import { type EventType, makeEvent, newId, type PayloadOf, type WoboEvent } from '@wobo/contracts';
import type { EventConsumer } from '@wobo/kgtopg-contract-seed';
import type { SdkConfig } from './config';
import type { SupabaseRest } from './supabase';
import type { SyncHealth } from './sync-health';

/**
 * The event backbone. Every meaningful action records one WoboEvent through the real contract.
 * Mock-first on the TRANSPORT: in local mode events go to an in-memory log and are handed to the
 * KGtoPG consumer (so evidence-bearing events update mastery). In live mode the Supabase outbox
 * writer (below) additionally batches every event into `learner.outbox`, where the relay publishes
 * them UP to platform.events — zero change to callers. `record` stamps the envelope from the
 * session so surfaces just name the event type and payload.
 */
export interface EventProvider {
  record<T extends EventType>(
    eventType: T,
    payload: PayloadOf<T>,
    context?: { ontologyNodeId?: string; courseId?: string },
  ): WoboEvent<T>;
  getLog(): WoboEvent[];
  countByType(): Record<string, number>;
}

/** A consumer rejection that could not be awaited — kept for diagnostics, never thrown at a tap. */
export interface ConsumeFailure {
  eventId: string;
  error: string;
}

/** How many consumer failures are kept; the newest win (a diagnostic, not a queue). */
const CONSUME_FAILURE_CAP = 20;

export class InMemoryEventProvider implements EventProvider {
  private readonly log: WoboEvent[] = [];
  private readonly sessionId = newId();
  private readonly failures: ConsumeFailure[] = [];

  constructor(
    private readonly config: SdkConfig,
    private readonly consumer: EventConsumer,
  ) {}

  record<T extends EventType>(
    eventType: T,
    payload: PayloadOf<T>,
    context?: { ontologyNodeId?: string; courseId?: string },
  ): WoboEvent<T> {
    const event = makeEvent({
      event_type: eventType,
      payload,
      actor: {
        subject_id: this.config.mockSubjectId,
        surface: this.config.surface,
        session_id: this.sessionId,
      },
      context: {
        app: 'learner',
        env: 'dev',
        consent_tier: this.config.consentTierDefault,
        ...(context?.ontologyNodeId ? { ontology_node_id: context.ontologyNodeId } : {}),
        ...(context?.courseId ? { course_id: context.courseId } : {}),
      },
    });
    // A concrete WoboEvent<T> is a member of the WoboEvent union; TS needs the widening cast.
    const stored = event as WoboEvent;
    this.log.push(stored);
    // The consumer is idempotent; evidence-bearing events update the learner's mastery bands.
    // Deliberately not awaited — recording an event must never block a tap — but a floating promise
    // still has to answer for itself: a rejection is recorded here as a diagnostic instead of
    // escaping as an unhandled rejection (which, in a browser, is a hard error on the page).
    void this.consumer.consume(stored).catch((err: unknown) => this.noteFailure(stored, err));
    return event;
  }

  /** Record a consumer rejection: mastery just did not move for this event; nothing else breaks. */
  private noteFailure(event: WoboEvent, err: unknown): void {
    this.failures.push({
      eventId: event.event_id,
      error: err instanceof Error ? err.message : String(err),
    });
    if (this.failures.length > CONSUME_FAILURE_CAP) this.failures.shift();
  }

  /** Consumer rejections seen this session (visible for tests/diagnostics). */
  get consumeFailures(): readonly ConsumeFailure[] {
    return this.failures;
  }

  getLog(): WoboEvent[] {
    return this.log;
  }

  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.log) {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    }
    return counts;
  }
}

/** The longest a failed batch ever waits before trying again. A returning network is picked up. */
export const OUTBOX_MAX_BACKOFF_MS = 60_000;

