'use client';

/**
 * THE two doors: `/sign-in` and `/sign-up`, drawn from design/prototypes/app-auth.html.
 *
 * The page is a CONVERSATION WITH A CHARACTER, so it is laid out as one: Wobo and what Wobo is
 * saying on the left, the thing you do on the right, stacking below 900px. That is the whole reason
 * the screen this replaces read as a template — everything was stacked dead centre in one narrow
 * column, and the parts of the page that talk and the parts that act were indistinguishable.
 *
 * Four things carry the design, and each of them is a decision rather than a decoration:
 *
 *  · THE FIELD IS A RULED LINE, not a box. The rule under it is neutral at rest and takes the
 *    pigment when the field is focused, drawn across from the left. Its leading glyph BECOMES a
 *    phone the moment what is typed reads like a number, and the input's `inputmode` changes with
 *    it so the right keyboard opens. `field.ts` decides that; it is the point of the design.
 *  · ONE saturated thing on the page: the primary action. Everything else is a white surface on a
 *    soft shadow, so the page has a clear first move instead of four buttons of equal weight.
 *  · A WAY IN THAT IS NOT OPEN keeps its shape and carries a `soon` chip. Never a dead grey slab
 *    with an apology sentence under it, and never a rule with nothing on the far side of it —
 *    `doors.ts` holds both of those rules and is tested on them.
 *  · WOBO LOOKS AT THE FIELD when it is focused, through the rig's own `focus` channel. Wobo is
 *    watching what you are doing, which is what a tutor does.
 *
 * AN ERROR CARRIES THE CONTROL IT IS ABOUT, not just a sentence. One `error` string used to paint
 * every field on the page, so pressing the button with a valid phone number and an unticked consent
 * box set `aria-invalid` on the phone field and pointed its `aria-describedby` at a line about the
 * terms — telling a screen-reader user their correct answer was wrong and explaining something
 * else. `problem.ts` holds the sentence and the place; `'form'` is the honest place for a failure
 * that belongs to no field, and nothing is marked invalid for one of those.
 *
 * Honesty is still the load-bearing choice. Every control on this page is wired to a seam the ONE
 * auth client (`client.ts`, read by feature detection) actually exposes; a way in that is not wired
 * is drawn as a shape that says so, and where nothing at all is wired no control is drawn. The day
 * the SDK grows a seam, the door opens by itself with no edit here.
 */

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { useSdk } from '../../store/sdk';
import { WoboHead, Wordmark } from '../../ui/primitives';
import { SiteLink } from '../site/nav';
import { failureFromAuthReturn, reportFailure } from '../states/select';
import { ageOn, blockedBy, consentBranch, type SignUpFields } from './age';
import { callSeam, liveSeams, type MethodName, methodStates } from './client';
import {
  ACTIONS,
  CHILD_DOOR,
  CONSENT,
  DOOR_LEGAL,
  ERRORS,
  FIELDS,
  METHODS,
  NO_WAY_IN,
  NOT_WIRED,
  PARENT,
  SENT,
  SIGN_IN,
  SIGN_UP,
  SOON,
} from './copy';
import { type ProviderName, waysIn } from './doors';
import { fieldProblem, fieldShape, type Glyph } from './field';
import { controlOf, marks, type Problem, type Where, whereBlocked, whereField } from './problem';
import { landingAfterDoor } from './run';
import { Steps } from './Steps';
import { rememberSignInSource } from './source';
import { ensureAuthStyles } from './styles';

// The chunk arriving IS the door being opened, so the sheet goes in at import time. An effect would
// let the first paint land unstyled for a frame.
ensureAuthStyles();

type Mode = 'sign-in' | 'sign-up';
/** What the screen is showing: the form, or what happened after it was sent. */
type Stage = 'form' | 'link-sent' | 'code' | 'parent-sent';

/**
 * THE DOOR AS STEP ONE OF THE RUN. Onboarding renders this same component for its first step; it
 * used to carry a copy of the sign-in instead, and the copy went stale while this one was rebuilt.
 * The two things the run needs to own are where a provider round-trip lands and what happens the
 * moment somebody is signed in. Everything else about the door is the door.
 */
export interface DoorRun {
  /** Where a provider sends the browser back to. The run's own address, so it resumes itself. */
  redirectTo: string;
  /** A code or a password just signed somebody in, without leaving the page. */
  onSignedIn: () => void;
}

