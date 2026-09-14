/**
 * The stylesheet for the state family — the loader and the six things that can go wrong, in the
 * hand of design/prototypes/states-v2.html, on LAW v5 (DESIGN.md §0): white paper, navy ink, Wobo
 * blue for the pen, 12px buttons with no border, 3.5px ink, no shadow on anything that does not
 * float. Every colour below is a token, so the ground moved from cream to white the moment
 * tokens.css did — there is not one literal in the sheet, and nothing here washes a scene to say
 * which state it is: the drawing says that.
 *
 * Why its own sheet and not the landing page's: these scenes are app chrome, not marketing. A 404
 * can be reached from inside a lesson and the daily-limit page can land over the board, so the
 * scene has to stand on the product's tokens alone rather than on a page shell that assumes a
 * visitor, a hero and a footer.
 *
 * Scoped under `.ws` so it cannot leak into a screen underneath.
 */

const STYLE_ID = 'wobo-states';

export const STATES_CSS = `
.ws {
  --ws-gutter: clamp(20px, 5vw, 56px);
  align-items: center;
  background: var(--paper);
  color: var(--ink);
  display: grid;
  font: 400 16px/1.5 var(--sans);
  justify-items: center;
  min-height: 100dvh;
  padding: 32px var(--ws-gutter);
  position: relative;
  width: 100%;
}
.ws *, .ws *::before, .ws *::after { box-sizing: border-box; }

/* The scene: one column, centred, nothing else on the page. DESIGN.md law 1. */
.ws-card { display: grid; justify-items: center; max-width: 560px; text-align: center; width: 100%; }
.ws-art { display: block; height: auto; overflow: visible; width: min(420px, 100%); }
.ws-h1 {
  font: 600 clamp(28px, 4vw, 40px)/1.15 var(--sans);
  letter-spacing: -0.02em;
  margin: 30px 0 10px;
  text-wrap: balance;
}
.ws-body { color: var(--ink-2); margin: 0; max-width: 42ch; text-wrap: pretty; }
.ws-tiny { color: var(--ink-3); font-size: 13px; margin: 12px 0 0; max-width: 46ch; }
.ws-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 24px; }

/* The two corners: what state this is, and whose product it is. */
.ws-code {
  color: var(--ink-3);
  font: 500 12px/1 var(--sans);
  left: var(--ws-gutter);
  letter-spacing: 0.14em;
  position: absolute;
  text-transform: uppercase;
  top: 24px;
}
.ws-mark { color: var(--ink); position: absolute; right: var(--ws-gutter); top: 22px; }
.ws-mark svg { display: block; fill: currentColor; height: 22px; width: auto; }

/* Controls. The prototype's button: 12px corners, no border, ink on paper, quiet on paper-2. */
.ws-btn {
  align-items: center;
  background: var(--ink);
  border: 0;
  border-radius: 12px;
  color: var(--paper);
  cursor: pointer;
  display: inline-flex;
  font: 500 15px/1 var(--sans);
  justify-content: center;
  min-height: 46px;
  padding: 15px 22px;
  text-decoration: none;
  transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ws-btn:hover { transform: translateY(-1px); }
.ws-btn--quiet { background: var(--paper-2); color: var(--ink); }

/* The ink itself. A path draws itself on; a group fades in behind it. */
.ws-draw {
  animation: ws-draw var(--ws-dur, 1.6s) cubic-bezier(0.5, 0, 0.2, 1) var(--ws-delay, 0s) forwards;
  stroke-dasharray: var(--ws-len, 400);
  stroke-dashoffset: var(--ws-len, 400);
}
@keyframes ws-draw { to { stroke-dashoffset: 0; } }
.ws-fade { animation: ws-fade 600ms ease var(--ws-delay, 0s) forwards; opacity: 0; }
@keyframes ws-fade { to { opacity: 1; } }

/* Each state's one moving idea. Nothing here animates chrome — every one of them is the meaning. */
.ws-sand { animation: ws-sand 4s linear 1.2s infinite; }
@keyframes ws-sand { from { transform: translateY(0); } to { transform: translateY(14px); } }
.ws-turn { animation: ws-turn 4s cubic-bezier(0.6, 0, 0.2, 1) 1.2s infinite; transform-origin: 250px 120px; }
@keyframes ws-turn { 0%, 70% { transform: rotate(0deg); } 85%, 100% { transform: rotate(180deg); } }
.ws-plane { animation: ws-plane 3.2s cubic-bezier(0.4, 0, 0.2, 1) 0.8s infinite; }
@keyframes ws-plane {
  0% { opacity: 1; transform: translate(0, 0) rotate(0deg); }
  45% { transform: translate(120px, -30px) rotate(-8deg); }
  60% { transform: translate(150px, -18px) rotate(12deg); }
  100% { opacity: 0; transform: translate(150px, 60px) rotate(40deg); }
}
.ws-spanner { animation: ws-wrench 1.6s ease-in-out 1s infinite; transform-origin: 38px 38px; }
@keyframes ws-wrench { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } }
.ws-seal { animation: ws-seal 2.4s ease 1.2s forwards; }
@keyframes ws-seal { to { opacity: 0.18; } }
.ws-spiral { animation: ws-spin 1.4s linear 1.1s 2; }
@keyframes ws-spin { to { transform: rotate(360deg); } }

/* A state that happened TO the screen the learner already had covers everything — header, Wobo,
   board — because each scene carries its own wordmark and a second one underneath reads as two
   products at once. */
.ws-full {
  background: var(--paper);
  inset: 0;
  overflow-y: auto;
  position: fixed;
  /* Above everything the app draws, header and docked Wobo included (the token scale tops out at
     1100 for toasts). A state page that let the app's own chrome show through would put two
     wordmarks and a live streak counter on a screen that is telling somebody the day is spent. */
  z-index: 1200;
}

/* The long wait for a generation: the same scene, frosted over whatever the learner was on. */
.ws-overlay {
  backdrop-filter: blur(var(--wobo-frost-blur)) saturate(1.2);
  -webkit-backdrop-filter: blur(var(--wobo-frost-blur)) saturate(1.2);
  background: var(--wobo-frost-on-paper);
  inset: 0;
  /* The download centre it is mounted from is pointer-events:none so its toasts never block the
     page; the overlay is a real surface and takes them back. */
  pointer-events: auto;
  position: fixed;
  /* Above the app's chrome, below the state family: a wait is not an outcome. */
  z-index: 1150;
}
.ws-overlay .ws { background: transparent; }

/* LAW v5 (DESIGN.md §0, "Motion that never stutters"): ONE OWNER PER ANIMATED PROPERTY. Nothing
   in this sheet is scrubbed by JS, so the .ws-btn transition on transform is that property's only
   owner; every scene animation below is a CSS keyframe and no two of them touch the same element.
   Add nothing here that a script also drives. */

/* Composed per breakpoint (WOBO-PLAN §18), never scaled down. */
@media (max-width: 600px) {
  .ws { padding-top: 64px; }
  .ws-art { width: min(300px, 100%); }
  .ws-row { flex-direction: column; width: 100%; }
  .ws-row .ws-btn { width: 100%; }
}

/* Reduced motion — the OS setting, or the app's own switch: every drawing rests finished, and
   nothing loops. The scenes still read — they were composed as still pictures first. */
@media (prefers-reduced-motion: reduce) {
  .ws-draw { animation: none; stroke-dashoffset: 0; }
  .ws-fade { animation: none; opacity: 1; }
  .ws-sand, .ws-turn, .ws-plane, .ws-spanner, .ws-spiral { animation: none; }
  .ws-seal { animation: none; opacity: 0.18; }
  .ws-btn { transition: none; }
}
:root[data-motion="reduce"] .ws-draw { animation: none; stroke-dashoffset: 0; }
:root[data-motion="reduce"] .ws-fade { animation: none; opacity: 1; }
:root[data-motion="reduce"] .ws-sand, :root[data-motion="reduce"] .ws-turn, :root[data-motion="reduce"] .ws-plane, :root[data-motion="reduce"] .ws-spanner, :root[data-motion="reduce"] .ws-spiral { animation: none; }
:root[data-motion="reduce"] .ws-seal { animation: none; opacity: 0.18; }
:root[data-motion="reduce"] .ws-btn { transition: none; }
`;

/** Inject the stylesheet once per document. Idempotent; never removed (the chunk is lazy). */
export function ensureStateStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STATES_CSS;
  document.head.appendChild(style);
}
