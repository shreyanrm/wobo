/**
 * The 59 turns' real glass, as the lab recorded it — the fixture the instant resolver is tested
 * against (docs/INK-FOUR.md, "the one thing we do not have").
 *
 * Every map here was taken off a real screen by the adversary's lab on 2026-09-09 (the course
 * lesson at 1440 on card 0 and card 5, and the chat page), and the worked example is the one the
 * board's own bench renders, with the content model's `step:` and `misconception:` meanings on it.
 * Nothing here is invented: the ids, the roles, the words, the boxes and the meanings are what the
 * page actually put on the glass.
 *
 * The outline's ordinals were re-measured on 2026-09-09 after the reader learned to read an
 * element's words the way a person does rather than the way `textContent` concatenates them
 * (glass/read.ts `joinTextRuns`): the glass said "1meet a square and a cube" and now says
 * "1 meet a square and a cube", which is what the page has always shown.
 */

import type { GlassEntry, GlassMap } from '@wobo/wobo';

/** The lesson's first card at 1440: the intro drawing, its parts, and the course outline. */
const C0_ENTRIES: GlassEntry[] = [
  {
    id: 'l-qwehqe-0',
    role: 'line',
    text: 'Mathematics · Chapter 1 · Lesson 1',
    box: [280, 33, 238, 20],
  },
  { id: 'l-1ejxgxr-0', role: 'line', text: 'meet a square and a cube', box: [1118, 130, 187, 20] },
  { id: 'l-4834uo-0', role: 'line', text: '1', box: [1092, 133, 6, 16] },
  { id: 'l-1cl74f0-0', role: 'line', text: 'feel the rule', box: [1118, 164, 82, 20] },
  { id: 'l-19wy6p9-0', role: 'line', text: 'make a move', box: [1118, 198, 97, 20] },
  {
    id: 'course-intro-mathematics',
    role: 'figure',
    text: 'the mathematics drawing',
    box: [450, 199, 420, 319],
  },
  {
    id: 'course-intro-mathematics.square-on-the-hypotenuse',
    role: 'figure-part',
    text: 'square on the hypotenuse',
    box: [555, 199, 273, 256],
    meaning: 'part:square-on-the-hypotenuse',
  },
  // THE SIDE ITSELF (the adversary, wave 58, finding 1). "circle the hypotenuse" rang the square
  // standing on it because the side had no declaration of its own. This is the side's entry, as the
  // reader names a `data-glass-part` (glass/read.ts `figureParts`): the id is the figure's id and
  // the part's slug, the meaning is `part:` and the slug. The resolver's test takes this entry away
  // to stand on the glass as it was before it.
  //
  // The drawing declares it as an un-inked `side` mark (ui/courseIntro.tsx): wave 58 wrote this
  // fixture before the drawing did, and the live glass of 2026-09-11 carried no such entry at
  // either width — which is why "circle the hypotenuse" still rang the square (wave 59).
  //
  // AND ITS BOX IS NOT THE TRIANGLE'S ANY MORE (the judge, wave 60). It was — a box around a
  // diagonal that runs corner to corner of its figure IS the figure's box — and so the ring the pen
  // drew on it held all three of the triangle's corners. The drawing declares the middle tenth of
  // the side now, which is this box: the same stretch, in this card's own scale.
  {
    id: 'course-intro-mathematics.hypotenuse',
    role: 'figure-part',
    text: 'hypotenuse',
    box: [640, 376, 19, 15],
    meaning: 'part:hypotenuse',
  },
  { id: 'l-5mxqf5-0', role: 'line', text: 'predict, then check', box: [1118, 232, 134, 20] },
  { id: 'l-ha3und-0', role: 'line', text: 'where it bends', box: [1118, 266, 103, 20] },
  {
    id: 'course-intro-mathematics.c²',
    role: 'figure-part',
    text: 'c²',
    box: [698, 285, 40, 58],
    meaning: 'part:c²',
  },
  {
    id: 'course-intro-mathematics.triangle',
    role: 'figure-part',
    text: 'triangle',
    box: [555, 312, 189, 143],
    meaning: 'part:triangle',
  },
  {
    id: 'course-intro-mathematics.right-angle',
    role: 'figure-part',
    text: 'right angle',
    box: [555, 421, 34, 34],
    meaning: 'part:right-angle',
  },
  { id: 'l-ltxivq-0', role: 'line', text: 'a square and a cube', box: [404, 594, 307, 43] },
  {
    id: 'course-outline-1',
    role: 'step',
    text: '1 meet a square and a cube',
    box: [404, 653, 512, 24],
  },
  { id: 'course-outline-2', role: 'step', text: '2 feel the rule', box: [404, 689, 512, 24] },
  { id: 'course-outline-3', role: 'step', text: '3 make a move', box: [404, 726, 512, 24] },
  { id: 'course-outline-4', role: 'step', text: '4 predict, then check', box: [404, 763, 512, 24] },
  { id: 'course-outline-5', role: 'step', text: '5 where it bends', box: [404, 799, 512, 24] },
  { id: 'course-outline-6', role: 'step', text: '6 the workbook', box: [404, 836, 512, 24] },
  { id: 'course-outline-7', role: 'step', text: '7 the boss', box: [404, 872, 512, 24] },
];

