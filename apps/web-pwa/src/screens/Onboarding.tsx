'use client';

/**
 * Onboarding — five steps, design/prototypes/onboarding-v2.html as drawn: sign in, who's learning,
 * the first question (the aha), a parent, ready. Wobo's head over a speech bubble, one form, one
 * pig button, the dots at the top and a quiet way past any step that can be skipped.
 *
 * What is underneath is the app's own machinery, unchanged: the additive account layer (a code to
 * an email or a phone, or a sign-in provider), the curriculum registry for boards and classes, the
 * own-syllabus door, the one conversation for the aha, the gateway's parent link, and the same
 * finish the frame theatre had — the account award, the onboarded mark, the live-mode rebuild.
 *
 * Sign-in is bypassed by configuration only: a build with no account layer (no keys → local dev,
 * tests) opens on step two, exactly as the old flow skipped its auth beat. There is no skip for a
 * learner.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { type FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ONBOARDED_KEY, SIGNIN_SOURCE_KEY } from '../App';
import { adoptFramework, adoptOwnSyllabus } from '../curriculum/adopt';
import { useBoardSearch, useRegistryRevision } from '../curriculum/hooks';
import { OwnSyllabus } from '../curriculum/OwnSyllabus';
import { loadedTopics } from '../curriculum/registry';
import { gradeOf, schoolLevels } from '../curriculum/world';
import { useRouter } from '../shell/router';
import { lifetimeSnapshot } from '../store/mind';
import { useProgress } from '../store/progress';
import { useSdk } from '../store/sdk';
import { WoboHead, Wordmark } from '../ui/primitives';
import { sfx } from '../ui/sound';
import { boardTurn } from '../wobo/board-turn';
import { useWoboChat } from '../wobo/chat';
import { speakLine } from '../wobo/speech';
import { callSeam, liveSeams, seamFor } from './auth/client';
import { ERRORS, SENT } from './auth/copy';
import { type Allowance, allowanceLine, allowanceShare, readAllowance } from './plans/allowance';
import { classLine } from './You';
import { boardOf, type ChosenBoard, levelsFor } from './you/GradeBoardPicker';
import { ParentInvite } from './you/ParentInvite';
import { looksLikeEmail } from './you/parentLink';
import { boardName, frameworkLabel, loadProfile, resolveBoardId, saveProfile } from './you/profile';
import './onboarding/onboarding.css';

/** Survives the provider round-trip in this tab: on return, resume signed in. */
const ONB_RETURN_KEY = 'wobo-onb-return';

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: readonly Step[] = [1, 2, 3, 4, 5];

/** The bubble's line on each step, verbatim. */
const BUBBLE: Partial<Record<Step, string>> = {
  1: "Hi. I'm Wobo. Let's make this yours.",
  2: "Tell me once. I'll find your exact chapter every week after.",
  4: 'On Sundays I write three lines home. Want someone to get them?',
};

