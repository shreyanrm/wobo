/**
 * THE donate page's stylesheet — one sheet, one id, injected once on top of the site shell's
 * (`site/styles.ts`), which already carries the header, the pill nav, the buttons, the chapter
 * head, the prose, the close panel and the footer. Nothing here touches a rule the shell owns.
 *
 * Every rule is `design/prototypes/site-donate.html`, ported declaration for declaration, under the
 * page prefix the prototype itself chose: `dn-`. It namespaces every one of its classes for the
 * reason DESIGN.md §0 records as the first of the six traps — `.sub`, `.quiet` and `.ask` each
 * meant one thing in a shell and another in a section, and each printed a stray box — so the
 * prototype's `.hero`, `.sub` and `.row` become `.dn-hero`, `.dn-sub` and `.dn-row` here rather
 * than joining the shell's.
 *
 * TWO deliberate changes from the prototype, both law v5 (DESIGN.md §0) catching up with it. The
 * law is that a wash may tint a pill, a tick or a selected row and NEVER a card, a tile, a panel or
 * a section; surfaces separate by tone, by space and by shape.
 *
 *  · the middle place card is `--pig-w` in the prototype. Here it is `--paper-2` with an inset
 *    3px pig ring, which is the exact conversion the plans page already made for the same card
 *    shape (`.pl-plan.pl-pro` in `site/styles.ts`). The pigment still points; it no longer washes.
 *  · the family's panel is `--lilac-w` in the prototype. Here it is `--paper-2`, and it keeps its
 *    weight the way the law says weight is made: it is the largest surface on the page, at the
 *    page's largest padding, with the only floating white card on the page sitting inside it. The
 *    copy's rule that both readers are equal and that the family's section is not a footnote is
 *    kept by size and space rather than by a tint.
 *
 * And one change the NIGHT theme asked for. The twin panels are `--paper` in the prototype, which
 * floats a white card on white paper beautifully and becomes invisible the moment the paper is
 * #0E0E16 and the shadow is black: a card the same colour as the ground it sits on, with no edge.
 * Night is designed, never inverted (DESIGN.md §0), so the panel takes `--paper-2` and its board
 * and chips take `--paper-3` in BOTH themes. One rule, one step of tone either side of it, and the
 * shadow still says the thing floats.
 *
 * Nothing here animates. The only motion on the page is the shell's own reveal, which owns opacity
 * and transform and nothing else, so none of the three causes of jitter (§0) is available to it.
 */

const STYLE_ID = 'wobo-donate';

