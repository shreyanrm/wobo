/**
 * The landing page's stylesheet — the prototype's own CSS, ported and scoped.
 *
 * This is a PORT, not a rewrite. Every colour, radius, alpha, easing and breakpoint below is the
 * one in `design/prototypes/landing-v8.html` — the page Fable handcrafted for law v5 and the owner
 * approved — because a "tidier" number here is a different page. What was edited on the way in is
 * written out above `LANDING_CSS` itself, and it is four things: scope, tokens, self-hosted fonts,
 * and `overflow-x: clip` in place of `hidden`.
 */

import { fontFamily } from '@wobo/config';

const STYLE_ID = 'wobo-landing-v8';

/** The class every rule in this sheet, and every element on the page, hangs off. */
export const ROOT = 'wb';

/**
 * DESIGN.md's two faces, self-hosted. Poppins 400/500/600/700 and Caveat 400–700 are the exact
 * binaries the prototype pulled from the font CDN, served from our own origin out of
 * `public/fonts/` — so the page sets in the type the owner approved, and no request leaves us.
 * The app's bundled stack stays behind each as the fallback while the face is swapping in.
 *
 * Subsetted to latin + latin-ext, split by weight, `font-display:swap`: the latin-ext files never
 * download for English copy, and nothing here blocks first paint.
 */
const SANS = `'Poppins', ${fontFamily.system}`;
const HAND = `'Caveat', ${fontFamily.handwritten}`;

/** @font-face for every face above, generated from the CDN's own css2 response (weights + ranges). */
const FACES = `@font-face{font-family:'Caveat';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/Caveat-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Caveat';font-style:normal;font-weight:400 700;font-display:swap;src:url(/fonts/Caveat-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Poppins';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/Poppins-400-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Poppins';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/Poppins-400-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Poppins';font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/Poppins-500-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Poppins';font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/Poppins-500-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Poppins';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/Poppins-600-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Poppins';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/Poppins-600-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Poppins';font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/Poppins-700-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF}
@font-face{font-family:'Poppins';font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/Poppins-700-latin.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}`;

/**
 * The page, exactly as `design/prototypes/landing-v8.html` sets it, with four edits made on the way
 * in and no others:
 *
 *  1. SCOPE. The prototype owned the document, so it styled `body`, `header`, `section`, `.btn`.
 *     Every rule here hangs off `.${ROOT}` so nothing leaks into a product screen. The prototype's
 *     own class names and ids are kept EXACTLY, because `engine/**` is a port of the same file's
 *     script and finds its elements by them.
 *  2. TOKENS. `:root` became `.${ROOT}` and `[data-theme="dark"]` became `[data-theme="dark"]
 *     .${ROOT}` — the app writes `data-theme` on the document root, so night is free.
 *  3. FONTS. The prototype pulled Poppins and Caveat from a font CDN. Nothing in this app reaches a
 *     CDN for a face, so both are self-hosted out of `public/fonts/` (see `FACES` above).
 *  4. `overflow-x: clip`, not `hidden`. `hidden` makes the element a scroll container, and a scroll
 *     container that is not the scroller kills `position: sticky` on its children — which is the
 *     whole header. `clip` clips without that side effect.
 *
 * Law v5 is visible in what is NOT here: no tinted section grounds, no border box on a card, and
 * `--line` used only where the prototype uses it — the rail's tick, a pill's edge, the safe list's
 * row separator, and the two floating panels' 1px hairline.
 */
