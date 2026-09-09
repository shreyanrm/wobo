import { describe, expect, it } from 'bun:test';
import { isConsequential, parseActions, reduceActions, type WoboAction } from '../src/actions';

describe('parseActions', () => {
  it('keeps valid actions and drops malformed ones', () => {
    const raw = [
      { type: 'say', text: 'try taking 3 from both sides' },
      { type: 'setMood', mood: 'hint' },
      { type: 'nope' }, // invalid
      { type: 'setMood' }, // missing mood -> invalid
    ];
    const actions = parseActions(raw);
    expect(actions.map((a) => a.type)).toEqual(['say', 'setMood']);
  });

  it('has no mark in its grammar: a drawing is a plan by glass id, never an action (INK §4)', () => {
    const raw = [
      { type: 'highlight', targetId: 'step-1', level: 'secondary' },
      { type: 'annotate', targetId: 'step-1', mark: 'circle' },
      { type: 'circle', targetId: 'eq' },
      { type: 'write', targetId: 'step-1', text: 'undo the +3' },
      { type: 'point', targetId: 'step-1' },
      { type: 'redrawMarks' },
      { type: 'say', text: 'kept' },
    ];
    expect(parseActions(raw)).toEqual([{ type: 'say', text: 'kept' }]);
  });

  it('carries no sentence beat: the hand keeps time from the plan, not from an action', () => {
    const [action] = parseActions([{ type: 'say', text: 'x', withSentence: 1 }]);
    expect(action).toEqual({ type: 'say', text: 'x' });
  });

  it('keeps forget actions and drops ones with an unknown scope', () => {
    const raw = [
      { type: 'forget', scope: 'show' },
      { type: 'forget', scope: 'fact', target: 'exam on Friday' },
      { type: 'forget', scope: 'all' },
      { type: 'forget', scope: 'everything' }, // invalid scope -> dropped
      { type: 'forget' }, // missing scope -> dropped
    ];
    const actions = parseActions(raw);
    expect(actions.map((a) => (a.type === 'forget' ? a.scope : a.type))).toEqual([
      'show',
      'fact',
      'all',
    ]);
  });

  it('returns [] for non-arrays', () => {
    expect(parseActions(null)).toEqual([]);
    expect(parseActions({ type: 'say', text: 'x' })).toEqual([]);
  });

  it('accepts setState and speak, drops malformed ones', () => {
    const raw = [
      { type: 'setState', targetId: 'sim-1', patch: { slider: 0.4, running: true } },
      { type: 'speak', text: 'watch what happens when I slow it down' },
      { type: 'setState', targetId: 'sim-1', patch: 'not-an-object' }, // invalid
      { type: 'setState', patch: {} }, // missing targetId -> invalid
      { type: 'speak' }, // missing text -> invalid
    ];
    const actions = parseActions(raw);
    expect(actions.map((a) => a.type)).toEqual(['setState', 'speak']);
  });
});

describe('isConsequential', () => {
  it('flags navigate / startPractice / switchModality only', () => {
    expect(isConsequential({ type: 'navigate', route: '/practice' })).toBe(true);
    expect(isConsequential({ type: 'startPractice', nodeId: 'n' })).toBe(true);
    expect(isConsequential({ type: 'say', text: 'hello' })).toBe(false);
    expect(isConsequential({ type: 'setMood', mood: 'hint' })).toBe(false);
  });
});

describe('reduceActions', () => {
  it('folds a turn into mood, says, and a single offer', () => {
    const actions: WoboAction[] = [
      { type: 'setMood', mood: 'thinking' },
      { type: 'say', text: 'look at this step' },
      { type: 'navigate', route: '/practice' },
      { type: 'startPractice', nodeId: 'n1' },
      { type: 'revealHint', level: 1 },
      { type: 'escalateHint' },
      { type: 'remember', text: 'exam on Friday' },
    ];
    const e = reduceActions(actions);
    expect(e.mood).toBe('thinking');
    expect(e.says).toEqual(['look at this step']);
    expect(e.revealHints).toEqual([1]);
    expect(e.escalateHints).toBe(1);
    expect(e.remembers).toEqual(['exam on Friday']);
    // the last consequential action is the one offer
    expect(e.offer?.type).toBe('startPractice');
    expect(e).not.toHaveProperty('highlights');
    expect(e).not.toHaveProperty('annotations');
    expect(e).not.toHaveProperty('notes');
  });

  it('folds forget actions into forgets, carrying scope and target — never an offer', () => {
    const actions: WoboAction[] = [
      { type: 'forget', scope: 'show' },
      { type: 'forget', scope: 'fact', target: 'exam on Friday' },
      { type: 'forget', scope: 'all' },
    ];
    const e = reduceActions(actions);
    expect(e.forgets).toEqual([
      { scope: 'show' },
      { scope: 'fact', target: 'exam on Friday' },
      { scope: 'all' },
    ]);
    expect(e.offer).toBeNull();
    expect(isConsequential(actions[0] as WoboAction)).toBe(false);
  });

  it('folds speak into speaks and setState into setStates — both immediate, never offered', () => {
    const actions: WoboAction[] = [
      { type: 'speak', text: 'here, let me show you' },
      { type: 'setState', targetId: 'sim-1', patch: { mass: 2 } },
      { type: 'setState', targetId: 'sim-1', patch: { mass: 10 } },
    ];
    const e = reduceActions(actions);
    expect(e.speaks).toEqual(['here, let me show you']);
    expect(e.setStates).toEqual([
      { targetId: 'sim-1', patch: { mass: 2 } },
      { targetId: 'sim-1', patch: { mass: 10 } },
    ]);
    expect(e.offer).toBeNull();
    expect(e.says).toEqual([]); // speak is the voice-locked channel, not say
    expect(isConsequential(actions[1] as WoboAction)).toBe(false);
  });
});
