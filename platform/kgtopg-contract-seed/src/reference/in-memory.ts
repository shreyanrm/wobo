import type { MasteryBand, WoboEvent } from '@wobo/contracts';
import { ATOM_NODES } from '../atom-seed';
import type {
  ConsentGrant,
  ConsentTierView,
  MasteryBandView,
  OntologyNode,
  TwinAnswer,
} from '../dto';
import type { EventConsumer, KGtoPG } from '../interface';
import { bandRank, chooseNextNode, MASTERY_FLOOR } from './chooser';

const MOCK_SUBJECT = '00000000-0000-7000-8000-000000000001';

/**
 * One answered thing, kept. `event_id` is the dedupe key: it survives into the snapshot, so an
 * outbox replay or a second device re-delivering the same event after a reload counts once.
 */
export interface MasteryEvidencePoint {
  event_id: string;
  correct: boolean;
  independence: number;
  /** ISO stamp of the moment, for the recency window. */
  at: string;
}

/** What is known about one node: the band last derived, and the evidence it was derived from. */
export interface MasteryNodeRecord {
  band: MasteryBand;
  evidence: MasteryEvidencePoint[];
}

/**
 * One learner's mastery, in a shape that can be written to `learner.mastery_cache` and read back.
 * This is the thing that used to die on reload.
 */
export interface MasterySnapshot {
  nodes: Record<string, MasteryNodeRecord>;
}

/** A band crossing, reported so the app can persist it and emit `mastery.band.changed.v1`. */
export interface MasteryBandChange {
  node_id: string;
  from: MasteryBand;
  to: MasteryBand;
  triggered_by_event_id?: string;
}

/**
 * How much evidence is kept per node — the newest answers, oldest discarded.
 *
 * Every threshold below reads at most the last ten answers (the reliability window) or counts to
 * four (the independence bar), so sixteen is comfortably more than any band needs while keeping
 * both the persisted row and the localStorage cache small: a learner with two hundred topics under
 * their belt carries a few hundred kilobytes, not megabytes, and every answer they give rewrites it.
 *
 * The consequence is deliberate: mastery is about where a learner stands now, so a distant win they
 * have not repeated in sixteen answers stops holding a band up on its own.
 */
const EVIDENCE_CAP = 16;
/** How many recent answers the reliability check looks at. */
const RECENT_WINDOW = 10;

/** Clean answers with no help behind them that put a node at the floor. */
const SECURE_UNAIDED_CORRECT = 3;

/**
 * The same standing, earned with help. Twice the unaided bar, because a hinted answer is weaker
 * evidence than an unaided one, and it sits inside the reliability window like every other route to
 * `secure`: this is a longer road to the floor, never a free one.
 */
const SECURE_AIDED_CORRECT = 6;
/** The share of that window that has to be correct before a node is called secure or independent. */
const RELIABILITY_FLOOR = 0.6;

export interface InMemoryKgtopgOptions {
  consentTier?: ConsentTierView;
  nodes?: OntologyNode[];
  /** Evidence recovered from storage at boot, per subject id. Mastery resumes instead of restarting. */
  evidence?: Record<string, MasterySnapshot>;
  /**
   * Called after evidence lands (and after a hydrate) with the whole snapshot for that subject and
   * whatever bands crossed. The app persists the snapshot and emits the crossing; the reference
   * itself knows nothing of storage or of the event backbone.
   */
  onChange?: (subjectId: string, snapshot: MasterySnapshot, changes: MasteryBandChange[]) => void;
}

/**
 * The in-repo KGtoPG reference — enough to build and prove the atom on seed data, with the same
 * interface the live Supabase-backed client will present. It is BOTH the governed-read side and the
 * event store: consuming an evidence-bearing event updates the learner's bands. Idempotent on event_id.
 */
export class InMemoryKgtopg implements KGtoPG, EventConsumer {
  private readonly nodes: Map<string, OntologyNode>;
  private readonly seen = new Set<string>();
  private readonly evidence = new Map<string, MasteryEvidencePoint[]>();
  private readonly onChange: InMemoryKgtopgOptions['onChange'];
  private consentTier: ConsentTierView;

  readonly identity: KGtoPG['identity'];
  readonly ontology: KGtoPG['ontology'];
  readonly mastery: KGtoPG['mastery'];
  readonly twin: KGtoPG['twin'];
  readonly consent: KGtoPG['consent'];