export const LANDING_CSS = `${FACES}

/* ── LAW v5 ────────────────────────────────────────────────────────────────────
   White paper. Ink. Colour only where it does a job: the accent that points, the
   highlighter that marks, the tick that confirms. No tinted section grounds. */
.${ROOT}{
  --paper:#FFFFFF; --paper-2:#F6F6F8; --paper-3:#ECECF0; --line:#E4E4EA;
  --ink:#14142B; --ink-2:#55556B; --ink-3:#8A8A9E;
  --pig:#2B45FF; --pig-soft:#EDF0FF; --marigold:#FFB629; --rose:#FF6B57; --mint:#12B981; --violet:#7C5CFF;
  --body:#14142B; --body-hi:#3A3A5C; --visor:#FFFFFF; --visor-lo:#EDEDF2; --eye:#2B45FF;
  --sans:${SANS}; --hand:${HAND};
  --s1:8px; --s2:16px; --s3:24px; --s4:40px; --s5:72px; --s6:128px;
  /* one vertical rhythm for the whole page, tied to the viewport so a phone never
     inherits a desktop's air and a wide screen never feels cramped */
  --gutter:clamp(20px, 5vw, 48px);
  --band:clamp(96px, 11vw, 184px);      /* space between one section and the next */
  --colgap:clamp(32px, 5vw, 80px);     /* space between the two halves of a row   */
  --shadow:0 24px 60px rgba(20,20,43,.10); --lift:0 10px 28px rgba(20,20,43,.07);
}
[data-theme="dark"] .${ROOT}{
  --paper:#0E0E16; --paper-2:#17171F; --paper-3:#1F1F29; --line:#26262F;
  --ink:#F4F4F7; --ink-2:#B4B4C2; --ink-3:#7E7E90;
  --pig:#7C8CFF; --pig-soft:#1A1E3A; --marigold:#FFC85A; --rose:#FF8A78; --mint:#3DD9A4; --violet:#A996FF;
  --body:#F4F4F7; --body-hi:#FFFFFF; --visor:#0E0E16; --visor-lo:#1F1F29; --eye:#7C8CFF;
  --shadow:0 24px 60px rgba(0,0,0,.5); --lift:0 10px 28px rgba(0,0,0,.35);
}
.${ROOT} *,.${ROOT} *::before,.${ROOT} *::after{box-sizing:border-box;min-width:0}
.${ROOT}{background:var(--paper);color:var(--ink);font:400 17px/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:clip}
.${ROOT} a{color:inherit;text-decoration:none}
.${ROOT} h1,.${ROOT} h2,.${ROOT} h3{margin:0;letter-spacing:-.028em;text-wrap:balance}
.${ROOT} p{margin:0}
.${ROOT} .hand{font-family:var(--hand);font-weight:600}
.${ROOT} .wrap{width:min(1180px,calc(100% - var(--gutter) * 2));margin:0 auto}
.${ROOT} .eyebrow{font:500 12px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.${ROOT} .eyebrow b{color:var(--pig);font-weight:500}
.${ROOT} section{padding:calc(var(--band) / 2) 0;position:relative;scroll-margin-top:96px}
.${ROOT} h2.t{font:700 clamp(30px,3.8vw,50px)/1.06 var(--sans)}
/* The highlighter is painted ON the span, not behind it, so a long phrase wraps like
   any other text instead of forcing the page sideways. box-decoration-break makes the
   mark continue onto the next line the way a real highlighter would. */
.${ROOT} h2.t .hl{
  background-image:linear-gradient(color-mix(in srgb,var(--marigold) 46%,transparent),color-mix(in srgb,var(--marigold) 46%,transparent));
  background-repeat:no-repeat;background-position:0 50%;background-size:0% 92%;
  -webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 .06em;margin:0 -.06em;border-radius:4px;
}
.${ROOT} h2.t .hl.lit{background-size:100% 92%;transition:background-size .72s cubic-bezier(.2,.8,.2,1)}
.${ROOT} .lede{font-size:clamp(16px,1.15vw,19px);color:var(--ink-2);max-width:46ch;margin-top:var(--s3)}

/* buttons — magnet is a translate on an INNER span, so the hit box never moves */
.${ROOT} .btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font:500 15px/1 var(--sans);min-height:50px;padding:0 24px;border-radius:14px;border:0;cursor:pointer;
  background:var(--ink);color:var(--paper);overflow:hidden;isolation:isolate}
/* ONE OWNER PER ANIMATED PROPERTY (DESIGN.md §0, cause 1). The magnet's rAF lerp is the only thing
   that writes this transform, so there is no CSS transition on it to ease toward a value the loop
   has already moved past. */
.${ROOT} .btn > span{display:inline-flex;align-items:center;gap:8px;will-change:transform}
.${ROOT} .btn.pig{background:var(--pig);color:#fff}
.${ROOT} .btn.quiet{background:var(--paper-2);color:var(--ink)}
.${ROOT} .btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 2px var(--line)}
.${ROOT} .btn::after{content:"";position:absolute;inset:0;background:currentColor;opacity:0;transition:opacity .25s;z-index:-1}
.${ROOT} .btn:hover::after{opacity:.08}
.${ROOT} .btn:focus-visible{outline:3px solid var(--marigold);outline-offset:3px}
/* The prototype sets outline:none on its one text field and never puts it back, which leaves the
   only place a visitor types as the one control a keyboard reader cannot see themselves land on.
   The ring paints on :focus-visible only, so nothing about the page as approved changes. */
.${ROOT} a:focus-visible,.${ROOT} button:focus-visible,.${ROOT} summary:focus-visible,.${ROOT} input:focus-visible{outline:3px solid var(--marigold);outline-offset:3px}

/* header — simple, real routes */
.${ROOT} header{position:sticky;top:0;z-index:60;background:color-mix(in srgb,var(--paper) 86%,transparent);backdrop-filter:blur(14px) saturate(1.4)}
.${ROOT} header .bar{display:flex;align-items:center;gap:var(--s4);height:74px}
.${ROOT} header .wm svg{height:22px;width:auto;color:var(--ink);display:block}
.${ROOT} header nav{display:flex;gap:var(--s3);margin-left:var(--s2)}
.${ROOT} header nav a{font:500 15px/1 var(--sans);color:var(--ink-2);padding:8px 0;position:relative}
.${ROOT} header nav a::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--pig);border-radius:2px;transform:scaleX(0);transform-origin:left;transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.${ROOT} header nav a:hover{color:var(--ink)}
.${ROOT} header nav a:hover::after{transform:scaleX(1)}
.${ROOT} header .right{margin-left:auto;display:flex;align-items:center;gap:var(--s2)}
.${ROOT} header .right .sign{font:500 15px/1 var(--sans);color:var(--ink-2)}
.${ROOT} header .btn{min-height:44px;padding:0 20px;border-radius:12px;font-size:14px}
@media (max-width:980px){.${ROOT} header nav{display:none}.${ROOT} header .right .sign{display:none}}

/* hero */
.${ROOT} #hero{padding:clamp(32px,5vw,64px) 0 calc(var(--band) / 2);overflow:visible}
.${ROOT} #hero .grid{display:grid;grid-template-columns:1.02fr .98fr;gap:var(--colgap);align-items:center;min-height:min(76vh,720px)}
.${ROOT} #hero h1{font:700 clamp(40px,5.4vw,68px)/1.0 var(--sans);letter-spacing:-.04em;margin-top:var(--s2)}
.${ROOT} #hero h1 .wake{display:block;font-family:var(--hand);font-weight:700;font-size:.62em;color:var(--pig);letter-spacing:0;margin-bottom:.08em}
.${ROOT} #hero .cta{display:flex;gap:12px;margin-top:var(--s4);flex-wrap:wrap;align-items:center}
.${ROOT} #hero .under{display:flex;gap:var(--s3);margin-top:var(--s3);flex-wrap:wrap;color:var(--ink-3);font-size:14px}
.${ROOT} #hero .under span{display:inline-flex;align-items:center;gap:8px}
.${ROOT} #hero .under i{width:7px;height:7px;border-radius:50%;background:var(--mint)}
@media (max-width:980px){
  .${ROOT} #hero .grid{grid-template-columns:1fr;gap:var(--s4)}
  .${ROOT} #hero .stagewrap{max-width:560px}
  .${ROOT} #hero h1{font-size:clamp(34px,8vw,52px)}
}

/* the device: one question, answered four ways */
.${ROOT} .device{position:relative;border-radius:26px;background:var(--paper);box-shadow:var(--shadow);padding:14px;border:1px solid var(--line)}
.${ROOT} .device .top{display:flex;align-items:center;gap:10px;padding:4px 8px 12px;font-size:13px;color:var(--ink-3)}
.${ROOT} .device .top b{color:var(--ink-2);font-weight:500}
.${ROOT} .device .top .live{margin-left:auto;display:inline-flex;align-items:center;gap:6px;color:var(--rose);font-size:12px}
.${ROOT} .device .top .live i{width:7px;height:7px;border-radius:50%;background:var(--rose)}
.${ROOT} .device .stage{position:relative;border-radius:18px;background:var(--paper-2);height:clamp(320px,42vw,420px);overflow:hidden}
.${ROOT} .device .stage > div{position:absolute;inset:0;opacity:0;display:grid;place-items:center}
.${ROOT} .device .stage > div.on{opacity:1}
.${ROOT} .device .rail{display:flex;gap:8px;padding:12px 6px 2px}
.${ROOT} .device .rail button{flex:1;border:0;background:transparent;padding:8px 4px 10px;cursor:pointer;font:500 12px/1.2 var(--sans);color:var(--ink-3);border-top:2px solid var(--line);transition:color .2s}
.${ROOT} .device .rail button.on{color:var(--ink);border-top-color:var(--pig)}
.${ROOT} .ink{fill:none;stroke:var(--ink);stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.${ROOT} .ink.pig{stroke:var(--pig)}.${ROOT} .ink.thin{stroke-width:2.6;stroke:var(--ink-3)}.${ROOT} .ink.rose{stroke:var(--rose)}.${ROOT} .ink.mint{stroke:var(--mint)}
.${ROOT} .hw{font-family:var(--hand);font-weight:600;fill:var(--ink)}.${ROOT} .hw.pig{fill:var(--pig)}.${ROOT} .hw.rose{fill:var(--rose)}.${ROOT} .hw.dim{fill:var(--ink-3)}
.${ROOT} .draw{stroke-dasharray:var(--len,900);stroke-dashoffset:var(--len,900)}

/* floats */
.${ROOT} .float{position:absolute;pointer-events:none;filter:drop-shadow(0 10px 20px rgba(20,20,43,.10))}
.${ROOT} .float svg{display:block}

/* the loop strip */
.${ROOT} .loop{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:clamp(10px,1.2vw,16px);margin-top:var(--s4)}
.${ROOT} .loop .step{background:var(--paper-2);border-radius:20px;padding:clamp(16px,1.6vw,22px);display:grid;gap:10px;align-content:start;position:relative;opacity:1}
.${ROOT} .loop .step .n{font:500 11px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.${ROOT} .loop .step > b{font:600 17px/1.2 var(--sans)}
.${ROOT} .loop .step > p{font-size:14px;color:var(--ink-2)}
.${ROOT} .loop .step svg{width:40px;height:40px;fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.${ROOT} .loop .step .acc{stroke:var(--pig)}
@media (max-width:1080px){.${ROOT} .loop{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:720px){.${ROOT} .loop{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:480px){.${ROOT} .loop{grid-template-columns:1fr}}

/* two-column row */
.${ROOT} .row{display:grid;grid-template-columns:1fr 1fr;gap:var(--colgap);align-items:center}
.${ROOT} .row.flip .art{order:-1}
@media (max-width:980px){
  .${ROOT} .row{grid-template-columns:1fr;gap:var(--s4)}
  .${ROOT} .row.flip .art{order:0}
  .${ROOT} .art{min-height:0;padding:var(--s3)}
}
@media (max-width:640px){
  .${ROOT} .art{padding:var(--s2);border-radius:20px}
  .${ROOT} h2.t{font-size:clamp(26px,7.4vw,34px)}
  .${ROOT} .grid4{grid-template-columns:repeat(2,84px);grid-template-rows:repeat(2,84px)}
  .${ROOT} .try{padding:var(--s3) var(--s2)}
  .${ROOT} .report .kpis{grid-template-columns:1fr}
  .${ROOT} .report .kpi{display:flex;align-items:baseline;gap:10px}
  .${ROOT} .report .kpi b{margin-top:0;font-size:22px}
  .${ROOT} .device .stage{height:clamp(240px,58vw,320px)}
  .${ROOT} .device .rail button{font-size:11px}
  .${ROOT} #close{padding:var(--s5) var(--s3);border-radius:24px}
  .${ROOT} #close input{min-width:0;width:100%}
  .${ROOT} #close form{flex-direction:column;align-items:stretch}
}
.${ROOT} .art{position:relative;border-radius:24px;background:var(--paper-2);padding:var(--s3);min-height:min(420px,52vw);display:grid;place-items:center;justify-items:stretch;overflow:hidden}
.${ROOT} .art > svg{width:100%;height:auto;overflow:visible}
.${ROOT} .art.bare{background:transparent;padding:0;min-height:0;overflow:visible}
.${ROOT} .claims{display:grid;gap:14px;margin-top:var(--s4)}
.${ROOT} .claims > div{display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;align-items:start}
.${ROOT} .claims > div > div{display:block}
.${ROOT} .claims i{width:30px;height:30px;border-radius:50%;background:var(--pig-soft);display:grid;place-items:center;font:600 13px/1 var(--sans);color:var(--pig);font-style:normal}
.${ROOT} .claims > div > div > b{font-weight:600;display:block}
.${ROOT} .claims > div > div > span{color:var(--ink-2);font-size:15px;display:block;margin-top:2px}

/* answer-forms carousel (scroll driven) */
.${ROOT} .forms{position:relative;width:100%;height:clamp(360px,44vw,460px);border-radius:24px;background:var(--paper-2);overflow:hidden}
.${ROOT} .forms .card{position:absolute;inset:0;display:grid;place-items:center;padding:var(--s3);opacity:0}
.${ROOT} .forms .card svg{width:min(100%,620px);height:auto;overflow:visible}
.${ROOT} .forms .label{position:absolute;left:24px;bottom:20px;display:flex;align-items:center;gap:10px;font:500 13px/1 var(--sans);color:var(--ink-2)}
.${ROOT} .forms .label i{width:8px;height:8px;border-radius:50%;background:var(--pig)}
.${ROOT} .formsnav{display:flex;gap:8px;margin-top:var(--s3);flex-wrap:wrap}
.${ROOT} .formsnav > span{font:500 13px/1 var(--sans);padding:9px 14px;border-radius:999px;background:var(--paper-2);color:var(--ink-3)}
.${ROOT} .formsnav > span.on{background:var(--ink);color:var(--paper)}

/* video moment */
.${ROOT} .player{position:relative;width:100%;border-radius:20px;overflow:hidden;background:var(--ink);box-shadow:var(--shadow)}
.${ROOT} .player .frame{position:relative;aspect-ratio:16/10;background:var(--paper)}
.${ROOT} .player .frame svg{position:absolute;inset:0;width:100%;height:100%}
.${ROOT} .player .bar{display:flex;align-items:center;gap:10px;padding:10px 14px;color:rgba(255,255,255,.72);font-size:12px}
.${ROOT} .player .bar .pp{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center}
.${ROOT} .player .bar .pp svg{width:10px;height:10px;fill:#fff}
.${ROOT} .player .bar .track{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.18);position:relative;overflow:hidden}
.${ROOT} .player .bar .track i{position:absolute;inset:0;transform-origin:left;transform:scaleX(0);background:var(--marigold);will-change:transform}
.${ROOT} .bubble{position:absolute;background:var(--ink);color:var(--paper);border-radius:14px 14px 14px 4px;padding:10px 14px;font:500 14px/1.3 var(--sans);box-shadow:var(--lift);opacity:0}
.${ROOT} .bubble.hand{font-family:var(--hand);font-weight:700;font-size:20px;background:var(--marigold);color:#14142B;border-radius:14px}

/* practice */
.${ROOT} .try{width:100%;border-radius:24px;background:var(--paper-2);padding:var(--s4);display:grid;gap:var(--s3);justify-items:center;text-align:center;position:relative;overflow:hidden}
.${ROOT} .try .q{font:600 22px/1.3 var(--sans)}
.${ROOT} .try .q i{font-style:normal;font-family:var(--hand);color:var(--pig);font-size:1.35em}
.${ROOT} .grid4{display:grid;grid-template-columns:repeat(2,104px);grid-template-rows:repeat(2,104px);gap:8px;padding:8px;border-radius:22px;background:var(--ink);position:relative;border:0;margin:0;min-inline-size:0}
.${ROOT} .grid4 button{border:0;border-radius:15px;background:var(--paper);padding:0;cursor:pointer;transition:transform .18s cubic-bezier(.34,1.56,.64,1),background .2s}
.${ROOT} .grid4 button:hover{transform:translateY(-2px)}
.${ROOT} .grid4 button.on{background:var(--pig)}
.${ROOT} .grid4 svg{position:absolute;inset:-44px;width:calc(100% + 88px);height:calc(100% + 88px);pointer-events:none;overflow:visible}
.${ROOT} .try .row2{display:flex;gap:10px}
.${ROOT} .try .say{font-family:var(--hand);font-weight:700;font-size:26px;color:var(--pig);min-height:1.3em}
/* The ring's own label, in the flow rather than hidden under the button row — see Practice.tsx. */
.${ROOT} .try .ringsay{font-family:var(--hand);font-weight:600;font-size:22px;color:var(--pig);min-height:1.3em;margin-top:calc(var(--s3) * -1)}
.${ROOT} .try .say.win{color:var(--mint)}
.${ROOT} .spark{position:absolute;width:9px;height:9px;border-radius:2px;opacity:0;pointer-events:none}

/* parents: the report */
.${ROOT} .report{width:100%;border-radius:24px;background:var(--paper);border:1px solid var(--line);box-shadow:var(--shadow);padding:var(--s3);display:grid;gap:var(--s3)}
.${ROOT} .report .head{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-3)}
.${ROOT} .report .head b{color:var(--ink);font:600 15px/1 var(--sans)}
.${ROOT} .report .head .tag{margin-left:auto;font:500 12px/1 var(--sans);color:var(--mint);background:color-mix(in srgb,var(--mint) 12%,transparent);padding:6px 10px;border-radius:999px}
.${ROOT} .report .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.${ROOT} .report .kpi{background:var(--paper-2);border-radius:16px;padding:14px}
.${ROOT} .report .kpi > span{font:500 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);display:block}
.${ROOT} .report .kpi > b{display:block;font:700 26px/1 var(--sans);margin-top:8px;font-variant-numeric:tabular-nums}
.${ROOT} .report .kpi > b span{font:inherit;letter-spacing:0;text-transform:none;color:inherit}
.${ROOT} .report .kpi > em{font-style:normal;font-size:12px;color:var(--ink-2);display:block;margin-top:6px}
.${ROOT} .report .chart{position:relative;height:150px}
.${ROOT} .report .chart svg{width:100%;height:100%;overflow:visible}
.${ROOT} .report .note{background:var(--paper-2);border-radius:16px;padding:16px 18px;font-family:var(--hand);font-weight:600;font-size:21px;line-height:1.2}
.${ROOT} .report .note em{font-style:normal;color:var(--rose)}
.${ROOT} .badges{display:flex;gap:10px;flex-wrap:wrap}
.${ROOT} .badges > div{display:inline-flex;align-items:center;gap:8px;background:var(--paper-2);border-radius:999px;padding:8px 14px;font:500 13px/1 var(--sans);color:var(--ink-2)}
.${ROOT} .badges svg{width:16px;height:16px;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}

/* subjects */
.${ROOT} .stages{display:grid;gap:12px;margin-top:var(--s4)}
.${ROOT} .stage{background:var(--paper-2);border-radius:20px;padding:clamp(16px,1.8vw,24px);display:grid;grid-template-columns:190px 1fr;gap:var(--s3);align-items:start}
.${ROOT} .stage .who{display:grid;gap:4px}
.${ROOT} .stage .who > b{font:600 17px/1.2 var(--sans)}
.${ROOT} .stage .who > span{font-size:13px;color:var(--ink-3)}
.${ROOT} .stage .subs{display:flex;flex-wrap:wrap;gap:8px}
.${ROOT} .stage .subs > span{font:500 13px/1 var(--sans);background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:9px 13px;color:var(--ink-2)}
.${ROOT} .stage .subs span.acc{border-color:transparent;background:var(--pig-soft);color:var(--pig)}
@media (max-width:760px){.${ROOT} .stage{grid-template-columns:1fr}}

/* safe: depth */
.${ROOT} .safe{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);margin-top:var(--s4)}
.${ROOT} .safe .item{display:grid;grid-template-columns:52px 1fr;gap:16px;align-items:start;padding:var(--s3) 0;border-top:1px solid var(--line)}
.${ROOT} .safe .item svg{width:52px;height:52px;fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.${ROOT} .safe .item .acc{stroke:var(--pig)}
.${ROOT} .safe .item > div > b{display:block;font:600 18px/1.25 var(--sans)}
.${ROOT} .safe .item > div > p{color:var(--ink-2);font-size:15px;margin-top:6px}
.${ROOT} .safe .item .proof{margin-top:10px;font:500 13px/1 var(--sans);color:var(--pig);display:inline-flex;align-items:center;gap:6px}
@media (max-width:860px){.${ROOT} .safe{grid-template-columns:1fr}}

/* ask blocks */
.${ROOT} .ask{border-radius:24px;background:var(--paper-2);padding:var(--s4);display:grid;grid-template-columns:auto 1fr;gap:var(--s3);align-items:center}
.${ROOT} .ask svg.w{width:96px}
.${ROOT} .ask .box{display:flex;gap:10px;background:var(--paper);border-radius:16px;padding:8px 8px 8px 20px;align-items:center;margin-top:var(--s2);box-shadow:var(--lift)}
.${ROOT} .ask input{flex:1;border:0;background:transparent;font:400 16px/1.4 var(--sans);color:var(--ink);outline:none;min-width:0}
.${ROOT} .ask .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;border:0;padding:0;margin-inline:0}
.${ROOT} .ask .chips > button{font:500 13px/1 var(--sans);padding:9px 13px;border-radius:999px;background:var(--paper);color:var(--ink-2);border:0;cursor:pointer}
.${ROOT} .ask .chips > button:hover{color:var(--ink)}
.${ROOT} .ask .answer{margin-top:14px;font-family:var(--hand);font-weight:600;font-size:22px;line-height:1.25;color:var(--ink);min-height:1.3em}
@media (max-width:860px){.${ROOT} .ask{grid-template-columns:1fr}.${ROOT} .ask svg.w{width:64px}}

.${ROOT} .others{margin-top:var(--s3);display:grid;gap:var(--s2)}
.${ROOT} .others .line{font-size:15px;color:var(--ink-2)}
.${ROOT} .models{display:flex;gap:10px;flex-wrap:wrap}
.${ROOT} .models a{display:inline-flex;align-items:center;gap:10px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:12px 16px;font:500 14px/1 var(--sans);color:var(--ink);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s}
.${ROOT} .models a:hover{transform:translateY(-2px);box-shadow:var(--lift)}
.${ROOT} .models svg{width:18px;height:18px}


/* the marked-up paragraph — every mark rides its own words, so none can drift */
.${ROOT} .marked{width:min(100%,620px);background:var(--paper);border-radius:18px;padding:26px 28px;display:grid;gap:14px}
.${ROOT} .marked p{font:400 17px/1.9 var(--sans);color:var(--ink);margin:0}
.${ROOT} .marked mark.hl{background:color-mix(in srgb,var(--marigold) 52%,transparent);color:inherit;padding:.06em .08em;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.${ROOT} .marked .tag{font-family:var(--hand);font-weight:700;font-size:18px;color:var(--pig);margin-left:8px;white-space:nowrap}
.${ROOT} .marked .circled{position:relative;display:inline-block}
.${ROOT} .marked .circled::after{content:"";position:absolute;left:-.35em;right:-.35em;top:-.16em;bottom:-.2em;border:2.6px solid var(--rose);border-radius:50%;transform:rotate(-1.4deg);pointer-events:none}
.${ROOT} .marked .note{font-family:var(--hand);font-weight:600;font-size:19px;color:var(--rose)}
.${ROOT} .marked .fix{font-family:var(--hand);font-weight:700;font-size:20px;color:var(--pig)}

/* ── it teaches YOU: the gap, the second way, the mastery ─────────────────────── */
.${ROOT} .beats{display:grid;gap:var(--s2);margin-top:var(--s4)}
.${ROOT} .beat{display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);gap:var(--colgap);align-items:center;
  background:var(--paper-2);border-radius:24px;padding:var(--s4)}
.${ROOT} .beat:nth-child(even){grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr)}
.${ROOT} .beat:nth-child(even) .beat-art{order:-1}
.${ROOT} .beat .n{font-family:var(--hand);font-weight:700;font-size:26px;color:var(--pig)}
.${ROOT} .beat h3{font:700 clamp(24px,2.6vw,34px)/1.1 var(--sans);margin-top:6px;letter-spacing:-.03em}
.${ROOT} .beat p{color:var(--ink-2);font-size:16px;margin-top:var(--s2);max-width:44ch}
.${ROOT} .beat .said{font-family:var(--hand);font-weight:600;font-size:22px;color:var(--ink);margin-top:var(--s2)}
.${ROOT} .beat .said em{font-style:normal;color:var(--rose)}
.${ROOT} .beat-art{background:var(--paper);border-radius:18px;padding:var(--s3);display:grid;place-items:center;min-height:260px}
.${ROOT} .beat-art svg{width:100%;height:auto;overflow:visible}
@media (max-width:900px){.${ROOT} .beat,.${ROOT} .beat:nth-child(even){grid-template-columns:1fr;padding:var(--s3)}
  .${ROOT} .beat:nth-child(even) .beat-art{order:0}}

/* ── the climb: one path, two vibes ───────────────────────────────────────────── */
.${ROOT} .climb{margin-top:var(--s4);background:var(--paper-2);border-radius:26px;padding:var(--s4);display:grid;gap:var(--s3)}
.${ROOT} .climb .switch{display:inline-flex;background:var(--paper);border-radius:999px;padding:4px;gap:4px;justify-self:start;border:0;margin:0;min-inline-size:0}
.${ROOT} .climb .switch button{border:0;background:transparent;cursor:pointer;font:500 14px/1 var(--sans);color:var(--ink-3);padding:11px 18px;border-radius:999px}
.${ROOT} .climb .switch button.on{background:var(--ink);color:var(--paper)}
.${ROOT} .climb .stagewrap{position:relative;border-radius:20px;background:var(--paper);overflow:hidden;min-height:clamp(280px,34vw,360px)}
.${ROOT} .climb .stagewrap > svg{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .45s ease}
.${ROOT} .climb .stagewrap > svg.on{opacity:1}
.${ROOT} .climb .same{font-family:var(--hand);font-weight:600;font-size:22px;color:var(--ink)}
.${ROOT} .climb .same em{font-style:normal;color:var(--pig)}
.${ROOT} .climb .legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--ink-2);font-size:14px}
.${ROOT} .climb .legend span{display:inline-flex;align-items:center;gap:8px}
.${ROOT} .climb .legend i{width:11px;height:11px;border-radius:3px}

/* faq */
.${ROOT} .faq{display:grid;gap:8px;margin-top:var(--s4)}
.${ROOT} .faq details{background:var(--paper-2);border-radius:16px;padding:0 var(--s3)}
.${ROOT} .faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:var(--s2);padding:20px 0;font-weight:500}
.${ROOT} .faq summary::-webkit-details-marker{display:none}
.${ROOT} .faq summary::after{content:"+";font:400 24px/1 var(--sans);color:var(--pig);transition:transform .3s}
.${ROOT} .faq details[open] summary::after{transform:rotate(45deg)}
.${ROOT} .faq p{color:var(--ink-2);padding:0 0 20px;max-width:66ch}

/* devices */
.${ROOT} .devices{display:flex;gap:10px;flex-wrap:wrap;margin-top:var(--s3)}
.${ROOT} .devices a{display:inline-flex;align-items:center;gap:10px;background:var(--paper-2);border-radius:14px;padding:12px 16px;font:500 14px/1 var(--sans);color:var(--ink-2)}
.${ROOT} .devices a.live{background:var(--ink);color:var(--paper)}
.${ROOT} .devices a > small{font-size:11px;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase}

/* close: promotion */
.${ROOT} #close{background:var(--ink);color:#fff;border-radius:32px;padding:var(--band) var(--s4);text-align:center;position:relative;overflow:hidden;margin-bottom:var(--band)}
.${ROOT} #close h2{font:700 clamp(34px,4.6vw,58px)/1.02 var(--sans);letter-spacing:-.035em;color:#fff}
.${ROOT} #close .sub{color:rgba(255,255,255,.72);margin:var(--s3) auto 0;max-width:48ch}
.${ROOT} #close form{display:flex;gap:10px;justify-content:center;margin-top:var(--s4);flex-wrap:wrap}
.${ROOT} #close input{font:400 16px/1 var(--sans);padding:0 20px;height:52px;border-radius:14px;border:0;background:rgba(255,255,255,.1);color:#fff;min-width:min(340px,80vw)}
.${ROOT} #close input::placeholder{color:rgba(255,255,255,.5)}
.${ROOT} #close .btn{background:var(--marigold);color:#14142B}
.${ROOT} #close .fine{color:rgba(255,255,255,.5);font-size:13px;margin-top:var(--s2)}
.${ROOT} #close .glow{position:absolute;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(43,69,255,.35),transparent 70%);filter:blur(20px);pointer-events:none}

.${ROOT} footer{padding:0 0 var(--band);color:var(--ink-3);font-size:14px}
.${ROOT} footer .grid{display:grid;grid-template-columns:1.6fr repeat(4,1fr);gap:var(--s3)}
.${ROOT} footer b{display:block;color:var(--ink);font-weight:600;margin-bottom:12px;font-size:14px}
.${ROOT} footer a{display:block;padding:5px 0;color:var(--ink-2)}
.${ROOT} footer .wm svg{height:20px;color:var(--ink)}
@media (max-width:860px){.${ROOT} footer .grid{grid-template-columns:1fr 1fr}}

.${ROOT} .blink{transform-origin:center;animation:wb-blink 5.5s infinite}
@keyframes wb-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
@media (prefers-reduced-motion:reduce){
  .${ROOT} .blink{animation:none}
  .${ROOT} .draw{stroke-dashoffset:0 !important}
  .${ROOT} h2.t .hl{background-size:100% 92%}
  /* Nothing scrubs, so the four answer cards and the pinned rail lay out as an ordinary stack
     rather than four cards at opacity 0 on top of one another. */
  .${ROOT} #forms .row{align-items:start}
  .${ROOT} .forms{height:auto;display:grid;gap:var(--s2);background:transparent}
  .${ROOT} .forms .card{position:relative;inset:auto;opacity:1;background:var(--paper-2);border-radius:24px}
  .${ROOT} .player .bar .track i{transform:scaleX(.38)}
  .${ROOT} .bubble{opacity:1;position:relative;left:auto !important;right:auto !important;top:auto !important;bottom:auto !important;margin:8px;max-width:none !important}
  .${ROOT} .player .frame{aspect-ratio:auto;padding-bottom:8px}
  .${ROOT} .player .frame svg{position:relative;inset:auto;height:auto}
}
`;

/**
 * Inject the stylesheet once per document. Idempotent, and it never removes itself: the page is
 * lazily chunked, so a visitor who comes back to it should not pay for a second parse.
 */
export function ensureLandingStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LANDING_CSS;
  document.head.appendChild(style);
}
