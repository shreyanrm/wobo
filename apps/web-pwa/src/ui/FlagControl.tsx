'use client';

/**
 * The control the help centre promised: a quiet flag, on every surface, that a child can press.
 *
 * `flag.ts` holds the reasoning and the seam; this is the thing a thumb hits. What it has to be,
 * and why each rule is here rather than in a review note:
 *
 *  - **Quiet.** A tonal button in the rail, not a red badge shouting for attention. It is the same
 *    quiet shape the kit uses everywhere else, one tonal step off the surface it sits on, with no
 *    line around it (DESIGN.md §0: surfaces separate by tone, never by a rule).
 *  - **On every screen.** `AppFrame` mounts one, so every screen behind the door has it; the full
 *    board mounts its own, because the board covers the rail. Both report what they are looking at.
 *  - **Reachable by keyboard.** A real `<button>` with `aria-expanded`, a panel that takes focus
 *    when it opens, Escape that closes it and hands focus back, and a 44px floor on every target.
 *  - **A tap is enough.** Every reason is a button that SENDS. There is no second step, no submit,
 *    and the words are a `<textarea>` a child may leave completely empty, because a child who
 *    cannot say why is exactly the child this control is for.
 *  - **It never lies about what happened.** The thank-you appears only when a row actually reached
 *    the desk. A failure says so and gives the one mailbox. Nothing anywhere says the report was
 *    scored, ranked, filed, or given a number, because none of that is built.
 */

import type { RefObject } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FLAG_COPY, FLAG_REASONS, type FlagAbout, type FlagOutcome, raiseFlag } from './flag';
import { usePhone } from './primitives/media';

/** The control's own stylesheet. `wf-` so no class here can ever mean two things (DESIGN.md §0). */
export const FLAG_CSS = `
.wf-open{font:500 14px/1 var(--sans);padding:12px 14px;min-height:44px;border:0;border-radius:10px;background:var(--paper-2);color:var(--ink-2);display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.wf-open:hover{color:var(--ink)}
.wf-open:focus-visible{outline:3px solid var(--pig);outline-offset:2px}
.wf-open svg{width:16px;height:16px;flex:none}
/* Above the phone's tab bar, and above the save-trouble strip when that is up: --wst-height is
   the strip's own measured height (store/SaveTrouble.tsx), 0 when there is no strip. */
.wf-float{position:fixed;left:12px;bottom:calc(84px + var(--wst-height,0px) + env(safe-area-inset-bottom));z-index:900}
.wf-corner{position:absolute;right:16px;top:16px;z-index:2}
.wf-panel{position:fixed;left:20px;bottom:20px;width:min(320px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 40px));overflow:auto;z-index:1000;display:grid;gap:12px;padding:20px;border-radius:24px;background:var(--paper-2);box-shadow:var(--shadow)}
.wf-panel.wf-at-top{left:auto;bottom:auto;right:16px;top:16px}
.wf-panel h2{font:600 17px/1.25 var(--sans);color:var(--ink);margin:0}
.wf-panel p{font:400 14px/1.5 var(--sans);color:var(--ink-2);margin:0}
.wf-reasons{display:grid;gap:6px}
.wf-reason{font:500 15px/1.3 var(--sans);text-align:left;padding:12px 14px;min-height:44px;border:0;border-radius:10px;background:var(--paper);color:var(--ink);cursor:pointer}
.wf-reason:hover{background:var(--paper-3)}
.wf-reason:focus-visible{outline:3px solid var(--pig);outline-offset:2px}
.wf-reason:disabled{cursor:progress;color:var(--ink-3)}
.wf-note{font:400 15px/1.4 var(--sans);color:var(--ink);background:var(--paper);border:0;border-radius:10px;padding:12px;min-height:76px;resize:vertical;width:100%}
.wf-note:focus-visible{outline:3px solid var(--pig);outline-offset:2px}
.wf-note-label{font:500 13px/1.3 var(--sans);color:var(--ink-3);display:grid;gap:6px}
.wf-said{font:400 15px/1.5 var(--sans);color:var(--ink);margin:0}
.wf-close{font:500 14px/1 var(--sans);padding:12px 16px;min-height:44px;border:0;border-radius:10px;background:var(--paper);color:var(--ink);cursor:pointer;justify-self:start}
.wf-close:focus-visible{outline:3px solid var(--pig);outline-offset:2px}
`;

/** Mounted with the control. Rendering the same text twice is free; the browser dedupes it. */
export function FlagStyle() {
  return <style>{FLAG_CSS}</style>;
}

/** A small flag, drawn in the ink of whatever it sits on. Decorative: the button carries the name. */
function FlagGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.5 14V2.6c2.6-1 5.2 1 7.8 0v6.2c-2.6 1-5.2-1-7.8 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface FlagPanelProps {
  id: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  firstRef?: RefObject<HTMLButtonElement | null>;
  /** Pinned to the top corner instead of the bottom one, for a surface that covers the shell. */
  atTop?: boolean;
  busy: boolean;
  /** Set once the desk has answered, one way or the other. Until then the reasons are on screen. */
  outcome: FlagOutcome | null;
  note: string;
  onNote: (note: string) => void;
  onReason: (code: string) => void;
  onClose: () => void;
}

