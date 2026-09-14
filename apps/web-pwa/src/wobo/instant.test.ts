import { describe, expect, it } from 'bun:test';
import {
  askKey,
  buildCore,
  type ConceptCore,
  type CoreCard,
  EMPTY_CORE,
  resolveDoubtInstant,
  resolveInstant,
} from './instant';
import { LAB_GLASS } from './instant-lab';

/**
 * The instant mark, against the questions of the 59 turns and the real glass they were asked on
 * (docs/INK-FOUR.md, "the one thing we do not have"; wobo/instant-lab.ts holds the maps).
 *
 * Every turn is here: the 23 course turns, the 16 from-scratch turns, the 2 doubt turns and the 18
 * world turns. What the resolver must AIM at is asserted; what it must LEAVE ALONE is asserted just
 * as hard, because a wrong instant ring is worse than a late right one.
 */

const aim = (
  question: string,
  map = LAB_GLASS.courseCard5(),
  core: ConceptCore = EMPTY_CORE,
  focusId?: string,
) => resolveInstant({ question, map, core, ...(focusId ? { focusId } : {}) });

describe('the local resolve: what it aims at', () => {
  it('rings the part the question names, not the figure it belongs to', () => {
    const hit = aim('circle the effect circle in the diagram');
    expect(hit?.target).toBe('diagram-c4.effect');
    expect(hit?.kind).toBe('ring');
    expect(hit?.by).toBe('part');
  });

  /**
   * A NAME'S TAIL IS WHAT THE THING STANDS ON (the adversary, wave 58, finding 1).
   *
   * Live at 1440 and at 390, "circle the hypotenuse" rang the SQUARE ON the hypotenuse — the
   * client's own instant mark, `instant-1#0`, and the sentence the gateway then built from it
   * ("The square on the hypotenuse is this one."). The learner named a side and got the figure
   * standing on it, which is the relevance law read backwards: "a question that names a part gets
   * the part, not its figure".
   *
   * Two things were wrong and both are fixed here: the drawing declared no part for the side at
   * all (`ui/courseIntro.tsx`), and the resolver read "square on the hypotenuse" as a name for the
   * hypotenuse. The side now has its own declaration, and a name is only ever matched on its own
   * head.
   */
  it('rings the side the learner named, not the figure standing on it', () => {
    const hit = aim('circle the hypotenuse', LAB_GLASS.courseCard0());
    expect(hit?.target).toBe('course-intro-mathematics.hypotenuse');
    expect(hit?.kind).toBe('ring');
    expect(hit?.by).toBe('part');
  });

  it('still rings the square when the square is what was named', () => {
    const hit = aim('circle the square on the hypotenuse', LAB_GLASS.courseCard0());
    expect(hit?.target).toBe('course-intro-mathematics.square-on-the-hypotenuse');
  });

  it('aims at nothing when only the FIGURE standing on the named thing is declared', () => {
    // The glass as it was before the side had a declaration of its own: the square is the only
    // thing whose words carry "hypotenuse", and it is not the hypotenuse. No ink, and the useful
    // sentence is the turn's to give.
    const map = LAB_GLASS.courseCard0();
    map.entries = map.entries.filter((e) => e.id !== 'course-intro-mathematics.hypotenuse');
    expect(resolveInstant({ question: 'circle the hypotenuse', map, core: EMPTY_CORE })).toBeNull();
  });

  it('names the right angle without ringing the triangle beside it', () => {
    const hit = aim('point at the right angle', LAB_GLASS.courseCard0());
    expect(hit?.target).toBe('course-intro-mathematics.right-angle');
  });

  it('underlines the step the number names', () => {
    const hit = aim('why does step 2 work?', LAB_GLASS.workedExample());
    expect(hit?.target).toBe('w2');
    expect(hit?.kind).toBe('underline');
  });

  it('underlines the one step the blueprint flagged when the ask is "which step is wrong"', () => {
    const hit = aim('which step is wrong here?', LAB_GLASS.workedExample());
    expect(hit?.target).toBe('w2');
    expect(hit?.by).toBe('misconception');
    expect(hit?.kind).toBe('underline');
  });

  it('underlines the photo line the words name', () => {
    const hit = aim('what is the focal length here?', LAB_GLASS.photo());
    expect(hit?.target).toBe('r-1');
    expect(hit?.kind).toBe('underline');
  });

  it('aims at the thing the learner tapped when the words are deictic', () => {
    const hit = aim('explain this', LAB_GLASS.workedExample(), EMPTY_CORE, 'k-explain');
    expect(hit?.target).toBe('k-explain');
    expect(hit?.by).toBe('focus');
  });

  it('takes the focus over the words, because the hand is the truest aim', () => {
    const hit = aim(
      'why is this the effect?',
      LAB_GLASS.courseCard5(),
      EMPTY_CORE,
      'diagram-c4.idea',
    );
    expect(hit?.target).toBe('diagram-c4.idea');
  });
});

