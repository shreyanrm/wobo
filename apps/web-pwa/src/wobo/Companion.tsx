'use client';

/**
 * The docked Wobo (DESIGN.md §4) — Wobo flies in on every page, floats in a slow idle drift at the
 * bottom right, and one tap opens Wobo's full-height drawer on the right. Wobo's words arrive in Wobo
 * own hand — Caveat, written letter by letter. Wobo's canvas ink lives in the overlay and fades;
 * nothing Wobo draws is saved.
 */

import { fontFamily } from '@wobo/config';
import { useReducedMotion } from '@wobo/motion';
import { glassHold, plane, useWoboBus, WoboBody } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from '../shell/router';
import { useViewport } from '../shell/useViewport';
import { useProgress } from '../store/progress';
import { useSdk } from '../store/sdk';
import { CloseIcon, SendIcon, WaveformIcon } from '../ui/icons';
import { useShellMounted } from '../ui/shellPresence';
import { sfx } from '../ui/sound';
import { boardTurn, screenInkHolding, screenStore } from './board-turn';
import { appendToArchive, type ChatTurn, useWoboChat } from './chat';
import { subscribeCompanionOpen } from './drawer';
import { FlyingWobo } from './Flight';
import { sheetFolded, sheetParts } from './fold';
import { withHelplines } from './helplines';
import { registerHoldToTalk } from './hold';
import {
  type LeanReason,
  leanInLine,
  loadProactivity,
  shouldLeanIn,
  trailingMisses,
} from './leanin';
import { availableModes, modePrompt } from './modes';
import { TurnAttachments } from './paths';
import { moodFor, useIdleSince } from './presence';
import { isMuted, MuteButton } from './speech';
import { probeTeachBack, type TeachBackTurn, teachBackOpening } from './tutor';
import { useWoboVoice } from './voice';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A sentence being written is never interrupted — Wobo waits for the full stop. */
function isTypingNow(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/** Teach-back (WOBO.md §8): Wobo plays the student; the exchange is ephemeral, like Wobo's ink. */
interface TeachBack {
  topic: string;
  nodeId?: string;
  turns: TeachBackTurn[];
  probed: string[];
  done: boolean;
}

const offerButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--wobo-ink-900)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 550,
  padding: 0,
};

/** Wobo's hand: letter-by-letter reveal for the newest line Wobo speaks. */
function Handwritten({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(timer);
    }, 22);
    return () => clearInterval(timer);
  }, [text, animate]);
  // Wobo's words sit on the page — no outline, no box; the learner's inputs carry the bubble
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 2px',
        fontSize: '0.92rem',
        lineHeight: 1.6,
        color: 'var(--wobo-ink)',
      }}
    >
      {/* Once the line has finished writing itself, the helpline numbers in it become pressable.
          Mid-animation it stays plain text: a half-written number is not a number to dial. */}
      {shown >= text.length ? withHelplines(text) : text.slice(0, shown)}
      {shown < text.length && <span style={{ opacity: 0.4 }}>|</span>}
    </span>
  );
}