export const DONATE_CSS = `
/* --- the hero: centred, the way the drawing sets it ------------------------------------------ */
.dn-hero{padding:var(--s5) 0 var(--s4);text-align:center}
.dn-hero h1{font:700 clamp(38px,5.4vw,64px)/1.0 var(--sans);letter-spacing:-.035em;margin:var(--s2) auto 0;max-width:18ch}
.dn-hero h1 em{font-style:normal;color:var(--pig)}
.dn-hero p.dn-sub{font-size:19px;color:var(--ink-2);max-width:52ch;margin:var(--s3) auto 0}
.dn-hero .dn-row{display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s4);flex-wrap:wrap}

/* an anchored section clears the sticky header when the page jumps to it */
.dn-anchor{scroll-margin-top:88px}

/* --- a chapter on this page ------------------------------------------------------------------ */
.dn-t{font:600 clamp(30px,4vw,46px)/1.08 var(--sans);max-width:20ch}
.dn-lede{margin-top:var(--s2);color:var(--ink-2);max-width:58ch}

/* --- the twins ------------------------------------------------------------------------------- */
/* The argument of this page is that the two panels are identical, so they are literally one
   component drawn twice and nothing here may make one look richer than the other. */
.dn-twins{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:var(--s4);align-items:center;margin-top:var(--s5)}
.dn-twin{margin:0;min-width:0}
.dn-twin figcaption{margin-top:var(--s3);text-align:center;font:500 14px/1.45 var(--sans);color:var(--ink-2);text-wrap:balance}
.dn-vs{color:var(--ink-3);font-size:22px;text-align:center;transform:rotate(-4deg)}
.dn-mini{background:var(--paper-2);border-radius:22px;box-shadow:var(--shadow);padding:18px;display:grid;gap:14px}
.dn-top{display:flex;align-items:center;gap:10px;min-width:0}
.dn-face{flex:0 0 auto;line-height:0}
.dn-top > span{font:500 14px/1.35 var(--sans);color:var(--ink);min-width:0}
.dn-board{background:var(--paper-3);border-radius:14px;padding:10px}
.dn-board svg{display:block;width:100%;height:auto}
.dn-chips{display:flex;flex-wrap:wrap;gap:6px}
.dn-chips > i{font:500 12px/1 var(--sans);font-style:normal;padding:8px 11px;border-radius:999px;background:var(--paper-3);color:var(--ink-2)}
.dn-chips > i.dn-lit{background:var(--pig);color:#fff}
.dn-foot{display:flex;align-items:center;gap:10px}
.dn-foot > b{font:500 13px/1 var(--sans);color:var(--ink-2)}
.dn-ring{width:18px;height:18px;border-radius:50%;flex:0 0 auto;background:conic-gradient(var(--mint) 0 78%,var(--paper-3) 78% 100%);-webkit-mask:radial-gradient(circle,transparent 50%,#000 52%);mask:radial-gradient(circle,transparent 50%,#000 52%)}

/* --- the three steps: numbered, because they happen in that order ----------------------------- */
.dn-steps{list-style:none;margin:var(--s5) 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--colgap)}
.dn-steps > li{min-width:0;display:grid;gap:10px;align-content:start}
.dn-steps > li > b{font:600 13px/1 var(--sans);letter-spacing:.1em;color:var(--pig)}
.dn-steps > li > h3{font:600 21px/1.2 var(--sans)}
.dn-steps > li > p{color:var(--ink-2);font-size:15px}

/* --- the four rules, stated where a reader sees all four at once ------------------------------ */
.dn-rules{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2)}
.dn-rules > li{min-width:0;background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:8px;align-content:start}
.dn-rules > li > b{font:600 16px/1.3 var(--sans)}
.dn-rules > li > p{color:var(--ink-2);font-size:15px}

/* --- what a place costs ---------------------------------------------------------------------- */
.dn-places{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin-top:var(--s5);align-items:stretch}
.dn-place{min-width:0;background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:12px;align-content:start}
.dn-place.dn-lead{background:var(--paper-2);box-shadow:inset 0 0 0 3px var(--pig)}
.dn-place > b{font:600 15px/1.3 var(--sans)}
.dn-price{font:600 clamp(26px,3vw,34px)/1 var(--sans);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.dn-place > p{color:var(--ink-2);font-size:14px;min-height:2.8em}
.dn-place .st-btn{width:100%}
/* a length whose price nobody has set yet, drawn as the gap it is rather than as a number */
.dn-slot{font:500 15px/1.4 var(--sans);letter-spacing:0;color:var(--ink-3);background:var(--paper);border-radius:10px;padding:6px 10px;display:inline-block}
.dn-fine{margin-top:var(--s3);color:var(--ink-3);font-size:14px}
.dn-fine a{margin-left:8px}

/* --- what it is not: a list of denials reads as a list, not as cards -------------------------- */
.dn-nots{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;gap:2px;max-width:62ch}
.dn-nots > li{padding:16px 0 16px 34px;position:relative;color:var(--ink-2);font-size:16px}
.dn-nots > li + li{box-shadow:inset 0 1px 0 var(--line)}
.dn-nots > li::before{content:"";position:absolute;left:6px;top:22px;width:14px;height:2px;border-radius:2px;background:var(--rose)}

/* --- the family's half, which is not a footnote ----------------------------------------------- */
.dn-ask{background:var(--paper-2);border-radius:28px;padding:clamp(28px,5vw,64px);display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:var(--colgap);align-items:center;margin-top:var(--s2)}
.dn-ask-say{display:grid;gap:var(--s2);justify-items:start;min-width:0}
.dn-ask-say > h2{font:600 clamp(26px,3.4vw,40px)/1.12 var(--sans);max-width:20ch}
.dn-ask-say > p{color:var(--ink-2);max-width:52ch}
.dn-note{color:var(--ink-3);font-size:19px}
.dn-eg{min-width:0;background:var(--paper);border-radius:20px;padding:var(--s3);display:grid;gap:10px;box-shadow:var(--lift)}
.dn-eg-label{font:500 12px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.dn-eg-line{font:500 clamp(17px,2vw,21px)/1.4 var(--sans);color:var(--pig);overflow-wrap:anywhere;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.dn-eg-foot{font:400 14px/1.4 var(--sans);color:var(--ink-2)}

/* --- a phone ---------------------------------------------------------------------------------- */
@media (max-width:900px){
  .dn-twins{grid-template-columns:1fr;gap:var(--s3)}
  .dn-vs{transform:rotate(-2deg)}
  .dn-steps{grid-template-columns:1fr;gap:var(--s4)}
  .dn-rules{grid-template-columns:1fr}
  .dn-places{grid-template-columns:1fr}
  .dn-place > p{min-height:0}
  .dn-ask{grid-template-columns:1fr}
}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensureDonateStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DONATE_CSS;
  document.head.appendChild(style);
}