describe('the local resolve: what it refuses to aim at', () => {
  const nothing = (question: string, map = LAB_GLASS.courseCard5(), core?: ConceptCore) =>
    expect(resolveInstant({ question, map, core: core ?? EMPTY_CORE })).toBeNull();

  it('aims at nothing on a page with no content model at all', () => {
    nothing('circle the ask about this card', LAB_GLASS.chat());
    nothing('what is 2 to the power 5?', LAB_GLASS.chat());
  });

  it('never rings the course outline when the ask is about a worked example', () => {
    // Seven outline rows, all role `step`, none of them a line of working: the words name no one
    // of them, so the pen stays up and the model answers as it always did.
    nothing('which step is wrong here?', LAB_GLASS.courseCard0());
  });

  it('aims at nothing when the words are pure deixis and nothing is focused', () => {
    nothing('why does that step work?');
    nothing('explain this');
    // "show me why" names nothing either, but the card the learner is on declares its own idea
    // and the level's store holds the sentence for it — see "the ask that names nothing at all".
    // With no core there is no sentence to underline, so it is silent here too.
    nothing('show me why');
  });

  it('leaves a from-scratch drawing to the plane', () => {
    for (const q of [
      'Prove Pythagoras theorem with squares on the sides of a right triangle with legs 3 cm and 4 cm',
      'Derive the first step of the quadratic formula from ax^2 + bx + c = 0 on the board',
      'Draw the path of a ball thrown at 20 m/s at 45 degrees and label the apex',
      'Draw a ray diagram of a ray through a convex lens of focal length 15 cm with the object 30 cm away',
      'Draw a plant cell with five labels',
      'Draw a Punnett square for Tt x Tt',
      'Draw a timeline of the non-cooperation movement',
      'Draw a labelled map of India and mark Maharashtra',
      'graph y = x^2 from -3 to 3',
      'solve 2x + 3 = 7 step by step',
      'draw the forces on the block',
      'draw this for me',
    ]) {
      nothing(q, LAB_GLASS.courseCard0());
      nothing(q, LAB_GLASS.courseCard5());
      nothing(q, LAB_GLASS.workedExample());
    }
  });

  it('never treats a board command as a question about the page', () => {
    for (const q of ['wipe the board', 'close the board', 'fresh board', 'clear the board']) {
      nothing(q, LAB_GLASS.courseCard5());
      nothing(q, LAB_GLASS.workedExample());
    }
  });

  it('says nothing about a statement that asks for nothing', () => {
    nothing('the effect is bigger', LAB_GLASS.courseCard5());
  });

  it('aims at nothing when two declared things answer the words equally', () => {
    // Four steps all declare themselves a step: "the step" names every one of them and no one of
    // them, so no ink starts and the plan decides.
    nothing('what does the step do?', LAB_GLASS.workedExample());
  });

  it('takes the concept the content model declared over the heading that repeats it', () => {
    // The card declares `concept:predict-then-check`; the heading above it only reads the same
    // words. The declaration wins, and it wins outright, so there is no tie to fall silent on.
    const hit = resolveInstant({
      question: 'what is predict then check?',
      map: LAB_GLASS.courseCard5(),
      core: EMPTY_CORE,
    });
    expect(hit?.target).toBe('card-c4');
    expect(hit?.by).toBe('concept');
  });

  it('never marks a line whose words are the question read back', () => {
    const map = LAB_GLASS.workedExample();
    map.entries.push({
      id: 'bubble',
      role: 'heading',
      text: 'which step is wrong here?',
      box: [24, 400, 300, 24],
    });
    const hit = resolveInstant({ question: 'which step is wrong here?', map, core: EMPTY_CORE });
    expect(hit?.target).toBe('w2');
  });

  it('is null on an empty glass, a blank question and no map at all', () => {
    expect(resolveInstant({ question: '', map: LAB_GLASS.courseCard5() })).toBeNull();
    expect(resolveInstant({ question: 'circle the effect', map: null })).toBeNull();
    expect(
      resolveInstant({
        question: 'circle the effect',
        map: { v: 1, viewport: { w: 390, h: 844, scrollY: 0 }, entries: [] },
      }),
    ).toBeNull();
  });
});

