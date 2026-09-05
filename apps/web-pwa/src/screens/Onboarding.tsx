'use client';

/**
 * Onboarding: five steps, design/prototypes/onboarding-v2.html as drawn. The door, who's learning,
 * the first question (the aha), a parent, ready. Wobo's head over a speech bubble, one form, one
 * pig button, the run across the top and a quiet way past any step that can be skipped.
 *
 * STEP ONE IS THE DOOR, THE SAME COMPONENT. This screen used to carry its own copy of the sign-in:
 * seventy-odd classes, its own field, its own error strings, a button that said "Continue with a
 * sign-in provider". The doors in `auth/Auth.tsx` were rebuilt and the copy was not, so the first
 * thing a new learner ever saw was the one screen the owner had already rejected. There is no copy
 * now. `<Auth mode="sign-up">` renders here with a `run` that tells it where a provider round-trip
 * lands and what to do the moment somebody is signed in, and `onboarding.test.ts` fails the day
 * this file grows an email or phone field of its own again.
 *
 * What is underneath is the app's own machinery, unchanged: the additive account layer, the
 * curriculum registry for boards and classes, the own-syllabus door, the one conversation for the
 * aha, the gateway's parent link, and the same finish the frame theatre had.
 *
 * Three courtesies the run keeps, all decided in `auth/run.ts` and tested there: a reload lands
 * where the learner was (never past what they have answered, never past the door); back works on
 * every step after the second, from a button and from the stepper's own finished pips; and the
 * door is bypassed by configuration only. A build with no account layer (no keys: local dev,
 * tests) opens on step two. There is no skip for a learner.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { type FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ONBOARDED_KEY } from '../App';
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
import { Auth } from './auth/Auth';
import { SIGN_UP } from './auth/copy';
import {
  backOf,
  clearStep,
  profileComplete,
  type RunStep,
  readSavedStep,
  restoreStep,
  type StepStore,
  saveStep,
} from './auth/run';
import { Steps } from './auth/Steps';
import {
  type Allowance,
  allowanceLine,
  allowanceShare,
  readAllowance,
  resetTime,
} from './plans/allowance';
import { classLine } from './You';
import { boardOf, type ChosenBoard, levelsFor } from './you/GradeBoardPicker';
import { ParentInvite } from './you/ParentInvite';
import { boardName, frameworkLabel, loadProfile, resolveBoardId, saveProfile } from './you/profile';
import './onboarding/onboarding.css';

type Step = RunStep;

/** The bubble's line on each step, verbatim. The door speaks its own (`SIGN_UP.hand`). */
const BUBBLE: Partial<Record<Step, string>> = {
  1: SIGN_UP.hand,
  2: "Tell me once. I'll find your exact chapter every week after.",
  4: 'On Sundays I write three lines home. Want someone to get them?',
};

