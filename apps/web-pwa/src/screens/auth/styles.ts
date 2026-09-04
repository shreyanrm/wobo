/**
 * THE doors' own stylesheet, ported from design/prototypes/app-auth.html.
 *
 * It is a sheet of its own, injected once, rather than rules added to the site sheet: the two doors
 * are the only surface in the product that wears this chrome (a bar with the run in it, two columns,
 * a ruled line instead of a field) and the site sheet belongs to another wave's file.
 *
 * Every class is namespaced `au-`. That is not tidiness, it is trap 1 in DESIGN.md §0: `.sub`,
 * `.quiet` and `.ask` each meant one thing in a shell and another in a section, and each printed a
 * stray box. Nothing in this sheet is a word short enough to mean two things.
 *
 * What the sheet has to get right, in the owner's order:
 *
 *  · TWO COLUMNS on desktop, stacking below 900. Wobo and what Wobo says on the left, the thing you
 *    do on the right, because the page is a conversation with a character.
 *  · THE FIELD IS A RULED LINE. Transparent input, a 3px rule under it that is neutral at rest and
 *    takes the pigment when focused, drawn across with a scaleX transform from the left. No box, no
 *    beige slab, no placeholder doing the work a label should do.
 *  · ONE saturated thing on the page — `.au-go`, the primary action. Providers are white surfaces
 *    that lift on a soft shadow, so they read as buttons on white paper with no border line.
 *  · A door that is not open keeps its shape and carries the `soon` chip. Never a dead grey slab.
 *
 * Law v5 (DESIGN.md §0): white ground, no border line anywhere, no corner under 10px, colour only
 * where it has a job, every value a token from `src/ui/tokens.css`. Nothing here transitions a
 * layout property and nothing is parked at `opacity:0` waiting for a scroll, so the first paint is
 * the page at rest and nothing can stutter.
 */

const STYLE_ID = 'wobo-auth';