/**
 * What the panel says, with no state of its own, so every word and every attribute in it can be
 * read by a test that has no browser.
 *
 * The shape of it is the promise: six reasons, each of them a button that finishes the job on its
 * own; a textarea that is never required and never asked about again; and, once the desk has
 * answered, nothing but that answer and a way out. No stars, no severity, no "how bad was it", no
 * confirmation step, and no second question. A child who taps once has reported something.
 */
export function FlagPanel(props: FlagPanelProps) {
  const { busy, outcome } = props;
  return (
    <div
      ref={props.panelRef}
      id={props.id}
      className={props.atTop ? 'wf-panel wf-at-top' : 'wf-panel'}
      role="dialog"
      aria-label={FLAG_COPY.title}
    >
      {outcome ? (
        <>
          {/* The answer, and only ever the true one: the desk's own sentence when it took the
              report, the honest failure when it did not. */}
          <p className="wf-said" aria-live="polite">
            {outcome.message}
          </p>
          <button type="button" className="wf-close" onClick={props.onClose}>
            {FLAG_COPY.close}
          </button>
        </>
      ) : (
        <>
          <h2>{FLAG_COPY.title}</h2>
          <p>{FLAG_COPY.invite}</p>
          <div className="wf-reasons">
            {FLAG_REASONS.map((reason, i) => (
              <button
                key={reason.code}
                ref={i === 0 ? props.firstRef : undefined}
                type="button"
                className="wf-reason"
                data-flag-reason={reason.code}
                disabled={busy}
                onClick={() => props.onReason(reason.code)}
              >
                {reason.label}
              </button>
            ))}
          </div>
          <label className="wf-note-label">
            {FLAG_COPY.noteLabel}
            <textarea
              className="wf-note"
              value={props.note}
              maxLength={2000}
              placeholder={FLAG_COPY.notePlaceholder}
              onChange={(e) => props.onNote(e.target.value)}
            />
          </label>
          <p aria-live="polite">{busy ? FLAG_COPY.sending : ''}</p>
        </>
      )}
    </div>
  );
}

export interface FlagControlProps {
  /** What is on screen: the pointers the surface mounting this knows about itself. */
  about?: FlagAbout;
  /**
   * Where it sits. `rail` is the shell's copy, which floats itself above the tab bar on a phone
   * because the rail's bottom slot is hidden there; `corner` is a copy pinned inside a surface
   * that covers the shell, such as the full board.
   */
  placement?: 'rail' | 'corner';
  /** Test seam: the same injection `flag.raiseFlag` takes. */
  send?: typeof raiseFlag;
}

export function FlagControl({ about, placement = 'rail', send = raiseFlag }: FlagControlProps) {
  const phone = usePhone();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FlagOutcome | null>(null);
  const [note, setNote] = useState('');
  const openRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  /** Close, and put focus back where the learner left it. A panel that eats focus is a trap. */
  const close = useCallback(() => {
    setOpen(false);
    setOutcome(null);
    setNote('');
    setBusy(false);
    openRef.current?.focus();
  }, []);

  // Escape closes from anywhere inside the panel, and a press outside it closes too: a child who
  // opened this by accident must be able to get out of it without reading anything.
  //
  // It listens in the CAPTURE phase and stops the event there, because the full board has its own
  // window-level Escape (`wobo/Stage.tsx`, which leaves the full board for the plane). Sharing the
  // bubble phase with it would mean one press both closed this panel and collapsed the board out
  // from under the thing the child was flagging. The innermost thing wins, which is what Escape
  // means everywhere else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || openRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  // The panel takes focus when it opens, so a keyboard reaches the reasons without hunting.
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  const raise = async (reason: string) => {
    if (busy) return;
    setBusy(true);
    const result = await send({
      reason,
      ...(note.trim() ? { note } : {}),
      ...(about ? { about } : {}),
    });
    setBusy(false);
    setOutcome(result);
  };

  const trigger = (
    <button
      ref={openRef}
      type="button"
      className="wf-open"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? panelId : undefined}
      aria-label={FLAG_COPY.openHint}
      onClick={() => (open ? close() : setOpen(true))}
    >
      <FlagGlyph />
      {FLAG_COPY.open}
    </button>
  );

  const panel = open ? (
    <FlagPanel
      id={panelId}
      panelRef={panelRef}
      firstRef={firstRef}
      atTop={placement === 'corner'}
      busy={busy}
      outcome={outcome}
      note={note}
      onNote={setNote}
      onReason={(code) => void raise(code)}
      onClose={close}
    />
  ) : null;

  // On a phone the rail becomes the tab bar and its bottom slot is hidden, so the shell's copy
  // lifts itself out to the body and floats clear of the bar. Everywhere else it stays where it
  // was mounted. The panel is fixed either way, so it is never clipped by the rail it grew from.
  const body = (
    <>
      <FlagStyle />
      {trigger}
      {panel}
    </>
  );
  if (placement === 'rail' && phone && typeof document !== 'undefined') {
    return createPortal(<div className="wf-float">{body}</div>, document.body);
  }
  return placement === 'corner' ? <div className="wf-corner">{body}</div> : <div>{body}</div>;
}