describe('the words come from the core', () => {
  const core: ConceptCore = {
    sentences: {
      'part:effect': 'The effect is what changes when you move the cause.',
      'part:square-on-the-hypotenuse':
        'The square on the hypotenuse has the area of the other two put together.',
    },
    asks: {},
  };

  it('carries the architect true sentence with the mark', () => {
    const hit = aim('circle the square on the hypotenuse', LAB_GLASS.courseCard0(), core);
    expect(hit?.say).toBe(
      'The square on the hypotenuse has the area of the other two put together.',
    );
    expect(hit?.words).toBe('square on the hypotenuse');
  });

  it('still lands the mark when the core holds no sentence for it', () => {
    const hit = aim('point at the triangle', LAB_GLASS.courseCard0(), core);
    expect(hit?.target).toBe('course-intro-mathematics.triangle');
    expect(hit?.say).toBeUndefined();
    expect(hit?.words).toBe('triangle');
  });
});

describe('the obvious asks, precomputed with the level', () => {
  const cards: CoreCard[] = [
    {
      id: 'c4',
      title: 'predict, then check',
      idea: 'A claimed answer must survive the original problem.',
      parts: [
        {
          slug: 'effect',
          name: 'effect',
          sentence: 'The effect is what changes when you move the cause.',
        },
        { slug: 'idea', name: 'idea', sentence: 'The idea is the rule you are testing.' },
      ],
      misconception: {
        slug: 'moves-term-without-sign',
        ask: 'which step is wrong here?',
        sentence: 'Step two moved the 3 across without flipping its sign.',
      },
    },
  ];
  const core = buildCore(cards);

  it('answers a card question from the level store, with no model and no map score', () => {
    const hit = resolveInstant({
      question: 'circle the effect',
      map: LAB_GLASS.courseCard5(),
      core,
    });
    expect(hit?.fromCache).toBe(true);
    expect(hit?.target).toBe('diagram-c4.effect');
    expect(hit?.say).toBe('The effect is what changes when you move the cause.');
  });

  it('serves the same answer whatever the punctuation and politeness', () => {
    for (const q of ['Circle the effect.', 'circle the effect?', 'Please circle the effect']) {
      expect(resolveInstant({ question: q, map: LAB_GLASS.courseCard5(), core })?.fromCache).toBe(
        true,
      );
    }
  });

  it('answers the misconception ask on the worked example', () => {
    const hit = resolveInstant({
      question: 'which step is wrong here?',
      map: LAB_GLASS.workedExample(),
      core,
    });
    expect(hit?.target).toBe('w2');
    expect(hit?.say).toBe('Step two moved the 3 across without flipping its sign.');
    expect(hit?.fromCache).toBe(true);
  });

  it('falls through to the map when the card it was made for is not on this glass', () => {
    // The cached answer names `part:effect`; card 0 declares no such part, so the store misses and
    // the map decides — which, for these words on that page, is nothing at all.
    expect(
      resolveInstant({ question: 'circle the effect', map: LAB_GLASS.courseCard0(), core }),
    ).toBeNull();
  });

  it('keys asks the way a learner types them', () => {
    expect(askKey('  Circle the EFFECT?? ')).toBe('circle the effect');
    expect(askKey('Please, Wobo — what is the idea')).toBe('what is the idea');
  });

  it('builds a sentence for every part and concept the level declares', () => {
    expect(core.sentences['concept:predict-then-check']).toBe(
      'A claimed answer must survive the original problem.',
    );
    expect(core.sentences['part:idea']).toBe('The idea is the rule you are testing.');
  });
});

