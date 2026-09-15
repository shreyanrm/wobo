'use client';

/**
 * The cold start, on the learner's side (docs/BOARD-COLD-START.md).
 *
 * This file used to be a status card: a pulsing dot, a stage word ("Looking for the official
 * syllabus", "Reading the board's document"), and a line explaining that there was nothing here.
 * For 264 of the 268 boards in the registry that card WAS the product, which is the hole this
 * closes. The law it now keeps, in order:
 *
 *  1. **A designed wait, not a spinner, and not a sentence.** `WaitScene` — the orb drawing
 *     something from the learner's own subject (docs/EMAILS-AND-ANIMATIONS.md §3). It never says
 *     what it is doing, never shows a percentage, never mentions a syllabus.
 *  2. **A ceiling of about eight seconds**, and the ceiling is the brain's number (`view.waitMs`),
 *     not one this file invented. It is the LEARNER'S eight seconds, counted from the moment they
 *     asked (`since`) rather than from the moment this card mounted — the card only mounts once
 *     the answer is in hand, so a clock started here charged them the fetch as well and the plan
 *     landed at nine and ten seconds on a throttled phone. If the board's syllabus lands inside
 *     the window the learner walks into their own climb and never knows anything happened.
 *  3. **If it does not land, they start anyway**, on the class-and-subject plan every board
 *     shares, because the concept cores are board-agnostic (docs/LEARNING-MODEL.md). It is
 *     concepts, never chapters: this board's chapters do not exist yet and we do not invent one.
 *     And starting means STARTING: every row is a door into a lesson on that concept
 *     (`sharedConceptRoute`), which is why `onStart` is required rather than optional. It was
 *     optional, and no screen passed one, so the plan rendered as two dozen names that could not
 *     be pressed — §2.4's "the first lesson begins" was the one clause of this design that was
 *     never true.
 *  4. **Nothing is announced.** Not the wait, not the fall-through, not the re-anchor when the
 *     board's own syllabus arrives behind them.
 *
 * The one case that still needs a sentence is a board whose document genuinely cannot be read:
 * they are taught anyway on the shared plan, and the own-syllabus door stays open beside it.
 *
 * NOT DONE, and named here rather than implied: the re-anchor's client half, in two parts. The
 * gateway computes the re-anchor (`coldstart.reanchor`, `curriculum.units` with `anchor: true`)
 * and it is proved there, but the SDK has no parameter for it, nothing reads the anchors, and
 * `store/progress` is never re-keyed. Underneath that, there is still nothing to carry: a composed
 * course records no progress at all (`Course.tsx` reports only for a registry topic), so a concept
 * started from this plan leaves no trace to move onto the board's node ids. "Same progress, now in
 * the board's order" is therefore a gateway fact and not yet a product one
 * (docs/BOARD-COLD-START.md §7, last bullet). What this file now guarantees is the step before
 * both: a concept the learner can actually start, under a name the anchor can match.
 */

import {
  type CurriculumStatusView,
  type CurriculumUnitsView,
  DISCOVERY_COPY,
  type SharedPlan,
} from '@wobo/sdk';
import { WaitScene } from '@wobo/wobo';
import { useEffect, useState } from 'react';
import type { Route } from '../shell/router';
import { MagneticButton, surface } from '../ui/kit';
import { useDiscoveryStatus } from './hooks';

/**
 * How long the designed wait may run, in milliseconds.
 *
 * The brain sends its own ceiling on every cold answer and that one wins; this is the fallback for
 * an answer that carried none, and it is checked against the gateway's `coldstart.WAIT_CEILING_MS`
 * by `test_board_cold_start.py` so there is one number in the product rather than two.
 */
export const WAIT_CEILING_MS = 8000;

/**
 * How much of the designed wait is left, in milliseconds.
 *
 * `waitMs` is the brain's ceiling and `since` is the epoch millisecond the learner asked — the
 * moment `useUnits` sent the request, not the moment this card mounted. The difference is the
 * whole point: the card cannot mount until the answer is in hand, so the fetch has already spent
 * part of the budget before there is anything to draw. Charging the learner for it again is what
 * put the shared plan on screen at 9.1 to 10.0 seconds against a ceiling of eight.
 *
 * A `since` of zero or undefined means nobody knows when they asked, and then the whole ceiling
 * stands — a guess in the other direction would cut a real wait short.
 */
export function remainingWait(waitMs: number, since: number | undefined, now: number): number {
  const ceiling = Math.min(Math.max(waitMs, 0), WAIT_CEILING_MS);
  if (!since || since <= 0) return ceiling;
  return Math.max(0, ceiling - Math.max(0, now - since));
}

/**
 * Where a row of the plan every board shares sends the learner.
 *
 * A concept, never a chapter: this board has no chapters yet and we do not invent one
 * (docs/LEARNING-MODEL.md §1). So it is not a syllabus node id — it is the composed-course seam
 * the product already has (`Course.tsx` reads the `custom:` prefix and composes a lesson on
 * exactly what it names), which is the only door that can open on a concept no board of ours has
 * yet named. The concept's canonical name is what travels, because that is the lesson's title AND
 * because `concept_id` is that name slugged (`content/catalogs/concepts.json`), so the quiet
 * re-anchor can still find what was learned when the board's own syllabus lands.
 *
 * Deterministic and trimmed, so two learners on two cold boards get the identical door.
 */
export function sharedConceptRoute(concept: {
  conceptId: string;
  name: string;
}): Extract<Route, { name: 'course' }> {
  const title = concept.name.trim() || concept.conceptId.trim();
  return { name: 'course', topicId: `custom:${title}` };
}