  constructor(opts: InMemoryKgtopgOptions = {}) {
    const nodeList = opts.nodes ?? ATOM_NODES;
    this.nodes = new Map(nodeList.map((n) => [n.node_id, n]));
    this.consentTier = opts.consentTier ?? 'un_elevated';
    this.onChange = opts.onChange;
    for (const [subject, snapshot] of Object.entries(opts.evidence ?? {})) {
      this.adopt(subject, snapshot);
    }

    this.identity = {
      resolveOrCreateSubject: async () => ({ subject_id: MOCK_SUBJECT }),
    };

    this.ontology = {
      getNode: async (nodeId) => this.nodes.get(nodeId) ?? null,
      getPrerequisites: async (nodeId) => {
        const node = this.nodes.get(nodeId);
        if (!node) return [];
        return node.prerequisite_ids
          .map((id) => this.nodes.get(id))
          .filter((n): n is OntologyNode => n != null);
      },
      compileCourse: async (spec) => {
        const nodes = spec.seedNodeIds?.length
          ? spec.seedNodeIds
              .map((id) => this.nodes.get(id))
              .filter((n): n is OntologyNode => n != null)
          : [...this.nodes.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        return { course_id: `course-${spec.title.toLowerCase().replace(/\s+/g, '-')}`, nodes };
      },
    };

    this.mastery = {
      getBands: async (subjectId) => this.bandsFor(subjectId),
      getNextBestNode: async (subjectId) => this.nextBestNode(subjectId),
      recordEvidence: async (event) => {
        await this.consume(event);
      },
    };

    this.twin = {
      query: async (subjectId, question) => this.answerTwin(subjectId, question),
    };

    this.consent = {
      getTier: async () => this.consentTier,
      grants: async () => this.grantsFor(),
    };
  }

  /** Idempotent event consumption (the "up" write target). */
  async consume(event: WoboEvent): Promise<{ accepted: boolean; deduped: boolean }> {
    if (this.seen.has(event.event_id)) return { accepted: true, deduped: true };
    this.seen.add(event.event_id);
    this.applyEvidence(event);
    return { accepted: true, deduped: false };
  }

  setConsentTier(tier: ConsentTierView): void {
    this.consentTier = tier;
  }

  /**
   * Take evidence recovered from storage. Merges by event id (never double-counts a point that is
   * already held), re-derives every band, and reports the snapshot back through `onChange` with no
   * crossings: recovering what was already true is not a mastery moment and must never ignite one.
   */
  hydrateEvidence(subjectId: string, snapshot: MasterySnapshot): MasterySnapshot {
    this.adopt(subjectId, snapshot);
    const merged = this.snapshotFor(subjectId);
    this.onChange?.(subjectId, merged, []);
    return merged;
  }

  /** Everything known about this learner's nodes, ready to be written down. */
  snapshotFor(subjectId: string): MasterySnapshot {
    const nodes: Record<string, MasteryNodeRecord> = {};
    const prefix = `${subjectId}|`;
    for (const [key, evidence] of this.evidence) {
      if (!key.startsWith(prefix)) continue;
      const nodeId = key.slice(prefix.length);
      nodes[nodeId] = { band: this.computeBand(evidence), evidence: [...evidence] };
    }
    return { nodes };
  }

  private adopt(subjectId: string, snapshot: MasterySnapshot): void {
    for (const [nodeId, record] of Object.entries(snapshot.nodes ?? {})) {
      const key = this.key(subjectId, nodeId);
      const held = this.evidence.get(key) ?? [];
      const byId = new Map(held.map((p) => [p.event_id, p]));
      for (const point of record.evidence ?? []) {
        if (!point?.event_id || byId.has(point.event_id)) continue;
        byId.set(point.event_id, point);
        this.seen.add(point.event_id); // a point already held must not be counted a second time
      }
      this.evidence.set(key, this.capped([...byId.values()]));
    }
  }

  /** Newest kept — the reliability window reads the tail, so the tail is what must survive. */
  private capped(points: MasteryEvidencePoint[]): MasteryEvidencePoint[] {
    const sorted = [...points].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return sorted.length > EVIDENCE_CAP ? sorted.slice(sorted.length - EVIDENCE_CAP) : sorted;
  }

  private key(subjectId: string, nodeId: string): string {
    return `${subjectId}|${nodeId}`;
  }

  private applyEvidence(event: WoboEvent): void {
    const subject = event.actor.subject_id;
    let point: { nodeId: string; ev: Omit<MasteryEvidencePoint, 'event_id' | 'at'> } | null = null;

    if (event.event_type === 'evidence.recorded.v1') {
      point = {
        nodeId: event.payload.node_id,
        ev: { correct: event.payload.correct, independence: event.payload.independence },
      };
    } else if (event.event_type === 'practice.item.answered.v1') {
      point = {
        nodeId: event.payload.node_id,
        ev: { correct: event.payload.correct, independence: event.payload.independence_signal },
      };
    } else if (event.event_type === 'learn.attempt.submitted.v1') {
      const raw = event.payload.independence_signal;
      // Aided attempts count for less toward the Independence keystone.
      point = {
        nodeId: event.payload.node_id,
        ev: { correct: event.payload.correct, independence: event.payload.aided ? raw * 0.5 : raw },
      };
    }

    if (!point) return;
    const key = this.key(subject, point.nodeId);
    const list = this.evidence.get(key) ?? [];
    const before = this.computeBand(list);
    list.push({
      event_id: event.event_id,
      at: event.occurred_at,
      correct: point.ev.correct,
      independence: point.ev.independence,
    });
    this.evidence.set(key, this.capped(list));
    const after = this.bandFor(subject, point.nodeId);
    const changes: MasteryBandChange[] =
      before === after
        ? []
        : [
            {
              node_id: point.nodeId,
              from: before,
              to: after,
              triggered_by_event_id: event.event_id,
            },
          ];
    this.onChange?.(subject, this.snapshotFor(subject), changes);
  }

  /**
   * The band, from the evidence. Counting alone is not enough: three good answers among twenty
   * wrong ones is not mastery, so `secure` and `independent` additionally require the recent run to
   * hold up. That is what lets a band fall back below the floor and pull a topic around again.
   *
   * THERE IS A WAY OUT FOR A LEARNER WHO TAKES THE HELP.
   *
   * An aided attempt is halved on the way in (`applyEvidence` below), so a hinted answer lands at
   * 0.30 independence and can never clear the 0.7 bar. With `secure` reachable only through that
   * bar, a learner who used a hint on every question could answer a hundred of them correctly and
   * still band `developing`: below the floor, so the chapter never says Mastered, so the chooser
   * sends them back into the same topic every time they open the board. The product offered the
   * help and then punished them for taking it, forever, with no path out but answering unaided.
   *
   * So `secure` now has two doors. Three clean unaided answers is the short one. The long one is
   * `SECURE_AIDED_CORRECT` correct answers of any independence, with the same reliability check in
   * front of it: mastery earned with support is still mastery, it just takes more of it to show.
   * `independent` keeps its single unaided door, because that band means exactly "without help".
   */
  private computeBand(points: MasteryEvidencePoint[] | undefined): MasteryBand {
    if (!points || points.length === 0) return 'not_started';
    const correct = points.filter((p) => p.correct);
    const independentCorrect = correct.filter((p) => p.independence >= 0.7);
    const highlyIndependent = correct.filter((p) => p.independence >= 0.9);
    const recent = points.slice(-RECENT_WINDOW);
    const reliable = recent.filter((p) => p.correct).length / recent.length >= RELIABILITY_FLOOR;
    if (reliable && highlyIndependent.length >= 4) return 'independent';
    if (reliable && independentCorrect.length >= SECURE_UNAIDED_CORRECT) return 'secure';
    if (reliable && correct.length >= SECURE_AIDED_CORRECT) return 'secure';
    if (correct.length >= 2) return 'developing';
    return 'emerging';
  }

  private bandFor(subjectId: string, nodeId: string): MasteryBand {
    return this.computeBand(this.evidence.get(this.key(subjectId, nodeId)));
  }

  private bandsFor(subjectId: string): MasteryBandView[] {
    return [...this.nodes.values()].map((node) => ({
      node_id: node.node_id,
      band: this.bandFor(subjectId, node.node_id),
      scope: 'node',
    }));
  }

  /**
   * The next node to teach. The ordering law lives in `chooser.ts` and is shared with the learn
   * flow, so the platform and the app can never drift into two different answers.
   */
  private nextBestNode(subjectId: string): OntologyNode | null {
    return chooseNextNode([...this.nodes.values()], (id) => this.bandFor(subjectId, id), {
      floor: MASTERY_FLOOR,
    });
  }

  private answerTwin(subjectId: string, question: string): TwinAnswer {
    const bands = this.bandsFor(subjectId);
    const weakest = bands.slice().sort((a, b) => bandRank(a.band) - bandRank(b.band))[0];
    const node = weakest ? this.nodes.get(weakest.node_id) : undefined;
    const answer = node
      ? `Right now your attention is best spent on ${node.name.toLowerCase()}. It is the next step that unlocks the most.`
      : 'There is not enough evidence yet to say. A short practice set will tell us more.';
    return {
      question,
      answer,
      // Honest conditional ranges, never a guarantee.
      ranges: [{ label: 'likely mastery within 3 focused sessions', low: 55, high: 80 }],
    };
  }

  private grantsFor(): ConsentGrant[] {
    if (this.consentTier === 'elevated') {
      return [
        { purpose: 'learning', scope: 'self', age_tier: 'minor' },
        { purpose: 'behavioural_personalisation', scope: 'self', age_tier: 'minor' },
      ];
    }
    // Un-elevated: teaching only, no profiling grant.
    return [{ purpose: 'learning', scope: 'self', age_tier: 'minor' }];
  }
}
