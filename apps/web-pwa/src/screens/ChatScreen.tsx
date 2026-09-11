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

import { armLasso, PHONE_SHEET_VH, plane, useRegisterTarget, useWoboBus } from '@wobo/wobo';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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

/**
 * A box on the screen, in viewport coordinates: what one piece of the page's furniture takes.
 * `readingWindow` is pure and takes these, so the numbers the lab measured on a real phone can be
 * replayed in a unit test (src/screens/chat/chat.test.ts) rather than asserted from memory.
 */
export type ScreenBox = { top: number; bottom: number; left: number; right: number };

/** Kept between the last line and anything painted over the page. The margin law's own 16. */
const READING_CLEARANCE = 16;

/** How many nodes of one piece of furniture are measured for paint before we take what we have. */
const PAINT_SCAN_LIMIT = 400;

/**
 * THE READING WINDOW: the band of the viewport Wobo's last line is allowed to end in.
 *
 * THE DEFECT THIS ANSWERS (the adversary, wave 42, finding 1, the SAY half). The floor used to be
 * `innerHeight - reserve - 16`, and the reserve is zero whenever no board is open — so on /chat at
 * 390 with ten lines on screen, the last one, Wobo's answer, sat at bottom 755 with the Tell Wobo
 * pill standing at 716 and the doubt camera at 708. The page had 430 px of scroll left and the app
 * parked its own answer under its own furniture, every time, in both themes and under reduced
 * motion. INK-FOUR craft: "nothing under a panel, sheet, toast or pill."
 *
 * THE FLOOR IS MEASURED, NOT DECLARED. Wave 42's craft probe missed the same two pieces because
 * neither was in its selector list, so nothing here names a class: the caller hands in every box
 * the page actually paints over itself (`furnitureBoxes`) and this decides.
 *
 *  · furniture in another column never moves the line — at 1440 the rail is a tall sticky bar down
 *    the left and the thread is nowhere near it;
 *  · furniture standing at the FOOT (its top in the lower half) lowers the floor to its top;
 *  · furniture standing at the HEAD (its bottom in the upper half) raises the ceiling instead, so
 *    following a long answer down can never bury its first line under a sticky bar;
 *  · furniture that spans the middle is a sheet, a scrim or a modal. It is not chrome over a page,
 *    it IS the page for as long as it is up, and it has its own law — the reserve, which the caller
 *    passes in (chat.css `[data-wobo-sheet] .ch-thread`, and the wave 47 measurement behind it).
 */
export function readingWindow(
  view: { height: number; reserve: number },
  line: { left: number; right: number },
  furniture: readonly ScreenBox[],
): { floor: number; ceiling: number } {
  const middle = view.height / 2;
  let floor = view.height - view.reserve - READING_CLEARANCE;
  let ceiling = 0;
  for (const box of furniture) {
    if (box.bottom - box.top < 1 || box.right - box.left < 1) continue;
    // not in the line's own column: it cannot cover a word of it
    if (box.right <= line.left || box.left >= line.right) continue;
    if (box.top >= middle) floor = Math.min(floor, box.top - READING_CLEARANCE);
    else if (box.bottom <= middle) ceiling = Math.max(ceiling, box.bottom + READING_CLEARANCE);
  }
  return { floor, ceiling };
}

/** A colour that paints. `rgba(0, 0, 0, 0)` and `transparent` do not. */
function opaque(colour: string): boolean {
  if (!colour || colour === 'transparent') return false;
  const alpha = /^rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(colour);
  return alpha ? Number(alpha[1]) > 0.01 : true;
}

/**
 * Elements that are their own picture — nothing else has to paint for them to be seen. An `svg`
 * counts where it STANDS, which is what makes Wobo's ink layer a layer the size of the screen: it
 * spans the middle, and `readingWindow` leaves what spans the middle alone. Wobo's answer is not
 * chrome over the page, and the line is never pushed around by the marks it is about.
 */
const SELF_PAINTING = new Set(['svg', 'img', 'canvas', 'video', 'input', 'textarea', 'select']);

