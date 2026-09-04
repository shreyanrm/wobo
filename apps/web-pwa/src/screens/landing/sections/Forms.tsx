'use client';

/**
 * The pinned sequence: the same question, four ways, as you scroll.
 *
 * The panel holds still while the page scrolls past it and each quarter of that distance swaps the
 * card. The swap is `engine/motion.ts`'s and it is guarded — one tween per change of card, never
 * one per scroll frame, which is cause 3 of law v5's jitter.
 *
 * With motion reduced the stylesheet turns the stack into four ordinary cards, so the argument is
 * read rather than scrubbed.
 */

import { FormDrag, FormFilm, FormProof } from '../art';
import { FORMS } from '../page-copy';

export function Forms() {
  const label = (i: number) => FORMS.labels[i] ?? '';
  const marked = FORMS.marks.marked;
  return (
    <section id="forms">
      <div className="wrap">
        <div className="row">
          <div>
            <div className="eyebrow reveal">{FORMS.eyebrow}</div>
            <h2 className="t reveal">
              {FORMS.title.lead}
              <span className="hl">{FORMS.title.mark}</span>
            </h2>
            <p className="lede reveal">{FORMS.lede}</p>
            <div className="formsnav reveal" id="formsNav">
              {FORMS.nav.map((entry, i) => (
                <span key={entry} className={i === 0 ? 'on' : undefined}>
                  {entry}
                </span>
              ))}
            </div>
          </div>
          <div className="art bare">
            <div className="forms" id="formsBox">
              <div className="card" data-i="0">
                <FormProof label={label(0)} marks={FORMS.marks} />
                <div className="label">
                  <i />
                  {label(0)}
                </div>
              </div>
              <div className="card" data-i="1">
                <FormFilm label={label(1)} />
                <div className="label">
                  <i />
                  {label(1)}
                </div>
              </div>
              <div className="card" data-i="2">
                <FormDrag label={label(2)} marks={FORMS.marks} />
                <div className="label">
                  <i />
                  {label(2)}
                </div>
              </div>
              {/* The fourth card is MARKUP, not a drawing. The prototype used to place these
                  annotations as SVG at guessed coordinates, and they drifted off their words at
                  other widths and in the other theme — trap 5 in DESIGN.md §0. Now the highlighter
                  is a `<mark>` and the loop is a `::after` on the clause it circles, so each mark
                  rides its own words and cannot drift. `box-decoration-break: clone` in the
                  stylesheet keeps the highlight correct when the phrase wraps. */}
              <div className="card" data-i="3">
                <div className="marked">
                  <p>
                    {marked.lead}
                    <mark className="hl">{marked.highlighted}</mark>
                    <span className="tag">{marked.tag}</span>
                    {marked.mid}
                    <span className="circled">{marked.circled}</span>
                    {marked.trail}
                  </p>
                  <div className="note">{marked.note}</div>
                  <div className="fix">{marked.fix}</div>
                </div>
                <div className="label">
                  <i />
                  {label(3)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
