/**
 * The book of boards has a ceiling (docs/BOARD.md §5, §9).
 *
 * "Multiple boards per session; 'fresh board' starts another" is the law, and it was implemented as
 * an unbounded map: every "fresh board" minted a store the book then kept for the life of the tab,
 * ink and all, and closing the plane dropped nothing. Fifty open/close cycles left fifty boards
 * alive. `drop` existed and was called from nowhere.
 */

import { describe, expect, it } from 'bun:test';
import { boardBook, plane } from '../../src/board/plane';

const circle = (id: string) =>
  ({ id, kind: 'circle', anchor: { board: [100, 100] }, pad: 8 }) as never;

describe('boards a session keeps', () => {
  it('forgets a board that was closed with nothing on it', () => {
    const id = plane.fresh();
    expect(boardBook.ids()).toContain(id);
    plane.dismiss();
    expect(boardBook.ids()).not.toContain(id);
  });

  it('keeps a board that has ink on it', () => {
    const id = plane.fresh();
    boardBook.get(id).ink(circle('a'));
    plane.dismiss();
    expect(boardBook.ids()).toContain(id);
    boardBook.drop(id);
  });

  it('never holds more than a handful, and never evicts the one on screen', () => {
    const kept: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = plane.fresh();
      boardBook.get(id).ink(circle(`ink-${i}`)); // ink, so nothing is dropped as merely empty
      kept.push(id);
    }
    expect(boardBook.ids().length).toBeLessThanOrEqual(8);
    // The board Wobo is actually looking at is always still there.
    expect(boardBook.ids()).toContain(plane.get().boardId);
    expect(plane.get().boardId).toBe(kept[kept.length - 1] as string);
    for (const id of boardBook.ids()) boardBook.drop(id);
  });

  it('drops the oldest EMPTY board before it drops one with ink on it', () => {
    for (const id of boardBook.ids()) boardBook.drop(id);
    const inked = plane.fresh();
    boardBook.get(inked).ink(circle('keep-me'));
    for (let i = 0; i < 12; i++) plane.fresh();
    expect(boardBook.ids()).toContain(inked);
  });
});

describe('the pin and the close tell the truth (wave 29, board-2)', () => {
  it('a pinned board survives a dismissal, and says so', () => {
    const id = plane.fresh();
    boardBook.get(id).ink(circle('pinned'));
    plane.togglePin();
    expect(plane.dismiss()).toBe(false);
    expect(plane.get().open).toBe(true);
    // the learner asked outright: the pin is lifted, the board goes, and the answer is true
    expect(plane.close()).toBe(true);
    expect(plane.get().open).toBe(false);
    expect(plane.get().pinned).toBe(false);
    boardBook.drop(id);
  });
  it('closing a board that is not out answers false', () => {
    expect(plane.get().open).toBe(false);
    expect(plane.close()).toBe(false);
  });
});
