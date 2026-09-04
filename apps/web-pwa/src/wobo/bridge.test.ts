import { describe, expect, it } from 'bun:test';
import type { Sdk } from '@wobo/sdk';
import type { GroundPiece, GroundReport } from '../curriculum/placement';
import type { Topic } from '../data/model';
import { bridgeCard, bridgeFor, bridgeFromReport, missingGround } from './bridge';

/**
 * The audit's first finding: `masteredGround` and `composeBridge` were written, exported, and
 * called by nothing. The re-teaching machinery existed on paper. These tests are the wire.
 */

const topic = (id: string, name: string, prereqs: string[] = []): Topic => ({
  id,
  chapterId: 'ch1',
  name,
  blurb: '',
  prereqTopicIds: prereqs,
  kind: 'syllabus',
  xp: 120,
});

const FRACTIONS = topic('t-fractions', 'Fractions');
const RATIOS = topic('t-ratios', 'Ratios', ['t-fractions']);
const LINEAR = topic('t-linear', 'Linear equations', ['t-ratios', 't-fractions']);
const CATALOG = new Map([FRACTIONS, RATIOS, LINEAR].map((t) => [t.id, t]));
const lookup = (id: string) => CATALOG.get(id);

/** An engine that composes a real bridge lesson. */
function composingSdk(cards: { title: string; idea?: string }[]) {
  const asked: Record<string, unknown>[] = [];
  const sdk = {
    llm: {
      invoke: async (_capability: string, input: Record<string, unknown>) => {
        asked.push(input);
        return { capability: 'engine.compose', output: { cards }, track: 'track_2', cached: false };
      },
    },
  } as unknown as Sdk;
  return { sdk, asked };
}

/** An engine that refuses. The bridge must still be a bridge. */
const refusingSdk = {
  llm: {
    invoke: async () => {
      throw new Error('no route');
    },
  },
} as unknown as Sdk;

describe('the bridge is only laid where the ground is missing', () => {
  it('returns null when the learner already stands on everything the topic needs', async () => {
    const completed = new Set(['t-fractions', 't-ratios']);
    expect(await bridgeFor(refusingSdk, { topic: LINEAR, completed, lookup })).toBeNull();
  });

  it('returns null when the topic declares no prerequisites at all', async () => {
    expect(
      await bridgeFor(refusingSdk, { topic: FRACTIONS, completed: new Set(), lookup }),
    ).toBeNull();
  });

  it('names the missing ground, and stands the bridge on ground already owned', async () => {
    const completed = new Set(['t-fractions']);
    const lesson = await bridgeFor(refusingSdk, { topic: LINEAR, completed, lookup });
    expect(lesson).not.toBeNull();
    expect(lesson?.unmet.map((t) => t.id)).toEqual(['t-ratios']);
    expect(lesson?.ground.map((t) => t.id)).toEqual(['t-fractions']);
    expect(lesson?.opening).toContain('ratios');
    expect(lesson?.opening).toContain('fractions');
    // never a detour and never a reprimand
    expect(lesson?.opening.toLowerCase()).not.toContain('behind');
    expect(lesson?.arrival).toContain('linear equations');
  });
});

describe('the bridge seam belongs to whoever tests the ground', () => {
  it('an explicit unmet list wins over the static graph', async () => {
    // The graph says this learner is fine; a placement check says otherwise, and it wins.
    const completed = new Set(['t-fractions', 't-ratios']);
    const lesson = await bridgeFor(refusingSdk, {
      topic: LINEAR,
      completed,
      lookup,
      unmet: [RATIOS],
    });
    expect(lesson?.unmet.map((t) => t.id)).toEqual(['t-ratios']);
  });

  it('missingGround reads the graph when the caller does not know', () => {
    expect(
      missingGround({ topic: LINEAR, completed: new Set(['t-ratios']), lookup }).map((t) => t.id),
    ).toEqual(['t-fractions']);
  });
});