/**
 * THE NUMBER THE OWNER ASKED FOR: what fraction of the 59 turns the local resolve serves alone.
 * The asks below are the lab's own, one row per turn, with the glass each was asked on.
 */
describe('the 59 turns', () => {
  const core = buildCore([
    {
      id: 'c4',
      title: 'predict, then check',
      idea: 'A claimed answer must survive the original problem.',
      parts: [
        {
          slug: 'effect',
          name: 'effect',
          sentence: 'The effect is what changes when you move the cause.',
        },
        { slug: 'idea', name: 'idea', sentence: 'The idea is the rule you are testing.' },
      ],
    },
    {
      id: 'c0',
      title: 'a square and a cube',
      idea: 'A square is a side times itself; a cube is that times the side again.',
      parts: [
        {
          slug: 'square-on-the-hypotenuse',
          name: 'hypotenuse',
          sentence: 'The square on the hypotenuse has the area of the other two put together.',
        },
        { slug: 'triangle', name: 'triangle', sentence: 'The triangle has one right angle.' },
        {
          slug: 'right-angle',
          name: 'right angle',
          sentence: 'The right angle is the corner the rule needs.',
        },
      ],
    },
  ]);

  /** Every turn of the 59, with the glass it was asked on and whether a focus was in hand. */
  const TURNS: { ask: string; glass: keyof typeof LAB_GLASS; focus?: string; times: number }[] = [
    // --- course, 23 -----------------------------------------------------------------------------
    { ask: 'which step is wrong here?', glass: 'courseCard0', times: 5 },
    { ask: 'why does that step work?', glass: 'courseCard5', times: 3 },
    { ask: 'circle the hypotenuse', glass: 'courseCard0', times: 4 },
    { ask: 'circle the effect circle in the diagram', glass: 'courseCard5', times: 4 },
    { ask: 'show me why', glass: 'courseCard5', times: 1 },
    { ask: 'draw this for me', glass: 'courseCard0', times: 2 },
    { ask: 'close the board', glass: 'courseCard5', times: 1 },
    { ask: 'wipe the board', glass: 'courseCard5', times: 1 },
    { ask: 'fresh board', glass: 'courseCard5', times: 1 },
    { ask: 'what is 2 to the power 5?', glass: 'courseCard5', times: 1 },
    // --- from scratch, 16 -----------------------------------------------------------------------
    {
      ask: 'Prove Pythagoras theorem with squares on the sides of a right triangle with legs 3 cm and 4 cm',
      glass: 'chat',
      times: 2,
    },
    {
      ask: 'Derive the first step of the quadratic formula from ax^2 + bx + c = 0 on the board',
      glass: 'chat',
      times: 2,
    },
    {
      ask: 'Draw the path of a ball thrown at 20 m/s at 45 degrees and label the apex',
      glass: 'chat',
      times: 2,
    },
    {
      ask: 'Draw a ray diagram of a ray through a convex lens of focal length 15 cm with the object 30 cm away',
      glass: 'chat',
      times: 2,
    },
    { ask: 'Draw a plant cell with five labels', glass: 'chat', times: 2 },
    { ask: 'Draw a Punnett square for Tt x Tt', glass: 'chat', times: 2 },
    { ask: 'Draw a timeline of the non-cooperation movement', glass: 'chat', times: 2 },
    { ask: 'Draw a labelled map of India and mark Maharashtra', glass: 'chat', times: 2 },
    // --- doubt, 2 --------------------------------------------------------------------------------
    { ask: 'what is the focal length here?', glass: 'photo', times: 1 },
    { ask: 'what does the object distance mean?', glass: 'photo', times: 1 },
    // --- the world, 18 ---------------------------------------------------------------------------
    { ask: 'explain this', glass: 'workedExample', focus: 'k-explain', times: 14 },
    { ask: 'graph y = x^2 from -3 to 3', glass: 'chat', times: 1 },
    { ask: 'show me a number line', glass: 'chat', times: 1 },
    { ask: 'solve 2x + 3 = 7 step by step', glass: 'chat', times: 1 },
    { ask: 'draw the forces on the block', glass: 'chat', times: 1 },
  ];

  it('counts 59 turns', () => {
    expect(TURNS.reduce((n, t) => n + t.times, 0)).toBe(59);
  });

  it('serves the turns that name something and stands down on the rest', () => {
    let served = 0;
    let total = 0;
    const rows: string[] = [];
    for (const turn of TURNS) {
      const hit = resolveInstant({
        question: turn.ask,
        map: LAB_GLASS[turn.glass](),
        core,
        ...(turn.focus ? { focusId: turn.focus } : {}),
      });
      total += turn.times;
      if (hit) served += turn.times;
      rows.push(`${hit ? `${hit.by}:${hit.target}` : 'no ink'} · ${turn.ask.slice(0, 44)}`);
    }
    // The record, so the number in the report is the one the test measured.
    console.log(`local resolve serves ${served} of ${total} turns\n  ${rows.join('\n  ')}`);
    expect(total).toBe(59);
    // Sixteen of the 59 are drawings built from scratch and three are board commands: no map can
    // answer those, and the resolver must not pretend to. What is left is what a content model can
    // reach, and the number here is the one reported. It may go up when more of the page declares
    // itself; it may never go down without this test saying so.
    expect(served).toBeGreaterThanOrEqual(24);
  });

  it('never aims at a thing that is not on the glass it was asked on', () => {
    for (const turn of TURNS) {
      const map = LAB_GLASS[turn.glass]();
      const hit = resolveInstant({
        question: turn.ask,
        map,
        core,
        ...(turn.focus ? { focusId: turn.focus } : {}),
      });
      if (!hit) continue;
      expect(map.entries.some((e) => e.id === hit.target)).toBe(true);
    }
  });
});

