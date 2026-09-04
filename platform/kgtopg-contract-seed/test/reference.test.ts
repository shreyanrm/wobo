import { describe, expect, it } from 'bun:test';
import { type Actor, type Context, makeEvent, type WoboEvent } from '@wobo/contracts';
import { ATOM_NODE_IDS } from '../src/atom-seed';
import { InMemoryKgtopg, type MasteryBandChange } from '../src/reference/in-memory';

const actor: Actor = {
  subject_id: '00000000-0000-7000-8000-000000000001',
  surface: 'pwa',
  session_id: '00000000-0000-7000-8000-0000000000a1',
};
const context: Context = { app: 'learner', env: 'dev', consent_tier: 'un_elevated' };

function evidence(nodeId: string, correct: boolean, independence: number, id: string): WoboEvent {
  return makeEvent({
    event_id: id,
    event_type: 'evidence.recorded.v1',
    actor,
    context,
    payload: {
      evidence_id: id,
      node_id: nodeId,
      source: 'practice',
      correct,
      independence,
      gap_types: [],
    },
  });
}

describe('InMemoryKgtopg — ontology', () => {
  it('returns the atom node and its confirmed prerequisites', async () => {
    const kg = new InMemoryKgtopg();
    const node = await kg.ontology.getNode(ATOM_NODE_IDS.linearEquations);
    expect(node?.name).toContain('linear equations');
    const prereqs = await kg.ontology.getPrerequisites(ATOM_NODE_IDS.linearEquations);
    expect(prereqs.map((p) => p.node_id)).toEqual([ATOM_NODE_IDS.variables]);
  });
});

/** A submitted attempt, the shape PracticeRun sends: an aided answer carries 0.6, unaided 0.95. */
function attempt(
  nodeId: string,
  correct: boolean,
  aided: boolean,
  id: string,
  itemId = '00000000-0000-7000-8000-0000000000f1',
): WoboEvent {
  return makeEvent({
    event_id: id,
    event_type: 'learn.attempt.submitted.v1',
    actor,
    context,
    payload: {
      node_id: nodeId,
      item_id: itemId,
      response: { kind: 'numeric', value: 1 },
      correct,
      aided,
      independence_signal: aided ? 0.6 : 0.95,
      latency_ms: 1000,
      attempt_index: 0,
    },
  });
}

/**
 * THE LEARNER WHO TAKES THE HELP HAS TO BE ABLE TO LEAVE.
 *
 * An aided attempt is halved on the way in, so a hinted answer lands at 0.30 independence and can
 * never clear the 0.7 bar `secure` used to be the only door to. A child who used a hint on every
 * question could answer twelve of them correctly and still band `developing`: below the floor, so
 * the chapter never said Mastered, so the chooser sent them back into the same topic every time
 * they opened the board, with no way out but answering unaided. The product offered the help and
 * then punished them for taking it, forever.
 */
describe('InMemoryKgtopg — a learner who uses hints can still reach the floor', () => {
  it('lets steady aided correct answers reach secure, and keeps independent unaided', async () => {
    const kg = new InMemoryKgtopg();
    const node = ATOM_NODE_IDS.integers;
    for (let i = 0; i < 12; i++) {
      await kg.consume(
        attempt(
          node,
          true,
          true,
          `00000000-0000-7000-8000-000000${String(i).padStart(2, '0')}00a1`,
        ),
      );
    }
    const bands = await kg.mastery.getBands(actor.subject_id);
    const band = bands.find((b) => b.node_id === node)?.band;
    expect(band).toBe('secure');
    // `independent` still means what it says: it is not reachable with help behind every answer.
    expect(band).not.toBe('independent');
  });

  it('does not hand out the floor for a run that is mostly wrong', async () => {
    const kg = new InMemoryKgtopg();
    const node = ATOM_NODE_IDS.integers;
    for (let i = 0; i < 12; i++) {
      await kg.consume(
        attempt(
          node,
          i % 3 === 0,
          true,
          `00000000-0000-7000-8000-000000${String(i).padStart(2, '0')}00b2`,
        ),
      );
    }
    const bands = await kg.mastery.getBands(actor.subject_id);
    expect(bands.find((b) => b.node_id === node)?.band).not.toBe('secure');
  });
});

describe('InMemoryKgtopg — evidence and mastery', () => {
  it('is idempotent on event_id', async () => {
    const kg = new InMemoryKgtopg();
    const ev = evidence(ATOM_NODE_IDS.integers, true, 0.95, '00000000-0000-7000-8000-0000000000e1');
    expect((await kg.consume(ev)).deduped).toBe(false);
    expect((await kg.consume(ev)).deduped).toBe(true);
    const bands = await kg.mastery.getBands(actor.subject_id);
    const integers = bands.find((b) => b.node_id === ATOM_NODE_IDS.integers);
    // One correct attempt => emerging, and the duplicate did not double-count.
    expect(integers?.band).toBe('emerging');
  });

  it('reaches the independent band on repeated unaided correct evidence', async () => {
    const kg = new InMemoryKgtopg();
    for (let i = 0; i < 4; i++) {
      await kg.consume(
        evidence(
          ATOM_NODE_IDS.linearEquations,
          true,
          0.95,
          `00000000-0000-7000-8000-0000000000f${i}`,
        ),
      );
    }
    const bands = await kg.mastery.getBands(actor.subject_id);
    const target = bands.find((b) => b.node_id === ATOM_NODE_IDS.linearEquations);
    expect(target?.band).toBe('independent');
  });

  it('selects forward: the next-best node respects the prerequisite graph', async () => {
    const kg = new InMemoryKgtopg();
    let seq = 0;
    const nextId = () => `00000000-0000-7000-8000-${(seq++).toString(16).padStart(12, '0')}`;
    // Nothing mastered yet: the first node with satisfied prereqs is integers (no prereqs).
    expect((await kg.mastery.getNextBestNode(actor.subject_id))?.node_id).toBe(
      ATOM_NODE_IDS.integers,
    );
    // Secure integers + variables, then next-best becomes linear equations.
    for (const node of [ATOM_NODE_IDS.integers, ATOM_NODE_IDS.variables]) {
      for (let i = 0; i < 3; i++) {
        await kg.consume(evidence(node, true, 0.85, nextId()));
      }
    }
    expect((await kg.mastery.getNextBestNode(actor.subject_id))?.node_id).toBe(
      ATOM_NODE_IDS.linearEquations,
    );
  });
});