/** Does this node put anything on the screen itself — a ground, an edge, a shadow, or words? */
function paintsItself(el: Element, cs: CSSStyleDeclaration): boolean {
  if (opaque(cs.backgroundColor)) return true;
  if (cs.backgroundImage !== 'none') return true;
  if (cs.boxShadow !== 'none') return true;
  if (Number.parseFloat(cs.borderTopWidth) > 0 || Number.parseFloat(cs.borderBottomWidth) > 0) {
    return true;
  }
  if (SELF_PAINTING.has(el.tagName.toLowerCase())) return true;
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '') return true;
  }
  return false;
}

/** Hidden outright, or by an ancestor. A pill the ink rule takes away covers nothing. */
function unpainted(cs: CSSStyleDeclaration): boolean {
  return (
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    cs.visibility === 'collapse' ||
    Number(cs.opacity) <= 0.05
  );
}

/**
 * The box a piece of furniture actually PAINTS in — not the box it reserves.
 *
 * The two are rarely the same. `.wf-float` is a transparent wrapper the size of the pill inside it;
 * the portal hosts Wobo's own layers live in are transparent and the size of the whole screen. Take
 * a wrapper's own rectangle and a page with one small pill in a full-screen host would be judged
 * covered from the top down. So the union of what paints inside it is measured instead, and a piece
 * of furniture that paints nothing at all takes nothing.
 */
function paintedBox(root: Element): ScreenBox | null {
  let box: ScreenBox | null = null;
  let seen = 0;
  const stack: Element[] = [root];
  while (stack.length > 0 && seen < PAINT_SCAN_LIMIT) {
    const el = stack.pop() as Element;
    seen += 1;
    const cs = getComputedStyle(el);
    if (unpainted(cs)) continue; // and nothing inside it paints either
    if (paintsItself(el, cs)) {
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) {
        box = box
          ? {
              top: Math.min(box.top, r.top),
              bottom: Math.max(box.bottom, r.bottom),
              left: Math.min(box.left, r.left),
              right: Math.max(box.right, r.right),
            }
          : { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }
    }
    for (const kid of el.children) stack.push(kid);
  }
  return box;
}

/**
 * Every box the page paints OVER itself: each fixed or sticky element, measured where it paints.
 *
 * The thread's own subtree is skipped whole — the words being read are not furniture, and skipping
 * the one big subtree on this screen is what keeps this cheap enough to run on every sentence.
 */
function furnitureBoxes(thread: Element | null): ScreenBox[] {
  const boxes: ScreenBox[] = [];
  if (typeof document === 'undefined' || !document.body) return boxes;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (node === thread ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const el = node as Element;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (unpainted(cs)) continue;
    // `opacity` does not inherit, so a layer faded out by the ink clearance (wobo/clearance.ts
    // fades Wobo's toast to 0 for the length of a turn) has to be read from above as well.
    let faded = false;
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      if (unpainted(getComputedStyle(up))) {
        faded = true;
        break;
      }
    }
    if (faded) continue;
    const box = paintedBox(el);
    if (box) boxes.push(box);
  }
  return boxes;
}

