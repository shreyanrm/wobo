/**
 * The vibe's chrome — the switch, and the two marks the switch swaps.
 *
 * The preference itself lives in `ui/viewPref.ts`; this is everything it is allowed to draw. Both
 * marks of a pair are always rendered and `ui/vibe.css` picks one, so a toggle is a repaint rather
 * than a remount: no flash, no node that can arrive without its neighbours, and nothing for a
 * transition to fight over.
 *
 * The climb reads them like this:
 *
 *   import { ChapterTestMark, RewardMark, VibeSwitch } from '../ui/vibe';
 *   import { useVibe, vibeWords } from '../ui/viewPref';
 *
 *   const words = vibeWords(useVibe());
 *   …
 *   <li className="cl-n cl-chest cl-l">
 *     <span className="cl-dot" aria-hidden="true"><RewardMark /></span>
 *     <div className="cl-card"><b>{words.reward}</b>…</div>
 *   </li>
 */

import './vibe.css';
import { holdScrollPlace, setVibe, useVibe, VIBE_LABELS, VIBES, type Vibe } from './viewPref';

/**
 * The reward node's mark: a chest in Quest, an opened lock in Focused.
 *
 * `aria-hidden` on purpose — the node's own card says what it is in words ("A chest" / "Unlocked"
 * and the line under it), so the status is never carried by a picture or by a colour alone.
 */
export function RewardMark() {
  return (
    <>
      <svg className="cl-i-q" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9.5h18v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
        <path d="M3 9.5 5 4.5h14l2 5M12 9.5v10.5M9.5 13.5h5" />
      </svg>
      <svg className="cl-i-f" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
        <path d="M8 10.5V7.5a4 4 0 0 1 7.4-2.1" />
      </svg>
    </>
  );
}

/** The chapter test's mark: a star in Quest, a paper in Focused. Also decoration, also silent. */
export function ChapterTestMark() {
  return (
    <>
      <svg className="cl-i-q" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
      </svg>
      <svg className="cl-i-f" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
        <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
      </svg>
    </>
  );
}

/**
 * Pick a look, and leave the reader looking at what they were looking at.
 *
 * The anchor is measured before the change and restored one frame after it, which is after React
 * has committed and after the stylesheet has taken the new corner radii — the two things that can
 * move the map under someone mid-read.
 */
function choose(vibe: Vibe): void {
  const restore = holdScrollPlace();
  setVibe(vibe);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
  else restore();
}

export interface VibeSwitchProps {
  /** What the group is called to a screen reader. */
  label?: string;
  /** Rides alongside `cl-vibe`, for a caller that needs to place it. */
  className?: string;
}

/**
 * The switch: two buttons in a labelled group, each saying whether it is the one that is on.
 *
 * Not a segmented radio — a radio group makes the second option reachable only by arrow key from
 * the first, and this is two words that both deserve a Tab stop. Native buttons, so Enter and
 * Space both work and nothing has to be re-implemented.
 *
 * A labelled `<div role="group">` rather than the `<fieldset>` the linter suggests: a fieldset is
 * for form fields and there is no form here, and it would arrive with a user-agent border and
 * margin — DESIGN.md §2 allows no border line on any surface in this product.
 */
export function VibeSwitch({ label = 'How the climb looks', className }: VibeSwitchProps) {
  const vibe = useVibe();
  return (
    // biome-ignore lint/a11y/useSemanticElements: no form, and a fieldset draws a UA border
    <div className={className ? `cl-vibe ${className}` : 'cl-vibe'} role="group" aria-label={label}>
      {VIBES.map((v) => (
        <button key={v} type="button" aria-pressed={v === vibe} onClick={() => choose(v)}>
          {VIBE_LABELS[v]}
        </button>
      ))}
    </div>
  );
}