/**
 * THE LEARNER'S OWN HAND (the adversary, wave 47, finding 3; docs/INK-FOUR.md, relevance).
 *
 * Live on a 4x-slowed machine the lasso drag crossed TWO lines of the course outline, so the focus
 * went with `targetIds: ['course-outline-2','course-outline-3']` and the text of both — and the
 * turn drew nothing and said "Which step feels shaky? Start there." The words tie (each line
 * answers half of them), so rule 2 fell silent; and the deixis branch could not save it because
 * `AppRuntime` handed it `focus.id` — "focus-1", the gesture's own id, which is never a glass id.
 * A learner who circles two lines of their own page is answered as if nothing was seen.
 */
describe('what the learner circled is not a guess', () => {
  const outline = LAB_GLASS.courseCard0();

  it('marks BOTH lines the lasso crossed, in the order they read', () => {
    const hit = resolveInstant({
      question: 'explain this: “2 feel the rule · 3 make a move”',
      map: outline,
      core: EMPTY_CORE,
      focusTargets: ['course-outline-2', 'course-outline-3'],
    });
    expect(hit?.target).toBe('course-outline-2');
    expect(hit?.by).toBe('focus');
    expect(hit?.kind).toBe('underline');
    expect(hit?.also?.map((m) => m.target)).toEqual(['course-outline-3']);
    expect(hit?.also?.[0]?.kind).toBe('underline');
  });

  it('aims at the one thing the gesture landed on', () => {
    const hit = resolveInstant({
      question: 'explain this: “2 feel the rule”',
      map: outline,
      core: EMPTY_CORE,
      focusTargets: ['course-outline-2'],
    });
    expect(hit?.target).toBe('course-outline-2');
    expect(hit?.by).toBe('focus');
    expect(hit?.also).toBeUndefined();
  });

  it('still falls silent on the same words with no gesture behind them', () => {
    expect(
      resolveInstant({
        question: 'explain this: “2 feel the rule · 3 make a move”',
        map: outline,
        core: EMPTY_CORE,
      }),
    ).toBeNull();
  });

  it('stands down when the gesture swept half the page', () => {
    expect(
      resolveInstant({
        question: 'explain this',
        map: outline,
        core: EMPTY_CORE,
        focusTargets: [
          'course-outline-1',
          'course-outline-2',
          'course-outline-3',
          'course-outline-4',
        ],
      }),
    ).toBeNull();
  });

  it('never aims at a gesture id that is not on the glass', () => {
    expect(
      resolveInstant({
        question: 'explain this: “2 feel the rule · 3 make a move”',
        map: outline,
        core: EMPTY_CORE,
        focusTargets: ['focus-1'],
      }),
    ).toBeNull();
  });
});