/** The class ladder onboarding-v2 draws before a board is chosen: shown, never pressable, until one is. */
const LADDER = ['4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

/** The reading before the brain has answered, or where there is no brain to ask. */
const UNREAD: Allowance = { known: false, remaining: null, limit: null, resetsAt: null };
/**
 * What the last step says about an allowance nothing could be read for. The plans page tells its
 * reader to sign in; this learner just did, so it says what the widget is and that it fills in.
 */
export const ALLOWANCE_UNREAD_LINE =
  'This fills in as we go: how much of today is left, and when it comes back.';

/** The three sample questions, verbatim. */
const SAMPLES = [
  "What's the difference between speed and velocity?",
  'Why is the sky blue?',
  'Explain fractions with a chocolate bar',
] as const;

/** The run's memory on this device, or nothing where there is no storage to hold it. */
function stepStore(): StepStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Somebody is signed in. An anonymous session is not somebody: it is the brain's way of budgeting a
 * stranger, and the door still has to be walked. `isAuthenticated()` alone said yes to it.
 */
function signedIn(account: { isAuthenticated(): boolean; isAnonymous(): boolean } | undefined) {
  return !!account && account.isAuthenticated() && !account.isAnonymous();
}

/** The board the profile remembers, as the picker would have chosen it. */
function rememberedBoard(): ChosenBoard | null {
  const id = loadProfile().boardId.trim();
  return id ? { id, name: boardName(id), framework: null, unlisted: false } : null;
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
  const [authed, setAuthed] = useState(() => signedIn(account));
  const [step, setStepState] = useState<Step>(() =>
    restoreStep(readSavedStep(stepStore()), {
      canAuth,
      signedIn: signedIn(account),
      profileComplete: profileComplete(loadProfile()),
    }),
  );
  /** Move the run, and remember where it is so a reload lands here. */
  const go = (next: Step) => {
    setStepState(next);
    saveStep(stepStore(), next);
  };

  // --- who's learning --------------------------------------------------------------------------
  const [name, setName] = useState(() => loadProfile().name);
  const [grade, setGrade] = useState<string | null>(() => loadProfile().grade || null);
  const [board, setBoard] = useState<ChosenBoard | null>(rememberedBoard);
  const [own, setOwn] = useState(false);
  const search = useBoardSearch();
  const [typed, setTyped] = useState(() => rememberedBoard()?.name ?? '');
  const results = search.state.result?.results ?? [];
  // A board the registry answered for brings its own classes. A board remembered from the profile
  // knows only the class that was picked with it, which is shown pressed rather than lost.
  const levels = useMemo(() => {
    const known = schoolLevels(levelsFor(board));
    if (known.length > 0) return known;
    return board && grade ? [grade] : [];
  }, [board, grade]);

  /**
   * What is in the way of "That's me", said in one line and pointed at the control it is about.
   * An empty submit used to be `disabled={!ready2}`, which is the silent kind of refusal: a
   * fourteen-year-old taps the brightest thing on the page and nothing happens. The button is
   * always live now, and pressing it early names the first thing missing, in page order, and puts
   * focus there so the next thing they do is the fix.
   */
  const [refusal, setRefusal] = useState<{
    where: 'name' | 'board' | 'class';
    line: string;
  } | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const boardField = useRef<HTMLInputElement>(null);
  const classChips = useRef<HTMLDivElement>(null);
  const REFUSAL_ID = 'ob-refusal';

  // --- the aha ---------------------------------------------------------------------------------
  const [question, setQuestion] = useState('');
  /** The aha's own refusal: Ask with nothing typed says so and puts the caret in the field. */
  const [askNote, setAskNote] = useState<string | null>(null);
  const askField = useRef<HTMLInputElement>(null);
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
  /** How much of today is still standing, kept only as a shape, for the bar to draw. */
  const share = allowance ? allowanceShare(allowance) : null;

  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const boardLabel = board?.name ?? boardName(loadProfile().boardId);

  const stageRef = useRegisterTarget<HTMLDivElement>('onboarding-stage', {
    kind: 'flow',
    label: 'setting up: the step Wobo is on and what Wobo is waiting for',
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

  // Wobo says the bubble's line on each step: the same voice the old flow had, muted where muted.
  useEffect(() => {
    const line = BUBBLE[step];
    if (line) void speakLine(line);
  }, [step]);

  // A new step starts at the top of the page, with attention on its heading rather than wherever
  // the last button happened to be.
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step changing IS the trigger
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [step]);

  // Somebody just signed in, at the door or back from a provider. An already-onboarded account
  // skips every question and lands home; a new account goes on to step two with the given name.
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
      // ends up reading "Class 8 · cbse" three screens away, so the label is settled here, at
      // the one place that knows a name is missing, rather than normalised by every screen.
      void adoptFramework({ frameworkId: boardId, name: frameworkLabel(boardId), level });
      localStorage.setItem(ONBOARDED_KEY, '1');
      clearStep(stepStore());
      router.replace({ name: 'home' });
      return;
    }
    const given = account?.profile()?.name?.trim().split(/\s+/)[0];
    if (given && !name.trim()) setName(given);
    go(2);
  };

  const booted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once boot, guarded by the ref
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // Arrived signed in with nothing of the run saved: a provider round-trip landing back here, or
    // an account walking in. Mid-run, the saved step already says where they are.
    if (signedIn(account) && readSavedStep(stepStore()) === null) void resumeAfterAuth();
  }, [sdk]);

  // --- who's learning → the aha --------------------------------------------------------------------
  const thatsMe = (e: FormEvent) => {
    e.preventDefault();
    // the first thing missing, in the order the page asks: a name, then a board, then its class
    if (!name.trim()) {
      setRefusal({ where: 'name', line: 'What should I call you? A first name is enough.' });
      nameField.current?.focus();
      return;
    }
    if (!board) {
      setRefusal({
        where: 'board',
        line: 'Which board are you with? Type it and pick it from the list.',
      });
      boardField.current?.focus();
      return;
    }
    if (!grade) {
      setRefusal({ where: 'class', line: 'Which class are you in? Tap one.' });
      classChips.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      return;
    }
    setRefusal(null);
    sfx.tap();
    saveProfile({ ...loadProfile(), name: name.trim(), grade, boardId: board.id });
    void adoptFramework({ frameworkId: board.id, name: board.name, level: grade });
    void account?.syncProfile({ display_name: name.trim(), grade, board: board.id });
    go(3);
  };

  const ask = (text: string) => {
    const line = text.trim();
    if (chat.busy) return;
    if (!line) {
      setAskNote('Type a question, or tap one of the three below.');
      askField.current?.focus();
      return;
    }
    setAskNote(null);
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
    clearStep(stepStore());
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

  // ONE quiet way past a step, never two. Step three's bar says "Skip for now" until a question
  // has been asked; from then on the way forward is the button under the answer, and the bar's
  // word goes. Step four's way past is the form's own "I'll do this later" (ParentInvite), so the
  // bar carries nothing there: it used to say "Not now" above a form that said the same thing in
  // other words.
  const skipLabel: Partial<Record<Step, string>> = askedAt === null ? { 3: 'Skip for now' } : {};
  const skip = () => {
    sfx.tap();
    if (step === 3) go(4);
  };
  const back = backOf(step);
  const goBack = (to: Step) => {
    sfx.tap();
    go(to);
  };

  // THE DOOR. The same component `/sign-up` is, with the run telling it where to come back to and
  // what happens once somebody is in. Nothing here is drawn twice.
  if (step === 1) {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <div ref={stageRef}>
        <Auth
          mode="sign-up"
          run={{ redirectTo: `${origin}/onboarding`, onSignedIn: () => void resumeAfterAuth() }}
        />
      </div>
    );
  }

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
        <Steps current={step} onBack={goBack} />
        <span className="ob-ways">
          {back !== null ? (
            <button type="button" className="ob-skip" onClick={() => goBack(back)}>
              Back
            </button>
          ) : null}
          {skipLabel[step] ? (
            <button type="button" className="ob-skip" onClick={skip}>
              {skipLabel[step]}
            </button>
          ) : null}
        </span>
      </div>

      <div className="ob-body">
        {step === 2 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="listening" />
            <div className="ob-bub">
              Tell me once. I'll find your exact chapter every week after.
            </div>
            <h1 ref={heading} tabIndex={-1}>
              Who's learning, and where?
            </h1>
            <form className="ob-form" onSubmit={thatsMe} noValidate>
              <div className="ob-field">
                <label htmlFor="ob-name">First name</label>
                <input
                  id="ob-name"
                  ref={nameField}
                  value={name}
                  {...(refusal?.where === 'name'
                    ? { 'aria-invalid': true as const, 'aria-describedby': REFUSAL_ID }
                    : {})}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (refusal?.where === 'name') setRefusal(null);
                  }}
                  placeholder="What should I call you?"
                  autoComplete="given-name"
                />
              </div>
              {/* THE BOARD BEFORE THE CLASS. The classes are the board's own, so they cannot be
                  answered first: with the class row above the board, a learner tapped "8", nothing
                  happened, and only the fine print two lines down said why. The fields are in the
                  order they can be answered. */}
              <div className="ob-field ob-ta">
                <label htmlFor="ob-board">Board</label>
                <input
                  id="ob-board"
                  ref={boardField}
                  value={typed}
                  {...(refusal?.where === 'board'
                    ? { 'aria-invalid': true as const, 'aria-describedby': REFUSAL_ID }
                    : {})}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setBoard(null);
                    search.setQuery(e.target.value);
                    if (refusal?.where === 'board') setRefusal(null);
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
              <fieldset
                className="ob-field"
                {...(refusal?.where === 'class' ? { 'aria-describedby': REFUSAL_ID } : {})}
              >
                <legend>Class</legend>
                {levels.length > 0 ? (
                  <div className="ob-chips" ref={classChips}>
                    {levels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={grade === level}
                        onClick={() => {
                          setGrade(level);
                          if (refusal?.where === 'class') setRefusal(null);
                        }}
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
                        : 'Pick your board above and I will bring its classes.'}
                    </p>
                  </>
                )}
              </fieldset>
              {refusal ? (
                <p className="ob-refuse" id={REFUSAL_ID} role="alert">
                  {refusal.line}
                </p>
              ) : null}
              <button type="submit" className="ob-btn ob-pig">
                That's me
              </button>
            </form>
          </div>
        )}

        {step === 3 && (
          <div className="ob-card">
            <h1 ref={heading} tabIndex={-1}>
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
                  ref={askField}
                  value={question}
                  {...(askNote
                    ? { 'aria-invalid': true as const, 'aria-describedby': 'ob-ask-note' }
                    : {})}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    if (askNote) setAskNote(null);
                  }}
                  placeholder="why does a² + b² = c²?"
                  aria-label="Ask Wobo"
                  autoComplete="off"
                  enterKeyHint="send"
                />
                <button type="submit" className="ob-btn ob-pig" disabled={chat.busy}>
                  Ask
                </button>
              </form>
              {askNote ? (
                <p className="ob-refuse" id="ob-ask-note" role="alert">
                  {askNote}
                </p>
              ) : null}
              <div className="ob-chipsq">
                {SAMPLES.map((q) => (
                  <button key={q} type="button" className="ob-chipq" onClick={() => ask(q)}>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* the way forward, once there is something to go forward from; before that the bar's
                "Skip for now" is the one way past, so this never reads as nonsense on first paint */}
            {askedAt !== null ? (
              <button
                type="button"
                className="ob-btn"
                onClick={() => {
                  sfx.tap();
                  go(4);
                }}
              >
                That was it. Keep going
              </button>
            ) : null}
          </div>
        )}

        {step === 4 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="listening" />
            <div className="ob-bub">
              On Sundays I write three lines home. Want someone to get them?
            </div>
            <h1 ref={heading} tabIndex={-1}>
              Link a parent, if you'd like.
            </h1>
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
                  go(5);
                }}
                onLater={() => {
                  sfx.tap();
                  go(5);
                }}
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="ob-card">
            <WoboHead size={120} shadow className="ob-wobo" mood="celebrate" />
            <h1 ref={heading} tabIndex={-1}>
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
              Enough questions for a normal day, every day, for free. Hold space to talk to me, or
              just type. I'll be here whenever you want me.
            </p>
            <div className="ob-allow">
              <b>Today's allowance</b>
              {/* The bar draws the same fraction the sentence describes, so the two agree: where
                  nothing could be read there is no fraction, and a bar at its CSS default of 100%
                  under a sentence saying nothing is known was the two disagreeing. */}
              {share !== null ? (
                <div className="ob-bar" aria-hidden="true">
                  <i style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
              ) : null}
              {/* The copy law (DESIGN.md §0): what is left is said in words, never "25 of 40".
                  And never "sign in" here: a learner on this step has just walked the door. */}
              <span>{allowanceLine(allowance ?? UNREAD, resetTime, ALLOWANCE_UNREAD_LINE)}</span>
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