describe('InMemoryKgtopg — consent', () => {
  it('grants only teaching under un_elevated, and profiling only when elevated', async () => {
    const kg = new InMemoryKgtopg();
    expect(await kg.consent.getTier(actor.subject_id)).toBe('un_elevated');
    expect(await kg.consent.grants(actor.subject_id)).toHaveLength(1);
    kg.setConsentTier('elevated');
    expect(await kg.consent.getTier(actor.subject_id)).toBe('elevated');
    expect((await kg.consent.grants(actor.subject_id)).map((g) => g.purpose)).toContain(
      'behavioural_personalisation',
    );
  });
});

describe('InMemoryKgtopg — mastery survives a reload', () => {
  it('hands back a snapshot that a second instance resumes from mid-climb', async () => {
    const first = new InMemoryKgtopg();
    // Two independent correct answers: developing, one short of the secure floor.
    for (let i = 0; i < 2; i++) {
      await first.consume(
        evidence(ATOM_NODE_IDS.integers, true, 0.95, `00000000-0000-7000-8000-00000000ab0${i}`),
      );
    }
    const snapshot = first.snapshotFor(actor.subject_id);
    expect(snapshot.nodes[ATOM_NODE_IDS.integers]?.band).toBe('developing');
    expect(snapshot.nodes[ATOM_NODE_IDS.integers]?.evidence).toHaveLength(2);

    // The reload. Without the snapshot this learner starts the topic over.
    const reloaded = new InMemoryKgtopg({ evidence: { [actor.subject_id]: snapshot } });
    const before = await reloaded.mastery.getBands(actor.subject_id);
    expect(before.find((b) => b.node_id === ATOM_NODE_IDS.integers)?.band).toBe('developing');

    // One more good answer now finishes the climb instead of restarting it.
    await reloaded.consume(
      evidence(ATOM_NODE_IDS.integers, true, 0.95, '00000000-0000-7000-8000-00000000ab90'),
    );
    const after = await reloaded.mastery.getBands(actor.subject_id);
    expect(after.find((b) => b.node_id === ATOM_NODE_IDS.integers)?.band).toBe('secure');
  });

  it('never counts a recovered answer twice, however it comes back', async () => {
    const kg = new InMemoryKgtopg();
    const ev = evidence(ATOM_NODE_IDS.integers, true, 0.95, '00000000-0000-7000-8000-00000000ac01');
    await kg.consume(ev);
    const snapshot = kg.snapshotFor(actor.subject_id);
    // Hydrating with what it already holds, then re-delivering the same event, changes nothing.
    kg.hydrateEvidence(actor.subject_id, snapshot);
    await kg.consume(ev);
    expect(kg.snapshotFor(actor.subject_id).nodes[ATOM_NODE_IDS.integers]?.evidence).toHaveLength(
      1,
    );
  });

  it('reports every band crossing, and reports none for a hydrate', async () => {
    const changes: MasteryBandChange[] = [];
    const kg = new InMemoryKgtopg({
      onChange: (_subject, _snapshot, crossings) => changes.push(...crossings),
    });
    for (let i = 0; i < 3; i++) {
      await kg.consume(
        evidence(ATOM_NODE_IDS.integers, true, 0.85, `00000000-0000-7000-8000-00000000ad0${i}`),
      );
    }
    expect(changes.map((c) => c.to)).toEqual(['emerging', 'developing', 'secure']);
    expect(changes[2]?.triggered_by_event_id).toBe('00000000-0000-7000-8000-00000000ad02');

    changes.length = 0;
    kg.hydrateEvidence(actor.subject_id, kg.snapshotFor(actor.subject_id));
    expect(changes).toHaveLength(0);
  });

  it('will not call a topic secure on a run of wrong answers, however many old wins there were', async () => {
    const kg = new InMemoryKgtopg();
    let seq = 0;
    const nextId = () =>
      `00000000-0000-7000-8000-${(0xae00 + seq++).toString(16).padStart(12, '0')}`;
    for (let i = 0; i < 3; i++) {
      await kg.consume(evidence(ATOM_NODE_IDS.variables, true, 0.85, nextId()));
    }
    const secure = await kg.mastery.getBands(actor.subject_id);
    expect(secure.find((b) => b.node_id === ATOM_NODE_IDS.variables)?.band).toBe('secure');
    // Then the topic falls apart. Reliability over the recent window pulls it back below the floor.
    for (let i = 0; i < 8; i++) {
      await kg.consume(evidence(ATOM_NODE_IDS.variables, false, 0.85, nextId()));
    }
    const fallen = await kg.mastery.getBands(actor.subject_id);
    expect(fallen.find((b) => b.node_id === ATOM_NODE_IDS.variables)?.band).toBe('developing');
  });
});
