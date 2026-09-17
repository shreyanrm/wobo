/**
 * The parent's home, drawn to law v5 (DESIGN.md §0): white paper, no border line, no corner under
 * 10px, every value a token, and one pigment per view. The pigment is the door a parent most often
 * wants, asking Wobo about their child; the other three are white surfaces on paper-2.
 *
 * Namespaced `pa-` so nothing here can mean something else in another sheet. Injected once, when
 * the chunk arrives, like the doors' own sheet. The door itself wears the doors' sheet (`au-`),
 * because it IS one of the doors.
 *
 * Three widths are the contract: 390, 834, 1440, in both themes, with no horizontal scroll. The
 * doors are one column on a phone and two from 720 up; nothing transitions a layout property.
 */

const STYLE_ID = 'wobo-parent';

export const PARENT_CSS = `
.pa{min-height:100vh;background:var(--paper);color:var(--ink);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:clip;padding-bottom:var(--s5)}
.pa h1,.pa h2,.pa p{margin:0}
.pa h1,.pa h2{letter-spacing:-.025em;text-wrap:balance}
.pa :where(a){color:inherit;text-decoration:none}
.pa-wrap{width:min(960px,calc(100% - 2*var(--gutter)));margin:0 auto}
.pa-skip{position:fixed;left:12px;top:-80px;z-index:60;background:var(--paper-2);color:var(--ink);padding:12px 16px;border-radius:12px}
.pa-skip:focus{top:12px}

.pa-top{padding:var(--s3) 0}
.pa-top .pa-wrap{display:flex;align-items:center;justify-content:space-between;gap:var(--s2)}
.pa-mark{display:block;flex:0 0 auto;min-height:44px;display:flex;align-items:center}
.pa-mark svg{height:22px;width:96px;color:var(--ink);display:block}

.pa-body{padding-top:clamp(16px,4vw,48px)}
.pa-hello{font:500 15px/1.4 var(--sans);color:var(--ink-2)}
.pa .pa-name{margin-top:var(--s2);font:700 clamp(38px,7vw,64px)/1.02 var(--sans)}
.pa-privacy{margin-top:12px;color:var(--ink-2);max-width:52ch}

.pa-switch{display:flex;flex-direction:column;align-items:flex-start;gap:var(--s1);margin:var(--s3) 0 0;padding:0;border:0;min-inline-size:0}
.pa-switch>legend{padding:0;margin-bottom:var(--s1);font:500 13px/1.3 var(--sans);color:var(--ink-3)}
.pa-switch .wk-seg{flex-wrap:wrap;max-width:100%}
.pa-switch .wk-seg button{min-height:44px;padding:10px 18px;font-size:15px}

.pa-doors{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;grid-template-columns:1fr;gap:var(--s2)}
@media (min-width:720px){.pa-doors{grid-template-columns:1fr 1fr}}
.pa-door{appearance:none;border:0;font:inherit;text-align:left;width:100%;height:100%;display:grid;grid-template-columns:auto 1fr;align-items:start;gap:var(--s2);padding:var(--s3);border-radius:20px;background:var(--paper-2);color:var(--ink);cursor:pointer;min-height:112px}
.pa-door:hover{background:var(--paper-3)}
.pa-door:focus-visible{outline:3px solid var(--pig);outline-offset:3px}
.pa-door b{display:block;font:600 19px/1.25 var(--sans);letter-spacing:-.01em}
.pa-door.pa-solo{align-items:center;min-height:88px}
.pa-door span.pa-line{display:block;margin-top:6px;color:var(--ink-2);font-size:15px}
.pa-door svg{width:40px;height:40px;border-radius:12px;padding:9px;background:var(--paper);color:var(--ink)}
.pa-door.pa-first{background:var(--pig);color:var(--paper)}
.pa-door.pa-first:hover{background:var(--pig);filter:brightness(1.06)}
.pa-door.pa-first span.pa-line{color:inherit;opacity:.88}
.pa-door.pa-first svg{background:color-mix(in srgb,var(--paper) 16%,transparent);color:inherit}
.pa-door.pa-first:focus-visible{outline-color:var(--marigold)}
.pa-door[aria-disabled="true"]{cursor:default;color:var(--ink-2)}
.pa-door[aria-disabled="true"]:hover{background:var(--paper-2)}
.pa-door[aria-disabled="true"].pa-first{background:var(--paper-2);color:var(--ink-2)}
.pa-door[aria-disabled="true"].pa-first span.pa-line{color:var(--ink-3);opacity:1}
.pa-door[aria-disabled="true"].pa-first svg{background:var(--paper);color:var(--ink-2)}
.pa-soon{display:inline-block;margin-left:8px;vertical-align:2px;font:600 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:5px 8px;border-radius:999px;background:var(--paper-3);color:var(--ink-2)}

.pa-more{margin-top:var(--band);display:grid;gap:var(--s2);max-width:60ch}
.pa-more h2{font:600 22px/1.25 var(--sans)}
.pa-more p{color:var(--ink-2)}
.pa-more .wk-btn{justify-self:start}
.pa-none{display:grid;gap:var(--s2);max-width:60ch;margin-top:var(--s2)}
.pa-none h1{font:700 clamp(30px,5vw,44px)/1.1 var(--sans)}
.pa-none p{color:var(--ink-2)}
.pa-none .wk-btn{justify-self:start;margin-top:var(--s1)}
.pa-note{color:var(--ink-2);font-size:15px}
.pa-wait{margin-top:var(--s4);color:var(--ink-2)}

.pa-gone{display:grid;gap:var(--s2);max-width:56ch;margin-top:var(--s4)}
.pa-gone h1{font:700 clamp(30px,5vw,44px)/1.1 var(--sans)}
.pa-gone p{color:var(--ink-2)}
.pa-gone .wk-btn{justify-self:start}

@media (prefers-reduced-motion:no-preference){
  .pa-door{transition:background-color 160ms ease}
}
`;

export function ensureParentStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PARENT_CSS;
  document.head.appendChild(style);
}
