'use client';

/**
 * The conversation — NOT a chat app. It is the lesson plane (board 03 of
 * design/prototypes/app-v1.html) opened in conversation mode: the same plane card with Wobo's bar,
 * the canvas and the say row, and the same side column beside it. What the canvas holds is the
 * never-ending thread — the one Wobo carries everywhere — set as a page rather than as bubbles:
 * the learner's question is the heading, Wobo's answer is the prose under it. Scroll up and the
 * past pages itself in; ask in the say row, where a lesson keeps its button.
 *
 * Wobo's ink belongs on the other screens; here Wobo speaks in regular type, person to person.
 */

import { armLasso, useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppFrame } from '../shell/AppFrame';
import { OFFLINE_LINE } from '../shell/resilience';
import { AskBox, Avatar, Card, Chip, Tag, TopBar, WoboHead } from '../ui/primitives';
import { useWoboChat } from '../wobo/chat';
import { withHelplines } from '../wobo/helplines';
import { holdToTalkEnd, holdToTalkStart } from '../wobo/hold';
import { TurnAttachments } from '../wobo/paths';
import { MuteButton } from '../wobo/speech';
import { useWoboVoice } from '../wobo/voice';
import './course/lesson.css';
import './chat/chat.css';
import { loadProfile } from './you/profile';

/** The product's own line for what this page is. It is the crumb, so the address explains itself. */
// The crumb is the name and nothing after it: a surface does not describe itself (DESIGN.md §0.x).
const CRUMB = 'Wobo';

