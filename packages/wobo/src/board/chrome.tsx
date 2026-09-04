'use client';

/**
 * The board's chrome — the frame around Wobo's ink, and nothing that makes ink itself.
 *
 * DESIGN.md is law here: bold ink on good paper. That means no border lines anywhere in the
 * chrome (a surface is told apart from the one under it by tone and by a soft shadow when it
 * floats, never by a rule), corners of 10 / 16 / 24, and the kit's own shapes — a quiet button
 * and the Practice progress bar — rather than a second vocabulary invented for the board.
 *
 * The board package cannot import the app's kit, so the two shapes it borrows are restated here
 * against the same tokens the kit uses (`--paper`, `--paper-2`, `--paper-3`, `--ink`,
 * `--marigold`, `--pig`, `--lift`, `--shadow`). Night reads exactly the same names, so the theme
 * comes for free from the document's stamp — there is not one dark-only value below.
 *
 * Every literal after a comma is a FALLBACK, for a board rendered outside a document the app has
 * stamped (an export, a test renderer). Law v5 (DESIGN.md §0) moved those fallbacks off cream and
 * onto the white ground, so a board that falls back looks like the board that does not.
 *
 * `test/board/chrome.test.ts` holds this stylesheet to the law, declaration by declaration.
 */

import type { ButtonHTMLAttributes } from 'react';

const SANS = "var(--sans,'Poppins',system-ui,-apple-system,sans-serif)";

/** The chrome stylesheet. Exported so the law test can read the rules rather than the rendering. */
export const BOARD_CHROME_CSS = `
.wobo-chrome{font:400 14px/1.4 ${SANS};color:var(--ink,#14142B)}

/* the full board: the page's own paper, with the bar floating clear of the bottom edge */
.wobo-chrome-full{position:absolute;inset:0;background:var(--wobo-page,#FFFFFF)}
.wobo-chrome-full > .wobo-chrome-bar{position:absolute;left:16px;right:16px;bottom:16px}

/* the bar that carries the scrubber and the two quiet buttons — a floating thing, so a shadow */
.wobo-chrome-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 12px;background:var(--paper-2,#F6F6F8);border-radius:24px;box-shadow:var(--lift,0 8px 24px rgba(20,20,43,.10))}

/* the kit's quiet button, small: 10px corners, no border, one tonal step off the bar */
.wobo-chrome-btn{font:500 14px/1 ${SANS};padding:10px 14px;min-height:44px;border:0;border-radius:10px;background:var(--paper,#FFFFFF);color:var(--ink,#14142B);display:inline-flex;align-items:center;gap:8px;cursor:pointer;flex:none}
.wobo-chrome-btn:disabled{cursor:progress;color:var(--ink-3,#8A8A9E)}
.wobo-chrome-btn:focus-visible{outline:3px solid var(--pig,#2B45FF);outline-offset:2px}

/* the scrubber IS the Practice progress bar: a 12px round track, filled marigold */
.wobo-chrome-scrub{position:relative;flex:1 1 auto;min-width:80px;height:44px;display:flex;align-items:center}
.wobo-chrome-track{position:relative;width:100%;height:12px;border-radius:999px;background:var(--paper-3,#ECECF0);overflow:hidden}
.wobo-chrome-fill{display:block;height:100%;background:var(--marigold,#FFB629);border-radius:999px}
.wobo-chrome-scrub input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;opacity:0;cursor:pointer;appearance:none;-webkit-appearance:none;background:transparent}
.wobo-chrome-scrub:focus-within .wobo-chrome-track{outline:3px solid var(--pig,#2B45FF);outline-offset:4px}

/* the plane: a card that floats over the screen — tone plus a shadow, never a line */
.wobo-chrome-plane{display:flex;flex-direction:column;background:var(--paper-2,#F6F6F8);border-radius:24px;box-shadow:var(--shadow,0 18px 50px rgba(43,69,255,.13));overflow:hidden}
.wobo-chrome-sheet{border-radius:24px 24px 0 0}
.wobo-chrome-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 0 auto;padding:12px 12px 10px;user-select:none}
.wobo-chrome-title{flex:1 1 auto;min-width:0;min-height:44px;appearance:none;background:transparent;border:0;margin:0;padding:8px;font:500 14px/1 ${SANS};color:var(--ink-2,#55556B);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;touch-action:none;border-radius:10px}
.wobo-chrome-title:focus-visible{outline:3px solid var(--pig,#2B45FF);outline-offset:2px}
.wobo-chrome-canvas{position:relative;flex:1 1 auto;margin:0 12px 12px;background:var(--paper,#FFFFFF);border-radius:16px;overflow:hidden}
.wobo-chrome-grip{appearance:none;background:transparent;border:0;padding:0;position:absolute;right:4px;bottom:4px;width:24px;height:24px;border-radius:10px;cursor:nwse-resize;touch-action:none}
.wobo-chrome-grip:focus-visible{outline:3px solid var(--pig,#2B45FF);outline-offset:2px}

/* the plane put away: the same card, thumbnail sized, still holding its ink */
.wobo-chrome-thumb{position:fixed;padding:0;border:0;overflow:hidden;cursor:pointer;background:var(--paper-2,#F6F6F8);border-radius:16px;box-shadow:var(--lift,0 8px 24px rgba(20,20,43,.10))}
.wobo-chrome-thumb:focus-visible{outline:3px solid var(--pig,#2B45FF);outline-offset:3px}
`;

/** The chrome stylesheet, mounted. Cheap to render more than once; the browser dedupes the text. */
export function BoardChromeStyle() {
  return <style>{BOARD_CHROME_CSS}</style>;
}

/** A quiet button in the kit's hand — the only button shape the board chrome has. */
export function ChromeButton({
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = className ? `wobo-chrome-btn ${className}` : 'wobo-chrome-btn';
  return <button type={type} className={cls} {...rest} />;
}

export interface ScrubberProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onSeek: (value: number) => void;
}

/**
 * The board's history, on the Practice progress bar's shape. The range input is real — every
 * keyboard and every assistive technology already knows it — and it lies invisibly over the track
 * it drives, which is the same trick the drawn controls on the surface itself use.
 */
export function Scrubber({ label, min, max, step, value, onSeek }: ScrubberProps) {
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  return (
    <div className="wobo-chrome-scrub">
      <div className="wobo-chrome-track">
        <i className="wobo-chrome-fill" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
