'use client';

/**
 * "A subject you can see yourself climbing" — the same path, dressed two ways.
 *
 * The switch is the argument: a learner who wants a quest gets checkpoints, a chest and a boss;
 * a learner who wants to work gets a list. Same chapters, same tutor, same standard — which is
 * what the line under it says, and why both drawings carry the identical four chapters.
 *
 * WHY THE SWAP IS CSS AND THE DRAW IS GSAP (law v5 §8, cause 1 — one owner per property):
 * the two SVGs cross-fade on `opacity`, and that transition lives in `page-styles.ts` where the
 * `.on` class is the only thing that moves it. GSAP never touches opacity here. What GSAP does own
 * is the pig path's `stroke-dashoffset`, fired once as the section arrives (`mountClimb`), and
 * nothing in CSS transitions that.
 *
 * The switch is two real `<button>`s inside a `<fieldset>`, not a styled div: two controls that
 * answer one question are a named group of controls, which is what a screen reader announces. The
 * stylesheet resets the fieldset to nothing, so the layout is the prototype's, and `aria-pressed`
 * says which way the path is currently dressed.
 */

import { useState } from 'react';
import { ClimbFocus, ClimbQuest } from '../art';
import { CLIMB } from '../page-copy';

export function Climb() {
  const [vibe, setVibe] = useState<'quest' | 'focus'>('quest');

  return (
    <section id="climb">
      <div className="wrap">
        <div className="eyebrow reveal">{CLIMB.eyebrow}</div>
        <h2 className="t reveal">
          {CLIMB.title.lead}
          <span className="hl">{CLIMB.title.mark}</span>
        </h2>
        <p className="lede reveal">{CLIMB.lede}</p>

        <div className="climb reveal">
          <fieldset className="switch" aria-label={CLIMB.switchLabel}>
            {CLIMB.vibes.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={vibe === entry.key ? 'on' : undefined}
                aria-pressed={vibe === entry.key}
                onClick={() => setVibe(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </fieldset>

          <div className="stagewrap">
            <ClimbQuest
              label={CLIMB.vibes[0]?.art ?? ''}
              on={vibe === 'quest'}
              marks={CLIMB.marks}
            />
            <ClimbFocus
              label={CLIMB.vibes[1]?.art ?? ''}
              on={vibe === 'focus'}
              rows={CLIMB.rows}
              gate={CLIMB.gate}
            />
          </div>

          <div className="same">
            {CLIMB.same.lead}
            <em>{CLIMB.same.em}</em>
          </div>
          <div className="legend">
            {CLIMB.legend.map((entry) => (
              <span key={entry.label}>
                <i style={{ background: entry.tone }} />
                {entry.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