export function WoboCompanion() {
  const { turns, ask, busy, mood, setMood, focus } = useWoboChat();
  const router = useRouter();
  const { route } = router;
  const bus = useWoboBus();
  const sdk = useSdk();
  const { award, xp } = useProgress();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [tb, setTb] = useState<TeachBack | null>(null);
  // Push-to-talk on Wobo's docked body: the live-voice halo, and a docked note when Wobo can't answer.
  const [ptt, setPtt] = useState(false);
  const [pttNote, setPttNote] = useState<string | null>(null);
  const reduced = useReducedMotion();
  // A screen on the app shell (the four doors, the lesson) IS Wobo's presence: Wobo's head lives
  // on its cards and in the say row, the rail carries hold-to-talk, and the prototype's boards
  // draw no docked orb. The orb would only cover the bar's fourth door on a phone. It stays
  // mounted (the hold and the drawer keep working) and simply does not show.
  const shelled = useShellMounted();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The drawer is modal: focus lands on the composer when it opens and returns to whatever opened
  // it when it closes.
  const composerRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // A push-to-talk exchange is spoken, not typed — but the same thread law holds, so each
  // transcribed side lands in the one chat archive (it surfaces in the thread on next load).
  const voice = useWoboVoice({
    setMood,
    onTranscript: ({ role, text }) => {
      // A minted id, not the archive length: two sides transcribed in the same tick (or a trimmed
      // archive) both read the same length and collide, and React keys the thread by turn id.
      appendToArchive({ id: crypto.randomUUID(), role, text } as ChatTurn);
    },
  });
  const voiceOn =
    voice.status === 'listening' || voice.status === 'speaking' || voice.status === 'connecting';

  const lastWoboId = [...turns].reverse().find((t) => t.role === 'wobo')?.id;

  // one scroll area, two threads: the conversation, or the ephemeral teach-back exchange
  const thread: { id: string; role: string; text: string }[] = tb ? tb.turns : turns;

  // what Wobo is plugged into right now — the current topic makes teach-back possible.
  // gated by route: the bus's curriculum lingers after a course closes, the page does not.
  const ctx = open ? bus.assembleContext() : null;
  const onCourse = ctx !== null && (ctx.page.route === 'course' || ctx.page.route === 'sandbox');
  const topicName = onCourse
    ? (ctx.curriculum.nodeName ?? (ctx.page.state.title as string | undefined))
    : undefined;

  const startTeachBack = () => {
    if (!topicName) return;
    // the node id travels only when it provably belongs to this topic (the curriculum lingers)
    const rawNode = ctx?.curriculum.nodeName === topicName ? ctx?.curriculum.nodeId : undefined;
    const nodeId = rawNode && UUID_RE.test(rawNode) ? rawNode : undefined;
    setTb({
      topic: topicName,
      nodeId,
      turns: [{ id: 'tb-0', role: 'wobo', text: teachBackOpening(topicName) }],
      probed: [],
      done: false,
    });
    setMood('listening');
  };

  const endTeachBack = () => {
    setTb(null);
    setMood('idle');
  };

  // the learner teaches; Wobo probes exactly one gap per turn — bonus XP when the lesson lands
  const submitTeachBack = (text: string) => {
    if (!tb) return;
    sdk.events.record(
      'wobo.turn.user.v1',
      {
        node_id: tb.nodeId,
        turn_id: crypto.randomUUID(),
        input_mode: 'text',
        text,
        has_audio: false,
      },
      { ontologyNodeId: tb.nodeId },
    );
    const r = probeTeachBack(text, tb.probed, tb.topic);
    sdk.events.record(
      'wobo.turn.assistant.v1',
      {
        node_id: tb.nodeId,
        turn_id: crypto.randomUUID(),
        assistance_level: 'challenge',
        hint_level: 0,
        grounded: false,
        track: 'track_2',
        handed_answer: false,
      },
      { ontologyNodeId: tb.nodeId },
    );
    const n = tb.turns.length;
    setTb({
      ...tb,
      turns: [
        ...tb.turns,
        { id: `tb-${n}-u`, role: 'learner', text },
        { id: `tb-${n}-v`, role: 'wobo', text: r.reply },
      ],
      probed: r.gap ? [...tb.probed, r.gap] : tb.probed,
      done: r.complete,
    });
    if (r.complete) {
      award('bonus', { onceKey: `teachback-${tb.topic}` });
      setMood('celebrate');
      window.setTimeout(() => setMood('idle'), 1600);
    }
  };

  const toggleVoice = () => {
    if (voiceOn) return voice.stop();
    void voice.start().then((landed) => {
      // 'idle' back from start() means getUserMedia was denied/blocked — don't fail silently.
      const note =
        landed === 'unavailable'
          ? 'my voice is asleep right now — the words still arrive'
          : landed === 'idle'
            ? 'allow microphone access to talk'
            : null;
      if (note) {
        setVoiceNote(note);
        window.setTimeout(() => setVoiceNote(null), 3000);
      }
    });
  };

  // A brief note beside the docked orb — Wobo can't hold a voice conversation right now.
  const flashPttNote = (msg: string) => {
    setPttNote(msg);
    window.setTimeout(() => setPttNote(null), 2600);
  };

  // Hold Wobo's docked body to talk (owner law): the mic opens, Wobo listens; release completes the
  // utterance and Wobo replies aloud, docked — no drawer opens. A quick tap stays the poke.
  const holdStart = () => {
    if (open || voiceOn) return; // the drawer has its own mic; never run two sessions
    // Barge-in by voice (docs/BOARD.md §4): the moment the learner speaks, the pen lifts where it
    // is and Wobo's voice stops with it. What is drawn stays, and the object Wobo was on rides the
    // next turn so Wobo resumes rather than starting again.
    boardTurn.interrupt();
    if (isMuted()) {
      flashPttNote('unmute to talk with Wobo'); // the mute law governs sound
      return;
    }
    setPtt(true);
    setMood('listening');
    void voice.start().then((landed) => {
      if (landed !== 'listening') {
        setPtt(false);
        setMood('idle');
        if (landed === 'unavailable')
          flashPttNote('my voice is asleep right now — the words still arrive');
        else if (landed === 'idle') flashPttNote('allow microphone access to talk');
      }
    });
  };
  const holdEnd = () => {
    if (!ptt) return;
    voice.finishTurn(); // stop capturing, let Wobo's spoken reply stream back, then the session closes
  };

  // The desktop hotkey is the same hold as pressing Wobo (WOBO-TASKS §5.9). The chord is caught by
  // the gesture layer on the stage, which has no microphone of its own; this is where the one live
  // voice session lives, so the body offers its hold and the hotkey takes it. Registered through a
  // ref so the handlers stay current without re-registering on every render.
  const holdRef = useRef({ start: holdStart, end: holdEnd });
  holdRef.current = { start: holdStart, end: holdEnd };
  useEffect(
    () =>
      registerHoldToTalk({
        start: () => holdRef.current.start(),
        end: () => holdRef.current.end(),
      }),
    [],
  );

  // The session can end on its own — Wobo's reply finishing, an abort, a drop. Retire the halo with it.
  useEffect(() => {
    if (voice.status === 'idle' || voice.status === 'unavailable') setPtt(false);
  }, [voice.status]);

  // --- Wobo's body, on real signals (WOBO-TASKS §5.7) ------------------------------------------------
  // Listening is the microphone actually being open; drawing is the pen actually being down;
  // thinking is a plan actually streaming; the aha is a real award crossing. Nothing here is a
  // timer and nothing is canned.
  const board = useSyncExternalStore(boardTurn.subscribe, boardTurn.get, boardTurn.get);
  // The freeze (docs/INK-FREEZE-PLAN-TRACE.md §3): while the glass is held on a phone, the sheet
  // folds to a strip along the bottom so the page Wobo is drawing on is in front of the learner,
  // not behind a modal. It unfolds on the same tick the glass is released.
  const glass = useSyncExternalStore(glassHold.subscribe, glassHold.get, glassHold.get);
  // And while Wobo's ink is still on the page, holding for an answer: unfolding then put the
  // modal over the very marks the question was about (wobo/fold.ts).
  const inkHolding = useSyncExternalStore(screenStore.subscribe, screenInkHolding, () => false);
  const { width: viewportWidth } = useViewport();
  const folded = sheetFolded({ open, held: glass.held, inkHolding, width: viewportWidth });
  // A strip is the ask row and nothing else, so the ask row cannot be pushed off the bottom
  // of the phone (wobo/fold.ts `sheetParts`; the adversary, 2026-09-09, finding 4).
  const parts = sheetParts(folded);
  const idleSince = useIdleSince();
  const [aha, setAha] = useState(false);
  const lastXp = useRef(xp);
  useEffect(() => {
    if (xp <= lastXp.current) {
      lastXp.current = xp;
      return;
    }
    lastXp.current = xp;
    setAha(true);
    const t = window.setTimeout(() => setAha(false), 2200);
    return () => window.clearTimeout(t);
  }, [xp]);
  const expression = moodFor({
    listening: ptt || voice.status === 'listening',
    thinking: busy || (board.active && board.objects === 0),
    drawing: board.active && board.objects > 0,
    aha,
    speaking: voice.status === 'speaking',
    engaged: open,
  });

  // --- proactive lean-in (WOBO-PLAN §3) -----------------------------------------------------------
  // Three wrong actions or forty idle seconds, governed by the dial the learner set in You. Wobo
  // never talks over themself, never interrupts typing, and offers once before a long cooldown.
  const [offer, setOffer] = useState<{ reason: LeanReason; line: string } | null>(null);
  const offerRef = useRef<{ reason: LeanReason; line: string } | null>(null);
  offerRef.current = offer;
  const [leanKey, setLeanKey] = useState(0);
  const lastOfferAt = useRef(0);
  const idleRef = useRef(idleSince);
  idleRef.current = idleSince;
  const engagedRef = useRef(false);
  engagedRef.current = open || plane.get().open || board.active || busy;
  useEffect(() => {
    const dial = loadProactivity();
    if (dial === 'quiet') return;
    const tick = () => {
      if (offerRef.current) return; // one on the table at a time
      const typing = isTypingNow();
      const reason = shouldLeanIn(
        {
          misses: trailingMisses(sdk.events.getLog()),
          lastInputAt: idleRef.current,
          lastOfferAt: lastOfferAt.current,
          speaking: !isMuted() && engagedRef.current,
          typing,
          engaged: engagedRef.current,
        },
        Date.now(),
        dial,
      );
      if (!reason) return;
      lastOfferAt.current = Date.now();
      setOffer({ reason, line: leanInLine(reason, topicName) });
      setLeanKey((k) => k + 1);
    };
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [sdk, topicName]);
  // Wobo's offer is never a wall: it retires on its own if the learner carries on without it.
  useEffect(() => {
    if (!offer) return;
    const t = window.setTimeout(() => setOffer(null), 12_000);
    return () => window.clearTimeout(t);
  }, [offer]);

  // Closing the drawer only contracts Wobo — Wobo stays docked (FlyingWobo never unmounts). And a
  // live mic must not outlive the drawer, so any voice session is stopped on close (stop() no-ops
  // when idle). Both close affordances route through here.
  const close = () => {
    voice.stop();
    sfx.breath(false); // a soft breath as the drawer slides shut
    setOpen(false);
    // Focus goes back where it came from — a drawer that closes into nothing strands a keyboard
    // learner at the top of the document.
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    window.setTimeout(() => back?.focus?.(), 0);
  };

  /**
   * The drawer is a modal surface, so it owes the three things a dialog owes: focus lands inside it
   * on open, Escape closes it, and focus returns to whatever opened it. Without these a keyboard or
   * screen-reader learner could open Wobo and then be nowhere.
   */
  // `close` reads only refs and setters, so re-binding the listener on every render of it would be
  // churn for nothing — open IS the trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open IS the trigger
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // The composer is what the drawer is FOR — focus it, not the panel.
    const focusTimer = window.setTimeout(() => composerRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: length/open ARE the triggers — scroll on new turns and on expand
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, open, busy, tb?.turns.length]);

  // The drawer's second opener (wobo/drawer.ts). When Wobo changes approach on its own, the new
  // explanation is asked for on the learner's behalf and arrives here; a drawer that only ever
  // opened on a tap left that teaching in a closed panel the learner had no reason to open. The
  // focus, Escape and return-focus contract above is the same either way, because `open` is.
  useEffect(() => subscribeCompanionOpen(() => setOpen(true)), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    if (tb && !tb.done) {
      submitTeachBack(text);
      return;
    }
    if (tb?.done) endTeachBack();
    void ask(text);
  };

  return (
    <>
      {/* Wobo is always docked and mounted — the drawer only overlays Wobo. Closing it must never
          remove Wobo (the owner's complaint); hiding via visibility keeps Wobo in place with no
          re-fly, and the fixed drawer (higher z) covers Wobo while open. */}
      {/* The push-to-talk halo — a soft molten pulse ring around Wobo while Wobo is on a live hold,
          visible without any drawer. Reduced motion: a calm static ring. */}
      {ptt && !shelled && (
        <motion.div
          aria-hidden
          data-wobo-surface=""
          animate={reduced ? undefined : { scale: [1, 1.16, 1], opacity: [0.55, 0.3, 0.55] }}
          transition={
            reduced
              ? undefined
              : { duration: 1.9, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          }
          style={{
            position: 'fixed',
            right: 4,
            bottom: 8,
            width: 104,
            height: 104,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 50% 50%, rgba(255,90,31,0.22), rgba(255,90,31,0) 68%)',
            border: '1.5px solid rgba(255,120,60,0.5)',
            opacity: reduced ? 0.5 : undefined,
            zIndex: 'var(--wobo-z-woboPresence)' as unknown as number,
            pointerEvents: 'none',
          }}
        />
      )}
      <div data-wobo-surface="" style={{ visibility: open || shelled ? 'hidden' : 'visible' }}>
        <FlyingWobo
          routeKey={route.name}
          mood={expression}
          // Wobo's eyes go to what the learner circled, and Wobo's idle life runs off real quiet.
          focus={focus?.rect ?? null}
          idleSince={idleSince}
          behaviour={offer ? 'lean' : null}
          behaviourKey={leanKey}
          onTap={() => {
            sfx.breath(true); // a soft breath as Wobo's drawer slides open
            setOpen(true);
          }}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
        />
      </div>
      {/* The lean-in: Wobo offers a pointer, Wobo does not take over. Both answers are one tap, and
          walking away is an answer too — it retires on its own. */}
      {offer && !open && !shelled && (
        <div
          data-wobo-surface=""
          style={{
            position: 'fixed',
            right: 18,
            bottom: 100,
            maxWidth: 240,
            padding: '8px 10px',
            borderRadius: 'var(--wobo-radius-sm)',
            background: 'var(--wobo-frost-on-paper)',
            backdropFilter: 'blur(var(--wobo-frost-blur))',
            WebkitBackdropFilter: 'blur(var(--wobo-frost-blur))',
            border: '0.5px solid var(--wobo-hairline-on-paper)',
            color: 'var(--wobo-ink-700)',
            fontSize: '0.8rem',
            lineHeight: 1.45,
            textAlign: 'right',
            zIndex: 'var(--wobo-z-panel)' as unknown as number,
          }}
        >
          {offer.line}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={() => {
                setOffer(null);
                void ask(modePrompt('show_me'));
              }}
              style={offerButton}
            >
              show me
            </button>
            <button type="button" onClick={() => setOffer(null)} style={offerButton}>
              not now
            </button>
          </div>
        </div>
      )}
      {pttNote && !shelled && (
        <div
          data-wobo-surface=""
          style={{
            position: 'fixed',
            right: 18,
            bottom: 100,
            maxWidth: 210,
            padding: '6px 10px',
            borderRadius: 'var(--wobo-radius-sm)',
            background: 'var(--wobo-frost-on-paper)',
            backdropFilter: 'blur(var(--wobo-frost-blur))',
            WebkitBackdropFilter: 'blur(var(--wobo-frost-blur))',
            border: '0.5px solid var(--wobo-hairline-on-paper)',
            color: 'var(--wobo-ink-500)',
            fontSize: '0.78rem',
            textAlign: 'right',
            zIndex: 'var(--wobo-z-panel)' as unknown as number,
            pointerEvents: 'none',
          }}
        >
          {pttNote}
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.aside
            role="dialog"
            aria-modal={folded ? undefined : 'true'}
            aria-label="Wobo"
            // WOBO'S OWN SURFACES ARE NEVER ON THE GLASS (docs/INK-FREEZE-PLAN-TRACE.md §3): the
            // mark is on the root of the sheet, so the whole transcript — every learner bubble,
            // every reply, the ask input — is skipped by the read, by construction and not by a
            // list of Wobo's own copy (wobo/glass.ts IGNORE, packages/wobo/src/glass/read.ts).
            data-wobo-surface=""
            data-glass-ignore=""
            // The read waits on THIS element's box to stop moving before it takes the map
            // (wobo/glass.ts nextLayout): the fold is a motion style on its own frame loop, so a
            // map taken two frames after the hold was a map of a half-folded page.
            data-wobo-sheet=""
            data-glass-strip={folded ? '' : undefined}
            initial={{ x: '104%' }}
            animate={{ x: 0 }}
            exit={{ x: '104%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            style={{
              // starts below the 64px header so it never overlaps the profile/xp/streak cluster
              position: 'fixed',
              top: folded ? 'auto' : 64,
              left: folded ? 0 : undefined,
              right: 0,
              bottom: 0,
              // FOLDED, THE BOX IS WHAT THE ASK ROW NEEDS. Wave 40 pinned it to a fixed 128 px
              // with the whole sheet still mounted inside, and the ask row was pushed 60 px below
              // the bottom of a 390x844 phone (the adversary, 2026-09-09, finding 4).
              maxHeight: folded ? '40vh' : undefined,
              width: folded ? '100%' : 'min(420px, 94vw)',
              zIndex: 'var(--wobo-z-panel)' as unknown as number,
              background: 'var(--wobo-frost-on-paper)',
              backdropFilter: 'blur(var(--wobo-frost-blur))',
              WebkitBackdropFilter: 'blur(var(--wobo-frost-blur))',
              borderLeft: '0.5px solid var(--wobo-hairline-on-paper-strong)',
              borderTop: '0.5px solid var(--wobo-hairline-on-paper)',
              display: 'flex',
              flexDirection: 'column',
              // the phone's home bar is not a place to put an input
              paddingBottom: folded ? 'env(safe-area-inset-bottom, 0px)' : undefined,
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                display: parts.head ? 'flex' : 'none',
                alignItems: 'center',
                gap: 12,
                borderBottom: '0.5px solid var(--wobo-hairline-on-paper)',
              }}
            >
              <WoboBody
                size={46}
                mood={busy ? 'thinking' : open ? 'listening' : mood}
                gaze="pointer"
              />
              {/* the name and nothing under it: the ladder's rung is not narrated, and a reply on
                  its way is the body's mood, never a caption (DESIGN.md §0.x) */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--wobo-ink-900)', lineHeight: 1.1 }}>
                  Wobo
                </div>
              </div>
              <MuteButton />
              {/* the drawer is a window onto the one conversation — this opens the whole thing */}
              <button
                type="button"
                onClick={() => {
                  close();
                  router.navigate({ name: 'chat' });
                }}
                aria-label="Open the full conversation"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--wobo-ink-500)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.78rem',
                  fontWeight: 550,
                  padding: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                full chat ↗
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--wobo-ink-500)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  lineHeight: 1,
                  padding: 6,
                }}
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* teach-back rides above the thread — ephemeral, like Wobo's ink; nothing saved */}
            {tb && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 18px',
                  borderBottom: '0.5px solid var(--wobo-hairline-on-paper)',
                  fontSize: '0.78rem',
                  color: 'var(--wobo-ink-500)',
                }}
              >
                <span style={{ flex: 1 }}>you are teaching: {tb.topic.toLowerCase()}</span>
                <button
                  type="button"
                  onClick={endTeachBack}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--wobo-ink-500)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.78rem',
                    fontWeight: 550,
                    padding: 4,
                  }}
                >
                  {tb.done ? 'back to chat' : 'stop teaching'}
                </button>
              </div>
            )}

            <div
              ref={scrollRef}
              aria-busy={busy || undefined}
              style={{
                display: parts.thread ? 'flex' : 'none',
                overflowY: 'auto',
                padding: 18,
                flexDirection: 'column',
                gap: 12,
                flex: 1,
              }}
            >
              {thread.map((t) =>
                t.role === 'user' || t.role === 'learner' ? (
                  <div
                    key={t.id}
                    style={{
                      alignSelf: 'flex-end',
                      maxWidth: '85%',
                      padding: '8px 13px',
                      borderRadius: 'var(--wobo-radius-md)',
                      fontSize: '0.92rem',
                      lineHeight: 1.5,
                      background: 'var(--wobo-ink-900)',
                      color: 'var(--wobo-paper)',
                    }}
                  >
                    {t.text}
                  </div>
                ) : (
                  <div
                    key={t.id}
                    style={{
                      alignSelf: 'flex-start',
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    <div style={{ maxWidth: '92%' }}>
                      <Handwritten
                        text={t.text}
                        animate={
                          tb
                            ? t.id === tb.turns[tb.turns.length - 1]?.id
                            : t.id === lastWoboId && t.id !== 'seed'
                        }
                      />
                    </div>
                    {/* path results ride the same thread here as on the chat page */}
                    {!tb && (t as ChatTurn).extras && (
                      <div style={{ width: '100%' }}>
                        <TurnAttachments turn={t as ChatTurn} />
                      </div>
                    )}
                  </div>
                ),
              )}
              {busy && !tb && (
                <span
                  style={{
                    fontFamily: fontFamily.handwritten,
                    fontSize: '1.2rem',
                    color: 'var(--wobo-ink-500)',
                  }}
                >
                  …
                </span>
              )}
            </div>

            {/* the teach-back door — only where there is a topic to teach */}
            {parts.teachBack && !tb && topicName && (
              <button
                type="button"
                onClick={startTeachBack}
                style={{
                  margin: '0 14px',
                  padding: '9px 12px',
                  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                  borderRadius: 'var(--wobo-radius-sm)',
                  background: 'var(--wobo-paper)',
                  color: 'var(--wobo-ink-700)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  textAlign: 'left',
                }}
              >
                teach it back: {topicName.toLowerCase()}
              </button>
            )}

            {/* Wobo's modes, at hand (WOBO-PLAN §3). The ones that need something in hand appear only
                once there is something in hand — the same list the palette and voice reach. */}
            {parts.modes && !tb && (
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  padding: '0 14px',
                }}
              >
                {availableModes({ hasFocus: focus !== null, onLesson: onCourse }).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => void ask(modePrompt(m.id, focus?.text))}
                    title={m.hint}
                    style={{
                      border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                      borderRadius: 'var(--wobo-radius-sm)',
                      background: 'transparent',
                      color: 'var(--wobo-ink-500)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.76rem',
                      padding: '4px 8px',
                    }}
                  >
                    {m.label.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={submit}
              style={{
                display: 'flex',
                gap: 8,
                padding: 14,
                borderTop: '0.5px solid var(--wobo-hairline-on-paper)',
                alignItems: 'center',
              }}
            >
              <input
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setMood('listening')}
                onBlur={() => setMood('idle')}
                placeholder={tb && !tb.done ? 'Explain it to Wobo…' : 'Ask or do anything…'}
                style={{
                  flex: 1,
                  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
                  borderRadius: 'var(--wobo-radius-sm)',
                  padding: '10px 12px',
                  fontSize: '0.92rem',
                  fontFamily: 'inherit',
                  background: 'var(--wobo-paper)',
                  color: 'var(--wobo-ink-900)',
                }}
              />
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={voiceOn ? 'Stop voice' : 'Talk by voice'}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: voiceOn ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-500)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  padding: '0 2px',
                  whiteSpace: 'nowrap',
                }}
              >
                <WaveformIcon active={voiceOn} size={17} />
              </button>
              {/* the ask affordance exists only once there is something to ask */}
              <AnimatePresence initial={false}>
                {draft.trim() && (
                  <motion.button
                    key="ask"
                    type="submit"
                    disabled={busy}
                    initial={{ opacity: 0, scale: 0.88 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.88 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                    style={{
                      border: 'none',
                      background: 'var(--wobo-ink-900)',
                      color: 'var(--wobo-paper)',
                      borderRadius: 'var(--wobo-radius-sm)',
                      padding: '10px 14px',
                      cursor: busy ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    <SendIcon size={13} /> ask
                  </motion.button>
                )}
              </AnimatePresence>
            </form>
            {voiceNote && (
              <div
                style={{
                  padding: '0 14px 10px',
                  color: 'var(--wobo-ink-500)',
                  fontSize: '0.78rem',
                }}
              >
                {voiceNote}
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
