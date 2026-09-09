import { beforeEach, describe, expect, it } from 'bun:test';
import { SurfaceRegistry } from '@wobo/wobo';
import {
  ARMED_TTL_MS,
  aimableTargets,
  armDoIt,
  armedAction,
  disarm,
  findTargetId,
  glideAt,
  glideDurationMs,
  glideEase,
  isConfirmation,
  isDecline,
  permissionFor,
  runsWithoutAsking,
  showMe,
  tapPoint,
} from './hands';

describe('the permission ladder', () => {
  it('always asks before anything that communicates, buys, submits or deletes', () => {
    for (const action of [
      'send the parent note',
      'share this board',
      'buy the plan',
      'submit the answer',
      'delete my account',
      'forget everything Wobo knows about you',
      'sign out',
    ]) {
      expect(permissionFor(action)).toBe('execute_with_permission');
      expect(runsWithoutAsking(action)).toBe(false);
    }
  });

  it("lets Wobo do the reversible, harmless things on Wobo's own", () => {
    for (const action of [
      'open the atom course',
      'show the chapter list',
      'go to practice',
      'scroll to the next card',
    ]) {
      expect(permissionFor(action)).toBe('safe_automatic');
      expect(runsWithoutAsking(action)).toBe(true);
    }
  });

  it('asks when it is not sure — an unknown verb is never automatic', () => {
    expect(permissionFor('frobnicate the widget')).toBe('execute_with_permission');
  });

  it('asks even when a harmless word sits beside a consequential one', () => {
    expect(runsWithoutAsking('open the share sheet and send it')).toBe(false);
  });
});

describe('the prepared rung', () => {
  beforeEach(() => disarm());

  it('holds exactly what Wobo offered, and nothing runs until the learner says go ahead', () => {
    armDoIt('course-advance', 'the continue button');
    expect(armedAction()?.targetId).toBe('course-advance');
    expect(isConfirmation('go ahead')).toBe(true);
    expect(isConfirmation('yes please')).toBe(true);
    expect(isConfirmation('what does that mean')).toBe(false);
  });

  it('honours a no', () => {
    expect(isDecline('no')).toBe(true);
    expect(isDecline('not now')).toBe(true);
    expect(isDecline('nothing else')).toBe(false);
  });

  it('expires rather than lingering as a trap', () => {
    const at = 1_000_000;
    armDoIt('t', 'a thing', at);
    expect(armedAction(at + ARMED_TTL_MS - 1)).not.toBeNull();
    expect(armedAction(at + ARMED_TTL_MS + 1)).toBeNull();
    expect(armedAction(at)).toBeNull(); // an expired offer is dropped, not resurrected
  });
});

