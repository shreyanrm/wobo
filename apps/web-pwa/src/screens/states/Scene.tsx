'use client';

/**
 * The shell every state page is built on, and the loading scene.
 *
 * One shape for all seven: the drawing, a heading, one paragraph written from the learner's side of
 * the screen, at most two doors, and a quiet line underneath saying what still works. The corner
 * carries the state's name and the wordmark, so a screenshot of any of them is self-describing.
 *
 * The loading scene is the one the owner directed (`scratchpad/design/states.html`): the pen draws
 * the hairline, the line loops into the orb, Wobo settles, a handwritten line rotates underneath,
 * and the last word is always "Your place is saved". The pen-and-settle half is the product's real
 * loader (`WoboLoader` in `@wobo/wobo`) rather than a copy of it, so the boot animation a learner
 * sees is the same animation everywhere it appears.
 */

import { useReducedMotion } from '@wobo/motion';
import { WoboLoader } from '@wobo/wobo';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from '../landing/wordmark';
import { LOADING_LINE_MS, LOADING_LINES } from './generation';
import { ensureStateStyles } from './styles';

// The chunk arriving IS the page being shown, so the stylesheet goes in at import time — an effect
// would let the first paint land unstyled for a frame, on the one screen that must never flicker.
ensureStateStyles();

/** The real wordmark, as drawn — the owner's own glyphs, in the page's ink. */
function StateWordmark() {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} role="img" aria-label="wobo">
      {WORDMARK_PATHS.map((g) => (
        <path key={g.transform} transform={g.transform} d={g.d} />
      ))}
    </svg>
  );
}

export interface SceneAction {
  label: string;
  onSelect: () => void;
  /** The one primary door. Everything else is quiet — one intention per screen. */
  primary?: boolean;
  /**
   * WHERE IT GOES, when it goes somewhere, and then it is rendered as a real link.
   *
   * `dist/404.html` is written as this screen so that somebody who mistyped an address can read
   * their way out of it with nothing running (scripts/notfound.ts). Both its doors were buttons,
   * and a button does nothing with JavaScript off, so the one page written for that reader was the
   * only page on the site with no way out of it: 27 words, no links in, no links out, against 34
   * real hrefs on /about. A door to an address is an anchor with the address in it; the click is
   * still the router's, so nothing about the running app changes.
   */
  href?: string;
}

/** The browser owns a click with a modifier on it: a new tab is the reader's decision, not ours. */
function browserOwnsClick(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** The scene shell. `art` is the drawing; everything else is words. */
export function StateScene({
  code,
  title,
  body,
  actions = [],
  note,
  art,
}: {
  /** The state's name, top left. Never a bare status code a learner would have to look up. */
  code: string;
  title: string;
  body: string;
  actions?: readonly SceneAction[];
  /** What still works, said plainly. The dead-end rule: never only an apology. */
  note?: string;
  art: ReactNode;
}) {
  return (
    <div className="ws">
      <span className="ws-code">{code}</span>
      <span className="ws-mark">
        <StateWordmark />
      </span>
      <div className="ws-card">
        {art}
        <h1 className="ws-h1">{title}</h1>
        <p className="ws-body">{body}</p>
        {actions.length > 0 ? (
          <div className="ws-row">
            {actions.map((a) => {
              const className = a.primary ? 'ws-btn' : 'ws-btn ws-btn--quiet';
              return a.href ? (
                <a
                  key={a.label}
                  href={a.href}
                  className={className}
                  onClick={(event) => {
                    if (event.defaultPrevented || browserOwnsClick(event)) return;
                    event.preventDefault();
                    a.onSelect();
                  }}
                >
                  {a.label}
                </a>
              ) : (
                <button key={a.label} type="button" className={className} onClick={a.onSelect}>
                  {a.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {note ? <p className="ws-tiny">{note}</p> : null}
      </div>
    </div>
  );
}

/**
 * A line written letter by letter, the way a hand writes it. Under reduced motion it is simply
 * there — the words are the point, and they are legible either way.
 */
function Handwritten({ line }: { line: string }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <span className="ws-hand" aria-live="polite">
        {line}
      </span>
    );
  }
  return (
    <span className="ws-hand" aria-live="polite">
      {[...line].map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the letters of a line ARE their positions
        <span key={`${line}-${i}`} style={{ animationDelay: `${i * 28}ms` }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/**
 * The loading scene: Wobo drawing the page.
 *
 * `line` pins the handwritten line to something true (a generation says which stage it is at);
 * left alone, the lines rotate. `onDone` fires when the pen-and-settle animation has finished, so
 * the boot loader can take itself away.
 */
export function LoadingScene({
  line,
  onDone,
  width = 300,
}: {
  line?: string;
  onDone?: () => void;
  width?: number;
}) {
  const [tick, setTick] = useState(0);
  const pinned = line !== undefined;
  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => setTick((t) => t + 1), LOADING_LINE_MS);
    return () => clearInterval(id);
  }, [pinned]);
  const shown = pinned ? line : ((LOADING_LINES[tick % LOADING_LINES.length] as string) ?? '');
  return (
    <div className="ws">
      <span className="ws-mark">
        <StateWordmark />
      </span>
      <div className="ws-card">
        <WoboLoader width={width} {...(onDone ? { onDone } : {})} />
        <Handwritten line={shown} />
        <p className="ws-tiny">Your place is saved</p>
      </div>
    </div>
  );
}

/**
 * The same scene, frosted over whatever the learner was already on, for a generation that is taking
 * long enough to be worth waiting with them. Escape leaves; the work carries on either way, which
 * is what the closing line promises.
 *
 * Rendered into `document.body` through a portal, and the portal is not decoration. It is mounted
 * from the download centre, whose container carries a `transform` — which makes that element the
 * containing block for every `position: fixed` descendant, so an overlay left inside it would size
 * itself to a 420px pill at the bottom of the screen instead of to the viewport. (The landing
 * page's ink field is portalled for exactly the same reason.)
 */
export function GenerationWait({
  title,
  stage,
  onLeave,
}: {
  title: string;
  stage: string;
  onLeave: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLeave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLeave]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="ws-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Wobo is building ${title}`}
    >
      <div className="ws">
        <span className="ws-code">{title}</span>
        <span className="ws-mark">
          <StateWordmark />
        </span>
        <div className="ws-card">
          <WoboLoader width={300} />
          <Handwritten line={stage.toLowerCase()} />
          <p className="ws-tiny">
            It carries on if you leave, and Wobo will tell you the moment it is ready.
          </p>
          <div className="ws-row">
            <button type="button" className="ws-btn ws-btn--quiet" onClick={onLeave}>
              Keep browsing
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