describe('the bridge is composed, and floors honestly when it cannot be', () => {
  it('asks the engine for a lesson scaffolded on the mastered ground', async () => {
    const { sdk, asked } = composingSdk([
      { title: 'a part of a whole', idea: 'three of four equal pieces, written down.' },
      { title: 'two parts compared', idea: 'the same two pieces, side by side.' },
      { title: 'the unknown part', idea: 'the piece we do not have yet, given a name.' },
    ]);
    const lesson = await bridgeFor(sdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    expect(asked[0]?.bridge_to).toBe('Linear equations');
    expect(asked[0]?.bridge_from).toEqual(['Fractions']);
    expect(lesson?.seeded).toBe(false);
    expect(lesson?.steps.map((s) => s.title)).toEqual([
      'a part of a whole',
      'two parts compared',
      'the unknown part',
    ]);
  });

  /**
   * The bridge kept `c.title` and threw the composed card away, so every step was a heading: the
   * card was a table of contents that then told the learner they were carrying the ground.
   */
  it('keeps what each step SAYS, not only what it is called', async () => {
    const { sdk } = composingSdk([
      { title: 'a part of a whole', idea: 'three of four equal pieces, written down.' },
      { title: 'two parts compared', idea: 'the same two pieces, side by side.' },
      { title: 'the unknown part', idea: 'the piece we do not have yet, given a name.' },
    ]);
    const lesson = await bridgeFor(sdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    expect(lesson?.steps.map((s) => s.idea)).toEqual([
      'three of four equal pieces, written down.',
      'the same two pieces, side by side.',
      'the piece we do not have yet, given a name.',
    ]);
    expect(lesson?.steps.every((s) => s.idea.trim().length > 0)).toBe(true);
  });

  it('a refusal is never an error state: the steps fall to the learner’s own completed ground', async () => {
    const lesson = await bridgeFor(refusingSdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    expect(lesson?.seeded).toBe(true);
    expect(lesson?.steps.some((s) => s.title.includes('fractions'))).toBe(true);
    expect(lesson?.steps.some((s) => s.title.includes('linear equations'))).toBe(true);
  });

  /**
   * A seeded bridge names the ground and teaches none of it. It must not then tell a learner who
   * has just said three times that the ground is new to them that they are carrying it.
   */
  it('a seeded bridge never claims the learner is carrying what it did not teach', async () => {
    const seeded = await bridgeFor(refusingSdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    expect(seeded?.seeded).toBe(true);
    expect(seeded?.arrival).not.toContain('carrying what it needs');

    const { sdk } = composingSdk([
      { title: 'one', idea: 'the first thing.' },
      { title: 'two', idea: 'the second thing.' },
      { title: 'three', idea: 'the third thing.' },
    ]);
    const taught = await bridgeFor(sdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    expect(taught?.seeded).toBe(false);
    expect(taught?.arrival).toContain('carrying what it needs');
  });
});

describe('the bridge is one card in front of the lesson, not a detour', () => {
  it('carries the opening, the steps and the arrival in a single card', async () => {
    const lesson = await bridgeFor(refusingSdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    const card = bridgeCard(lesson as NonNullable<typeof lesson>);
    expect(card.title).toContain('linear equations');
    expect(card.idea).toBe(String(lesson?.opening));
    expect(card.steps).toEqual(lesson?.steps ?? []);
    expect(card.reveal).toBe(String(lesson?.arrival));
    expect(card.prompt.trim().length).toBeGreaterThan(0);
  });

  /**
   * The steps were folded into `idea` with newlines and rendered through a style that sets no
   * white-space, so HTML collapsed them into one paragraph; and the prompt asked for a tap on a
   * step when the steps were inside that paragraph and the only control was Check.
   */
  it('keeps the steps as steps, and asks only for the tap the card actually has', async () => {
    const lesson = await bridgeFor(refusingSdk, {
      topic: LINEAR,
      completed: new Set(['t-fractions']),
      lookup,
    });
    const card = bridgeCard(lesson as NonNullable<typeof lesson>);
    expect(card.idea).not.toContain('\n');
    expect(card.steps.length).toBeGreaterThan(0);
    expect(card.prompt.toLowerCase()).not.toContain('tap the step');
    expect(card.seeded).toBe(true);
  });
});

describe('the bridge meets the placement check where it hands off', () => {
  const piece = (t: typeof FRACTIONS, extra: Partial<GroundPiece> = {}): GroundPiece => ({
    topicId: t.id,
    name: t.name,
    reason: 'editorial',
    depth: 1,
    band: 'not_started',
    evidence: 'checked',
    ...extra,
  });

  const report = (unmet: GroundPiece[], solid: GroundPiece[] = []): GroundReport => ({
    topicId: LINEAR.id,
    topicName: LINEAR.name,
    unmet,
    solid,
    claimed: [],
    at: '2026-09-04T10:00:00.000Z',
  });

  it('teaches over what the check found missing, standing on what it found solid', async () => {
    const { sdk, asked } = composingSdk([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const lesson = await bridgeFromReport(
      sdk,
      LINEAR,
      report([piece(RATIOS)], [piece(FRACTIONS, { band: 'secure' })]),
      lookup,
    );
    expect(lesson?.unmet.map((t) => t.id)).toEqual(['t-ratios']);
    expect(lesson?.ground.map((t) => t.id)).toEqual(['t-fractions']);
    expect(asked[0]?.bridge_from).toEqual(['Fractions']);
  });

  it('a check that found the ground solid asks for no bridge at all', async () => {
    const lesson = await bridgeFromReport(
      refusingSdk,
      LINEAR,
      report([], [piece(RATIOS), piece(FRACTIONS)]),
      lookup,
    );
    expect(lesson).toBeNull();
  });

  it('ground the learner only claimed is never what the bridge is stood on', async () => {
    const claimedOnly: GroundReport = {
      ...report([piece(RATIOS)]),
      claimed: [piece(FRACTIONS, { evidence: 'claimed', band: 'developing' })],
    };
    const lesson = await bridgeFromReport(refusingSdk, LINEAR, claimedOnly, lookup);
    expect(lesson?.ground).toEqual([]);
    expect(lesson?.opening).not.toContain('you already have');
  });

  /**
   * The report used to BE the completed set, so a learner with twenty finished topics behind them
   * had all twenty thrown away and the bridge was asked with nothing to stand on.
   */
  it('stands on the learner’s whole history, not only the three pieces this check asked about', async () => {
    const { sdk, asked } = composingSdk([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const lesson = await bridgeFromReport(
      sdk,
      LINEAR,
      report([piece(RATIOS)]),
      lookup,
      new Set(['t-fractions']), // finished long before this check, and never asked about here
    );
    expect(lesson?.ground.map((t) => t.id)).toEqual(['t-fractions']);
    expect(asked[0]?.bridge_from).toEqual(['Fractions']);
  });

  it('a check that just found ground missing outranks an old tick on the same topic', async () => {
    const lesson = await bridgeFromReport(
      refusingSdk,
      LINEAR,
      report([piece(FRACTIONS)]),
      lookup,
      new Set(['t-fractions', 't-ratios']),
    );
    expect(lesson?.unmet.map((t) => t.id)).toEqual(['t-fractions']);
    expect(lesson?.ground.map((t) => t.id)).not.toContain('t-fractions');
  });

  it('a piece whose topic left the registry keeps the check’s own name, never an invention', async () => {
    const lesson = await bridgeFromReport(
      refusingSdk,
      LINEAR,
      report([piece(RATIOS)]),
      () => undefined,
    );
    expect(lesson?.unmet.map((t) => t.name)).toEqual(['Ratios']);
  });
});
