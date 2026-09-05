/**
 * The re-teach ladder, run for real, so the harness can prove it FIRES rather than trusting that
 * it exists.
 *
 * Wave 10 built `apps/web-pwa/src/wobo/reteach.ts`: two misses on the same concept and Wobo
 * changes approach on its own, moving an AXIS — method, representation, example, voice — never
 * repeating the same explanation louder. Its unit tests prove the chooser picks the right rung.
 * Nothing proved the rung then reaches the tutor and comes back as a genuinely different lesson.
 *
 * This probe is the first half of that proof: it drives the real module, with the real durable
 * record behind it, and prints what the ladder actually decided — the rung, the axis, the
 * modality it moves from and to, the event it recorded, and the SENTENCE Wobo is asked with. The
 * Python side then sends those sentences through the real gateway and marks the answers.
 *
 * Run:  bun services/gateway/harness/ladder_probe.ts '{"topic":"...","world":"cricket"}'
 */

/**
 * Bun has no localStorage and the tried-list is DURABLE — it has to survive a reload — so the
 * module needs somewhere to survive in. Same shim the module's own test uses.
 */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
(globalThis as unknown as { localStorage: Storage }).localStorage =
  (globalThis as unknown as { localStorage?: Storage }).localStorage ??
  (new MemoryStorage() as unknown as Storage);

import type { Sdk } from '../../../packages/sdk/src/index';
import {
  RETEACH_AFTER_MISSES,
  resetReteach,
  reteachOnMiss,
} from '../../../apps/web-pwa/src/wobo/reteach';

interface Input {
  topic: string;
  world?: string;
  /** How many misses to feed it. Two is the threshold; four walks the ladder further. */
  misses?: number;
}

const recorded: { type: string; payload: unknown }[] = [];
const sdk = {
  events: {
    record: (type: string, payload: unknown) => {
      recorded.push({ type, payload });
    },
  },
} as unknown as Sdk;

const input: Input = JSON.parse(process.argv[2] ?? '{"topic":"equivalent fractions"}');
const conceptId = `harness:${input.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

resetReteach();

const turns: unknown[] = [];
const total = input.misses ?? 4;
for (let i = 1; i <= total; i++) {
  const turn = reteachOnMiss(sdk, {
    nodeId: 'harness-node',
    conceptId,
    from: 'opener',
    context: { topic: input.topic, world: input.world },
  });
  turns.push(
    turn === null
      ? { miss: i, switched: false }
      : {
          miss: i,
          switched: true,
          approach: turn.approach.id,
          axis: turn.approach.axis,
          from: turn.from,
          to: turn.to,
          reason: turn.reason,
          line: turn.line,
          ask: turn.ask,
          fresh: turn.fresh,
        },
  );
}

process.stdout.write(
  `${JSON.stringify({ threshold: RETEACH_AFTER_MISSES, turns, events: recorded }, null, 2)}\n`,
);