export function ChatScreen() {
  const { turns, ask, busy, setMood, hasOlder, loadOlder, offline, pending } = useWoboChat();
  const bus = useWoboBus();
  const [draft, setDraft] = useState('');
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sayRef = useRef<HTMLDivElement | null>(null);
  const learner = useMemo(() => loadProfile().name.trim(), []);
  const initial = learner.charAt(0).toUpperCase();

  // The conversation IS the screen: Wobo publishes themself here, and the course layers are
  // cleared, so Wobo never answers about a page already left.
  const threadRef = useRegisterTarget<HTMLDivElement>('chat-thread', {
    kind: 'conversation',
    label: 'the conversation on screen',
    getSceneState: () => ({
      turns: turns.slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 120) })),
    }),
  });
  useEffect(() => {
    bus.publishPage({
      route: 'chat',
      state: { title: 'conversation', intent: 'talk', turnCount: turns.length },
    });
    bus.publishCurriculum({});
    bus.publishCanvas(undefined);
  }, [bus, turns.length]);

  // scroll bookkeeping: keep the reader's place when the past prepends, follow the newest line
  const restore = useRef<{ height: number; top: number } | null>(null);
  const lastLen = useRef(turns.length);
  const voice = useWoboVoice({ setMood });
  const voiceOn =
    voice.status === 'listening' || voice.status === 'speaking' || voice.status === 'connecting';

  // Arrive at the newest line, instantly.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restore.current) {
      // older turns prepended — hold the exact line the reader was on
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (turns.length > lastLen.current) {
      // a new turn arrived — follow it down only if the reader is already near the bottom
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
    lastLen.current = turns.length;
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !hasOlder || restore.current) return;
    if (el.scrollTop < 80) {
      restore.current = { height: el.scrollHeight, top: el.scrollTop };
      loadOlder();
    }
  };

  const submit = (text: string) => {
    // Offline queueing + reconnect retry live in the shared chat layer (App.tsx `ask`), so the home
    // composer and this one behave identically. When online, don't stack turns while one is in flight.
    if (busy && !offline) return;
    setDraft('');
    void ask(text);
  };

  const toggleVoice = useCallback(() => {
    if (voiceOn) {
      voice.stop();
      return;
    }
    void voice.start().then((state) => {
      // 'idle' back from start() means getUserMedia was denied/blocked — don't fail silently.
      const note =
        state === 'unavailable'
          ? 'My voice is asleep right now — the words still arrive'
          : state === 'idle'
            ? 'Allow microphone access to talk with Wobo'
            : null;
      if (note) {
        setVoiceNote(note);
        window.setTimeout(() => setVoiceNote(null), 3000);
      }
    });
  }, [voice, voiceOn]);

  const focusAsk = () => sayRef.current?.querySelector('input')?.focus();

  return (
    <AppFrame active="home">
      <h1 className="ls-sr">Wobo</h1>
      <TopBar
        crumb={CRUMB}
        right={<Avatar aria-hidden={initial ? undefined : true}>{initial}</Avatar>}
      />
      <div className="ls-lesson">
        <section
          className="ls-plane ch-plane"
          aria-label="Your conversation with Wobo"
          aria-busy={busy || undefined}
        >
          <div className="ls-bar">
            <b>Wobo</b>
            <span className="ls-voice">
              <MuteButton />
            </span>
            {/* a reply is on its way: the pulse says so, no word does (DESIGN.md §0.x) */}
            {busy && (
              <span className="ls-live" aria-hidden="true">
                <i />
              </span>
            )}
          </div>
          <div className="ls-canvas">
            <div ref={scrollRef} onScroll={onScroll} className="ls-stage wobo-scroll-quiet">
              {/* the thread is a log: every answer Wobo lands is announced where it lands */}
              <div className="ch-thread" ref={threadRef} role="log" aria-label="The conversation">
                {!hasOlder && <div className="ch-began">Where we began</div>}
                {turns.map((t) =>
                  t.role === 'user' ? (
                    <div key={t.id} className="ch-turn">
                      <Tag>You asked</Tag>
                      <p>{t.text}</p>
                    </div>
                  ) : (
                    <div key={t.id} className="ch-turn">
                      {/* Wobo's own words. `withHelplines` makes the two helpline numbers in a
                          crisis reply pressable and leaves every other line exactly as it was: a
                          child in distress on a phone should not have to copy a number out of a
                          paragraph by hand. */}
                      <div className="ch-said">{withHelplines(t.text)}</div>
                      {/* the five paths land in the thread itself — sims, drawings, action cards */}
                      {t.extras && <TurnAttachments turn={t} />}
                    </div>
                  ),
                )}
                {/* queued while offline — shown so nothing they typed silently vanishes */}
                {pending.map((q) => (
                  <div key={q.id} className="ch-turn ch-queued">
                    <Tag>You asked</Tag>
                    <p>{q.text}</p>
                    <div className="ch-wait">Sending when you're back…</div>
                  </div>
                ))}
                {/* offline: one plain line telling them what still works (the dead-end rule) */}
                {offline && (
                  <div className="ch-wait" role="status">
                    {OFFLINE_LINE}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="ls-say ch-say" ref={sayRef}>
            <WoboHead size={44} mood={busy ? 'thinking' : 'idle'} />
            <AskBox
              placeholder="Talk to Wobo…"
              label="Ask Wobo"
              value={draft}
              onChange={setDraft}
              onAsk={submit}
              onMic={toggleVoice}
              micLabel={voiceOn ? 'Stop voice' : 'Talk to Wobo by voice'}
            />
          </div>
        </section>
        <aside className="ls-side">
          {/* LAW v5 (DESIGN.md §0): rose is for the thing that needs care. The tools that let a
              learner circle the board and ask are neither a worry nor a highlight, so the card is
              a tonal surface and the pigment on this screen stays in Wobo's ink. */}
          <Card compact>
            <Tag>Ask about this</Tag>
            <p style={{ color: 'var(--ink)' }}>
              Circle any part of the board and ask why. Or just say it.
            </p>
            <div className="ls-tools">
              <Chip onClick={() => armLasso(true)}>Circle</Chip>
              <Chip onClick={focusAsk}>Type</Chip>
              <TalkChip />
            </div>
          </Card>
          <Card compact>
            <Tag>Your place</Tag>
            <p>Saved as you go. Leave any time, come back to this line.</p>
            {voiceNote && <div className="ch-wait">{voiceNote}</div>}
          </Card>
        </aside>
      </div>
    </AppFrame>
  );
}

/** The Talk chip in the ask card — hold it to speak, the same hold as the space bar. */
function TalkChip() {
  const held = useRef(false);
  const start = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (held.current) return;
    held.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdToTalkStart();
  }, []);
  const end = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    holdToTalkEnd();
  }, []);
  useEffect(() => end, [end]);
  return (
    <Chip
      onClick={() => {}}
      aria-label="Hold to talk to Wobo"
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
    >
      Talk
    </Chip>
  );
}