/** Card five at 1440: the "predict, then check" card, its diagram and the diagram's two parts. */
const C5_ENTRIES: GlassEntry[] = [
  {
    id: 'l-qwehqe-0',
    role: 'line',
    text: 'Mathematics · Chapter 1 · Lesson 1',
    box: [280, 33, 238, 20],
  },
  { id: 'l-1ejxgxr-0', role: 'line', text: 'meet a square and a cube', box: [1118, 130, 187, 20] },
  { id: 'l-1cl74f0-0', role: 'line', text: 'feel the rule', box: [1118, 164, 82, 20] },
  {
    id: 'card-c4',
    role: 'card',
    text: 'predict, then check',
    box: [374, 189, 572, 460],
    meaning: 'concept:predict-then-check',
  },
  { id: 'l-19wy6p9-0', role: 'line', text: 'make a move', box: [1118, 198, 97, 20] },
  { id: 'h-cxlpbr-0', role: 'heading', text: 'predict, then check', box: [374, 225, 572, 36] },
  { id: 'l-5mxqf5-0', role: 'line', text: 'predict, then check', box: [1118, 232, 134, 20] },
  { id: 'l-ha3und-0', role: 'line', text: 'where it bends', box: [1118, 266, 103, 20] },
  {
    id: 'l-1lqhuwx-0',
    role: 'line',
    text: 'A claimed answer must survive the original problem.',
    box: [374, 279, 419, 23],
  },
  { id: 'l-qfe3cg-0', role: 'line', text: 'the workbook', box: [1118, 300, 88, 20] },
  { id: 'l-1ahyqo1-0', role: 'line', text: 'the boss', box: [1118, 334, 59, 20] },
  {
    id: 'diagram-c4',
    role: 'figure',
    text: 'diagram: Predict, then check',
    box: [510, 343, 300, 169],
  },
  {
    id: 'diagram-c4.a-square-and-a-cube-predict-then-ch',
    role: 'figure-part',
    text: 'A Square and A Cube: Predict, then ch…',
    box: [542, 356, 237, 17],
    meaning: 'part:a-square-and-a-cube-predict-then-ch',
  },
  {
    id: 'diagram-c4.idea',
    role: 'figure-part',
    text: 'idea',
    box: [564, 411, 64, 64],
    meaning: 'part:idea',
  },
  {
    id: 'diagram-c4.effect',
    role: 'figure-part',
    text: 'effect',
    box: [698, 411, 64, 64],
    meaning: 'part:effect',
  },
  {
    id: 'l-h7830m-0',
    role: 'line',
    text: 'Circle any part of the board and ask why.',
    box: [374, 530, 300, 20],
  },
  { id: 'l-1nnwep0-0', role: 'line', text: 'Or just say it.', box: [374, 553, 120, 20] },
  {
    id: 'l-1h55ux5-0',
    role: 'line',
    text: 'Type your value and test it.',
    box: [390, 553, 214, 23],
  },
  {
    id: 'l-13gb0b1-0',
    role: 'line',
    text: 'Substitute it back. If both sides agree, the answer stands.',
    box: [391, 609, 452, 23],
  },
];

