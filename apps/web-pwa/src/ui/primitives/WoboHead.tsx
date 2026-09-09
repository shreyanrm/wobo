import { WoboBody, type WoboBodyProps } from '@wobo/wobo';
import type { CSSProperties } from 'react';

export interface WoboHeadProps extends Omit<WoboBodyProps, 'draggable' | 'style'> {
  /** The soft shadow under the hero head (the prototype's `drop-shadow`). Small heads go without. */
  shadow?: boolean;
  /** Placement only — the head's own box comes from `size`. */
  style?: CSSProperties;
}

/**
 * Wobo's head — the shipped rig from packages/wobo, wrapped, never redrawn.
 *
 * Two things the wrapper does: it hides the rig's grounding mark (a head on a card floats on the
 * card's tone; the prototype draws no patch under it), and it hands the rig the page's own
 * `--body` / `--visor` / `--eye` tokens so the head takes the theme of whatever panel it sits in,
 * not only the document's. The rig's own hairline rim stays as the rig sets it.
 *
 * AND A THIRD, ADDED AFTER THE SITE WAS PRE-RENDERED. A head used as ornament carries no
 * information a reader needs, and the rig keeps its sleeping z's in the markup at all times
 * (hidden by style, present in the DOM), so on every pre-rendered page two stray letters sat in
 * the body text between the document hash and the ask block. An ornamental head is marked as one:
 * it is taken out of the accessibility tree unless it is doing a job, which it is only when the
 * caller has given it a label or something to do. That is correct on its own merits and it is
 * also what keeps the z's out of what a page is read as. Removing them from the markup entirely
 * is a change inside the rig (`packages/wobo/src/body/WoboBody.tsx`), which this wave does not own.
 */
export function WoboHead({ size = 88, shadow, className, style, ...rig }: WoboHeadProps) {
  const cls = ['wk-head', shadow && 'wk-shadow', className].filter(Boolean).join(' ');
  const ornament = !rig.label && !rig.onTap && !rig.onDoubleTap && !rig.onHoldStart;
  const tones = {
    '--wr-body': 'var(--body)',
    '--wr-visor': 'var(--visor)',
    '--wr-eye': 'var(--eye)',
  } as CSSProperties;
  return (
    <span className={cls} style={style} aria-hidden={ornament || undefined}>
      <WoboBody size={size} style={tones} {...rig} />
    </span>
  );
}
