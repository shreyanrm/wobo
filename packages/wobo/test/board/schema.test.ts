import { describe, expect, it } from 'bun:test';
import {
  BOARD_UNITS,
  CONTROL_KINDS,
  isDrawable,
  isPatch,
  MARK_KINDS,
  parseBoardEvent,
  parseBoardObject,
  parseBoardPlan,
  SHAPE_KINDS,
} from '../../src/board/schema';

describe('the board grammar', () => {
  it('covers every mark, shape and control BOARD.md §2 names', () => {
    expect([...MARK_KINDS]).toEqual([
      'point',
      'circle',
      'ring',
      'tick',
      'cross',
      'note',
      'underline',
      'arrow',
      'bracket',
      'strike',
      'number',
      'write',
      'erase',
      'wipe',
    ]);
    expect([...SHAPE_KINDS]).toEqual([
      'line',
      'polyline',
      'curve',
      'polygon',
      'ellipse',
      'axis',
      'grid',
      'table',
      'label',
      'tex',
      'bond',
      'atom',
      'region',
      'image',
    ]);
    expect([...CONTROL_KINDS]).toEqual(['slider', 'toggle', 'input', 'drag']);
    expect(BOARD_UNITS).toBe(1000);
  });

  it('accepts all four anchor forms', () => {
    for (const anchor of [
      { target: 'btn-next' },
      { object: 'v1', at: 'top' },
      { focus: 'f3' },
      { board: [120, 400] },
    ]) {
      expect(parseBoardObject({ id: 'a', kind: 'circle', anchor })).not.toBeNull();
    }
  });

  it('rejects an object with no anchor — nothing is placed by pixels', () => {
    expect(parseBoardObject({ id: 'a', kind: 'circle' })).toBeNull();
    expect(parseBoardObject({ id: 'a', kind: 'circle', anchor: { x: 10, y: 10 } })).toBeNull();
  });

  it('rejects an unknown kind and a bad style', () => {
    expect(parseBoardObject({ id: 'a', kind: 'sparkle', anchor: { board: [0, 0] } })).toBeNull();
    expect(
      parseBoardObject({
        id: 'a',
        kind: 'circle',
        anchor: { board: [0, 0] },
        style: { ink: '#ff0000' },
      }),
    ).toBeNull();
    expect(
      parseBoardObject({
        id: 'a',
        kind: 'circle',
        anchor: { board: [0, 0] },
        style: { weight: 9 },
      }),
    ).toBeNull();
  });

  it('a number carries its verification, and an unverified one is not drawable', () => {
    const base = { id: 'n', kind: 'number', anchor: { board: [0, 0] }, value: 25 };
    expect(parseBoardObject(base)).toBeNull(); // verified is required
    const unverified = parseBoardObject({ ...base, verified: false });
    const verified = parseBoardObject({ ...base, verified: true });
    expect(unverified).not.toBeNull();
    expect(verified).not.toBeNull();
    if (unverified) expect(isDrawable(unverified)).toBe(false);
    if (verified) expect(isDrawable(verified)).toBe(true);
  });

  it('everything that is not a number is drawable', () => {
    const o = parseBoardObject({ id: 'c', kind: 'circle', anchor: { board: [0, 0] } });
    expect(o && isDrawable(o)).toBe(true);
  });

  it('distinguishes a patch from an object so object memory works', () => {
    const patch = { id: 'v1', kind: 'fade' } as const;
    expect(isPatch(patch)).toBe(true);
    const event = parseBoardEvent({ type: 'ink', object: patch });
    expect(event?.type).toBe('ink');
    if (event?.type === 'ink') expect(isPatch(event.object)).toBe(true);
  });

  it('parses every event in the streaming protocol', () => {
    const stream = [
      { type: 'say', text: 'At the top, the ball is still moving.', t: 0 },
      { type: 'ink', object: { id: 'p3', kind: 'point', anchor: { target: 'apex' } }, t: 180 },
      { type: 'ask', prompt: 'Where is it moving fastest?', targets: ['p3', 'p7'] },
      { type: 'action', name: 'navigate', args: { route: 'course' }, needs: 'permission' },
      { type: 'card', id: 'c1', title: 'projectiles' },
      { type: 'done' },
    ];
    expect(parseBoardPlan(stream)).toHaveLength(6);
  });

  it('drops only the malformed frame, never the whole turn', () => {
    const plan = parseBoardPlan([
      { type: 'say', text: 'one' },
      { type: 'ink', object: { id: 'x', kind: 'nope', anchor: { board: [0, 0] } } },
      { type: 'done' },
    ]);
    expect(plan.map((e) => e.type)).toEqual(['say', 'done']);
  });

  it('parseBoardPlan on a non-array is empty, never a throw', () => {
    expect(parseBoardPlan(null)).toEqual([]);
    expect(parseBoardPlan('nope')).toEqual([]);
  });
});