/**
 * Card five at 390, SCROLLED AWAY (the adversary, wave 60, Builder 6). The learner is 561 px down
 * the lesson: the outline and "Ask about this" fill the glass, and the card is 377 px above it
 * with 13 px of its 390 showing. Its idea sentence is not on the glass at all. This is the map
 * "show me why" was asked on, taken after the turn; the box of every entry is what the page put
 * there, and the ring the resolver used to hand back here landed at y = -390.
 */
const C5_390_SCROLLED_ENTRIES: GlassEntry[] = [
  { id: 'card-c4', role: 'card', text: 'predict, then check', box: [52, -377, 286, 390], meaning: 'concept:predict-then-check' },
  { id: 'k-ba1eez-0', role: 'chip', text: 'Check', box: [281, 123, 73, 44] },
  { id: 'l-3eh0xn-0', role: 'line', text: 'This lesson', box: [38, 224, 89, 17] },
  { id: 'l-v83xhs-0', role: 'line', text: 'meet a new course', box: [74, 251, 134, 20] },
  { id: 'l-4834uo-0', role: 'line', text: '1', box: [48, 253, 6, 16] },
  { id: 'l-1cl74f0-0', role: 'line', text: 'feel the rule', box: [74, 285, 82, 20] },
  { id: 'l-521xxl-0', role: 'line', text: '2', box: [48, 287, 6, 16] },
  { id: 'l-19wy6p9-0', role: 'line', text: 'make a move', box: [74, 319, 97, 20] },
  { id: 'l-4s2c8m-0', role: 'line', text: '3', box: [48, 321, 6, 16] },
  { id: 'l-5mxqf5-0', role: 'line', text: 'predict, then check', box: [74, 353, 135, 20] },
  { id: 'l-5m15bj-0', role: 'line', text: '4', box: [48, 355, 6, 16] },
  { id: 'l-ha3und-0', role: 'line', text: 'where it bends', box: [74, 387, 103, 20] },
  { id: 'l-5c1jmk-0', role: 'line', text: '5', box: [48, 389, 6, 16] },
  { id: 'l-qfe3cg-0', role: 'line', text: 'the workbook', box: [74, 421, 94, 20] },
  { id: 'l-660cph-0', role: 'line', text: '6', box: [48, 423, 6, 16] },
  { id: 'l-1ahyqo1-0', role: 'line', text: 'the boss', box: [74, 455, 60, 20] },
  { id: 'l-5w0r0i-0', role: 'line', text: '7', box: [48, 457, 6, 16] },
  { id: 'l-l4qolh-0', role: 'line', text: 'Ask about this', box: [38, 534, 116, 17] },
  { id: 'l-wbb34f-0', role: 'line', text: 'Circle any part of the board and ask why. Or', box: [38, 559, 308, 20] },
  { id: 'l-17yn32l-0', role: 'line', text: 'just say it.', box: [38, 580, 68, 20] },
  { id: 'k-1fur2q9-0', role: 'chip', text: 'Sign in first, then I can read a photo of your page', box: [326, 612, 52, 52] },
  { id: 'l-gn8f6l-0', role: 'line', text: 'Your place', box: [38, 711, 86, 17] },
  { id: 'l-1w6zkwb-0', role: 'line', text: 'Saved as you go. Leave any time, come', box: [38, 736, 276, 20] },
  { id: 'l-1yhnral-0', role: 'line', text: 'back to this line.', box: [38, 758, 112, 20] },
];

