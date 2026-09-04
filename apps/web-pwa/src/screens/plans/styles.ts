/**
 * The plans page's own stylesheet — the period control, the billed line under a price, the sentence
 * that closes the cards, and the marker on the payment door that is not open yet.
 *
 * WHY IT IS A SECOND SHEET rather than more rules in `screens/site/styles.ts`: that sheet is the
 * whole public site's, owned and tested elsewhere. These rules belong to one page and are injected
 * by it, after the site sheet (`SiteShell` injects that one at module scope, and this page imports
 * `SiteShell` before it imports this file), so the cascade order is the file order and never a
 * surprise. Nothing here restates a site rule; every selector below is a class this page adds.
 *
 * TRAP 1 (DESIGN.md §0): every class here is namespaced `pl-` and was grepped against the shell it
 * renders inside before it was written — `pl-per`, `pl-seg`, `pl-pill`, `pl-save`, `pl-billed`,
 * `pl-close-line`, `pl-pay` and `pl-soon` appear nowhere else in `src/`.
 *
 * WHAT IS NOT HERE ANY MORE: `pl-taken`, the sentence that stated the annual total and the day of
 * the next charge. docs/PRICING.md forbids the total on this page and billing.py forbids naming a
 * charge nothing in this repo can take, so the rule went with the element. `.pl-checkout .pl-total`
 * in `screens/site/styles.ts` (two rules) is now dead for the same reason and belongs to the site
 * wave to remove.
 *
 * TRAP 2: the two segment buttons are pinned to `grid-row:1`, so neither can be pushed onto a row
 * of its own by auto-placement.
 *
 * THE INDICATOR ONLY EVER TRANSLATES. Both segments are the same width, so a transform is the whole
 * animation: transitioning its width would be a layout property animating, which is the second of
 * law v5's three causes of jitter. Nothing else on this page transitions at all.
 */

const STYLE_ID = 'wobo-plans';

export const PLANS_CSS = `
/* --- how you would like to pay -------------------------------------------------------------- */
.pl-per{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin:0 0 var(--s4)}
.pl-seg{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:264px;max-width:100%;background:var(--paper-2);padding:4px;border-radius:999px}
.pl-seg .pl-pill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:999px;background:var(--ink);transform:translateX(0);transition:transform .34s cubic-bezier(.2,.8,.2,1);pointer-events:none}
.pl-per[data-period="monthly"] .pl-pill{transform:translateX(100%)}
.pl-seg>button{grid-row:1;position:relative;z-index:1;font:500 14px/1 var(--sans);border:0;background:transparent;color:var(--ink-2);padding:11px 8px;border-radius:999px;cursor:pointer;min-height:44px}
.pl-seg>button[aria-pressed="true"]{color:var(--paper)}
.pl-save{font:500 13px/1 var(--sans);color:var(--ink);background:var(--marigold-w);padding:10px 14px;border-radius:999px}
/* THE PILL STEPS BACK ON THE MONTHLY PERIOD, IT DOES NOT FADE. It used to carry opacity:.42, which
   took 13px text to 2.68:1 by day and 3.42:1 at night — far under the 4.5:1 AA floor — while it was
   still live, readable, unhidden text saying "two months free". Dimming information is not the same
   as marking it inactive. It loses the highlighter instead: a quiet surface, full-strength ink,
   6.15:1 by day and 7.97:1 at night. */
.pl-per[data-period="monthly"] .pl-save{background:var(--paper-3);color:var(--ink-2)}

/* --- the words under a price, and the sentence under the cards ------------------------------- */
/* SMALL PRINT IS STILL TEXT SOMEBODY HAS TO READ. This is the line the whole period control exists
   to keep on the card, and it was ported at --ink-3: 13px at weight 400 measures 3.13:1 on
   --paper-2 by day, under AA. The prototype's own rule is --ink-2 (site-plans.html:166) and the
   port swapped it; --ink-2 is 6.71:1 by day and 8.69:1 at night. */
.pl-plan .pl-billed{margin-top:-8px;font:400 13px/1.35 var(--sans);color:var(--ink-2);font-variant-numeric:tabular-nums}
/* The Max card is painted --ink and lettered --paper, so it is DARK BY DAY AND LIGHT AT NIGHT: the
   two tokens swap. The prototype pinned #A9A9BD here with the comment "the Max card is dark in
   both themes", which was not true even of the prototype, and the 55% mix that replaced it landed
   at 4.11:1 on the night card. 70% of the card's own letter colour is a step quieter than the
   price above it and clears AA both ways: 9.14:1 by day, 6.95:1 at night. */
.pl-plan.pl-max .pl-billed{color:color-mix(in srgb,var(--paper) 70%,transparent)}
.pl-close-line{max-width:60ch;margin:var(--s4) auto 0;text-align:center;color:var(--ink-2);font-size:17px}

/* --- the door that is not open yet ------------------------------------------------------------ */
/* The payment control keeps its shape and carries a marker, exactly as an unwired door does on the
   two auth screens (.au-soon). Marker text on --marigold-w with --ink is 16.8:1 by day and 11.8:1
   at night, so it needs no dark override and names no literal. */
.pl-checkout .pl-pay{cursor:default;justify-content:space-between;gap:12px}
.pl-checkout .pl-soon{font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;background:var(--marigold-w);color:var(--ink);padding:6px 9px;border-radius:999px}

@media (prefers-reduced-motion:reduce){.pl-seg .pl-pill{transition:none}}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensurePlansStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PLANS_CSS;
  document.head.appendChild(style);
}