export function DiscoveryCard({
  view,
  since,
  onOwnSyllabus,
  onFinished,
  onStart,
}: {
  /** The brain's answer for this level and subject. Null while the first request is in flight. */
  view: CurriculumUnitsView | null;
  /**
   * When the learner asked (epoch ms), from `useUnits`. The designed wait is counted from here,
   * not from this card's mount. Absent where a caller genuinely does not know.
   */
  since?: number | undefined;
  onOwnSyllabus(): void;
  /** Called when the board's own syllabus lands, so the caller can re-read the chapters. */
  onFinished?(status: CurriculumStatusView): void;
  /**
   * Start one concept of the shared plan — `sharedConceptRoute` is where every caller sends it.
   * REQUIRED. It used to be optional "where a screen has nowhere to send them yet", and the
   * consequence was that no screen ever passed one and every row of the plan was dead.
   */
  onStart(concept: { conceptId: string; name: string }): void;
}) {
  const plan = view?.plan ?? null;
  const budget = Math.min(view?.waitMs ?? WAIT_CEILING_MS, WAIT_CEILING_MS);
  // Lazy, and read once: `Date.now()` in a render body would make the ceiling a new number on
  // every render and restart the timer under the learner.
  const [waiting, setWaiting] = useState(() => remainingWait(budget, since, Date.now()) > 0);

  // The quiet poll. It exists so that a syllabus landing inside the window replaces the scene
  // mid-loop with the learner's own climb; it renders nothing and says nothing.
  useDiscoveryStatus(view?.jobId ?? view?.placeholder?.jobId ?? null, onFinished);

  useEffect(() => {
    const left = remainingWait(budget, since, Date.now());
    if (left <= 0) {
      setWaiting(false);
      return;
    }
    setWaiting(true);
    const timer = setTimeout(() => setWaiting(false), left);
    return () => clearTimeout(timer);
    // The subject changing is a new wait; the ceiling changing is a new answer.
  }, [budget, since]);

  if (waiting) {
    return (
      <section
        style={{
          display: 'grid',
          justifyItems: 'center',
          padding: '28px 16px',
          background: surface.card,
          borderRadius: surface.radius.card,
        }}
      >
        {/* No text node, by law. The scene is the whole of what is said. */}
        <WaitScene subject={view?.subject ?? 'math'} width={220} orb />
      </section>
    );
  }

  if (plan) return <SharedPlanClimb plan={plan} onStart={onStart} onOwnSyllabus={onOwnSyllabus} />;

  // No plan came back at all: the board's document could not be read AND we hold no shared plan
  // for this class and subject. This is the one case the law gives a sentence to, and the door is
  // open in the same place rather than at the end of a dead end.
  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
        background: surface.card,
        borderRadius: surface.radius.card,
      }}
    >
      <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: surface.inkSoft }}>
        {DISCOVERY_COPY.refused}
      </p>
      <div>
        <MagneticButton variant="primary" size="sm" onClick={onOwnSyllabus}>
          Show me my syllabus
        </MagneticButton>
      </div>
    </section>
  );
}

/**
 * What they climb while their board is being read.
 *
 * Deliberately not dressed as a syllabus: no chapter numbers, no "Chapter 1", no board's name over
 * it. It is the list of things learners in this class learn in this subject, and when the board's
 * own syllabus lands these same concepts reappear in the board's order under the board's names
 * (the gateway's `coldstart.reanchor` — computed there, not yet read here; see the note at the top
 * of this file). Nothing on this screen says any of that.
 *
 * Every row is a button. Not "a button when a handler happens to be passed": the rows ARE the
 * climb, and a climb nobody can step onto is a list of names.
 */
function SharedPlanClimb({
  plan,
  onStart,
  onOwnSyllabus,
}: {
  plan: SharedPlan;
  onStart(concept: { conceptId: string; name: string }): void;
  onOwnSyllabus(): void;
}) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <ol
        style={{
          display: 'grid',
          gap: 2,
          margin: 0,
          padding: 0,
          listStyle: 'none',
          background: surface.card,
          borderRadius: surface.radius.card,
          overflow: 'hidden',
        }}
      >
        {plan.concepts.map((concept, index) => (
          <li key={concept.conceptId}>
            <button
              type="button"
              style={{
                display: 'grid',
                gridTemplateColumns: '2ch 1fr',
                gap: 12,
                width: '100%',
                // 44px on the short side at this font size and padding — the tap target law
                // (docs/02-DESIGN), and these rows are the only thing to press on the screen.
                minHeight: 44,
                alignItems: 'center',
                padding: '12px 16px',
                textAlign: 'left',
                font: 'inherit',
                fontSize: '0.95rem',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
              }}
              onClick={() => onStart({ conceptId: concept.conceptId, name: concept.name })}
            >
              <span style={{ color: surface.inkFaint, fontVariantNumeric: 'tabular-nums' }}>
                {index + 1}
              </span>
              <span>{concept.name}</span>
            </button>
          </li>
        ))}
      </ol>
      <div>
        <MagneticButton variant="quiet" size="sm" onClick={onOwnSyllabus}>
          Show me my syllabus
        </MagneticButton>
      </div>
    </section>
  );
}

/** The empty world: no board chosen on this device yet. One line, one door. */
export function EmptyWorldCard({ onChooseBoard }: { onChooseBoard(): void }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
        background: surface.card,
        borderRadius: surface.radius.card,
      }}
    >
      <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.5 }}>{DISCOVERY_COPY.empty}</p>
      <div>
        <MagneticButton size="sm" onClick={onChooseBoard}>
          Choose your board
        </MagneticButton>
      </div>
    </section>
  );
}