export const AUTH_CSS = `
/* --- the page ---------------------------------------------------------------------------------- */
.au{min-height:100vh;display:grid;grid-template-rows:auto 1fr;padding-bottom:var(--s5);background:var(--paper);color:var(--ink);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:clip}
.au h1,.au h2{margin:0;letter-spacing:-.025em;text-wrap:balance}
.au p{margin:0}
.au :where(a){color:inherit;text-decoration:none}
.au-wrap{width:min(1080px,calc(100% - 2*var(--gutter)));margin:0 auto}
.au-skip{position:fixed;left:12px;top:-80px;z-index:60;background:var(--paper-2);color:var(--ink);padding:12px 16px;border-radius:12px;transition:top 140ms ease}
.au-skip:focus{top:12px}

/* --- the bar: the name, where you are in the run, and the other door -------------------------- */
.au-top{padding:var(--s3) 0}
.au-top .au-wrap{display:flex;align-items:center;gap:var(--s3)}
.au-mark{display:block;flex:0 0 auto}
.au-mark svg{height:22px;width:96px;color:var(--ink);display:block}
.au-steps{display:flex;gap:6px;margin:0 auto}
.au-steps i{width:22px;height:5px;border-radius:3px;background:var(--paper-3);display:block}
.au-steps i.au-on{width:34px;background:var(--pig)}
.au-other{font:500 14px/1 var(--sans);color:var(--ink-2);display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:44px;margin-left:auto}
.au-other b{color:var(--ink);white-space:nowrap}
.au-other.au-doorbtn{background:var(--paper-2);padding:12px 18px;border-radius:12px;color:var(--ink);font-weight:600}

/* --- the two halves: what Wobo says, and what you do ------------------------------------------ */
.au-body{display:grid;place-items:center}
.au-grid{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(0,.98fr);gap:var(--colgap);align-items:center;width:100%}
.au-say{min-width:0;display:grid;gap:var(--s3);justify-items:start}
.au-who{display:flex;align-items:flex-start;gap:14px;max-width:100%}
.au-face{flex:0 0 auto}
.au-bubble{position:relative;background:var(--paper-2);border-radius:16px;padding:12px 18px;font:600 21px/1.25 var(--hand);color:var(--ink);margin-top:14px;text-wrap:balance}
.au-bubble::before{content:"";position:absolute;left:-7px;top:18px;width:14px;height:14px;background:var(--paper-2);transform:rotate(45deg);border-radius:3px}
.au-say h1{font:600 clamp(30px,4vw,46px)/1.06 var(--sans);max-width:15ch}
.au-lede{color:var(--ink-2);max-width:38ch;text-wrap:pretty}

/* --- the act ----------------------------------------------------------------------------------- */
.au-act{min-width:0;display:grid;gap:var(--s2);align-content:center}
.au-act form{display:grid;gap:var(--s2)}
.au-lab{font:500 12px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}

/* THE FIELD. Not a box: a line you write on, which is what this product is. The rule beneath takes
   the pigment and draws itself across when you focus it, so the place your attention is going is
   the place the ink goes. A keyboard visitor also gets the standard marigold ring, because a
   colour change on a 3px rule is a weak indicator on its own. */
.au-field{position:relative;display:flex;align-items:center;gap:12px;padding:6px 2px 14px}
.au-field>svg{width:22px;height:22px;flex:0 0 auto;color:var(--ink-3);fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;transition:color .2s}
.au-field input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:400 20px/1.4 var(--sans);padding:6px 0;outline:none}
.au-field input::placeholder{color:var(--ink-3)}
.au-field::before{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:2px;background:var(--paper-3)}
.au-field::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:2px;background:var(--pig);transform:scaleX(0);transform-origin:left;transition:transform .38s cubic-bezier(.2,.8,.2,1)}
.au-field:focus-within::after{transform:scaleX(1)}
.au-field:focus-within>svg{color:var(--pig)}
.au-field:has(input:focus-visible){outline:3px solid var(--marigold);outline-offset:6px;border-radius:12px}
.au-field[data-invalid="true"]::before{background:var(--rose)}
.au-field[data-invalid="true"]>svg{color:var(--rose)}

/* --- the buttons: one saturated thing, and white objects that float --------------------------- */
.au-btn{font:600 16px/1 var(--sans);border:0;border-radius:14px;min-height:56px;padding:16px 20px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;text-align:left;transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s}
.au-btn:focus-visible{outline:3px solid var(--marigold);outline-offset:3px}
.au :where(a):focus-visible{outline:3px solid var(--marigold);outline-offset:3px;border-radius:12px}
.au-go{background:var(--pig);color:#fff;box-shadow:0 10px 24px rgba(43,69,255,.28)}
.au-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 14px 30px rgba(43,69,255,.34)}
.au-go:active:not(:disabled){transform:translateY(0)}
.au-go:disabled{cursor:progress;opacity:.62}
.au-prov{background:var(--paper);color:var(--ink);box-shadow:var(--lift);font-weight:500}
.au-prov:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.au-prov>svg{width:20px;height:20px;flex:0 0 auto}
.au-prov[aria-disabled="true"]{cursor:default;color:var(--ink-3);box-shadow:none;background:var(--paper-2)}
.au-prov[aria-disabled="true"]:hover{transform:none;box-shadow:none}
/* Night is designed, never inverted (DESIGN.md §2). A provider is a white object floating on white
   paper by day; at night the paper token IS the ground, so the button would vanish and only its
   shadow would remain — a shadow that is itself nearly invisible on black. It lifts a step
   instead, and the door that is not open yet drops a step, so the two never read as one thing. */
[data-theme="dark"] .au-prov{background:var(--paper-3)}
[data-theme="dark"] .au-prov[aria-disabled="true"]{background:var(--paper-2)}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .au-prov{background:var(--paper-3)}
  :root:not([data-theme="light"]) .au-prov[aria-disabled="true"]{background:var(--paper-2)}
}
.au-quiet{background:var(--paper-2);color:var(--ink);font-weight:500;min-height:48px}
.au-soon{margin-left:auto;font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;background:var(--marigold-w);color:#5A3B00;padding:6px 9px;border-radius:999px}
[data-theme="dark"] .au-soon{color:var(--marigold)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .au-soon{color:var(--marigold)}}

/* --- the rule with a word in it, drawn only when both sides have something -------------------- */
.au-or{display:flex;align-items:center;gap:14px;color:var(--ink-3);font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;margin:2px 0}
.au-or::before,.au-or::after{content:"";flex:1;height:3px;background:var(--paper-3);border-radius:2px}

/* --- what is said in small print, what went wrong, and what a parent is told ------------------ */
.au-fine{color:var(--ink-3);font-size:14px;max-width:42ch}
/* The standing legal line. Quiet, but never hidden: a person is entitled to read what they are
   agreeing to from where they stand, and these two pages carry their own chrome rather than the
   site footer that used to hold it. */
.au-legal{margin:var(--s4) 0 0;color:var(--ink-3);font-size:13px;text-align:center}
.au-legal a{color:var(--ink-2);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
.au-legal a:focus-visible{outline:3px solid var(--marigold);outline-offset:2px}
.au-fine a{color:var(--ink-2);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
.au-error{background:var(--rose-w);border-radius:14px;padding:12px 16px;font-size:15px;color:var(--ink)}
.au-parent{background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:10px}
.au-parent h2{font:600 17px/1.25 var(--sans)}
.au-parent p{font-size:15px;color:var(--ink-2)}
.au-consent{display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start;font-size:14px;color:var(--ink-2);padding:12px;border-radius:14px;background:var(--paper-2)}
.au-consent a{color:var(--ink);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
.au-consent>input[type=checkbox]{appearance:none;-webkit-appearance:none;width:44px;height:44px;margin:-11px 0 -11px -11px;padding:0;background:transparent;cursor:pointer;display:grid;grid-template-areas:'box';place-items:center}
.au-consent>input[type=checkbox]::before{content:'';grid-area:box;width:22px;height:22px;border-radius:10px;background:var(--paper-3)}
.au-consent>input[type=checkbox]:checked::before{background:var(--pig)}
.au-consent>input[type=checkbox]::after{content:'';grid-area:box;width:14px;height:14px;background:var(--paper);clip-path:polygon(14% 44%,0 58%,38% 96%,100% 34%,86% 20%,38% 68%);opacity:0}
.au-consent>input[type=checkbox]:checked::after{opacity:1}
.au-consent>input[type=checkbox]:focus-visible{outline:3px solid var(--marigold);outline-offset:-8px;border-radius:14px}
/* The tick that is the thing in the way. Marked the same way a field is (a rose mark AND the
   sentence beside it, never colour alone), and only when the error is ABOUT this box: one error
   string used to paint the phone field invalid because the terms had not been agreed to. */
.au-consent[data-invalid="true"]>input[type=checkbox]::before{background:var(--rose)}

/* --- three widths, one rhythm ------------------------------------------------------------------ */
@media (max-width:900px){
  .au-grid{grid-template-columns:1fr;gap:var(--s4)}
  .au-say h1{font-size:clamp(27px,7vw,34px)}
  .au-top .au-wrap{gap:var(--s2)}
  .au-steps{margin:0 auto 0 0}
}
@media (max-width:640px){
  /* The lead-in is a courtesy, not information: below 640 the bar keeps the name, the run, and the
     one word that is the link. */
  .au-lead{display:none}
  .au-steps i{width:16px}
  .au-steps i.au-on{width:26px}
  .au-bubble{font-size:19px}
}
@media (prefers-reduced-motion:reduce){.au *{animation:none!important;transition:none!important}}
`;

/** Put the sheet in the document once. Idempotent, and a no-op where there is no document. */
export function ensureAuthStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = AUTH_CSS;
  document.head.appendChild(tag);
}
