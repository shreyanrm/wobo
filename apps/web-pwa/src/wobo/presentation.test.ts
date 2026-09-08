import { describe, expect, it } from 'bun:test';
import { type BoardObject, parseBoardObject } from '@wobo/wobo';
import {
  boardShapeOf,
  isLessonRoute,
  needsBoard,
  PresentationChoice,
  presentationWord,
  SCREEN_OBJECT_LIMIT,
  staysOnScreen,
} from './presentation';

const object = (raw: Record<string, unknown>): BoardObject => {
  const parsed = parseBoardObject(raw);
  if (!parsed) throw new Error(`not valid grammar: ${JSON.stringify(raw)}`);
  return parsed;
};

const pointer = (id: string) =>
  object({ id, kind: 'circle', anchor: { target: 'card-3' }, pad: 8 });

const circled = (id: string) => object({ id, kind: 'circle', anchor: { focus: 'f7' }, pad: 10 });

/** A step of a derivation hung off ink that was already on the board — neither a mark about the
 *  screen nor a diagram from scratch, so it is what the object COUNT is really about. */
const step = (id: string, owner = 'p9') =>
  object({ id, kind: 'write', anchor: { object: owner }, text: 'so a squared' });

const axis = () =>
  object({
    id: 'x',
    kind: 'axis',
    anchor: { board: [100, 100] },
    orientation: 'x',
    min: 0,
    max: 10,
    step: 1,
    length: 400,
  });

describe('what belongs on a board of its own', () => {
  it('a mark on something that is already on screen does not', () => {
    expect(needsBoard(pointer('v1'))).toBe(false);
  });
  it('anything drawn from scratch does', () => {
    expect(needsBoard(axis())).toBe(true);
  });
  it('anything anchored to board space does — there is nothing on screen to hang it off', () => {
    expect(
      needsBoard(object({ id: 'l', kind: 'label', anchor: { board: [10, 10] }, text: 'a' })),
    ).toBe(true);
  });
});

describe("Wobo's rule for the surface", () => {
  it('keeps a pointer or one line on the screen', () => {
    const choice = new PresentationChoice();
    expect(choice.offer(pointer('v1'))).toBe('screen');
    expect(choice.offer(pointer('v2'))).toBe('screen');
    expect(choice.promoted).toBe(false);
  });

  it('moves to the plane once it is no longer one line', () => {
    const choice = new PresentationChoice();
    for (let i = 0; i <= SCREEN_OBJECT_LIMIT; i++) choice.offer(step(`v${i}`));
    expect(choice.current()).toBe('plane');
    expect(choice.promoted).toBe(true);
  });

  it('a mark about the screen never counts towards a board, however many of them there are', () => {
    // Ten pointers at ten things on the page are still ten pointers. Promoting on the count would
    // put a board over the page they are all pointing at.
    const choice = new PresentationChoice();
    for (let i = 0; i < 10; i++) expect(choice.offer(pointer(`v${i}`))).toBe('screen');
    expect(choice.current()).toBe('screen');
    expect(choice.promoted).toBe(false);
  });

  it('holds both surfaces at once: the mark stays on the screen, the diagram gets a board', () => {
    // The turn that broke: a ring round the paused film, then a diagram from scratch. One surface
    // for the whole turn meant the plane opened over the film and the ring was lost with it.
    const choice = new PresentationChoice();
    expect(choice.offer(circled('ring'))).toBe('screen');
    expect(choice.offer(axis())).toBe('plane');
    expect(choice.promoted).toBe(true);
    // And the ring is still a screen mark afterwards, not something the plane took with it.
    expect(choice.offer(pointer('v2'))).toBe('screen');
    expect(choice.onScreen()).toBe(2);
  });

  it('a mark hung off another object follows that object to its surface', () => {
    // `{object: id}` resolves against the boxes on the SAME surface, so splitting the two would
    // break the anchor outright.
    const choice = new PresentationChoice();
    expect(choice.offer(pointer('v1'))).toBe('screen');
    expect(choice.offer(step('note', 'v1'))).toBe('screen');
    expect(choice.offer(axis())).toBe('plane');
    expect(choice.offer(step('label', 'x'))).toBe('plane');
  });

  it('moves to the plane the moment a diagram from scratch arrives, however few objects', () => {
    const choice = new PresentationChoice();
    expect(choice.offer(axis())).toBe('plane');
    expect(choice.promoted).toBe(true);
  });

  it('promotes exactly once — the ink is not carried twice', () => {
    const choice = new PresentationChoice();
    choice.offer(axis());
    choice.offer(step('v2'));
    expect(choice.promoted).toBe(false);
  });

  it('a lesson is the full board and stays there', () => {
    const choice = new PresentationChoice({ lesson: true });
    expect(choice.offer(axis())).toBe('full');
    expect(choice.offer(axis())).toBe('full');
    expect(choice.promoted).toBe(false);
  });

  it('but a lesson never covers the thing a mark is about', () => {
    // Wobo paused the film, the learner circled the frame and asked why. The ring belongs ON the
    // frame; the full board would sit over the film it is explaining (BOARD.md §11).
    const circle = new PresentationChoice({ lesson: true });
    expect(circle.offer(circled('f1ring'))).toBe('screen');
    // A mark on a registered target is the same case, whenever in the turn it arrives.
    const onTarget = new PresentationChoice({ lesson: true });
    expect(onTarget.offer(axis())).toBe('full');
    expect(onTarget.offer(pointer('v1'))).toBe('screen');
    // And the lesson board is still the board for anything drawn from scratch.
    expect(onTarget.offer(axis())).toBe('full');
    expect(onTarget.current()).toBe('full');
  });

  it("the learner's word wins over Wobo's rule, in both directions", () => {
    const here = new PresentationChoice({ override: 'screen', lesson: true });
    expect(here.offer(axis())).toBe('screen');
    const board = new PresentationChoice({ override: 'plane' });
    expect(board.offer(pointer('v1'))).toBe('plane');
  });
});