/** The chat page at 1440: no content model at all, so nothing on it is a thing to mark. */
const CHAT_ENTRIES: GlassEntry[] = [
  { id: 'l-1iobgio-0', role: 'line', text: 'Wobo', box: [24, 24, 60, 22] },
  { id: 'k-2cxdwa-0', role: 'chip', text: 'Home', box: [20, 86, 200, 46] },
  { id: 'l-l4qolh-0', role: 'line', text: 'Ask about this', box: [374, 120, 160, 22] },
  {
    id: 'l-h7830m-0',
    role: 'line',
    text: 'Circle any part of the board and ask why.',
    box: [374, 150, 300, 20],
  },
  { id: 'k-1krzrk9-0', role: 'chip', text: 'Learn', box: [20, 138, 200, 46] },
  { id: 'l-1nnwep0-0', role: 'line', text: 'Or just say it.', box: [374, 176, 120, 20] },
  { id: 'k-ouohqs-0', role: 'chip', text: 'Practice', box: [20, 190, 200, 46] },
  { id: 'k-11ig4ko-0', role: 'chip', text: 'You', box: [20, 242, 200, 46] },
  { id: 'l-gn8f6l-0', role: 'line', text: 'Your place', box: [374, 300, 120, 22] },
  {
    id: 'l-1w6zkwb-0',
    role: 'line',
    text: 'Saved as you go. Leave any time, come',
    box: [374, 326, 300, 20],
  },
  { id: 'l-1yhnral-0', role: 'line', text: 'back to this line.', box: [374, 348, 140, 20] },
  { id: 'l-11vp92m-0', role: 'line', text: "Today's allowance", box: [374, 400, 160, 22] },
  { id: 'l-70co9c-0', role: 'line', text: 'Sign in and this shows', box: [374, 426, 200, 20] },
  { id: 'l-fvs8ut-0', role: 'line', text: 'how much of today is left,', box: [374, 448, 220, 20] },
  { id: 'l-1ooz9vx-0', role: 'line', text: 'and when it comes back.', box: [374, 470, 200, 20] },
];

/**
 * The worked example the board's bench renders (wobo/glass-bench.tsx): four steps, and the second
 * one carries the misconception the blueprint declared for it.
 */
const STEPS_ENTRIES: GlassEntry[] = [
  { id: 'h1', role: 'heading', text: 'Solve 2x + 3 = 7', box: [24, 80, 340, 30] },
  { id: 'w1', role: 'step', text: '2x + 3 = 7', box: [24, 130, 340, 28], meaning: 'step:1' },
  {
    id: 'w2',
    role: 'step',
    text: '2x = 7 + 3',
    box: [24, 168, 340, 28],
    meaning: 'step:2 misconception:moves-term-without-sign',
  },
  { id: 'w3', role: 'step', text: '2x = 10', box: [24, 206, 340, 28], meaning: 'step:3' },
  { id: 'w4', role: 'step', text: 'x = 5', box: [24, 244, 340, 28], meaning: 'step:4' },
  { id: 'k-explain', role: 'chip', text: 'Explain this', box: [24, 300, 140, 40] },
];

/** A doubt's photo, read once into lines with boxes — the map on the doubt screen. */
const PHOTO_ENTRIES: GlassEntry[] = [
  {
    id: 'r-1',
    role: 'photo-line',
    text: 'Q4. A convex lens has focal length 15 cm.',
    box: [20, 60, 340, 26],
  },
  {
    id: 'r-2',
    role: 'photo-line',
    text: 'An object is placed 30 cm from the lens.',
    box: [20, 92, 340, 26],
  },
  {
    id: 'r-3',
    role: 'photo-line',
    text: 'Find the position of the image.',
    box: [20, 124, 300, 26],
  },
  { id: 'r-4', role: 'photo-line', text: '1/v - 1/u = 1/f', box: [20, 170, 200, 26] },
];

const map = (entries: GlassEntry[], w = 1440, h = 900, scrollY = 0): GlassMap => ({
  v: 1,
  viewport: { w, h, scrollY },
  entries,
});

/** The five real glasses the 59 turns were asked on. */
export const LAB_GLASS = {
  courseCard0: () => map(C0_ENTRIES),
  courseCard5: () => map(C5_ENTRIES),
  courseCard5Scrolled390: () => map(C5_390_SCROLLED_ENTRIES, 390, 844, 561),
  chat: () => map(CHAT_ENTRIES),
  workedExample: () => map(STEPS_ENTRIES, 390, 844),
  photo: () => map(PHOTO_ENTRIES, 390, 844),
};
