'use client';

/**
 * THE INVITATION, as a panel. What stands where the door was.
 *
 * `docs/DOORS-CLOSED.md` §3. One email address, optionally a class and board, and a plain sentence
 * saying Wobo is not open yet and that they will hear the day it is. The words are all in
 * `invitation.ts`; what is decided here is the SHAPE, and four of those decisions matter:
 *
 *  · **It is a real form.** A `<form method="post">` with a real `<input type="email" required>`
 *    and a real submit button, all of it present in the markup before a line of JavaScript runs.
 *    438 pre-rendered files carry this panel, an answer engine reads them off disk with nothing
 *    executing, and a panel assembled by an effect would be an empty box to every one of them. The
 *    `action` is the gateway's own route, so the form is honest even about where it posts.
 *  · **Two fields, and the second is optional in the words as well as in the markup.** `required`
 *    is invisible; "Optional" is not, and a reader deciding whether to give us their class should
 *    not have to test the form to find out (`docs/SELL.md` §8: a field that is not strictly needed
 *    costs conversions, so the one that is not needed says so).
 *  · **Nothing is claimed that we will not do.** One mail, the day it opens. No queue position, no
 *    number of people ahead, no countdown, no date we do not know (§3, and `docs/SELL.md` §9).
 *  · **A failure is said out loud.** An address that did not reach the list must never look like
 *    one that did, so the panel says thank you only when a row was actually kept.
 *  · **With nothing running, the form is not drawn.** It posts JSON, from JavaScript, to another
 *    hostname. A NATIVE submit of the same form would be form-encoded and cross-origin, so a
 *    reader with JavaScript off who pressed it was thrown onto a raw error page on a host that is
 *    not ours, with no header, no footer and no way back. The `noscript` block below hides the
 *    form in exactly that case and puts one address in its place, which is a path that works.
 *
 * The under-13 rule is a sentence rather than a field. Asking a date of birth to decide whose
 * address to take would mean collecting an age from a child in order to avoid collecting anything
 * from a child. The line under the field asks them to hand it to a parent instead, and no age is
 * asked, stored or inferred (`docs/legal/childrens-privacy.md` §2).
 */

import { type FormEvent, useId, useState } from 'react';
import {
  joinList,
  LIST,
  LIST_PATH,
  type ListSource,
  looksLikeEmail,
  NO_SCRIPT_HTML,
  SOURCE_PATH,
} from './invitation';
import { ensureSiteStyles } from './styles';

// The chunk arriving IS the panel being opened, so the sheet goes in at import time.
ensureSiteStyles();

/** What the panel is doing. `said` carries the one line the reader is shown at the end. */
type Stage = 'form' | 'sending' | 'done' | 'trouble';

export function JoinList({
  source,
  gatewayUrl,
  fetchImpl,
}: {
  /** Which page the reader was on. Recorded, never asked. */
  source: ListSource;
  /** The brain's address. Defaults to the build's own, so no host has to pass one. */
  gatewayUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [where, setWhere] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [said, setSaid] = useState('');
  const base = gatewayUrl ?? import.meta.env?.VITE_GATEWAY_URL ?? '';

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (stage === 'sending' || !looksLikeEmail(email)) {
      if (!looksLikeEmail(email)) {
        setStage('trouble');
        setSaid(LIST.trouble);
      }
      return;
    }
    setStage('sending');
    setSaid('');
    void joinList(base, { email, where, source }, fetchImpl ?? fetch).then((outcome) => {
      setStage(outcome.joined ? 'done' : 'trouble');
      setSaid(outcome.message);
    });
  };

  return (
    <section className="jl">
      <div className="st-wrap jl-wrap">
        <h1 className="jl-title">{LIST.title}</h1>
        <p className="jl-what">{LIST.what}</p>
        <p className="jl-promise">{LIST.promise}</p>

        {stage === 'done' ? (
          <p className="jl-said jl-done" role="status">
            {said}
          </p>
        ) : (
          <form
            className="jl-form"
            method="post"
            action={base ? `${base.replace(/\/$/, '')}${LIST_PATH}` : LIST_PATH}
            onSubmit={send}
          >
            {/* The page they came from, as the list stores it: a PATH, never a name. */}
            <input type="hidden" name="page" value={SOURCE_PATH[source]} />

            <label className="jl-lab" htmlFor={`${id}-email`}>
              {LIST.emailLabel}
            </label>
            <input
              id={`${id}-email`}
              className="jl-field"
              type="email"
              name="email"
              required
              autoComplete="email"
              inputMode="email"
              aria-describedby={`${id}-email-hint`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="jl-hint" id={`${id}-email-hint`}>
              {LIST.emailHint}
            </p>

            <label className="jl-lab" htmlFor={`${id}-where`}>
              {LIST.whereLabel}
            </label>
            <input
              id={`${id}-where`}
              className="jl-field"
              type="text"
              name="where"
              autoComplete="off"
              aria-describedby={`${id}-where-hint`}
              value={where}
              onChange={(e) => setWhere(e.target.value)}
            />
            <p className="jl-hint" id={`${id}-where-hint`}>
              {LIST.whereHint}
            </p>

            <button
              type="submit"
              className="st-btn st-pig jl-go"
              disabled={stage === 'sending'}
              aria-busy={stage === 'sending'}
            >
              {stage === 'sending' ? LIST.sending : LIST.send}
            </button>
            {said ? (
              <p className="jl-said" role="status">
                {said}
              </p>
            ) : null}
          </form>
        )}

        {/*
          A READER WITH NOTHING RUNNING IS HANDED A PATH, NOT A TRAP. The submit above posts JSON
          from JavaScript; a native submit of the same form would be form-encoded, cross-origin,
          and answered with a raw error page on another hostname that has no way back to us. So
          where there is no JavaScript the form is not drawn and this is the door instead: one
          address, and a person on the other end of it. The style rides inside the `noscript`, so
          it applies in exactly the case it is written for and in no other.
        */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant of our own, and the
            only way a `noscript` block reaches a pre-rendered file (see NO_SCRIPT_HTML). */}
        <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT_HTML }} />

        {/*
          The other door. It has never closed and it never changes weight: closing the door to new
          accounts is not locking anybody out (docs/DOORS-CLOSED.md §2). A plain anchor, so it
          works with nothing running.
        */}
        <p className="jl-quiet">
          <a href="/sign-in">{LIST.signIn}</a>
        </p>
      </div>
    </section>
  );
}