describe('the glide', () => {
  it('taps the middle of the control, where a person would', () => {
    expect(tapPoint({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
  });

  it('sets off, travels and settles — never a linear tween', () => {
    expect(glideEase(0)).toBe(0);
    expect(glideEase(1)).toBe(1);
    expect(glideEase(0.5)).toBeCloseTo(0.5, 5);
    expect(glideEase(0.25)).toBeLessThan(0.25); // slow away from rest
    expect(glideEase(0.75)).toBeGreaterThan(0.75); // and slow into it
  });

  it('clamps a fraction that ran past its ends', () => {
    expect(glideEase(-3)).toBe(0);
    expect(glideEase(9)).toBe(1);
  });

  it('travels the whole way and no further', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    expect(glideAt(from, to, 0)).toEqual(from);
    expect(glideAt(from, to, 1)).toEqual(to);
  });

  it('is slower for a longer trip, and never slow', () => {
    expect(glideDurationMs(0)).toBeGreaterThanOrEqual(320);
    expect(glideDurationMs(2000)).toBeLessThanOrEqual(1100);
    expect(glideDurationMs(600)).toBeGreaterThan(glideDurationMs(100));
  });

  it('arrives instantly under reduced motion, and still taps', () => {
    expect(glideDurationMs(900, true)).toBe(0);
  });
});

describe('finding the control Wobo was asked about', () => {
  const registry = () => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'course',
      title: 'the course player',
      targets: [
        {
          id: 'course-advance',
          kind: 'control',
          label: 'the continue button — it moves the lesson on',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
        {
          id: 'home-composer',
          kind: 'composer',
          label: 'the box where you talk to Wobo',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
      ],
    });
    return r;
  };

  it('takes an exact id first', () => {
    expect(findTargetId('course-advance', registry())).toBe('course-advance');
  });

  it('resolves the words a learner would use', () => {
    expect(findTargetId('the continue button', registry())).toBe('course-advance');
    expect(findTargetId('the box where I talk to Wobo', registry())).toBe('home-composer');
  });

  it('says nothing rather than pointing at the wrong thing', () => {
    expect(findTargetId('the microscope', registry())).toBeNull();
    expect(findTargetId('   ', registry())).toBeNull();
  });
});

/**
 * "Show me" resolves a tap point, glides to it for up to 1.1 s, and then presses what is there. A
 * scroll or a layout shift during that second leaves the point over something else entirely — the
 * one place in the hand where a coordinate can outlive its layout. So the target is re-read on
 * arrival, and what is pressed has to belong to it.
 */
describe('showing the learner a control', () => {
  const registry = new SurfaceRegistry();

  it('presses the target itself when nothing is under the point it travelled to', async () => {
    let pressed = 0;
    const el = { click: () => (pressed += 1), contains: () => false } as unknown as Element;
    let where = { x: 100, y: 100, width: 80, height: 30 };
    registry.registerSurface({
      id: 's',
      title: 'a screen',
      targets: [
        {
          id: 'next',
          kind: 'button',
          label: 'next',
          rect: () => where,
          element: () => el,
        },
      ],
    });
    // The page scrolls while Wobo is on Wobo's way: the point Wobo set off towards is now empty.
    where = { x: 100, y: 700, width: 80, height: 30 };
    const result = await showMe('next', { registry, reduced: true });
    expect(result.ok).toBe(true);
    expect(pressed).toBe(1);
  });

  it('says so rather than guessing when the target is not on screen at all', async () => {
    const empty = new SurfaceRegistry();
    empty.registerSurface({
      id: 's',
      title: 'a screen',
      targets: [{ id: 'gone', kind: 'button', label: 'gone', rect: () => null }],
    });
    const result = await showMe('gone', { registry: empty, reduced: true });
    expect(result.ok).toBe(false);
    expect(result.say).toContain('not on screen');
  });
});

/**
 * "Show me" glides to a thing on the LEARNER'S page. The registry lends the glass as the page's
 * targets (docs/INK-FREEZE-PLAN-TRACE.md §4), and the lab of 2026-09-08 found the cursor gliding
 * to the conversation instead: "show me why" landed on the learner's own bubble, "here: why does
 * that step work?". A line of prose is not a control, and the question read back is not a subject.
 */
describe('the hand aims at the page, never at the conversation', () => {
  const onGlass = (
    entries: { id: string; role: string; text: string; meaning?: string }[],
  ): SurfaceRegistry => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'course',
      title: 'the course player',
      targets: [
        {
          id: 'course-advance',
          kind: 'control',
          label: 'the continue button — it moves the lesson on',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
      ],
    });
    r.readGlass(() => ({
      map: { entries },
      rectOf: () => [0, 0, 10, 10] as const,
      elementOf: () => null,
    }));
    return r;
  };

  const CONVERSATION = [
    { id: 'l-bubble', role: 'line', text: 'show me why that step works' },
    { id: 'l-reply', role: 'line', text: 'The line that says show me why that step works.' },
    { id: 's-3', role: 'step', text: '3x = 15', meaning: 'step:3' },
    { id: 'k-begin', role: 'chip', text: 'Begin' },
  ];

  it('never lands on a line of prose, whatever it shares with the words', () => {
    const found = findTargetId('why that step works', onGlass(CONVERSATION));
    expect(found).not.toBe('l-bubble');
    expect(found).not.toBe('l-reply');
  });

  it('still points at the things that are really on the page', () => {
    expect(findTargetId('the begin chip', onGlass(CONVERSATION))).toBe('k-begin');
    expect(findTargetId('step 3', onGlass(CONVERSATION))).toBe('s-3');
    expect(findTargetId('the continue button', onGlass(CONVERSATION))).toBe('course-advance');
  });

  /**
   * THE CALLER STRIPS "SHOW ME" OUT BEFORE IT RESOLVES (the adversary, 2026-09-09, finding 2).
   *
   * AppRuntime asks for a target with the mode words removed, so the echo refusal was run against
   * " a number line" while the bubble said "show me a number line" — which does not BEGIN as the
   * stripped words begin, so the bubble came through and won on every word. Wobo's entire spoken
   * and printed answer to "show me a number line" was "here: show me a number line": no ink, no
   * gateway turn, no answer. The learner's whole words ride along now.
   */
  it('never aims at the question itself, however the caller trimmed the words', () => {
    const said = 'show me a number line';
    const trimmed = said.replace(/\b(show me|do it|for me|please|where is|how to)\b/gi, ' ');
    // An ask box that reached the map carries the words the learner just typed, and `input` is a
    // kind a hand may aim at — which is how "here: show me a number line" was Wobo's whole answer.
    const glass = onGlass([
      { id: 'ask-input', role: 'input', text: said },
      { id: 'k-begin', role: 'chip', text: 'Begin' },
    ]);
    expect(findTargetId(trimmed, glass, said)).not.toBe('ask-input');
    expect(aimableTargets(glass, trimmed, said).map((t) => t.id)).not.toContain('ask-input');
  });

  it('a hand-registered control whose label is the question back is refused too', () => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'course',
      title: 'the course player',
      targets: [
        {
          id: 'echo',
          kind: 'control',
          label: 'show me a number line',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
      ],
    });
    expect(aimableTargets(r, ' a number line', 'show me a number line')).toEqual([]);
  });
});