/** The class ladder onboarding-v2 draws before a board is chosen — shown, never pressable, until one is. */
const LADDER = ['4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

/** The three sample questions, verbatim. */
const SAMPLES = [
  "What's the difference between speed and velocity?",
  'Why is the sky blue?',
  'Explain fractions with a chocolate bar',
] as const;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

/** The typed prefix, marked in the name it matched. */
function Marked({ name, query }: { name: string; query: string }) {
  const q = query.trim();
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <b>{name}</b>;
  return (
    <b>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </b>
  );
}

function Dots({ step }: { step: Step }) {
  return (
    <span className="ob-dots" role="img" aria-label={`step ${step} of 5`}>
      {STEPS.map((s) => (
        <i key={s} className={s === step ? 'ob-on' : s < step ? 'ob-done' : undefined} />
      ))}
    </span>
  );
}

function useDrawing(): boolean {
  return useSyncExternalStore(
    (l) => boardTurn.subscribe(l),
    () => boardTurn.get().active,
    () => false,
  );
}

export function Onboarding() {
  const router = useRouter();
  const sdk = useSdk();
  const bus = useWoboBus();
  const chat = useWoboChat();
  const { award } = useProgress();
  const drawing = useDrawing();
  const revision = useRegistryRevision();

  const account = sdk.account;
  const canAuth = !!account;
  const [authed, setAuthed] = useState(() => !!account?.isAuthenticated());
  const [step, setStep] = useState<Step>(() => {
    // DEV ONLY: `?step=3` opens a later step for the design gate's screenshots. Production builds
    // ignore it — a learner always starts where the flow starts.
    if (import.meta.env.DEV && typeof location !== 'undefined') {
      const asked = Number(new URLSearchParams(location.search).get('step'));
      if (asked >= 1 && asked <= 5) return asked as Step;
    }
    return canAuth && !account?.isAuthenticated() ? 1 : 2;
  });

  // --- sign in ---------------------------------------------------------------------------------
  const seams = useMemo(
    () =>
      liveSeams({
        account: account as unknown as Record<string, unknown> | undefined,
        identityAuth: sdk.identity.auth as unknown as Record<string, unknown>,
        devAuth: sdk.config.devAuth,
      }),
    [account, sdk],
  );
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'address' | 'code' | 'sent'>('address');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // --- who's learning --------------------------------------------------------------------------
  const [name, setName] = useState(() => loadProfile().name);
  const [grade, setGrade] = useState<string | null>(() => loadProfile().grade || null);
  const [board, setBoard] = useState<ChosenBoard | null>(null);
  const [own, setOwn] = useState(false);
  const search = useBoardSearch();
  const [typed, setTyped] = useState('');
  const results = search.state.result?.results ?? [];
  const levels = useMemo(() => schoolLevels(levelsFor(board)), [board]);

  // --- the aha ---------------------------------------------------------------------------------
  const [question, setQuestion] = useState('');
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const reply = useMemo(() => {
    if (askedAt === null) return null;
    const last = [...chat.turns].reverse().find((t) => t.role === 'wobo');
    return last && chat.turns.indexOf(last) >= askedAt ? last.text : null;
  }, [chat.turns, askedAt]);

  // --- ready -----------------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: the registry revision is the trigger
  const firstTopic = useMemo(() => loadedTopics()[0]?.name ?? null, [revision]);
  // The copy law (DESIGN.md §0) forbids a raw allowance anywhere a learner reads one, so this
  // screen keeps the brain's reading in the SAME shape the rail's card keeps it (screens/plans/
  // allowance.ts) and says it with the same words. One vocabulary, one sentence, no numbers.
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  useEffect(() => {
    if (step !== 5) return;
    let cancelled = false;
    void sdk
      .me()
      .then((me) => {
        if (cancelled || !me) return;
        setAllowance(readAllowance(me));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sdk, step]);
  /** How much of today is still standing — kept only as a shape, for the bar to draw. */
  const share = allowance ? allowanceShare(allowance) : null;

  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const boardLabel = board?.name ?? boardName(loadProfile().boardId);

  const stageRef = useRegisterTarget<HTMLDivElement>('onboarding-stage', {
    kind: 'flow',
    label: 'setting up — the step Wobo is on and what Wobo is waiting for',
    getSceneState: () => ({
      step,
      signedIn: authed,
      name: firstName || undefined,
      grade: grade ?? undefined,
      board: board?.name ?? undefined,
    }),
  });

  useEffect(() => {
    bus.publishPage({
      route: 'onboarding',
      state: {
        step,
        name: firstName || undefined,
        grade: grade ?? undefined,
        board: board?.name,
        signedIn: authed,
      },
    });
  }, [bus, step, firstName, grade, board, authed]);

  // Wobo says the bubble's line on each step — the same voice the old flow had, muted where muted.
  useEffect(() => {
    const line = BUBBLE[step];
    if (line) void speakLine(line);
  }, [step]);

  // A provider return, resolved: an already-onboarded account skips every question and lands home;
  // a new account resumes at step two with the given name prefilled.
  const resumeAfterAuth = async () => {
    setAuthed(true);
    const remote = (await account?.fetchProfile().catch(() => null)) ?? null;
    const restorable = remote?.archetype_slot === 'onboarded' && !!remote.grade && !!remote.board;
    if (restorable) {
      const p = loadProfile();
      const boardId = resolveBoardId(remote?.board) ?? p.boardId;
      const level = (remote?.grade as string | undefined) ?? p.grade;
      saveProfile({
        ...p,
        name: (remote?.display_name ?? p.name).trim() || p.name,
        grade: level,
        boardId,
      });
      // A restore only carries the framework's ID. Adopting it as its own NAME is how a crumb
      // ends up reading "Class 8 · cbse" three screens away, so the label is settled here — at
      // the one place that knows a name is missing — rather than normalised by every screen.
      void adoptFramework({ frameworkId: boardId, name: frameworkLabel(boardId), level });
      localStorage.setItem(ONBOARDED_KEY, '1');
      router.replace({ name: 'home' });
      return;
    }
    const given = account?.profile()?.name?.trim().split(/\s+/)[0];
    if (given && !name.trim()) setName(given);
    setStep(2);
  };

  const booted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once boot, guarded by the ref
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (sessionStorage.getItem(ONB_RETURN_KEY) && account?.isAuthenticated()) {
      sessionStorage.removeItem(ONB_RETURN_KEY);
      void resumeAfterAuth();
    }
  }, [sdk]);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    const raw = address.trim();
    if (!raw || busy) return;
    setNote(null);
    setBusy(true);
    try {
      if (looksLikeEmail(raw)) {
        const seam = seamFor('magicLink', seams);
        if (!seam) {
          setNote(ERRORS.unknown);
          return;
        }
        await callSeam(seams, seam, raw);
        setStage('sent');
      } else {
        const phone = normalizePhone(raw);
        if (phone.replace(/\D/g, '').length < 10) {
          setNote('That number looks short — check it once more');
          return;
        }
        await sdk.identity.auth.requestPhoneOtp(phone);
        setStage('code');
      }
    } catch {
      setNote(ERRORS.unknown);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (candidate: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await sdk.identity.auth.verifyPhoneOtp(normalizePhone(address.trim()), candidate);
      localStorage.setItem(SIGNIN_SOURCE_KEY, 'phone');
      sfx.tap();
      await resumeAfterAuth();
    } catch {
      setNote(ERRORS.code);
    } finally {
      setBusy(false);
    }
  };

  const withProvider = async () => {
    sessionStorage.setItem(ONB_RETURN_KEY, '1');
    localStorage.setItem(SIGNIN_SOURCE_KEY, 'google');
    try {
      await account?.signInWithGoogle(window.location.origin);
    } catch {
      sessionStorage.removeItem(ONB_RETURN_KEY);
      setNote(ERRORS.unknown);
    }
  };

  // --- who's learning → the aha --------------------------------------------------------------------
  const ready2 = name.trim().length > 0 && !!grade && !!board;
  const thatsMe = (e: FormEvent) => {
    e.preventDefault();
    if (!ready2 || !board || !grade) return;
    sfx.tap();
    saveProfile({ ...loadProfile(), name: name.trim(), grade, boardId: board.id });
    void adoptFramework({ frameworkId: board.id, name: board.name, level: grade });
    void account?.syncProfile({ display_name: name.trim(), grade, board: board.id });
    setStep(3);
  };

  const ask = (text: string) => {
    const line = text.trim();
    if (!line || chat.busy) return;
    setQuestion(line);
    setAskedAt(chat.turns.length);
    void chat.ask(line);
  };

  const finish = () => {
    sfx.reveal();
    award('account');
    try {
      sdk.events.record('onboarding.step.completed.v1', {
        step: 'aha',
        step_index: 2,
        total_steps: 5,
      });
    } catch {
      // event stream best-effort
    }
    bus.publishLifetime(lifetimeSnapshot());
    localStorage.setItem(ONBOARDED_KEY, '1');
    // live mode rebuilds on the real session so providers re-key to auth.uid()
    if (!sdk.config.devAuth) {
      window.location.assign('/');
      return;
    }
    router.replace({ name: 'home' });
  };

  const pickBoard = (b: ChosenBoard) => {
    setBoard(b);
    setTyped(b.name);
    search.clear();
    if (grade && !levelsFor(b).includes(grade)) setGrade(null);
  };

  const skipLabel: Partial<Record<Step, string>> = {
    1: 'Already have an account? Sign in',
    3: 'Skip for now',
    4: 'Not now',
  };
  const skip = () => {
    sfx.tap();
    if (step === 1) router.navigate({ name: 'sign-in' });
    else if (step === 3) setStep(4);
    else if (step === 4) setStep(5);
  };

  return (
    <div className="ob-screen" ref={stageRef}>
      {step === 5 && (
        <div className="ob-confetti" aria-hidden="true">
          <i style={{ left: '12%', top: '12%', background: 'var(--marigold)' }} />
          <i
            style={{
              left: '26%',
              top: '7%',
              background: 'var(--pig)',
              transform: 'rotate(-20deg)',
            }}
          />
          <i style={{ left: '78%', top: '9%', background: 'var(--rose)' }} />
          <i
            style={{
              left: '64%',
              top: '15%',
              background: 'var(--mint)',
              transform: 'rotate(40deg)',
            }}
          />
          <i style={{ left: '88%', top: '18%', background: 'var(--lilac)' }} />
          <i
            style={{
              left: '36%',
              top: '17%',
              background: 'var(--violet)',
              transform: 'rotate(-35deg)',
            }}
          />
        </div>
      )}
      <div className="ob-top">
        <span className="ob-wm" style={{ width: 90 }}>
          <Wordmark />
        </span>
        <Dots step={step} />
        {skipLabel[step] ? (
          <button type="button" className="ob-skip" onClick={skip}>
            {skipLabel[step]}
          </button>
        ) : (
          <span className="ob-skip" />
        )}
      </div>

      <div className="ob-body">
        {step === 1 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="listening" />
            <div className="ob-bub">Hi. I'm Wobo. Let's make this yours.</div>
            <h1>Sign in so everything stays with you, on any device.</h1>
            <p className="ob-sub">That's the only reason I'm asking. No newsletter, no card.</p>
            {stage === 'sent' ? (
              <div className="ob-form">
                <p className="ob-sub">
                  <b>{SENT.title}</b>
                  <br />
                  {SENT.body}
                </p>
                <button
                  type="button"
                  className="ob-btn ob-link"
                  onClick={() => setStage('address')}
                >
                  {SENT.again}
                </button>
              </div>
            ) : stage === 'code' ? (
              <form
                className="ob-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verifyCode(code);
                }}
              >
                <div className="ob-field">
                  <label htmlFor="ob-code">The code Wobo sent</label>
                  <input
                    id="ob-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      setCode(digits);
                      if (digits.length === 6) void verifyCode(digits);
                    }}
                    placeholder="6-digit code"
                    // biome-ignore lint/a11y/noAutofocus: the code is this stage's single intention
                    autoFocus
                  />
                </div>
                {note ? <p className="ob-fine">{note}</p> : null}
                <button type="submit" className="ob-btn ob-pig" disabled={busy || code.length < 6}>
                  Check the code
                </button>
              </form>
            ) : (
              <form className="ob-form" onSubmit={(e) => void sendCode(e)}>
                <div className="ob-field">
                  <label htmlFor="ob-address">Email or phone</label>
                  <input
                    id="ob-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="you@example.com or +91 …"
                    autoComplete="username"
                    inputMode="email"
                  />
                </div>
                {note ? <p className="ob-fine">{note}</p> : null}
                <button type="submit" className="ob-btn ob-pig" disabled={busy}>
                  Send me a code
                </button>
                <div className="ob-or">or</div>
                <button
                  type="button"
                  className="ob-btn ob-quiet"
                  onClick={() => void withProvider()}
                >
                  Continue with a sign-in provider
                </button>
                <p className="ob-fine">
                  Under 13, or under 18 in India?{' '}
                  <a
                    href="/sign-up"
                    onClick={(e) => {
                      e.preventDefault();
                      router.navigate({ name: 'sign-up' });
                    }}
                  >
                    A parent signs in first.
                  </a>{' '}
                  I'll explain why in one line when you get there.
                </p>
              </form>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="listening" />
            <div className="ob-bub">
              Tell me once. I'll find your exact chapter every week after.
            </div>
            <h1>Who's learning, and where?</h1>
            <form className="ob-form" onSubmit={thatsMe}>
              <div className="ob-field">
                <label htmlFor="ob-name">First name</label>
                <input
                  id="ob-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should I call you?"
                  autoComplete="given-name"
                />
              </div>
              <fieldset className="ob-field">
                <legend>Class</legend>
                {levels.length > 0 ? (
                  <div className="ob-chips">
                    {levels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={grade === level}
                        onClick={() => setGrade(level)}
                      >
                        <span className={grade === level ? 'ob-on' : undefined}>
                          {gradeOf(level) ?? level}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    {/* the board's own classes replace this ladder the moment a board is chosen;
                        until then it is the prototype's row, drawn but not pressable */}
                    <div className="ob-chips" aria-hidden="true">
                      {LADDER.map((level) => (
                        <button key={level} type="button" disabled tabIndex={-1}>
                          <span>{level}</span>
                        </button>
                      ))}
                    </div>
                    <p className="ob-fine">
                      {board?.unlisted
                        ? `I do not have ${board.name}'s classes yet. Pick your board first and I will bring them.`
                        : 'Pick your board and I will bring its classes.'}
                    </p>
                  </>
                )}
              </fieldset>
              <div className="ob-field ob-ta">
                <label htmlFor="ob-board">Board</label>
                <input
                  id="ob-board"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setBoard(null);
                    search.setQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      search.flush();
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="CBSE, ICSE, your state board…"
                  aria-label="Board"
                  aria-autocomplete="list"
                />
                {!board && typed.trim() && (
                  <div className="ob-list">
                    {results.slice(0, 5).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="ob-opt"
                        onClick={() => pickBoard(boardOf(f))}
                      >
                        {/* The copy law (DESIGN.md §0): no grade range on any surface. The
                            board's own classes appear as chips the moment a board is chosen,
                            which is where the learner actually needs them. */}
                        <Marked name={f.name} query={typed} />
                      </button>
                    ))}
                    {search.state.error ? <div className="ob-own">{search.state.error}</div> : null}
                    <button type="button" className="ob-own" onClick={() => setOwn(true)}>
                      Not listed? <b>Paste your school's syllabus</b> and I'll build the plan from
                      that.
                    </button>
                  </div>
                )}
              </div>
              {own && (
                <div style={{ textAlign: 'left' }}>
                  <OwnSyllabus
                    suggestedName={typed}
                    onCancel={() => setOwn(false)}
                    onReady={(view) => {
                      const world = adoptOwnSyllabus(view);
                      setOwn(false);
                      pickBoard({
                        id: world.frameworkId,
                        name: world.frameworkName,
                        framework: null,
                        unlisted: false,
                      });
                      if (world.level) setGrade(world.level);
                    }}
                  />
                </div>
              )}
              <button type="submit" className="ob-btn ob-pig" disabled={!ready2}>
                That's me
              </button>
            </form>
          </div>
        )}

        {step === 3 && (
          <div className="ob-card">
            <h1>
              Ask me anything from {grade ? classLine(grade) : 'your class'}
              {boardLabel ? `, ${boardLabel}` : ''}. I'll draw it.
            </h1>
            <p className="ob-sub">
              Try one of these, or type your own. This is the whole thing, in thirty seconds.
            </p>
            <div className="ob-aha">
              <div className="ob-bar">
                <b>Wobo{firstName ? ` · with ${firstName}` : ''}</b>
                {chat.busy || drawing ? (
                  <span className="ob-live">
                    <i /> drawing
                  </span>
                ) : null}
              </div>
              <div className="ob-canvas" aria-live="polite">
                {reply ? (
                  <div className="ob-hw">{reply}</div>
                ) : question ? (
                  <div className="ob-hw ob-pig">{question}</div>
                ) : null}
                <WoboHead
                  size={72}
                  mood={chat.busy || drawing ? 'thinking' : 'listening'}
                  style={{ position: 'absolute', right: 14, bottom: 10 }}
                />
              </div>
              <form
                className="ob-ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
              >
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="why does a² + b² = c²?"
                  aria-label="Ask Wobo"
                  autoComplete="off"
                  enterKeyHint="send"
                />
                <button type="submit" className="ob-btn ob-pig" disabled={chat.busy}>
                  Ask
                </button>
              </form>
              <div className="ob-chipsq">
                {SAMPLES.map((q) => (
                  <button key={q} type="button" className="ob-chipq" onClick={() => ask(q)}>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="ob-btn"
              onClick={() => {
                sfx.tap();
                setStep(4);
              }}
            >
              That was it. Keep going
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="listening" />
            <div className="ob-bub">
              On Sundays I write three lines home. Want someone to get them?
            </div>
            <h1>Link a parent, if you'd like.</h1>
            <p className="ob-sub">
              They'll see your lessons, your progress and the Sunday note. Your questions word for
              word stay yours unless you choose to share them.
            </p>
            <div className="ob-parent">
              <div className="ob-note">
                {firstName || 'They'} asked for help twice after a miss this week,{' '}
                <em>which is exactly how learning looks.</em>
                <small>a sample of the Sunday note</small>
              </div>
              <ParentInvite
                learnerName={firstName}
                onDone={() => {
                  award('invite_parent', { onceKey: 'invite_parent' });
                  sfx.tap();
                  setStep(5);
                }}
                onLater={() => {
                  sfx.tap();
                  setStep(5);
                }}
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="celebrate" />
            <h1>
              That's it{firstName ? `, ${firstName}` : ''}.{' '}
              {[
                grade && classLine(grade),
                boardLabel,
                firstTopic && `${firstTopic.toLowerCase()} this week`,
              ]
                .filter(Boolean)
                .join(', ')}
              .
            </h1>
            <p className="ob-sub">
              Enough questions for a normal day, every day, for free. Hold space to talk to me,
              or just type. I'll be here whenever you want me.
            </p>
            <div className="ob-allow">
              <b>Today's allowance</b>
              <div className="ob-bar" aria-hidden="true">
                <i style={share === null ? undefined : { width: `${Math.round(share * 100)}%` }} />
              </div>
              {/* The copy law (DESIGN.md §0): what is left is said in words, never "25 of 40".
                  The bar draws the same fraction the sentence describes, so the two agree. */}
              <span>{allowance ? allowanceLine(allowance) : 'Enough for a normal evening.'}</span>
            </div>
            {/* The prototype's "Start this evening" is the LANDING's call, and the copy law (DESIGN.md
                §0) keeps a promotional call off a surface only a signed-in learner can reach. Here
                the button is the action itself. */}
            <button type="button" className="ob-btn ob-pig" onClick={finish}>
              Begin
            </button>
            <p className="ob-fine">
              You can change the class, the board or the parent link any time in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
