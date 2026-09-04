'use client';

/**
 * "Try one. Wobo never says wrong." — a real moment, not a picture of one.
 *
 * Colour any of the four squares and press Check. Two squares is half, and Wobo makes a small,
 * specific fuss. Anything else and it draws a loop around what you actually coloured, names it
 * ("that's a quarter, not half") and waits. There is no red, no cross and no score, because the
 * product does not have any.
 *
 * The ring's path is arithmetic, not a lookup: `ringPath` in `engine/choreography.ts` builds the
 * hand-drawn oval around whichever squares are on, so it is correct for all fifteen combinations
 * and is tested without a browser.
 */

import { useCallback, useRef, useState } from 'react';
import { burst, drawRing, HALF, ringPath } from '../engine';
import { PRACTICE } from '../page-copy';

/** The pigments the fuss is thrown in — every accent that has a job on this page. */
const SPARK_COLOURS = [
  'var(--marigold)',
  'var(--pig)',
  'var(--mint)',
  'var(--rose)',
  'var(--violet)',
] as const;

type Say = { text: string; win: boolean };

export function Practice() {
  const [on, setOn] = useState<readonly boolean[]>([false, false, false, false]);
  const [say, setSay] = useState<Say>({ text: PRACTICE.hint, win: false });
  const [ringLabel, setRingLabel] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGPathElement>(null);

  const clearRing = useCallback(() => {
    drawRing(ring.current, '');
    setRingLabel('');
  }, []);

  const toggle = useCallback(
    (i: number) => {
      setOn((cells) => cells.map((v, n) => (n === i ? !v : v)));
      clearRing();
      setSay({ text: '', win: false });
    },
    [clearRing],
  );

  const check = useCallback(() => {
    const selection = on.flatMap((v, i) => (v ? [i] : []));
    if (selection.length === HALF) {
      clearRing();
      setSay({ text: PRACTICE.win, win: true });
      burst(box.current, SPARK_COLOURS);
      return;
    }
    if (!selection.length) {
      setSay({ text: PRACTICE.empty, win: false });
      return;
    }
    drawRing(ring.current, ringPath(selection));
    setRingLabel(`${PRACTICE.counts[selection.length] ?? ''}, ${PRACTICE.notHalf}`);
    setSay({ text: PRACTICE.close, win: false });
  }, [on, clearRing]);

  const reset = useCallback(() => {
    setOn([false, false, false, false]);
    clearRing();
    setSay({ text: PRACTICE.hint, win: false });
  }, [clearRing]);

  return (
    <section id="practice">
      <div className="wrap">
        <div className="row">
          <div className="art bare">
            <div className="try" id="tryBox" ref={box}>
              <div className="q">
                {PRACTICE.question.lead}
                <i>{PRACTICE.question.fraction}</i>
                {PRACTICE.question.trail}
              </div>
              {/* A fieldset, because four toggles that answer one question ARE a group of
                  controls with a name, and that is the element a screen reader trusts. The
                  stylesheet resets it to nothing, so the layout is the prototype's. */}
              <fieldset
                className="grid4"
                id="grid"
                aria-label={`${PRACTICE.question.lead}${PRACTICE.question.fraction}${PRACTICE.question.trail}`}
              >
                {PRACTICE.cells.map((cell, i) => (
                  <button
                    key={cell}
                    type="button"
                    className={on[i] ? 'on' : undefined}
                    aria-label={cell}
                    aria-pressed={on[i]}
                    onClick={() => toggle(i)}
                  />
                ))}
                <svg viewBox="-44 -44 304 304" aria-hidden="true">
                  <path
                    id="ring"
                    className="ink pig draw"
                    d=""
                    ref={ring}
                    style={{ '--len': 700 } as React.CSSProperties}
                  />
                </svg>
              </fieldset>
              {/* THE ONE PLACE THIS PORT MOVES SOMETHING. The prototype draws this label inside the
                  ring's SVG at y=258 — below the grid, where the button row paints straight over
                  it, at every width and in both themes. The words are the point of the moment
                  ("that's a quarter, not half"), so they are rendered here instead: same words,
                  same hand, same pigment, in the flow, where they can be read and announced. */}
              <p className="ringsay" id="ringtxt" aria-live="polite">
                {ringLabel}
              </p>
              <div className="row2">
                <button type="button" className="btn" id="check" onClick={check}>
                  <span>{PRACTICE.check}</span>
                </button>
                <button type="button" className="btn quiet" id="reset" onClick={reset}>
                  <span>{PRACTICE.reset}</span>
                </button>
              </div>
              <div className={say.win ? 'say win' : 'say'} id="say" aria-live="polite">
                {say.text}
              </div>
            </div>
          </div>
          <div>
            <div className="eyebrow reveal">{PRACTICE.eyebrow}</div>
            <h2 className="t reveal">
              {PRACTICE.title.lead}
              <span className="hl">{PRACTICE.title.mark}</span>
            </h2>
            <p className="lede reveal">{PRACTICE.lede}</p>
            <div className="claims reveal">
              {PRACTICE.claims.map((claim) => (
                <div key={claim.title}>
                  <i>✓</i>
                  <div>
                    <b>{claim.title}</b>
                    <span>{claim.body}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