/**
 * The glyph at the head of the ruled line. Two shapes, one element: the envelope becomes a phone as
 * soon as what is being typed reads like a number.
 */
function FieldGlyph({ glyph }: { glyph: Glyph | 'calendar' | 'lock' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {glyph === 'phone' ? (
        <>
          <rect x="6" y="2.5" width="12" height="19" rx="3" />
          <path d="M10.6 18.4h2.8" />
        </>
      ) : glyph === 'calendar' ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10.5h18M8 3v4M16 3v4" />
        </>
      ) : glyph === 'lock' ? (
        <>
          <rect x="4" y="10" width="16" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      ) : (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M3 7l9 6 9-6" />
        </>
      )}
    </svg>
  );
}

/** The account a learner already has, drawn rather than fetched — no third-party logo request. */
function ProviderMark({ name }: { name: ProviderName }) {
  if (name === 'google') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="#4285F4"
          d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.5 7.6 24 12 24z"
        />
        <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z" />
        <path
          fill="#EA4335"
          d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.5 1.8 6.1l3.8 3C6.5 6.7 9 4.8 12 4.8z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.7 3-.7 1.4 0 1.8.7 3 .7 1.3 0 2.1-1.1 2.8-2.2.9-1.2 1.3-2.5 1.3-2.5s-2.5-1-2.5-3.6zM14.2 5.3c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z" />
    </svg>
  );
}

/**
 * One way in that uses an account the learner already has.
 *
 * A door that is not open yet KEEPS ITS SHAPE and carries a small `soon` chip. It is not hidden —
 * a door somebody was told about and cannot find is worse than one that says it is coming — and it
 * is not a dead grey slab with an apology printed underneath it either. The whole sentence is the
 * button's accessible description, so a screen reader gets the truth without the page carrying a
 * paragraph of excuses. The `soon` chip is text, so nothing here is said by colour alone.
 */