export function ChatScreen() {
  const { turns, ask, busy, setMood, hasOlder, loadOlder, offline, pending } = useWoboChat();
  const bus = useWoboBus();
  const [draft, setDraft] = useState('');
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** The last line's own text, so a say that grows sentence by sentence is followed as it grows. */
  const lastSaid = useRef('');
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
  // What the last line says right now, and whether Wobo's board is a sheet over the page. Both are
  // reasons to follow the thread down (see the layout effect below).
  const said = turns.length > 0 ? (turns[turns.length - 1]?.text ?? '') : '';
  const board = useSyncExternalStore(plane.subscribe, plane.get, plane.get);
  const sheet = board.open && !board.minimized;
  const voice = useWoboVoice({ setMood });
  const voiceOn =
    voice.status === 'listening' || voice.status === 'speaking' || voice.status === 'connecting';

  // Arrive at the newest line, instantly.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * THE NEWEST LINE STAYS IN VIEW, WHATEVER IS OVER THE PAGE (docs/INK-FOUR.md, experience; the
   * adversary, wave 47, finding 10).
   *
   * Two things were wrong. The follow ran only when the NUMBER of turns grew, and Wobo's line
   * grows in TEXT, sentence by sentence, so a say that ran past the fold was never followed. And
   * "near the bottom" was measured against the scroll height, which the phone sheet's reserve
   * (`sheetReserve`, board/plane.tsx) legitimately adds 62vh to — so the moment the board opened,
   * the reader was judged to have scrolled away and the follow stopped, leaving the sentence cut
   * in half by the sheet edge. Both are measured against the last line itself now.
   */
  /**
   * Bring Wobo's last line above whatever stands over the foot of the page, in the page's own
   * scroll. On a phone the sheet is fixed across the bottom, and so are the Tell Wobo pill, the
   * doubt camera and the tab rail — so "the bottom of the page" is under all of them; the line the
   * learner is meant to read is put just above the lowest-standing of them. Nothing is hidden, and
   * on a wide screen — where the plane is a panel beside the page and the rail is a column down the
   * left, in another column entirely — there is nothing over the line and nothing moves.
   *
   * The sheet is passed in as a reserve because it is not chrome over the page (see
   * `readingWindow`); everything else is MEASURED, because a selector list is exactly what missed
   * the pill and the camera for two waves running.
   */
  const followInPage = () => {
    if (typeof window === 'undefined') return;
    const last = (threadRef.current?.lastElementChild as HTMLElement | null) ?? null;
    if (!last) return;
    const line = last.getBoundingClientRect();
    const reserve = sheet ? window.innerHeight * (PHONE_SHEET_VH / 100) : 0;
    const { floor, ceiling } = readingWindow(
      { height: window.innerHeight, reserve },
      { left: line.left, right: line.right },
      furnitureBoxes(threadRef.current),
    );
    // Follow the foot of the line down to the floor — but never so far that a long answer's own
    // first line is pushed up under whatever stands at the head of the page. A line taller than the
    // window between them is read from its top.
    const over = Math.min(line.bottom - floor, line.top - ceiling);
    if (over > 1) window.scrollBy(0, over);
  };

  const endOfThread = (el: HTMLDivElement): { last: HTMLElement | null; bottom: number } => {
    const last = (threadRef.current?.lastElementChild as HTMLElement | null) ?? null;
    return { last, bottom: last ? last.offsetTop + last.offsetHeight : el.scrollHeight };
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { bottom } = endOfThread(el);
    if (restore.current) {
      // older turns prepended — hold the exact line the reader was on
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top;
      restore.current = null;
    } else if (turns.length > lastLen.current || said !== lastSaid.current) {
      // a new turn, or the line Wobo is speaking grew — follow it down only if the reader is
      // already near it. The reserve under the thread is not content and never counts as distance.
      const near = bottom - (el.scrollTop + el.clientHeight) < 240;
      if (near) {
        el.scrollTop = Math.max(
          0,
          Math.min(bottom + 24 - el.clientHeight, el.scrollHeight - el.clientHeight),
        );
        // On a phone this column is not a scroller — the PAGE is — so the line has to be brought
        // above the sheet in the page's own scroll. The thread already keeps the sheet's height
        // clear at its foot, so there is somewhere to scroll to.
        if (el.scrollHeight <= el.clientHeight) followInPage();
      }
    }
    lastLen.current = turns.length;
    lastSaid.current = said;
  }, [turns, said, sheet]);

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
          {/* Wobo's own name and voice controls: never on the glass map. */}
          <div className="ls-bar" data-wobo-surface="">
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
              {/* the thread is a log: every answer Wobo lands is announced where it lands.
                  WOBO'S OWN SURFACES ARE NEVER ON THE GLASS (docs/INK-FREEZE-PLAN-TRACE.md §3):
                  the mark is on the root of the transcript, so every learner bubble and every
                  reply is skipped by the read. The adversary, 2026-09-09: this screen was the one
                  Wobo's own transcript was left on, and on /chat at 390 "draw a labelled map of
                  India" made Wobo ring the learner's OWN question and say "The line that says
                  Draw a labelled map of India is this one." */}
              <div
                className="ch-thread"
                ref={threadRef}
                role="log"
                aria-label="The conversation"
                data-wobo-surface=""
              >
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
          {/* Wobo's own ask row — the input, the mic, Wobo's head: never on the glass map. */}
          <div className="ls-say ch-say" ref={sayRef} data-wobo-surface="">
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
            {/* the tools are Wobo's own; the card's words above them are the page's */}
            <div className="ls-tools" data-wobo-surface="">
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