/**
 * The live transport: everything InMemoryEventProvider does (log + immediate local mastery), plus
 * batched inserts into `learner.outbox` via `outbox_append_batch` — the transactional-outbox side
 * of the existing relay pattern (relay.ts publishes rows UP; outbox_append dedupes on event_id, so
 * at-least-once retries are no-ops). A failed flush re-queues the batch and retries on the next
 * record/flush (and on its own re-armed timer, so a batch is never left waiting on the learner);
 * the local log and mastery loop are never blocked by the network.
 *
 * WHOSE ID DOES A QUEUED WRITE LAND UNDER? The learner who recorded it, always, and there is a
 * belt and braces for it. Each event is stamped with the attribution subject at `record` time
 * (`InMemoryEventProvider.record`, from the config the SDK was assembled with), and the queue is
 * never re-stamped. Server side, `learner.outbox_append` (migration 0002) refuses outright when
 * `auth.uid()` is not the event's `actor.subject_id`, so a batch that somehow met a different
 * session's token is rejected rather than filed under the wrong child. And the app-side sign-out
 * navigates (`shell/CommandPalette.tsx`), which tears this queue down with the document, so the
 * two-learners-one-page case does not arise in the first place. What WAS wrong is what happens
 * after such a refusal: the retry re-armed the same 800ms timer forever, hammering a server that
 * had already said no. Hence the backoff below.
 *
 * ponytail: the pending queue is in-memory — events recorded fully offline that never see another
 * flush are lost with the tab; move the queue to localStorage if offline sessions must survive.
 * Keyed by subject when it moves, or it becomes the leak the paragraph above rules out.
 */
export class SupabaseOutboxEventProvider extends InMemoryEventProvider {
  private pending: WoboEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive failed flushes. Drives the backoff; reset by the first one that lands. */
  private flushFailures = 0;

  constructor(
    config: SdkConfig,
    consumer: EventConsumer,
    private readonly rest: Pick<SupabaseRest, 'rpc'>,
    private readonly flushAfterMs = 800,
    private readonly maxBatch = 20,
    /** Where a failed flush is counted. See `sync-health.ts`. */
    private readonly health?: SyncHealth,
  ) {
    super(config, consumer);
    this.health?.register('events', () => this.flushOrThrow());
  }

  /**
   * How long the next attempt waits: the base delay doubled once per consecutive failure, capped.
   * Zero failures is the ordinary batching delay, so a working device is unchanged.
   */
  get nextAttemptInMs(): number {
    return Math.min(this.flushAfterMs * 2 ** this.flushFailures, OUTBOX_MAX_BACKOFF_MS);
  }

  /** Stop the timer. For a test, and for any caller that wants the queue to stop retrying. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  override record<T extends EventType>(
    eventType: T,
    payload: PayloadOf<T>,
    context?: { ontologyNodeId?: string; courseId?: string },
  ): WoboEvent<T> {
    const event = super.record(eventType, payload, context);
    this.pending.push(event as WoboEvent);
    if (this.pending.length >= this.maxBatch) {
      void this.flush();
    } else {
      this.arm();
    }
    return event;
  }

  /** Arm the flush timer if nothing is armed — the batch always has a next attempt of its own. */
  private arm(): void {
    if (this.timer || this.pending.length === 0) return;
    this.timer = setTimeout(() => void this.flush(), this.nextAttemptInMs);
  }

  /** Push the pending batch to the outbox. Resolves to the number of events accepted. */
  async flush(): Promise<number> {
    try {
      return await this.flushOrThrow();
    } catch {
      return 0; // recording an event never throws at a tap, and neither does giving up on one
    }
  }

  /**
   * The same flush, but it reports the refusal to its caller. The retry button needs to know
   * whether the push landed; `flush` above is the fire-and-forget door every other caller uses.
   */
  private async flushOrThrow(): Promise<number> {
    this.stop();
    if (this.pending.length === 0) return 0;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.rest.rpc('outbox_append_batch', { p_events: batch });
      this.flushFailures = 0;
      this.health?.succeeded('events');
      return batch.length;
    } catch (err) {
      this.pending = [...batch, ...this.pending]; // keep order; retry on the next record/flush
      this.flushFailures += 1;
      this.health?.failed('events', err);
      // Re-arm: a failed flush cleared the timer, so without this the batch would sit until the
      // learner happened to record another event — and a tab closed first takes it with them.
      // The wait grows with the run, so a permanent refusal is not a hot loop against the server.
      this.arm();
      throw err;
    }
  }

  /** Events recorded but not yet accepted by the outbox (visible for tests/diagnostics). */
  get pendingCount(): number {
    return this.pending.length;
  }
}