function ProviderButton({
  name,
  open,
  busy,
  onSelect,
}: {
  name: ProviderName;
  open: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const shutId = `au-${name}-shut`;
  return (
    <>
      <button
        type="button"
        className="au-btn au-prov"
        {...(open
          ? { disabled: busy, onClick: onSelect }
          : { 'aria-disabled': true as const, 'aria-describedby': shutId })}
      >
        <ProviderMark name={name} />
        {METHODS[name]}
        {open ? null : <span className="au-soon">{SOON}</span>}
      </button>
      {open ? null : (
        <span id={shutId} hidden>
          {NOT_WIRED}
        </span>
      )}
    </>
  );
}

export function Auth({ mode, run }: { mode: Mode; run?: DoorRun }) {
  const router = useRouter();
  const sdk = useSdk();
  const words = mode === 'sign-in' ? SIGN_IN : SIGN_UP;
  const other: Mode = mode === 'sign-in' ? 'sign-up' : 'sign-in';

  // The ONE auth client the app already built, read as a bag of seams. No second client is made
  // here and none may ever be — two places minting sessions is two places to get refresh wrong.
  const seams = useMemo(
    () =>
      liveSeams({
        account: sdk.account as unknown as Record<string, unknown> | null,
        identityAuth: sdk.identity.auth as unknown as Record<string, unknown> | null,
        devAuth: sdk.config.devAuth,
      }),
    [sdk],
  );
  const states = useMemo(() => methodStates(seams), [seams]);
  const ways = useMemo(() => waysIn(states), [states]);
  const seamOf = (name: MethodName): string | null =>
    states.find((state) => state.name === name)?.seam ?? null;

  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  // A SENTENCE AND THE CONTROL IT IS ABOUT, never a sentence on its own. One `error` string used to
  // paint every field on the page, so a missing consent tick marked a valid phone number invalid
  // and pointed its `aria-describedby` at a line about the terms. `problem.ts` holds the mapping.
  const [problem, setProblem] = useState<Problem | null>(null);
  const [who, setWho] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [fields, setFields] = useState<SignUpFields>({ birth: '', parentEmail: '', agreed: false });

  const whoField = useRef<HTMLDivElement>(null);

  // The tab's name while a door is open, put back on the way out. (The site shell does this for
  // every other public page; these two wear their own chrome and so carry their own.)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = `${words.tab} · Wobo`;
    return () => {
      document.title = previous;
    };
  }, [words.tab]);

  // A fresh document starts at its top: arriving from halfway down another page must not leave the
  // reader halfway down this one.
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  // A sign-in link that came back dead. The address is read once and then scrubbed, so the state
  // cannot fire again on a reload and the dead token never sits in the learner's history.
  const readReturn = useRef(false);
  useEffect(() => {
    if (readReturn.current || typeof window === 'undefined') return;
    readReturn.current = true;
    const failure = failureFromAuthReturn(window.location.search, window.location.hash);
    if (!failure) return;
    reportFailure(failure);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const age = fields.birth ? ageOn(fields.birth) : null;
  const branch = age === null ? null : consentBranch(age);
  // Under 13 the account is a parent's, so none of the learner's own doors are theirs to open: the
  // only way on is the message to the parent's own address, which takes the whole column.
  const childHolds = mode === 'sign-up' && branch?.parentRequired === true;

  const shape = fieldShape(ways.identifier, who);
  const errorId = 'au-error';
  const hintId = 'au-who-hint';
  const error = problem?.message ?? null;
  /**
   * Say the sentence and put the caret in the control it is about, so the next keystroke is the
   * fix. Never a silent return: pressing the button with nothing typed used to do nothing at all.
   */
  const fail = (message: string, where: Where) => {
    setProblem({ message, where });
    const id = controlOf(where);
    if (id && typeof document !== 'undefined') document.getElementById(id)?.focus();
  };
  /**
   * Signed in. Under live auth the page is left, so the SDK is rebuilt on the session that just
   * landed and nothing this learner does is keyed to nobody (`run.ts` landingAfterDoor says why);
   * under the dev mock the run takes over, or the app does, without leaving the page.
   */
  const arrived = () => {
    const landing = landingAfterDoor({
      devAuth: sdk.config.devAuth,
      mode,
      run: run ?? null,
      origin: typeof window === 'undefined' ? '' : window.location.origin,
    });
    if ('leave' in landing) {
      window.location.assign(landing.leave);
      return;
    }
    if (landing.stay === 'run') run?.onSignedIn();
    else router.replace({ name: landing.stay });
  };
  /** `data-invalid` on the control this problem is about, and on no other. */
  const wrong = (where: Where) =>
    marks(problem, where) ? { 'data-invalid': 'true' as const } : {};
  const invalid = (where: Where) =>
    marks(problem, where) ? { 'aria-invalid': true as const } : {};
  /** A control's own descriptions, with the error sentence added only where the error is its. */
  const describedBy = (where: Where, ...ids: string[]): string =>
    (marks(problem, where) ? [...ids, errorId] : ids).join(' ');
  const hint =
    ways.identifier === 'both'
      ? FIELDS.whoHintEither
      : ways.identifier === 'phone'
        ? FIELDS.whoHintCode
        : FIELDS.whoHintLink;
  const fieldLabel =
    ways.identifier === 'both'
      ? FIELDS.who
      : ways.identifier === 'phone'
        ? FIELDS.phone
        : FIELDS.email;
  const placeholder =
    ways.identifier === 'both'
      ? FIELDS.placeholderWho
      : ways.identifier === 'phone'
        ? FIELDS.placeholderPhone
        : FIELDS.placeholderEmail;
  /** The email half needs a password only where the client's email seam IS the password one. */
  const wantsPassword = shape.sends === 'link' && ways.emailSeam === 'password';

  const attempt = async (job: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      await job();
      then?.();
    } catch (err) {
      // Never a provider's sentence and never a status code — one of Wobo's lines, or the honest
      // catch-all when we genuinely cannot tell what happened. It belongs to the FORM and to no
      // field: nothing the learner typed was wrong, so nothing they typed is marked wrong.
      fail(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? ERRORS.offline
          : ERRORS.unknown,
        'form',
      );
      console.error('sign-in failed', err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * What is still in the way of creating an account, said out loud. Returns true when the learner
   * cannot go on yet — the SAME gate for every door, so signing in with a provider can never walk
   * past the age question or the consent tick the field asks for.
   */
  const gated = (): boolean => {
    if (mode !== 'sign-up') return false;
    const blocked = blockedBy(fields);
    if (!blocked) return false;
    fail(
      blocked === 'birth'
        ? ERRORS.birth
        : blocked === 'birth-invalid'
          ? ERRORS.birthInvalid
          : blocked === 'parent-email'
            ? ERRORS.parentEmail
            : ERRORS.agree,
      whereBlocked(blocked),
    );
    return true;
  };

  const openProvider = (name: ProviderName) => {
    const seam = seamOf(name);
    if (!seam || gated()) return;
    const redirectTo =
      run?.redirectTo ?? (typeof window === 'undefined' ? undefined : `${window.location.origin}/`);
    rememberSignInSource(name);
    void attempt(() => callSeam(seams, seam, redirectTo));
  };

  const verifyCode = () => {
    const verify = typeof seams.verifyPhoneOtp === 'function' ? 'verifyPhoneOtp' : null;
    if (!verify) {
      fail(ERRORS.unknown, 'form');
      return;
    }
    void attempt(
      () => callSeam(seams, verify, who.trim(), code.trim()),
      () => {
        rememberSignInSource('phone');
        arrived();
      },
    );
  };

  /** Send whatever the one field is holding, down whichever seam it belongs to. */
  const sendIdentifier = () => {
    const wrongField = fieldProblem(ways.identifier, who);
    if (wrongField) {
      fail(ERRORS[wrongField], whereField(wrongField));
      return;
    }
    const value = who.trim();
    if (shape.sends === 'code') {
      const seam = seamOf('phone');
      if (!seam) {
        fail(ERRORS.unknown, 'form');
        return;
      }
      void attempt(
        () => callSeam(seams, seam, value),
        () => {
          setCode('');
          setStage('code');
        },
      );
      return;
    }
    if (wantsPassword) {
      const seam = seamOf('password');
      if (!seam) {
        fail(ERRORS.unknown, 'form');
        return;
      }
      if (password.length < 8) {
        fail(ERRORS.password, 'password');
        return;
      }
      void attempt(
        () => callSeam(seams, seam, value, password),
        () => {
          rememberSignInSource('password');
          arrived();
        },
      );
      return;
    }
    const seam = seamOf('magicLink');
    if (!seam) {
      fail(ERRORS.unknown, 'form');
      return;
    }
    void attempt(
      () => callSeam(seams, seam, value),
      () => setStage('link-sent'),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // In the order the controls stand on the page: the ruled line first, then the gate. Checked the
    // other way round, an empty page asked for a date of birth while the empty field above it sat
    // unmentioned, and a learner fixing one thing at a time was walked down the page backwards.
    if (!childHolds && ways.identifier !== 'none') {
      const wrongField = fieldProblem(ways.identifier, who);
      if (wrongField) {
        fail(ERRORS[wrongField], whereField(wrongField));
        return;
      }
    }
    if (gated()) return;
    // Under 13 the account is the parent's, so the next step is a message to the parent's own
    // address — a tick on a child's screen is never parental consent (parental-consent.md §2).
    if (childHolds) {
      const seam = seamOf('magicLink');
      if (!seam) {
        fail(ERRORS.unknown, 'form');
        return;
      }
      void attempt(
        () => callSeam(seams, seam, fields.parentEmail.trim()),
        () => setStage('parent-sent'),
      );
      return;
    }
    sendIdentifier();
  };

  const primaryLabel = childHolds
    ? ACTIONS.askParent
    : shape.sends === 'code'
      ? ACTIONS.sendCode
      : wantsPassword
        ? mode === 'sign-up'
          ? ACTIONS.signUp
          : ACTIONS.signIn
        : ACTIONS.sendLink;

  /** The headline and the line under it, which are the same conversation at every stage. */
  const said =
    stage === 'link-sent'
      ? { title: SENT.title, lede: SENT.body }
      : stage === 'code'
        ? { title: SENT.codeTitle, lede: SENT.codeBody }
        : stage === 'parent-sent'
          ? { title: PARENT.sentTitle, lede: PARENT.sent }
          : { title: words.title, lede: words.lede };

  const errorNote = error ? (
    <p className="au-error" id={errorId} role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className="au">
      <a className="au-skip" href="#au-main">
        Skip to the page
      </a>

      {/* the bar: the name, where you are in the run, and the other door */}
      <div className="au-top">
        <div className="au-wrap">
          <SiteLink to={{ name: 'landing' }} className="au-mark" aria-label="Wobo, the front page">
            <Wordmark />
          </SiteLink>
          {mode === 'sign-up' ? <Steps current={1} /> : null}
          <SiteLink
            to={{ name: other }}
            className={mode === 'sign-up' ? 'au-other' : 'au-other au-doorbtn'}
          >
            {mode === 'sign-up' ? (
              <>
                <span className="au-lead">{words.switchPrompt}</span>
                <b>{words.switchAction}</b>
              </>
            ) : (
              words.switchAction
            )}
          </SiteLink>
        </div>
      </div>

      <main className="au-body" id="au-main" aria-label={words.tab}>
        <div className="au-wrap">
          <div className="au-grid">
            {/* what Wobo says */}
            <div className="au-say">
              <div className="au-who">
                <WoboHead
                  className="au-face"
                  size={84}
                  shadow
                  mood={looking ? 'listening' : 'greeting'}
                  focus={looking ? whoField.current : null}
                />
                <span className="au-bubble">{words.hand}</span>
              </div>
              <h1>{said.title}</h1>
              <p className="au-lede">{said.lede}</p>
            </div>

            {/* what you do */}
            <div className="au-act">
              {stage === 'form' ? (
                <>
                  {/* Nothing to fill in where nothing can be sent: a date of birth and a consent
                      tick with no button under them is a form that has given up. */}
                  {ways.anyOpen ? (
                    <form onSubmit={submit} noValidate>
                      {ways.identifier !== 'none' && !childHolds ? (
                        <>
                          <label className="au-lab" htmlFor="au-who">
                            {fieldLabel}
                          </label>
                          <div className="au-field" ref={whoField} {...wrong('who')}>
                            <FieldGlyph glyph={shape.glyph} />
                            <input
                              id="au-who"
                              type="text"
                              value={who}
                              inputMode={shape.inputMode}
                              autoComplete={shape.autoComplete}
                              placeholder={placeholder}
                              aria-describedby={describedBy('who', hintId)}
                              {...invalid('who')}
                              onFocus={() => setLooking(true)}
                              onBlur={() => setLooking(false)}
                              onChange={(e) => setWho(e.target.value)}
                            />
                          </div>
                          <p className="au-fine" id={hintId}>
                            {hint}
                          </p>
                          {wantsPassword ? (
                            <>
                              <label className="au-lab" htmlFor="au-password">
                                {FIELDS.password}
                              </label>
                              <div className="au-field" {...wrong('password')}>
                                <FieldGlyph glyph="lock" />
                                <input
                                  id="au-password"
                                  type="password"
                                  value={password}
                                  {...invalid('password')}
                                  {...(marks(problem, 'password')
                                    ? { 'aria-describedby': errorId }
                                    : {})}
                                  autoComplete={
                                    mode === 'sign-up' ? 'new-password' : 'current-password'
                                  }
                                  onChange={(e) => setPassword(e.target.value)}
                                />
                              </div>
                            </>
                          ) : null}
                        </>
                      ) : null}

                      {mode === 'sign-up' ? (
                        <>
                          <label className="au-lab" htmlFor="au-birth">
                            {FIELDS.birth}
                          </label>
                          <div className="au-field" {...wrong('birth')}>
                            <FieldGlyph glyph="calendar" />
                            <input
                              id="au-birth"
                              type="date"
                              autoComplete="bday"
                              value={fields.birth}
                              {...invalid('birth')}
                              aria-describedby={describedBy('birth', 'au-birth-why')}
                              onChange={(e) => setFields((f) => ({ ...f, birth: e.target.value }))}
                            />
                          </div>
                          <p className="au-fine" id="au-birth-why">
                            {FIELDS.birthWhy}
                          </p>

                          {branch && branch.band !== 'adult' ? (
                            <div className="au-parent">
                              <h2>{PARENT.title}</h2>
                              <p>{branch.notice}</p>
                              <p>{PARENT.body}</p>
                              <p>{PARENT.learning}</p>
                              {childHolds ? <p>{CHILD_DOOR}</p> : null}
                              <label className="au-lab" htmlFor="au-parent-email">
                                {FIELDS.parentEmail}
                              </label>
                              <div className="au-field" {...wrong('parent-email')}>
                                <FieldGlyph glyph="envelope" />
                                <input
                                  id="au-parent-email"
                                  type="email"
                                  inputMode="email"
                                  autoComplete="email"
                                  value={fields.parentEmail}
                                  {...invalid('parent-email')}
                                  {...(marks(problem, 'parent-email')
                                    ? { 'aria-describedby': errorId }
                                    : {})}
                                  onChange={(e) =>
                                    setFields((f) => ({ ...f, parentEmail: e.target.value }))
                                  }
                                />
                              </div>
                            </div>
                          ) : null}

                          <label className="au-consent" htmlFor="au-agree" {...wrong('consent')}>
                            <input
                              id="au-agree"
                              type="checkbox"
                              checked={fields.agreed}
                              {...invalid('consent')}
                              {...(marks(problem, 'consent')
                                ? { 'aria-describedby': errorId }
                                : {})}
                              onChange={(e) =>
                                setFields((f) => ({ ...f, agreed: e.target.checked }))
                              }
                            />
                            <span>
                              {`${CONSENT.lead} `}
                              <a href={CONSENT.termsHref}>{CONSENT.terms}</a>
                              {` ${CONSENT.and} `}
                              <a href={CONSENT.privacyHref}>{CONSENT.privacy}</a>.
                            </span>
                          </label>
                        </>
                      ) : null}

                      {errorNote}

                      {/* the one saturated thing on the page */}
                      {childHolds && !seamOf('magicLink') ? (
                        <p className="au-fine">{PARENT.cannotSend}</p>
                      ) : ways.identifier !== 'none' || childHolds ? (
                        <button
                          type="submit"
                          className="au-btn au-go"
                          disabled={busy}
                          aria-busy={busy}
                        >
                          {primaryLabel}
                        </button>
                      ) : null}
                    </form>
                  ) : null}

                  {/* the rule, drawn only when there is something on both sides of it */}
                  {ways.divider && !childHolds ? (
                    <div className="au-or">
                      <span>{ACTIONS.or}</span>
                    </div>
                  ) : null}

                  {childHolds || !ways.anyOpen
                    ? null
                    : ways.providers.map((door) => (
                        <ProviderButton
                          key={door.name}
                          name={door.name}
                          open={door.status === 'open'}
                          busy={busy}
                          onSelect={() => openProvider(door.name)}
                        />
                      ))}

                  {/* nothing wired at all: say so, rather than draw a control that cannot work */}
                  {ways.anyOpen ? null : <p className="au-fine">{NO_WAY_IN}</p>}
                </>
              ) : null}

              {stage === 'code' ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!code.trim()) {
                      fail(ERRORS.code, 'code');
                      return;
                    }
                    verifyCode();
                  }}
                  noValidate
                >
                  <label className="au-lab" htmlFor="au-code">
                    {FIELDS.code}
                  </label>
                  <div className="au-field" {...wrong('code')}>
                    <FieldGlyph glyph="phone" />
                    <input
                      id="au-code"
                      value={code}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-describedby={describedBy('code', 'au-code-hint')}
                      {...invalid('code')}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                  <p className="au-fine" id="au-code-hint">
                    {FIELDS.codeHint}
                  </p>
                  {errorNote}
                  <button type="submit" className="au-btn au-go" disabled={busy} aria-busy={busy}>
                    {ACTIONS.verify}
                  </button>
                  <button
                    type="button"
                    className="au-btn au-quiet"
                    disabled={busy}
                    onClick={() => {
                      setProblem(null);
                      setStage('form');
                    }}
                  >
                    {ACTIONS.startOver}
                  </button>
                </form>
              ) : null}

              {stage === 'link-sent' ? (
                <>
                  {errorNote}
                  <button
                    type="button"
                    className="au-btn au-quiet"
                    disabled={busy}
                    onClick={() => setStage('form')}
                  >
                    {SENT.again}
                  </button>
                </>
              ) : null}

              {stage === 'parent-sent' ? errorNote : null}
            </div>
          </div>

          {/* Entitled to read what you are agreeing to, from where you stand. See DOOR_LEGAL. */}
          <p className="au-legal">
            {DOOR_LEGAL.lead} <a href={CONSENT.termsHref}>{DOOR_LEGAL.terms}</a> {DOOR_LEGAL.and}{' '}
            <a href={CONSENT.privacyHref}>{DOOR_LEGAL.privacy}</a>.
          </p>
        </div>
      </main>
    </div>
  );
}

export function SignIn() {
  return <Auth mode="sign-in" />;
}

export function SignUp() {
  return <Auth mode="sign-up" />;
}