/**
 * THE INSTANT MARK ON A PHOTOGRAPH (docs/INK-FOUR.md, timing; the adversary, wave 57: the doubt
 * turn is the one turn of the 59 that fails timing outright, first stroke 8 193 ms after the
 * confirm). The six lines are the page the adversary photographed, as the learner confirmed them.
 */
describe('the instant mark on a photograph', () => {
  const LINES = [
    { id: 'r1', text: 'Ex 2.3 Q4' },
    { id: 'r2', text: 'Solve: 3x + 5 = 20' },
    { id: 'r3', text: '3x = 20 + 5 ?' },
    { id: 'r4', text: '3x = 25' },
    { id: 'r5', text: 'x = 25/3' },
    { id: 'r6', text: 'x = 8.33' },
  ];

  it('marks the line the learner tapped, at once, in their own words', () => {
    expect(resolveDoubtInstant({ lines: LINES, lit: 'r3' })).toEqual({
      target: 'r3',
      kind: 'underline',
      words: '3x = 20 + 5 ?',
      by: 'focus',
    });
  });

  it('with no tap and no words, marks the equation and not the exercise heading', () => {
    const aim = resolveDoubtInstant({ lines: LINES });
    expect(aim?.target).toBe('r2');
    expect(aim?.by).toBe('photo-line');
    // never r1: "Ex 2.3 Q4" is a heading, and nobody is asking about it
    expect(aim?.words).toBe('Solve: 3x + 5 = 20');
  });

  it('marks the line the learner’s own words name, when they name exactly one', () => {
    expect(resolveDoubtInstant({ lines: LINES, words: 'how did 8.33 come out of this' })?.target).toBe(
      'r6',
    );
  });

  it('falls to the equation rather than guessing between two lines that answer equally', () => {
    // "the +5" is on r2 and on r3; a token count cannot choose, so the aim is the line the page
    // is about — which is also the line the model opens on, so the ink never has to move.
    expect(resolveDoubtInstant({ lines: LINES, words: 'I am not sure about the +5' })?.target).toBe(
      'r2',
    );
  });

  it('draws nothing on a page with no relation and nothing pointed at', () => {
    expect(
      resolveDoubtInstant({ lines: [{ id: 'r1', text: 'The Non-Cooperation Movement' }] }),
    ).toBeNull();
    expect(resolveDoubtInstant({ lines: [] })).toBeNull();
    // a tap on a line the reading no longer has is not a target
    expect(resolveDoubtInstant({ lines: [{ id: 'r1', text: 'A heading' }], lit: 'r9' })).toBeNull();
  });
});

/**
 * THE DOUBT'S OWN FIRST STROKE (the adversary, wave 47, finding 4; docs/INK-FOUR.md, timing).
 *
 * The doubt photo is the one turn of the 59 that fails timing outright: the first stroke landed
 * 8 193 ms after the learner confirmed the reading. The photo's lines are already on the glass as
 * `photo-line` entries the moment the reading is shown, so a learner who has TAPPED a line has
 * already said which one they mean — and that is a lookup, not an inference. It is underlined
 * while the request is still in flight, like any other thing under their hand.
 */
describe('the line the learner lit on their own photo', () => {
  it('underlines it at once, with no model call', () => {
    const hit = resolveInstant({
      question: 'Is my step 2 right? I am not sure about the +5',
      map: LAB_GLASS.photo(),
      core: EMPTY_CORE,
      focusTargets: ['r-2'],
    });
    expect(hit?.target).toBe('r-2');
    expect(hit?.kind).toBe('underline');
    expect(hit?.by).toBe('focus');
  });

  it('and aims at nothing when they lit nothing', () => {
    expect(
      resolveInstant({
        question: 'Is my step 2 right? I am not sure about the +5',
        map: LAB_GLASS.photo(),
        core: EMPTY_CORE,
      }),
    ).toBeNull();
  });
});
