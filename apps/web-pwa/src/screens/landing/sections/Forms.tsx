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

import { FormDrag, FormFilm, FormProof, HeroSpoken } from '../art';
import { FORMS } from '../page-copy';

export function Forms() {
  const label = (i: number) => FORMS.labels[i] ?? '';
  const spoken = FORMS.marks.spoken;
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
              {/* The fourth card is the SPOKEN form, and it is the fourth engine rather than a
                  fourth drawing: `wobo/voice.ts` reads an answer aloud, and the gateway's
                  /v1/voice/tts returns the audio. It used to be a marked-up paragraph labelled
                  "Your own writing, with the pen on it", which named a capability this tree does
                  not have — no input anywhere reads a learner's own writing. The hero's rail has
                  always said Drawn, Filmed, Tried, Spoken; this card now agrees with it. */}
              <div className="card" data-i="3">
                <HeroSpoken label={label(3)} line={spoken.line} />
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