describe("the learner's word", () => {
  it('hears the board and the screen', () => {
    expect(presentationWord('show me on the board')).toEqual({ presentation: 'plane' });
    expect(presentationWord('just do it here')).toEqual({ presentation: 'screen' });
    expect(presentationWord('use the full board')).toEqual({ presentation: 'full' });
  });
  it('hears a fresh board, a wipe and a dismissal, and never confuses them with a summons', () => {
    expect(presentationWord('give me a fresh board')).toEqual({
      fresh: true,
      presentation: 'plane',
    });
    expect(presentationWord('wipe the board')).toEqual({ wipe: true });
    expect(presentationWord('close the board')).toEqual({ dismiss: true });
  });
  it('says nothing about an ordinary question', () => {
    expect(presentationWord('why did the coefficient change')).toBeNull();
    expect(presentationWord('')).toBeNull();
  });
});

describe('which turns Wobo answers by drawing', () => {
  it('draws when the answer has a shape', () => {
    expect(boardShapeOf('derive the quadratic formula').board).toBe(true);
    expect(boardShapeOf('graph y = 2x + 1').board).toBe(true);
    expect(boardShapeOf('work it out step by step').board).toBe(true);
  });
  it('draws when the learner names the surface, and carries the override', () => {
    const shape = boardShapeOf('on the board please');
    expect(shape.board).toBe(true);
    expect(shape.override).toBe('plane');
  });
  it('draws whenever the caller says the mode can draw on this turn', () => {
    // Whether a mode can draw WITHOUT something in hand is the mode's own to answer (wobo/modes.ts
    // `modeDraws`): demanding a focus here as well locked out `quiz_me`, the one drawing mode
    // offered with an empty hand (wave 29, board-7). So `modeDraws: true` is the caller's verdict.
    expect(boardShapeOf('why is this wrong', { hasFocus: true, modeDraws: true }).board).toBe(true);
    expect(boardShapeOf('why is this wrong', { hasFocus: false, modeDraws: true }).board).toBe(true);
    expect(boardShapeOf('why is this wrong', { hasFocus: false, modeDraws: false }).board).toBe(
      false,
    );
  });
  it('does not turn an ordinary question into theatre', () => {
    expect(boardShapeOf('what time is my review').board).toBe(false);
    expect(boardShapeOf('how are you today').board).toBe(false);
  });
  it('draws for a bare question asked with a region in hand', () => {
    // The learner circled a frame and said "why?". They have already told Wobo what "this" is, and
    // the answer is a mark on it — the video case in BOARD.md §5. Without a focus the same words
    // are just a question, and a paragraph is the honest answer.
    for (const line of ['why?', 'what is this', 'explain', "i don't get it", 'huh']) {
      expect(boardShapeOf(line, { hasFocus: true }).board, line).toBe(true);
      expect(boardShapeOf(line, { hasFocus: false }).board, line).toBe(false);
    }
  });
  it('still leaves a statement with something in hand as a conversation', () => {
    expect(boardShapeOf('i am tired', { hasFocus: true }).board).toBe(false);
    expect(boardShapeOf('thanks, that helped', { hasFocus: true }).board).toBe(false);
  });
  it('answers a question about something on the screen in place, through the planner', () => {
    // On /course with the advance button registered, "which button starts the course?" went to
    // the plain conversation and came back as words. With the words naming a target it is a
    // board turn whose ink lands on that target and whose surface stays the screen.
    expect(boardShapeOf('which button starts the course?', { namesTarget: true }).board).toBe(true);
    expect(boardShapeOf('circle the hypotenuse', { namesTarget: true }).board).toBe(true);
    expect(boardShapeOf('which button starts the course?', { namesTarget: false }).board).toBe(
      false,
    );
    // Naming a target in passing, with nothing asked about it, is still a conversation.
    expect(boardShapeOf('the button is blue', { namesTarget: true }).board).toBe(false);
  });
  it('never treats a wipe or a dismissal as a request to draw', () => {
    expect(boardShapeOf('close the board').board).toBe(false);
    expect(boardShapeOf('wipe the board').board).toBe(false);
  });
});

describe('where the board is the screen', () => {
  it('is a lesson and its sandbox, and nowhere else', () => {
    expect(isLessonRoute('course')).toBe(true);
    expect(isLessonRoute('sandbox')).toBe(true);
    expect(isLessonRoute('home')).toBe(false);
  });
});

describe('what cannot leave the screen', () => {
  it('is anything about a target or about the region the learner circled', () => {
    expect(staysOnScreen(pointer('v1'))).toBe(true);
    expect(staysOnScreen(circled('f1'))).toBe(true);
  });
  it('is not something drawn from scratch in board space', () => {
    expect(staysOnScreen(axis())).toBe(false);
  });
});

describe('a screen that promised a drawing (onboarding step three, 2026-09-05)', () => {
  it('draw: true sends a plain question to the hand', () => {
    // "Why is the sky blue?" is prose: no draw word, no mode, no target. Under a headline that
    // says "I'll draw it", the screen keeps the promise by asking for the hand outright.
    expect(boardShapeOf('Why is the sky blue?').board).toBe(false);
    expect(boardShapeOf('Why is the sky blue?', { draw: true }).board).toBe(true);
  });
  it("the learner's word about the surface still wins", () => {
    expect(boardShapeOf('close the board', { draw: true }).board).toBe(false);
    expect(boardShapeOf('close the board', { draw: true }).word?.dismiss).toBe(true);
  });
});
