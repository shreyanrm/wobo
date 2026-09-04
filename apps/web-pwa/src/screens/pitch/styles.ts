/**
 * THE six pitch pages' stylesheet — /security, /meet-wobo, /for-parents, /for-students,
 * /how-it-works and /subjects. One sheet, one id, injected once, on top of the site shell's
 * (`site/styles.ts`), which already carries the header, the pill nav, the buttons, the chapter
 * head, the three-across tiles, the ask block, the close panel and the footer.
 *
 * Every rule here is its prototype's (design/prototypes/site-*.html), ported declaration for
 * declaration under a page prefix — `sc-` security, `mt-` meet, `pa-` parents, `su-` students,
 * `hw-` how it works, `sb-` subjects — and `pt-` for the drawing vocabulary the six share: the ink
 * stroke, the hand, the paper, the draw-on reveal, the chapter, the art panel, the chat mock.
 * `styles.test.ts` holds a sample of those rules to their sources and the laws to the whole sheet.
 *
 * The one deliberate change, the same one the site shell makes: the ink panels (the request
 * form, the demo stage, the film's bar) tint their text with `rgba(250,247,240,.N)` — cream at N
 * percent — in the prototypes, which vanishes on the night theme where the panel's ink IS cream.
 * Here those tints are `color-mix(in srgb, var(--paper) N%, transparent)`: identical on paper,
 * legible at night. The test normalises the two spellings before comparing.
 *
 * The laws (DESIGN.md §2): no border lines — surfaces separate by tone, space and shape, and the
 * only lines are the ones Wobo draws, 3.5px ink with round caps (2.5px for a thin construction
 * line); corners 10 / 16 / 24 and up, except the 4px tail of a speech bubble and the foot of a
 * bar, which the prototypes draw as a tail rather than a corner; a soft tinted shadow only under
 * what floats (the film, the envelope, the note, a sticker, the typeahead); Poppins for every word
 * and Caveat only for what Wobo writes; every colour a law-v5 token — and, since law v5
 * (DESIGN.md §0), no tinted section ground anywhere: the paper is white, an art panel and every
 * card sit on `--paper-2`, and a wash may tint a pill, a tick, a selected row or a node in a drawn
 * diagram, but never a card, a tile, a panel or a section.
 */

const STYLE_ID = 'wobo-pitch';

