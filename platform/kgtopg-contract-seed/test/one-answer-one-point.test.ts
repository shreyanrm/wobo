import { describe, expect, it } from 'bun:test';
import { type Actor, type Context, makeEvent, type WoboEvent } from '@wobo/contracts';
import { ATOM_NODE_IDS } from '../src/atom-seed';
import { InMemoryKgtopg } from '../src/reference/in-memory';

/**
 * ONE ANSWER IS ONE PIECE OF EVIDENCE.
 *
 * The practice run reports every answer on two planes: the learn loop's
 * `learn.attempt.submitted.v1` and the practice plane's `practice.item.answered.v1`. Both are
 * evidence-bearing, and until 2026-09-16 each was counted as its own point, so the band's bars
 * (three unaided right for `secure`, four for `independent`, over a window of ten) were met by two
 * right answers. With the course ending a topic at the band, a child who got the first two right
 * was told the topic was theirs. The two reports of one answer are one point now; two answers are
 * still two, even to the same item.
 */

const actor: Actor = {
  subject_id: '00000000-0000-7000-8000-000000000001',
  surface: 'pwa',
  session_id: '00000000-0000-7000-8000-0000000000a1',
};
const context: Context = { app: 'learner', env: 'dev', consent_tier: 'un_elevated' };
const ITEM = '00000000-0000-7000-8000-000000000101';

let n = 0;
const id = () => {
  n += 1;
  return `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
};

function onBothPlanes(node: string, correct: boolean, latency: number, item = ITEM): WoboEvent[] {
  const response = { kind: 'numeric' as const, value: correct ? 5 : 9 };
  return [
    makeEvent({
      event_id: id(),
      event_type: 'learn.attempt.submitted.v1',
      actor,
      context,
      payload: {
        node_id: node,
        item_id: item,
        response,
        correct,
        aided: false,
        independence_signal: 0.95,
        latency_ms: latency,
        attempt_index: 0,
      },
    }),
    makeEvent({
      event_id: id(),
      event_type: 'practice.item.answered.v1',
      actor,
      context,
      payload: {
        node_id: node,
        item_id: item,
        response,
        correct,
        latency_ms: latency,
        independence_signal: 0.95,
      },
    }),
  ];
}

async function bandOf(kg: InMemoryKgtopg, node: string): Promise<string | undefined> {
  const bands = await kg.mastery.getBands(actor.subject_id);
  return bands.find((b) => b.node_id === node)?.band;
}

describe('InMemoryKgtopg — one answer, one point', () => {
  it('counts an answer reported on both planes once', async () => {
    const kg = new InMemoryKgtopg();
    const node = ATOM_NODE_IDS.linearEquations;
    for (const e of onBothPlanes(node, true, 4100)) await kg.consume(e);
    for (const e of onBothPlanes(node, true, 5200, '00000000-0000-7000-8000-000000000102')) {
      await kg.consume(e);
    }
    expect(kg.snapshotFor(actor.subject_id).nodes[node]?.evidence).toHaveLength(2);
    expect(await bandOf(kg, node)).toBe('developing');
    for (const e of onBothPlanes(node, true, 3900, '00000000-0000-7000-8000-000000000103')) {
      await kg.consume(e);
    }
    expect(await bandOf(kg, node)).toBe('secure');
  });

  it('still counts two answers to the same item as two, even at the same speed', async () => {
    const kg = new InMemoryKgtopg();
    const node = ATOM_NODE_IDS.linearEquations;
    for (const e of [...onBothPlanes(node, true, 4000), ...onBothPlanes(node, true, 4000)]) {
      await kg.consume(e);
    }
    expect(kg.snapshotFor(actor.subject_id).nodes[node]?.evidence).toHaveLength(2);
  });

  it('keeps the redelivery of one event idempotent, as it always was', async () => {
    const kg = new InMemoryKgtopg();
    const node = ATOM_NODE_IDS.linearEquations;
    const both = onBothPlanes(node, true, 4000);
    for (const e of [...both, ...both]) await kg.consume(e);
    expect(kg.snapshotFor(actor.subject_id).nodes[node]?.evidence).toHaveLength(1);
  });
});
