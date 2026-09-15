/**
 * The cold start, from the learner's side of the glass (docs/BOARD-COLD-START.md).
 *
 * The gateway's half is proved in `services/gateway/tests/test_board_cold_start.py`. This is the
 * half a child actually meets: what is on the screen during the wait, what is on it after, and the
 * two sentences that must never be on it at all.
 *
 * There is no browser in this suite, so the card is rendered to static markup. That is enough for
 * everything that matters here, because every law in this file is about what is PRESENT: the wait
 * is a drawing and no words, the fall-through is the learner's plan, and the phrase "no syllabus"
 * is nowhere.
 */

import { describe, expect, it } from 'bun:test';
import type { CurriculumUnitsView, SharedPlan } from '@wobo/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoveryCard, remainingWait, sharedConceptRoute, WAIT_CEILING_MS } from './StatusCard';

const noop = () => {};

const PLAN: SharedPlan = {
  source: 'shared',
  level: 'Class 9',
  subject: 'Science',
  concepts: [
    { conceptId: 'laws-of-motion', name: 'Laws of motion', boards: 4, order: 0 },
    { conceptId: 'atoms', name: 'Atoms', boards: 3, order: 1 },
    { conceptId: 'sound', name: 'Sound', boards: 2, order: 2 },
  ],
};

const cold = (waitMs: number): CurriculumUnitsView => ({
  frameworkId: 'msbshse',
  level: 'Class 9',
  subject: 'Science',
  status: 'shared',
  subjectId: null,
  units: [],
  placeholder: null,
  plan: PLAN,
  jobId: 'job-1',
  waitMs,
  label: 'Official Maharashtra State Board',
  notListed: null,
});

const render = (view: CurriculumUnitsView | null, since?: number) =>
  renderToStaticMarkup(
    <DiscoveryCard view={view} onOwnSyllabus={noop} onStart={noop} since={since} />,
  );

/**
 * Everything a reader would actually READ: the markup with its tags taken out, and the drawing
 * with it. The orb's own body carries two `z` glyphs for when it sleeps (hidden, and Wobo's, not
 * this card's); what this file is about is whether the CARD says anything.
 */
const words = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the wait is a drawing, and it says nothing', () => {
  it('shows the subject scene and not one word while the ceiling runs', () => {
    const html = render(cold(WAIT_CEILING_MS));
    expect(html).toContain('<svg');
    expect(words(html)).toBe('');
  });

  it('never narrates: no stage, no percentage, no syllabus', () => {
    const said = words(render(cold(WAIT_CEILING_MS))).toLowerCase();
    for (const narration of ['looking', 'searching', 'reading', 'checking', 'syllabus', '%']) {
      expect(said).not.toContain(narration);
    }
  });

  it("counts to the brain's number, and never past its own ceiling", () => {
    expect(WAIT_CEILING_MS).toBe(8000);
    // A brain that asked for longer than a child will wait does not get it.
    const html = render(cold(60_000));
    expect(html).toContain('<svg');
  });
});

describe('when the syllabus has not landed, they start anyway', () => {
  it('shows the plan every board shares, in its order', () => {
    const said = words(render(cold(0)));
    expect(said).toContain('Laws of motion');
    expect(said).toContain('Atoms');
    expect(said).toContain('Sound');
    expect(said.indexOf('Laws of motion')).toBeLessThan(said.indexOf('Atoms'));
  });

  it("never dresses the plan as the board's syllabus", () => {
    const said = words(render(cold(0))).toLowerCase();
    expect(said).not.toContain('chapter');
    expect(said).not.toContain('no syllabus');
    expect(said).not.toContain('maharashtra');
  });

  it('keeps the own-syllabus door open beside it', () => {
    expect(words(render(cold(0)))).toContain('Show me my syllabus');
  });
});

describe('the one case that still needs a sentence', () => {
  it('a board with nothing to start anyone on gets the honest end and the door', () => {
    const view = { ...cold(0), plan: null };
    const said = words(render(view));
    expect(said).toContain('Show me my syllabus');
    expect(said.toLowerCase()).not.toContain('no syllabus stored');
  });
});

/**
 * THE HALF THAT WAS NEVER JOINED (the lab, 2026-09-15).
 *
 * The plan rendered and every row was inert: `onStart` was optional, no screen passed one, and
 * `SharedPlanClimb` fell back to a `<div>`. A learner on a cold board read two dozen concept names
 * and pressing one did nothing, so "the first lesson begins" (docs/BOARD-COLD-START.md §2.4) was
 * the one clause of the cold start that was never true.
 */
describe('and the first lesson begins', () => {
  it('every row of the plan is something a learner can press', () => {
    const html = render(cold(0));
    const controls = html.match(/<button[^>]*type="button"/g) ?? [];
    expect(controls.length).toBeGreaterThanOrEqual(PLAN.concepts.length);
  });

  it('a row opens a lesson on that concept, never a chapter of a board that has none', () => {
    const [first] = PLAN.concepts;
    expect(first && sharedConceptRoute(first)).toEqual({
      name: 'course',
      topicId: 'custom:Laws of motion',
    });
  });

  it('two learners on two cold boards get the identical door for the identical concept', () => {
    expect(sharedConceptRoute({ conceptId: 'atoms', name: 'Atoms' })).toEqual(
      sharedConceptRoute({ conceptId: 'atoms', name: ' Atoms ' }),
    );
  });
});

/**
 * THE CEILING IS THE LEARNER'S WAIT, NOT THE CARD'S.
 *
 * The card only mounts once the answer is in hand (`useUnits` reports `looking` from a view), so a
 * clock started at mount charged the learner the fetch AND the whole eight seconds — 9.1 to 10.0
 * seconds on the throttled lab against a ceiling of eight. The budget is spent from the moment
 * they asked.
 */
describe('the designed wait is counted from when the learner asked', () => {
  it('spends what the answer already spent', () => {
    expect(remainingWait(8000, 2_000, 3_500)).toBe(6_500);
  });

  it('starts them at once when the answer took the whole budget', () => {
    expect(remainingWait(8000, 1_000, 10_000)).toBe(0);
  });

  it('is the whole ceiling when nothing is known about when they asked', () => {
    expect(remainingWait(8000, undefined, Date.now())).toBe(WAIT_CEILING_MS);
  });

  it("never runs past this file's ceiling however long the brain asks for", () => {
    expect(remainingWait(60_000, 1_000, 1_000)).toBe(WAIT_CEILING_MS);
  });

  it('shows the plan, not the scene, when the budget is already gone', () => {
    const said = words(render(cold(WAIT_CEILING_MS), Date.now() - WAIT_CEILING_MS));
    expect(said).toContain('Laws of motion');
  });
});
