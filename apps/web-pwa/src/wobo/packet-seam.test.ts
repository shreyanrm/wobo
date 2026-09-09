import { beforeEach, describe, expect, it } from 'bun:test';
import { chooseGlass, createFocus, type GlassMap, resetFocusIds } from '@wobo/wobo';

/** A localStorage stand-in, installed before the mind store is imported (it reads through it). */
class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new FakeStorage();

const {
  buildTurnPacket,
  mindFrom,
  noteAccount,
  setTurnFocus,
  taskFrom,
  turnFocus,
  woboTurnPayload,
} = await import('./capabilities');
const { rememberInterests } = await import('../store/mind');

/** The glass as the reader chose it: the one card on the course screen, with its step. */
const glass = (): GlassMap =>
  chooseGlass(
    [
      {
        id: 'card-3',
        role: 'step',
        text: '2x + 3 = 11',
        box: [0, 0, 200, 40],
        order: 0,
        visible: 1,
        meaning: 'step:3',
      },
    ],
    { w: 390, h: 844, scrollY: 0 },
  );

const context = () => ({
  page: { route: 'course', state: { topicId: 'm2-1', mode: 'story' } },
  curriculum: { nodeName: 'Linear equations', band: 'developing' },
  session: { sessionId: 's1', recentEvents: ['practice.attempt (correct=false)', 'card.viewed'] },
  turn: { recentTurns: [{ role: 'user' as const, text: 'why is this wrong' }] },
  lifetime: {},
  // The course card, exactly as the registry publishes it: the beat is on the screen, not in a
  // variable the app happens to remember.
  targets: [
    {
      id: 'course-card',
      kind: 'card',
      label: 'the card on stage',
      scene: { state: { beat: 3, of: 7, attempt: 2, correct: 4 }, drivable: false },
    },
  ],
});

beforeEach(() => {
  resetFocusIds();
  setTurnFocus(null);
  noteAccount(null);
});

describe('the turn packet', () => {
  it('carries the route, the screen, the mind digest and the recent turns', () => {
    const packet = buildTurnPacket(context(), { glass: glass() });
    expect(packet.v).toBe(1);
    expect(packet.route).toBe('course');
    expect(packet.glass?.[0]?.id).toBe('card-3');
    expect(packet.glass?.[0]?.meaning).toBe('step:3');
    expect(packet.mind).toMatchObject({
      band: 'developing',
      topic: 'Linear equations',
      mistakes: ['practice.attempt (correct=false)'],
    });
    expect(packet.turns).toEqual([{ role: 'learner', text: 'why is this wrong' }]);
  });

  /**
   * §5.3 names five things in the mind digest and three in the task state. The builder always fit
   * all eight; the production feed sent three, so the brain never saw the world the learner asked
   * to be taught in, the door the brain itself opened, or which beat they were stuck on.
   */
  it('digests the whole mind §5.3 asks for — analogy, consent tier and plan included', () => {
    expect(
      mindFrom(context(), { analogy: 'cricket', consentTier: 'un_elevated', plan: 'free' }),
    ).toEqual({
      band: 'developing',
      topic: 'Linear equations',
      mistakes: ['practice.attempt (correct=false)'],
      analogy: 'cricket',
      consentTier: 'un_elevated',
      plan: 'free',
    });
  });

  it('carries the world the learner asked for and the door the brain opened, on the real feed', () => {
    rememberInterests(['cricket', 'space']);
    noteAccount({ plan: 'free', consentTier: 'un_elevated' });
    const packet = buildTurnPacket(context(), { glass: glass() });
    expect(packet.mind?.analogy).toBe('cricket');
    expect(packet.mind?.consentTier).toBe('un_elevated');
    expect(packet.mind?.plan).toBe('free');
  });

  it('tells the brain where in the task they are — the beat, the attempt and the score', () => {
    expect(taskFrom(context())).toEqual({ beat: '3 of 7', attempt: 2, score: 4, mode: 'story' });
    expect(buildTurnPacket(context(), { glass: glass() }).task).toEqual({
      beat: '3 of 7',
      attempt: 2,
      score: 4,
      mode: 'story',
    });
  });

  it("lets a caller's own rung win over the screen's, without losing the beat", () => {
    const packet = buildTurnPacket(context(), {
      glass: glass(),
      task: { mode: 'say_it_in_my_world' },
    });
    expect(packet.task).toEqual({
      beat: '3 of 7',
      attempt: 2,
      score: 4,
      mode: 'say_it_in_my_world',
    });
  });

  it('sends no task state at all where the screen has none', () => {
    expect(buildTurnPacket({}, { glass: null }).task).toBeUndefined();
  });

  it('picks up the focus the gesture layer last made', () => {
    const focus = createFocus({
      kind: 'lasso',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      targetIds: ['card-3'],
      text: '2x + 3 = 11',
    });
    setTurnFocus(focus);
    expect(turnFocus()).toBe(focus);
    const packet = buildTurnPacket(context(), { glass: glass() });
    expect(packet.focus?.targetIds).toEqual(['card-3']);
    expect(packet.focus?.numbers).toEqual([2, 3, 11]);
  });

  it('sends no focus when the learner has pointed at nothing', () => {
    expect(buildTurnPacket(context(), { glass: glass() }).focus).toBeUndefined();
  });

  it('stays inside the token budget', () => {
    const packet = buildTurnPacket(context(), { glass: glass(), budget: { maxTokens: 120 } });
    expect(packet.tokens).toBeLessThanOrEqual(120);
  });
});

describe('the wobo.turn payload', () => {
  it('adds the packet without disturbing a single existing context field', () => {
    const assembled = context();
    const payload = woboTurnPayload(assembled, { glass: glass() });
    for (const key of Object.keys(assembled)) {
      expect(payload.context[key as keyof typeof assembled]).toEqual(
        assembled[key as keyof typeof assembled],
      );
    }
    expect(payload.context.packet.v).toBe(1);
  });

  it('does not mutate the context it was given', () => {
    const assembled = context();
    woboTurnPayload(assembled, { glass: glass() });
    expect('packet' in assembled).toBe(false);
  });

  it('survives an empty context — the first turn on a bare screen', () => {
    const payload = woboTurnPayload({}, { glass: null });
    expect(payload.context.packet.v).toBe(1);
    expect(payload.context.packet.route).toBeUndefined();
  });
});