/**
 * THE ID IS NOT WORDS (the adversary, 2026-09-09, finding 1).
 *
 * `findTargetId` scored the target's own id in the same haystack as its label, so the course
 * outline's `course-outline-1` matched the word "line" — out-LINE — and "show me a number line"
 * was answered by gliding to the page's first lesson card. Live at 1440 on 2026-09-09 Wobo's
 * whole spoken and printed reply was "here: 1meet a square and a cube": no ink, no gateway turn,
 * and the number-line pipeline never reached. An id is ours; only the words a learner can read
 * are matched against the words a learner typed.
 */
describe('the hand matches words, never our own identifiers', () => {
  const outline = (): SurfaceRegistry => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'course',
      title: 'the course player',
      targets: [
        {
          id: 'course-outline-1',
          kind: 'step',
          label: 'step 1 of the course: meet a square and a cube',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
        {
          id: 'course-outline-2',
          kind: 'step',
          label: 'step 2 of the course: feel the rule',
          rect: () => ({ x: 0, y: 20, width: 10, height: 10 }),
        },
      ],
    });
    return r;
  };

  it('never lands on a lesson card because its id spells "outline"', () => {
    expect(findTargetId(' a number line', outline(), 'show me a number line')).toBeNull();
  });

  it('never lands on a target because its id spells the ask', () => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'course',
      title: 'the course player',
      targets: [
        {
          id: 'lesson-graph-card',
          kind: 'card',
          label: 'meet a square and a cube',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
      ],
    });
    expect(findTargetId(' y = x^2 on a graph', r, 'graph y = x^2')).toBeNull();
  });

  it('still finds a control by the words on it', () => {
    expect(findTargetId('the step about the rule', outline())).toBe('course-outline-2');
  });

  it('matches a word, not a fragment of a longer one', () => {
    const r = new SurfaceRegistry();
    r.registerSurface({
      id: 'you',
      title: 'your page',
      targets: [
        {
          id: 'a',
          kind: 'control',
          label: 'your subscription',
          rect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        },
      ],
    });
    // "script" is inside "subscription"; a learner asking for a script is not asking for billing.
    expect(findTargetId('the script', r)).toBeNull();
  });
});

/**
 * A NUMBER IS THE WHOLE OF WHAT "STEP 3" NAMES (measured at 1440, 2026-09-09).
 *
 * The words shorter than three letters are dropped as noise, which threw the number away: "show
 * me step 3 of the course" scored `step` against all seven outline lines and answered with the
 * first — "here: 1 meet a square and a cube". On the real page those lines carry no `meaning`,
 * only their own words, and the number IS the words.
 */
describe('the hand hears a number', () => {
  const outline = (): SurfaceRegistry => {
    const r = new SurfaceRegistry();
    r.readGlass(() => ({
      map: {
        entries: [
          { id: 'course-outline-1', role: 'step', text: '1 meet a square and a cube' },
          { id: 'course-outline-2', role: 'step', text: '2 feel the rule' },
          { id: 'course-outline-3', role: 'step', text: '3 make a move' },
        ],
      },
      rectOf: () => [0, 0, 10, 10] as const,
      elementOf: () => null,
    }));
    return r;
  };

  it('lands on the step the number names, not the first one that says "step"', () => {
    expect(findTargetId(' step 3 of the course', outline(), 'show me step 3 of the course')).toBe(
      'course-outline-3',
    );
  });

  it('still answers with the first when no number is given', () => {
    expect(findTargetId('the step about the move', outline())).toBe('course-outline-3');
  });
});