export const PITCH_CSS = `
/* --- the drawing vocabulary the six pages share ------------------------------------------- */
html:has(.pt){scroll-behavior:smooth}
.pt [id]{scroll-margin-top:88px}
.pt-ink{fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.pt-ink.pt-pig{stroke:var(--pig)}.pt-ink.pt-rose{stroke:var(--rose)}.pt-ink.pt-mint{stroke:var(--mint)}.pt-ink.pt-thin{stroke-width:2.5}
.pt-hw{font-family:var(--hand);font-weight:600;fill:var(--ink)}.pt-hw.pt-pig{fill:var(--pig)}.pt-hw.pt-rose{fill:var(--rose)}.pt-hw.pt-dim{fill:var(--ink-3)}
.pt-paper{fill:var(--paper)}
.pt-draw{stroke-dasharray:900;stroke-dashoffset:900;transition:stroke-dashoffset 1.8s cubic-bezier(.6,0,.2,1) .2s}
.pt-on .pt-draw{stroke-dashoffset:0}
.pt-blink{transform-origin:center;animation:pt-blink 5s infinite}
@keyframes pt-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
@keyframes pt-fade{to{opacity:1}}
@keyframes pt-cur{50%{opacity:0}}
.pt-tight{padding:var(--s4) 0}
.pt-hero .pt-row{display:flex;gap:var(--s2);margin-top:var(--s4);flex-wrap:wrap;align-items:center}
.pt-hero .pt-note{font-size:14px;color:var(--ink-3)}
.pt-num{font-family:var(--hand);font-weight:700;font-size:28px;color:var(--pig)}

/* --- a chapter: the number, the line, the art beside it ---------------------------------- */
.pt-chapter{display:grid;grid-template-columns:1fr 1fr;gap:var(--s5);align-items:center}
.pt-chapter.pt-flip .pt-art{order:-1}
.pt-chapter h2{font:700 clamp(30px,3.6vw,46px)/1.06 var(--sans);margin-top:8px;isolation:isolate}
.pt-chapter h2 .pt-hl{position:relative;white-space:nowrap}
.pt-chapter h2 .pt-hl::before{content:"";position:absolute;left:-.1em;right:-.1em;bottom:.08em;height:.5em;background:var(--marigold);opacity:.55;border-radius:6px;z-index:-1;transform-origin:left;transform:scaleX(0);transition:transform .8s cubic-bezier(.6,0,.2,1) .2s}
.pt-chapter.pt-on h2 .pt-hl::before{transform:scaleX(1)}
.pt-chapter p{color:var(--ink-2);font-size:18px;margin-top:var(--s2);max-width:46ch}
.pt-say{margin-top:var(--s3);font-family:var(--hand);font-weight:600;font-size:28px;line-height:1.15;color:var(--ink)}
.pt-say em{font-style:normal;color:var(--rose)}
.pt-art{border-radius:28px;padding:var(--s3);background:var(--paper-2);position:relative;min-height:380px;display:grid;place-items:center}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.pt-art.pt-night{background:var(--ink)}
.pt-art>svg{width:100%;height:auto;overflow:visible}
.pt-chat{width:100%;display:grid;gap:10px}
.pt-chat div{max-width:80%;padding:12px 16px;border-radius:18px;font-size:15px;line-height:1.45}
.pt-chat .pt-me{justify-self:end;background:var(--ink);color:var(--paper);border-bottom-right-radius:4px}
.pt-chat .pt-wo{justify-self:start;background:var(--paper);border-bottom-left-radius:4px;font-family:var(--hand);font-weight:600;font-size:22px;line-height:1.15}
.pt-chat .pt-wo b{color:var(--pig);font-weight:700}
.pt-chat .pt-t{justify-self:center;font-size:12px;color:var(--ink-3);padding:0}
/* the ask block's reply, in Wobo's hand, typed */
.pt-reply{margin-top:var(--s2);font-family:var(--hand);font-weight:600;font-size:24px;line-height:1.2;color:var(--ink);min-height:1.2em}
.pt-reply.pt-busy{color:var(--ink-3)}
@media (max-width:900px){
  .pt-chapter{grid-template-columns:1fr;gap:var(--s3)}.pt-chapter.pt-flip .pt-art{order:0}.pt-art{min-height:0}
  /* the touch floor (DESIGN.md §2): the students page's angle slider is a thumb's 44px tall */
  .su-angle input[type=range]{min-height:44px}
}

/* --- /security ------------------------------------------------------------------------------ */
.sc-hero{padding:var(--s5) 0 var(--s5)}
.sc-hero .st-wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:var(--s4);align-items:center}
.sc-hero h1{font:700 clamp(38px,5vw,64px)/1.02 var(--sans);letter-spacing:-.035em;margin-top:var(--s2)}
.sc-hero h1 em{font-style:normal;color:var(--pig)}
.sc-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:48ch;margin-top:var(--s3)}
.sc-shield{display:grid;place-items:center}
.sc-shield svg{width:min(100%,420px);overflow:visible;filter:drop-shadow(0 22px 34px rgba(20,20,43,.14))}
.sc-shield .sc-draw{fill:none;stroke:var(--ink);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1400;stroke-dashoffset:1400;animation:sc-draw 2.2s cubic-bezier(.6,0,.2,1) .2s forwards}
@keyframes sc-draw{to{stroke-dashoffset:0}}
.sc-shield .sc-fill{fill:var(--pig-w);opacity:0;animation:pt-fade .8s ease 1.6s forwards}
.sc-shield .sc-eyes{opacity:0;animation:pt-fade .5s ease 2.2s forwards}
.sc-shield .sc-hw{font-family:var(--hand);font-weight:700;fill:var(--ink);opacity:0;animation:pt-fade .6s ease 2.6s forwards}
.sc-short{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:1fr 1fr;gap:var(--s3) var(--s5);align-items:start}
.sc-five{display:grid;gap:var(--s2)}
.sc-five>div{display:grid;grid-template-columns:34px 1fr;gap:var(--s2);align-items:start}
.sc-five i{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:700 18px/1 var(--hand);font-style:normal;color:var(--ink);background:var(--marigold)}
.sc-five b{display:block;font-weight:600}
.sc-five span{color:var(--ink-2);font-size:15px}
.sc-short .hand{font-size:30px;line-height:1.15;color:var(--ink)}
.sc-short .hand em{font-style:normal;color:var(--rose)}
.sc-tbl{border-radius:24px;overflow:hidden;background:var(--paper-2)}
.sc-tbl .sc-r{display:grid;grid-template-columns:1.1fr 1.6fr 1fr 1fr;gap:var(--s2);padding:var(--s2) var(--s3);align-items:start}
.sc-tbl .sc-r+.sc-r{border-top:2px solid var(--paper)}
.sc-tbl .sc-r.sc-h{background:var(--paper-3);font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);padding:var(--s2) var(--s3)}
.sc-tbl b{font-weight:600}
.sc-tbl span{font-size:15px;color:var(--ink-2)}
.sc-tbl .sc-del{display:inline-flex;align-items:center;gap:6px;background:var(--rose-w);color:var(--ink);padding:6px 10px;border-radius:999px;font:500 13px/1 var(--sans)}
.sc-tbl .sc-del i{width:8px;height:8px;border-radius:50%;background:var(--rose)}
.st-tile .sc-gloss{font-size:13px;color:var(--ink-3)}
.sc-flow{margin-top:var(--s4);background:var(--paper-2);border-radius:28px;padding:var(--s3);overflow-x:auto}
.sc-flow svg{width:100%;min-width:720px;height:auto;display:block}
.sc-flow .sc-ink{fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.sc-flow .sc-box{fill:var(--paper);stroke:var(--ink);stroke-width:3.5}
.sc-flow .sc-box.sc-pig{fill:var(--pig-w)}.sc-flow .sc-box.sc-mint{fill:var(--mint-w)}.sc-flow .sc-box.sc-rose{fill:var(--rose-w)}.sc-flow .sc-box.sc-marigold{fill:var(--marigold-w)}
.sc-flow .sc-t{font:600 15px var(--sans);fill:var(--ink)}
.sc-flow .sc-s{font:400 13px var(--sans);fill:var(--ink-2)}
.sc-flow .sc-hw{font:700 22px var(--hand);fill:var(--pig)}
.sc-flow .sc-lock{fill:var(--marigold);stroke:var(--ink);stroke-width:3}
.sc-flow .sc-fdraw{stroke-dasharray:600;stroke-dashoffset:600;transition:stroke-dashoffset 1.6s cubic-bezier(.6,0,.2,1)}
.sc-flow.pt-on .sc-fdraw{stroke-dashoffset:0}
.sc-children{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);align-items:center}
.sc-children .sc-card{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;gap:var(--s2)}
.sc-children .sc-card .hand{font-size:32px;line-height:1.1}
.sc-children .sc-card .hand em{font-style:normal;color:var(--rose)}
.sc-children .sc-card p{color:var(--ink-2)}
.sc-children ul{margin:0;padding:0;list-style:none;display:grid;gap:12px}
.sc-children li{display:grid;grid-template-columns:28px 1fr;gap:12px;align-items:start;color:var(--ink-2)}
.sc-children li b{color:var(--ink);font-weight:600}
.sc-children li svg{width:28px;height:28px;fill:none;stroke:var(--mint);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.sc-who{border-radius:24px;overflow:hidden;background:var(--paper-2)}
.sc-who .sc-r{display:grid;grid-template-columns:1.4fr repeat(3,1fr);align-items:center}
.sc-who .sc-r+.sc-r{border-top:2px solid var(--paper)}
.sc-who .sc-r>div{padding:14px var(--s3);font-size:15px}
.sc-who .sc-r.sc-h>div{font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);background:var(--paper-3);padding:var(--s2) var(--s3)}
.sc-who .sc-r>div:first-child{font-weight:600}
.sc-who .sc-y{display:inline-flex;align-items:center;gap:6px;color:var(--ink)}
.sc-who .sc-y i{width:10px;height:10px;border-radius:50%;background:var(--mint)}
.sc-who .sc-n{color:var(--ink-3)}
.sc-who .sc-n i{display:inline-block;width:14px;height:3px;border-radius:2px;background:var(--paper-3);vertical-align:middle}
.sc-who .sc-l{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2)}
.sc-who .sc-l i{width:10px;height:10px;border-radius:50%;background:var(--marigold)}
.sc-never{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.sc-never div{background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:8px;align-content:start}
.sc-never .sc-x{font-family:var(--hand);font-weight:700;font-size:26px;color:var(--rose);line-height:1}
.sc-never b{font-weight:600}
.sc-never span{font-size:15px;color:var(--ink-2)}
.sc-posture{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2)}
.sc-col{border-radius:24px;padding:var(--s3);background:var(--paper-2);display:grid;gap:12px;align-content:start}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.sc-col h3{font:600 20px/1.2 var(--sans)}
.sc-posture ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.sc-posture li{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;font-size:15px;color:var(--ink-2)}
.sc-posture li i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center}
.sc-today li i{background:var(--mint)}
.sc-next li i{background:var(--paper-3)}
.sc-posture li svg{width:12px;height:12px;fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.sc-honest{font-size:14px;color:var(--ink-3)}
.sc-subs{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.sc-subs div{background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:6px;align-content:start}
.sc-subs b{font-weight:600}
.sc-subs span{font-size:14px;color:var(--ink-2)}
.sc-subs .sc-reg{font:500 13px/1 var(--sans);color:var(--ink-3);letter-spacing:.06em}
.sc-two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2)}
.sc-panel{border-radius:28px;padding:var(--s4);background:var(--paper-2);display:grid;gap:var(--s2);align-content:start}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.sc-panel h3{font:600 24px/1.15 var(--sans)}
.sc-panel p{color:var(--ink-2)}
.sc-panel .sc-mail{font:600 18px/1 var(--sans);color:var(--ink);display:inline-flex;align-items:center;min-height:44px}
.sc-docs{display:grid;gap:8px}
.sc-docs a{display:flex;justify-content:space-between;align-items:center;background:var(--paper);border-radius:14px;padding:14px 16px;font-weight:500}
.sc-docs a span{color:var(--ink-3);font-size:13px;font-weight:400}
.sc-req{background:var(--ink);color:var(--paper);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:1.1fr .9fr;gap:var(--s4);align-items:center}
.sc-req h3{font:600 28px/1.15 var(--sans)}
.sc-req p{color:color-mix(in srgb,var(--paper) 72%,transparent)}
.sc-req form{display:grid;gap:10px}
.sc-req input{font:400 16px/1.4 var(--sans);padding:14px 16px;border-radius:12px;border:0;background:color-mix(in srgb,var(--paper) 10%,transparent);color:var(--paper)}
.sc-req input::placeholder{color:color-mix(in srgb,var(--paper) 50%,transparent)}
.sc-req .st-btn{background:var(--marigold);color:#14142B;justify-self:start}
.sc-req small{color:color-mix(in srgb,var(--paper) 50%,transparent);font-size:13px}
@media (max-width:900px){
  .sc-hero .st-wrap{grid-template-columns:1fr}.sc-shield{order:-1}.sc-shield svg{width:min(70%,300px)}
  .sc-short{grid-template-columns:1fr}
  .sc-tbl .sc-r{grid-template-columns:1fr;gap:6px}.sc-tbl .sc-r.sc-h{display:none}
  .sc-children{grid-template-columns:1fr}
  .sc-who{overflow-x:auto}.sc-who .sc-r{min-width:720px}
  .sc-never{grid-template-columns:1fr 1fr}
  .sc-posture{grid-template-columns:1fr}
  .sc-subs{grid-template-columns:1fr 1fr}
  .sc-two{grid-template-columns:1fr}
  .sc-req{grid-template-columns:1fr}
}
@media (max-width:600px){.sc-never{grid-template-columns:1fr}.sc-subs{grid-template-columns:1fr}}

/* --- /meet-wobo ----------------------------------------------------------------------------- */
.mt-hero{padding:var(--s4) 0 var(--s5)}
.mt-hero .st-wrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:var(--s4);align-items:center;min-height:70vh}
.mt-big{display:grid;place-items:center;position:relative}
.mt-big .wk-head{filter:drop-shadow(0 30px 40px rgba(20,20,43,.18))}
.mt-bubble{position:absolute;right:-8px;top:8%;background:var(--paper-2);border-radius:20px 20px 20px 4px;padding:14px 18px;font-family:var(--hand);font-weight:700;font-size:28px;line-height:1.1;color:var(--ink);box-shadow:0 12px 26px rgba(20,20,43,.10);max-width:280px}
.mt-bubble .mt-cur{display:inline-block;width:3px;height:1em;background:var(--pig);vertical-align:-2px;margin-left:2px;animation:pt-cur 1s steps(2) infinite}
.mt-hero h1{font:700 clamp(38px,5vw,62px)/1.02 var(--sans);letter-spacing:-.035em;margin-top:var(--s2)}
.mt-hero h1 em{font-style:normal;color:var(--pig)}
.mt-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:46ch;margin-top:var(--s3)}
.mt-list{margin:var(--s3) 0 0;padding:0;list-style:none;display:grid;gap:12px}
.mt-list li{display:grid;grid-template-columns:32px 1fr;gap:12px;align-items:start;font-size:16px;color:var(--ink-2)}
.mt-list li b{color:var(--ink);font-weight:600}
.mt-list li i{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--paper-2);font-style:normal}
.mt-list li i svg{width:18px;height:18px;fill:none;stroke:var(--ink);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.mt-wave rect{fill:var(--pig);transform-origin:center;animation:mt-wave 1.1s ease-in-out infinite}
.mt-wave rect:nth-child(2){animation-delay:.12s}.mt-wave rect:nth-child(3){animation-delay:.24s}.mt-wave rect:nth-child(4){animation-delay:.36s}.mt-wave rect:nth-child(5){animation-delay:.48s}.mt-wave rect:nth-child(6){animation-delay:.6s}
@keyframes mt-wave{50%{transform:scaleY(.35)}}
.mt-never{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);margin-top:var(--s4)}
.mt-never div{background:var(--paper-2);border-radius:22px;padding:var(--s3);display:grid;gap:8px;align-content:start}
.mt-never .mt-x{font-family:var(--hand);font-weight:700;font-size:28px;color:var(--rose);line-height:1}
.mt-never b{font-weight:600;font-size:18px}
.mt-never span{font-size:15px;color:var(--ink-2)}
.mt-demo{background:var(--ink);color:var(--paper);border-radius:32px;padding:var(--s5) var(--s4);display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);align-items:center;position:relative;overflow:hidden}
.mt-demo h2{font:700 clamp(28px,3.4vw,42px)/1.06 var(--sans)}
.mt-demo p{color:color-mix(in srgb,var(--paper) 70%,transparent);margin-top:var(--s2);max-width:42ch}
.mt-demo .wk-label{color:var(--marigold)}
.mt-hold{margin-top:var(--s3);display:inline-flex;align-items:center;gap:14px;background:color-mix(in srgb,var(--paper) 10%,transparent);padding:12px 18px 12px 12px;border-radius:16px;cursor:pointer;user-select:none;border:0;color:var(--paper);font:500 16px/1 var(--sans);touch-action:none}
.mt-hold .mt-k{font:600 13px/1 var(--sans);padding:10px 12px;border-radius:10px;background:var(--marigold);color:#14142B}
.mt-hold.mt-live{background:color-mix(in srgb,var(--marigold) 18%,transparent)}
.mt-stage{display:grid;place-items:center;position:relative;min-height:320px;--body:var(--paper);--visor:var(--ink);--eye:var(--pig)}
.mt-stage .wk-head{filter:drop-shadow(0 20px 30px rgba(0,0,0,.35));transition:transform .3s;position:relative}
.mt-stage.mt-live .wk-head{transform:scale(1.06)}
.mt-say{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-family:var(--hand);font-weight:700;font-size:30px;color:var(--marigold);white-space:nowrap;opacity:0;transition:opacity .3s}
.mt-say.mt-show{opacity:1}
/* Law v5 gives pig one job — the pointer, one per view — so this backdrop is a GLOW rather
   than a 260px solid disc of the pointer pigment: the same warmth behind Wobo's head, with
   the colour falling off to nothing at the edge instead of reading as a second button. */
.mt-ring{position:absolute;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--pig) 42%,transparent) 0%,color-mix(in srgb,var(--pig) 16%,transparent) 55%,transparent 72%);opacity:0;transition:opacity .3s}
.mt-stage.mt-live .mt-ring{opacity:.28;animation:mt-pulse 1.2s ease-in-out infinite}
@keyframes mt-pulse{50%{transform:scale(1.12)}}
@media (max-width:900px){
  .mt-hero .st-wrap{grid-template-columns:1fr;min-height:0}.mt-big{order:-1}.mt-bubble{right:0;top:-6px;font-size:22px;max-width:220px}
  .mt-never{grid-template-columns:1fr}
  .mt-demo{grid-template-columns:1fr}.mt-stage{min-height:260px}
}

/* --- /for-parents --------------------------------------------------------------------------- */
.pa-hero{padding:var(--s4) 0 var(--s5)}
.pa-hero .st-wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:var(--s4);align-items:center;min-height:68vh}
.pa-hero h1{font:700 clamp(38px,5vw,62px)/1.02 var(--sans);letter-spacing:-.035em;margin-top:var(--s2)}
.pa-hero h1 em{font-style:normal;color:var(--pig)}
.pa-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:46ch;margin-top:var(--s3)}
.pa-env{position:relative;display:grid;place-items:center;min-height:420px}
.pa-env>svg{width:min(100%,480px);overflow:visible;filter:drop-shadow(0 26px 40px rgba(20,20,43,.16))}
.pa-env .pa-letter{transform:translateY(150px);animation:pa-rise 1.5s cubic-bezier(.6,0,.2,1) .4s forwards}
@keyframes pa-rise{to{transform:translateY(0)}}
.pa-env .pa-flap{transform-origin:50% 0;animation:pa-flap 1s cubic-bezier(.6,0,.2,1) forwards}
@keyframes pa-flap{to{transform:scaleY(-1)}}
.pa-caps{display:grid;gap:10px;margin-top:var(--s3)}
.pa-caps div{font-family:var(--hand);font-weight:600;font-size:26px;line-height:1.15;color:var(--ink)}
.pa-caps div em{font-style:normal;color:var(--rose)}
.pa-caps div.pa-t{font-family:var(--sans);font-weight:500;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.pa-mock{background:var(--paper);border-radius:22px;padding:18px;display:grid;gap:12px;width:100%;box-shadow:0 18px 40px rgba(20,20,43,.10)}
.pa-mock .pa-top{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-3)}
.pa-mock .pa-top b{color:var(--ink);font-weight:600;font-size:15px}
.pa-mock .pa-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;background:var(--paper-2);border-radius:14px;padding:12px 14px;font-size:14px}
.pa-mock .pa-row b{display:block;font-weight:600;color:var(--ink)}
.pa-mock .pa-row span{color:var(--ink-3);font-size:13px}
.pa-mock .pa-row .pa-ok{font:500 12px/1 var(--sans);padding:6px 10px;border-radius:999px;background:var(--mint-w);color:var(--ink)}
.pa-mock .pa-row .pa-now{background:var(--pig);color:#fff}
.pa-mock .pa-row .pa-next{background:var(--paper-3)}
.pa-mock .pa-note{background:var(--marigold-w);border-radius:14px;padding:14px;font-family:var(--hand);font-weight:600;font-size:22px;line-height:1.15}
.pa-mock .pa-note em{font-style:normal;color:var(--rose)}
.pa-mock .pa-lock{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3)}
.pa-mock .pa-lock svg{width:16px;height:16px;fill:none;stroke:var(--ink-3);stroke-width:2.5;stroke-linecap:round}
.pa-head{display:grid;gap:var(--s2);max-width:64ch}
.pa-head h2{font:700 clamp(28px,3.4vw,42px)/1.08 var(--sans)}
.pa-head p{color:var(--ink-2);font-size:18px}
.pa-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);margin-top:var(--s4)}
.pa-more{margin-top:var(--s3)}
.pa-cost{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:1.1fr .9fr;gap:var(--s4);align-items:center}
.pa-cost h2{font:700 clamp(28px,3.4vw,40px)/1.08 var(--sans)}
.pa-cost p{color:var(--ink-2);margin-top:var(--s2)}
.pa-cost .pt-row{display:flex;gap:var(--s2);margin-top:var(--s3);flex-wrap:wrap}
.pa-cost .st-btn.st-quiet{background:var(--paper)}
.pa-allow{background:var(--paper);border-radius:22px;padding:22px;display:grid;gap:10px;box-shadow:0 18px 40px rgba(20,20,43,.10);max-width:360px;justify-self:center;width:100%}
.pa-allow b{font-weight:600}
.pa-allow .pa-bar{height:12px;border-radius:6px;background:var(--paper-3);overflow:hidden}
.pa-allow .pa-bar i{display:block;height:100%;width:62%;background:var(--marigold);border-radius:6px}
.pa-allow span{font-size:13px;color:var(--ink-3)}
.pa-allow .hand{font-size:22px;color:var(--pig)}
.pa-faq{display:grid;gap:10px;margin-top:var(--s4)}
.pa-faq details{background:var(--paper-2);border-radius:18px;padding:0 var(--s3)}
.pa-faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:var(--s2);padding:18px 0;font-weight:500;font-size:17px}
.pa-faq summary::-webkit-details-marker{display:none}
.pa-faq summary::after{content:"+";font:600 24px/1 var(--sans);color:var(--pig);transition:transform .3s}
.pa-faq details[open] summary::after{transform:rotate(45deg)}
.pa-faq details p{color:var(--ink-2);padding:0 0 18px;max-width:64ch}
@media (max-width:900px){
  .pa-hero .st-wrap{grid-template-columns:1fr;min-height:0}.pa-env{order:-1;min-height:0}.pa-env>svg{width:min(80%,340px)}
  .pa-grid3{grid-template-columns:1fr}
  .pa-cost{grid-template-columns:1fr}
}

/* --- /for-students -------------------------------------------------------------------------- */
.su-hero{padding:var(--s4) 0 var(--s5)}
.su-hero .st-wrap{display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);align-items:center;min-height:68vh}
.su-hero h1{font:700 clamp(40px,5.4vw,66px)/1.0 var(--sans);letter-spacing:-.035em;margin-top:var(--s2)}
.su-hero h1 em{font-style:normal;color:var(--pig)}
.su-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:44ch;margin-top:var(--s3)}
.su-film{position:relative;border-radius:28px;background:var(--ink);padding:14px;box-shadow:0 30px 60px rgba(20,20,43,.22);transform:rotate(-2deg)}
.su-frame{border-radius:18px;background:var(--paper);position:relative;overflow:hidden;aspect-ratio:16/10}
.su-frame svg{position:absolute;inset:0;width:100%;height:100%}
.su-bar{display:flex;align-items:center;gap:10px;padding:12px 6px 2px;color:color-mix(in srgb,var(--paper) 70%,transparent);font-size:13px}
.su-bar .su-p{width:30px;height:30px;border-radius:50%;background:color-mix(in srgb,var(--paper) 12%,transparent);display:grid;place-items:center}
.su-bar .su-p i{display:block;width:4px;height:12px;background:var(--paper);box-shadow:6px 0 0 var(--paper);margin-right:6px}
.su-bar .su-track{flex:1;height:4px;border-radius:2px;background:color-mix(in srgb,var(--paper) 18%,transparent);position:relative}
.su-bar .su-track::after{content:"";position:absolute;left:0;top:0;height:100%;width:38%;background:var(--marigold);border-radius:2px}
.su-lasso{stroke-dasharray:700;stroke-dashoffset:700;animation:su-lasso 1.6s cubic-bezier(.6,0,.2,1) .9s forwards}
@keyframes su-lasso{to{stroke-dashoffset:0}}
.su-q{position:absolute;right:-18px;bottom:36px;background:var(--marigold);color:#14142B;font-family:var(--hand);font-weight:700;font-size:26px;padding:8px 16px;border-radius:14px 14px 4px 14px;transform:rotate(3deg);box-shadow:0 12px 24px rgba(20,20,43,.16);opacity:0;animation:pt-fade .5s ease 2.4s forwards}
.su-puzzle{display:grid;gap:18px;justify-items:center;width:100%}
.su-grid4{display:grid;grid-template-columns:repeat(2,96px);grid-template-rows:repeat(2,96px);gap:6px;padding:6px;border-radius:20px;background:var(--ink);position:relative}
.su-grid4 button{border:0;border-radius:14px;background:var(--paper);padding:0;cursor:pointer;transition:transform .15s}
.su-grid4 button:active{transform:scale(.96)}
.su-grid4 button.su-lit{background:var(--pig)}
.su-grid4 svg{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);pointer-events:none;overflow:visible}
.su-grid4 svg path{fill:none;stroke:var(--pig);stroke-width:4;stroke-linecap:round;stroke-dasharray:700;stroke-dashoffset:700;transition:stroke-dashoffset 1.2s cubic-bezier(.6,0,.2,1)}
.su-grid4 svg.su-show path{stroke-dashoffset:0}
.su-grid4 svg text{font-family:var(--hand);font-weight:700;font-size:26px;fill:var(--pig);opacity:0;transition:opacity .4s .8s}
.su-grid4 svg.su-show text{opacity:1}
.su-puzzle .pt-row{display:flex;gap:10px}
.su-line{font-family:var(--hand);font-weight:700;font-size:28px;color:var(--pig);min-height:1.2em;text-align:center}
.su-line.su-win{color:var(--mint)}
.su-pq{font:600 20px/1.3 var(--sans);text-align:center}
.su-pq i{font-style:normal;font-family:var(--hand);color:var(--pig);font-size:1.3em}
.su-angle{display:grid;gap:14px;justify-items:center;width:100%}
.su-angle svg{width:min(100%,360px);overflow:visible}
.su-angle input[type=range]{width:min(100%,320px);accent-color:var(--pig)}
.su-streak{display:grid;gap:14px;width:100%}
.su-days{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.su-days i{width:44px;height:44px;border-radius:50%;background:var(--paper);display:grid;place-items:center;font:600 13px/1 var(--sans);color:var(--ink-3);font-style:normal}
.su-days i.su-lit{background:var(--marigold);color:var(--ink)}
.su-days i.su-rest{background:var(--paper);color:var(--ink-3);outline:3px dashed var(--paper-3);outline-offset:-3px}
.su-n{font:700 72px/1 var(--sans);text-align:center;letter-spacing:-.04em}
.su-n small{display:block;font:500 14px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-top:8px}
.su-streak .hand{text-align:center;font-size:24px;color:var(--ink)}
@media (max-width:900px){
  .su-hero .st-wrap{grid-template-columns:1fr;min-height:0}.su-film{order:-1;transform:none}
}

/* --- /how-it-works -------------------------------------------------------------------------- */
.hw-hero{padding:var(--s5) 0 var(--s4);text-align:center}
.hw-hero h1{font:700 clamp(38px,5.4vw,66px)/1.0 var(--sans);letter-spacing:-.035em;margin:var(--s2) auto 0;max-width:18ch}
.hw-hero h1 em{font-style:normal;color:var(--pig)}
.hw-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:52ch;margin:var(--s3) auto 0}
.hw-hero .pt-row{justify-content:center}
.hw-strip{margin:var(--s5) auto 0;max-width:980px}
.hw-strip svg{width:100%;height:auto;overflow:visible}
.hw-strip .hw-box{fill:var(--paper-2)}
.hw-strip .hw-box.hw-pig{fill:var(--pig-w)}.hw-strip .hw-box.hw-mint{fill:var(--mint-w)}.hw-strip .hw-box.hw-marigold{fill:var(--marigold-w)}
.hw-strip .hw-t{font:600 18px var(--sans);fill:var(--ink)}
.hw-strip .hw-s{font:400 13px var(--sans);fill:var(--ink-2)}
.hw-strip .hw-arrow{stroke-dasharray:200;stroke-dashoffset:200;animation:hw-dash 1s cubic-bezier(.6,0,.2,1) forwards}
.hw-strip .hw-arrow.hw-a2{animation-delay:.6s}.hw-strip .hw-arrow.hw-a3{animation-delay:1.2s}
.hw-strip .hw-arrow.hw-long{stroke-dasharray:1000;stroke-dashoffset:1000}
@keyframes hw-dash{to{stroke-dashoffset:0}}
.hw-step{display:grid;grid-template-columns:72px 1fr 1fr;gap:var(--s4);align-items:center;padding:var(--s4) 0;position:relative}
.hw-step::before{content:"";position:absolute;left:26px;top:0;bottom:0;width:4px;background:var(--paper-3);border-radius:2px}
.hw-step:first-child::before{top:50%}.hw-step:last-child::before{bottom:50%}
.hw-n{width:56px;height:56px;border-radius:50%;background:var(--ink);color:var(--paper);display:grid;place-items:center;font:700 26px/1 var(--hand);position:relative;z-index:1;box-shadow:0 0 0 8px var(--paper)}
.hw-step .hw-when{font:500 12px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.hw-step h2{font:700 clamp(28px,3.4vw,42px)/1.06 var(--sans);margin-top:8px}
.hw-step p{color:var(--ink-2);font-size:18px;margin-top:var(--s2);max-width:44ch}
.hw-step .pt-say{font-size:26px}
.hw-step .pt-art{min-height:340px}
.hw-step .pt-chat div{max-width:82%}
.hw-dragpt{width:100%;display:grid;gap:12px;justify-items:center}
.hw-dragpt svg{width:100%;max-width:440px;touch-action:none;overflow:visible}
.hw-dline{font-family:var(--hand);font-weight:700;font-size:28px;color:var(--pig);min-height:1.2em;text-align:center}
.hw-dline.hw-win{color:var(--mint)}
.hw-dq{font:600 19px/1.3 var(--sans);text-align:center}
.hw-dq i{font-style:normal;font-family:var(--hand);color:var(--pig);font-size:1.3em}
.hw-pt{cursor:grab}
.hw-pt:active{cursor:grabbing}
.hw-kinds{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%}
.hw-kinds div{background:var(--paper);border-radius:16px;padding:14px;display:grid;gap:8px;justify-items:center;text-align:center;font:500 13px/1.2 var(--sans);color:var(--ink-2)}
.hw-kinds svg{width:56px;height:56px;fill:none;stroke:var(--ink);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.hw-kinds svg .hw-p{stroke:var(--pig)}.hw-kinds svg .hw-f{fill:var(--pig);stroke:none}
.hw-week{width:100%;display:grid;gap:14px}
.hw-week .hand{font-size:26px;line-height:1.15}
.hw-week .hand em{font-style:normal;color:var(--rose)}
.hw-chart{display:flex;align-items:flex-end;gap:8px;height:110px}
.hw-chart i{flex:1;background:var(--pig);border-radius:8px 8px 4px 4px;opacity:.85}
.hw-chart i.hw-k{background:var(--paper-3);opacity:1}
.hw-days{display:flex;gap:8px}
.hw-days span{flex:1;text-align:center;font:500 12px/1 var(--sans);color:var(--ink-3)}
.hw-note{background:var(--paper);border-radius:18px;padding:22px 24px;width:100%;transform:rotate(-1.5deg);box-shadow:0 18px 40px rgba(20,20,43,.10)}
.hw-note .hw-d{font-family:var(--hand);font-weight:600;font-size:20px;color:var(--ink-3)}
.hw-note .hand{font-size:26px;line-height:1.15;margin-top:8px}
.hw-note .hand em{font-style:normal;color:var(--rose)}
.hw-sig{margin-top:12px;display:flex;align-items:center;gap:8px;font-family:var(--hand);font-weight:700;font-size:22px}
@media (max-width:900px){
  .hw-step{grid-template-columns:1fr;gap:var(--s3)}.hw-step::before{display:none}.hw-step .pt-art{min-height:0}
}

/* --- /subjects ------------------------------------------------------------------------------ */
.sb-hero{padding:var(--s5) 0 var(--s4);text-align:center}
.sb-hero h1{font:700 clamp(38px,5.4vw,66px)/1.0 var(--sans);letter-spacing:-.035em;margin:var(--s2) auto 0;max-width:16ch}
.sb-hero h1 em{font-style:normal;color:var(--pig)}
.sb-hero p.pt-sub{font-size:19px;color:var(--ink-2);max-width:52ch;margin:var(--s3) auto 0}
.sb-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s2);margin-top:var(--s5)}
.sb-tiles a{border-radius:24px;padding:var(--s3);background:var(--paper-2);display:grid;gap:12px;justify-items:start;text-align:left;transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;position:relative}
.sb-tiles a:hover{transform:translateY(-6px) rotate(-1deg);box-shadow:0 22px 44px rgba(20,20,43,.14)}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.sb-tiles svg{width:100%;height:auto;aspect-ratio:4/3;overflow:visible}
.sb-tiles b{font:600 20px/1.2 var(--sans)}
.sb-tiles span{font-size:14px;color:var(--ink-2)}
.sb-tiles .sb-go{margin-top:4px;font:500 14px/1 var(--sans);color:var(--pig)}
.sb-boards{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);align-items:center;margin-top:var(--s5)}
.sb-boards h2{font:700 clamp(26px,3vw,36px)/1.08 var(--sans);margin-top:8px}
.sb-boards p{color:var(--ink-2);margin-top:var(--s2)}
.sb-type{background:var(--paper);border-radius:18px;padding:10px;display:grid;gap:8px;box-shadow:0 18px 40px rgba(20,20,43,.10)}
.sb-type .sb-in{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:var(--paper-2);font-size:16px}
.sb-type .sb-in i{width:2px;height:20px;background:var(--pig);animation:pt-cur 1s steps(2) infinite}
.sb-type .sb-opt{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:12px;font-size:15px}
.sb-type .sb-opt.sb-lit{background:var(--pig-w)}
.sb-type .sb-opt span{font-size:12px;color:var(--ink-3)}
.sb-type .sb-opt b{font-weight:500}
.sb-type .sb-opt b mark{background:transparent;color:var(--pig);font-weight:700}
.sb-type .sb-own{padding:10px 14px;font-size:14px;color:var(--ink-2);border-top:2px solid var(--paper-2)}
.sb-type .sb-own b{color:var(--pig)}
.sb-k{display:inline-flex;align-items:center;gap:8px;font:500 12px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.sb-k i{width:10px;height:10px;border-radius:50%;background:var(--pig)}
.sb-k i.sb-mint{background:var(--mint)}.sb-k i.sb-marigold{background:var(--marigold)}.sb-k i.sb-lilac{background:var(--lilac)}
.sb-chapter h2{margin-top:10px}
.sb-span{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:var(--s3)}
.sb-span div{background:var(--paper-2);border-radius:16px;padding:14px 16px;font-size:14px;color:var(--ink-2)}
.sb-span b{display:block;color:var(--ink);font-weight:600;font-size:15px;margin-bottom:4px}
.sb-chapter .pt-say{font-size:26px}
.sb-chapter .pt-art{min-height:360px}
@media (max-width:900px){
  .sb-tiles{grid-template-columns:1fr 1fr}
  .sb-boards{grid-template-columns:1fr}
  .sb-span{grid-template-columns:1fr}
}
@media (max-width:560px){.sb-tiles{grid-template-columns:1fr}}

/* --- less motion: the drawn thing is simply there --------------------------------------------- */
@media (prefers-reduced-motion:reduce){
  html:has(.pt){scroll-behavior:auto}
  .pt-blink,.mt-wave rect,.mt-ring,.mt-bubble .mt-cur,.sb-type .sb-in i{animation:none}
  .pt-draw,.sc-flow .sc-fdraw{stroke-dashoffset:0}
  .pt-chapter h2 .pt-hl::before{transform:scaleX(1)}
  .sc-shield .sc-draw{animation:none;stroke-dashoffset:0}
  .sc-shield .sc-fill,.sc-shield .sc-eyes,.sc-shield .sc-hw{animation:none;opacity:1}
  .pa-env .pa-letter,.pa-env .pa-flap{animation:none;transform:none}.pa-env .pa-flap{transform:scaleY(-1)}
  .su-lasso{animation:none;stroke-dashoffset:0}.su-q{animation:none;opacity:1}
  .hw-strip .hw-arrow{animation:none;stroke-dashoffset:0}
  .sb-tiles a:hover{transform:none}
  .su-grid4 svg path,.su-grid4 svg text,.mt-stage .wk-head,.mt-say,.mt-ring,.st-reveal{transition:none}
}
[data-motion="reduce"] .pt-blink,[data-motion="reduce"] .mt-wave rect,[data-motion="reduce"] .mt-ring,[data-motion="reduce"] .mt-bubble .mt-cur,[data-motion="reduce"] .sb-type .sb-in i{animation:none}
[data-motion="reduce"] .pt-draw,[data-motion="reduce"] .sc-flow .sc-fdraw{stroke-dashoffset:0}
[data-motion="reduce"] .pt-chapter h2 .pt-hl::before{transform:scaleX(1)}
[data-motion="reduce"] .sc-shield .sc-draw{animation:none;stroke-dashoffset:0}
[data-motion="reduce"] .sc-shield .sc-fill,[data-motion="reduce"] .sc-shield .sc-eyes,[data-motion="reduce"] .sc-shield .sc-hw{animation:none;opacity:1}
[data-motion="reduce"] .pa-env .pa-letter{animation:none;transform:none}[data-motion="reduce"] .pa-env .pa-flap{animation:none;transform:scaleY(-1)}
[data-motion="reduce"] .su-lasso{animation:none;stroke-dashoffset:0}[data-motion="reduce"] .su-q{animation:none;opacity:1}
[data-motion="reduce"] .hw-strip .hw-arrow{animation:none;stroke-dashoffset:0}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensurePitchStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PITCH_CSS;
  document.head.appendChild(style);
}
