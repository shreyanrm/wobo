/**
 * The growth pages' own sheet: the glossary, the exam-cycle pages and the side-by-side pages.
 *
 * It is short on purpose. These pages wear the public site's shell and almost all of its furniture
 * — `.st-wrap`, `.st-section`, `.st-head`, `.st-tile`, `.st-scroll` and `.st-grid` for a table,
 * `.st-note`, `.st-prose`, `.st-ask`, `.st-close` — because a reader who arrives on a glossary page
 * from a search and then walks to the plans page must not be able to tell they changed sites. What
 * is here is only what the site did not already have:
 *
 *   the SOURCE LINE      one document, its title, and the day we read it, set small and quiet under
 *                        the thing it supports. It is the most important content on these pages and
 *                        the least loud, which is the DESIGN.md rule for a trust signal.
 *   the PLACEMENT CARD   a chapter on one board, on a page that lists the same idea on four. A row
 *                        in a table loses the objectives underneath it, so this is a card.
 *   the FACT ROW         two columns of the same question, side by side, that become two stacked
 *                        blocks on a phone with the column's name repeated, because a table that
 *                        scrolls sideways on a phone is a table nobody reads.
 *   the INDEX COLUMNS    a long alphabetical list that reads down, not across.
 *
 * Law v5 (DESIGN.md §0 and §2): no border lines anywhere, no tinted section ground, a card is
 * `--paper-2`, corners 10 / 16 / 24 and up, every colour a token.
 */

const STYLE_ID = 'wobo-growth';

export const GROWTH_CSS = `
/* --- the page head ---------------------------------------------------------------------------- */
.gw-head{display:grid;gap:var(--s2);max-width:70ch;margin:0}
.gw-head h1{font:700 clamp(30px,4vw,50px)/1.05 var(--sans);letter-spacing:-.03em}
/* The lead sits OUTSIDE the <header> (see the note in Exams.tsx), so it is spaced as its own
   block rather than as a row of the heading's grid. It still reads as part of the opening. */
.gw-lead{color:var(--ink-2);font-size:18px;line-height:1.6;max-width:70ch;margin:var(--s2) 0 var(--s4)}
.gw-head .gw-kin{font:500 13px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--pig)}

/* the standing note: what this page is, and what it is not. Quiet, and never a warning colour. */
.gw-standing{background:var(--paper-2);border-radius:20px;padding:20px var(--s3);color:var(--ink-2);font-size:15px;line-height:1.6;max-width:78ch;margin:0 0 var(--s4)}

/* --- a source line ---------------------------------------------------------------------------- */
.gw-src{display:grid;gap:2px;font-size:13px;line-height:1.5;color:var(--ink-3);margin-top:10px}
.gw-src a{color:var(--pig);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.gw-src .gw-hash{font-variant-numeric:tabular-nums;word-break:break-all}

/* --- the placement cards ---------------------------------------------------------------------- */
.gw-places{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s2);margin:0 0 var(--s4);padding:0;list-style:none}
.gw-place{background:var(--paper-2);border-radius:22px;padding:var(--s3);display:grid;gap:8px;align-content:start}
.gw-place .gw-board{font:600 13px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--pig)}
.gw-place h3{font:600 19px/1.25 var(--sans);margin:0}
.gw-place .gw-where{color:var(--ink-2);font-size:15px}
.gw-place ul{margin:6px 0 0;padding-left:20px;color:var(--ink-2);font-size:15px;display:grid;gap:6px}
.gw-place li::marker{color:var(--marigold)}

/* --- the fact rows (side by side) ------------------------------------------------------------- */
.gw-facts{display:grid;gap:var(--s2);margin:0 0 var(--s4);padding:0;list-style:none}
.gw-fact{background:var(--paper-2);border-radius:24px;padding:var(--s3);display:grid;gap:var(--s2)}
.gw-fact>h3{font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin:0}
.gw-cols{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s3)}
.gw-col{display:grid;gap:6px;align-content:start}
.gw-col b{font:600 15px/1.2 var(--sans);color:var(--ink)}
.gw-col p{color:var(--ink-2);font-size:16px;line-height:1.55;margin:0}
.gw-col q{font-style:normal;color:var(--ink);quotes:'\\201C' '\\201D'}

/* --- a list of documents ---------------------------------------------------------------------- */
.gw-docs{margin:0;padding:0;list-style:none;display:grid;gap:var(--s2);max-width:74ch}
.gw-docs li{background:var(--paper-2);border-radius:18px;padding:16px var(--s3);display:grid;gap:4px}
.gw-doc{font:500 16px/1.4 var(--sans);color:var(--pig);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;display:inline-block;min-height:44px;align-content:center}

/* --- the index ------------------------------------------------------------------------------- */
.gw-group{margin:0 0 var(--s4)}
.gw-group h2{font:700 clamp(22px,2.4vw,28px)/1.15 var(--sans);margin:0 0 var(--s2)}
.gw-list{columns:3;column-gap:var(--s3);margin:0;padding:0;list-style:none}
.gw-list li{break-inside:avoid;margin:0 0 10px}
.gw-list a{display:grid;gap:2px;padding:8px 0;min-height:44px;align-content:center}
.gw-list b{font:500 16px/1.3 var(--sans);color:var(--ink)}
.gw-list span{font-size:13px;color:var(--ink-3)}
.gw-list a:hover b{color:var(--pig)}

/* --- the honest limits ------------------------------------------------------------------------ */
.gw-limits{margin:0;padding-left:22px;color:var(--ink-2);font-size:16px;line-height:1.6;display:grid;gap:12px;max-width:74ch}
.gw-limits li::marker{color:var(--pig)}

/* the "last checked" line, at the foot of a page that lives or dies on being current */
.gw-checked{margin:var(--s3) 0 0;color:var(--ink-3);font-size:14px}

@media (max-width:900px){
  .gw-places{grid-template-columns:1fr}
  .gw-cols{grid-template-columns:1fr}
  .gw-list{columns:2}
}
@media (max-width:560px){
  .gw-list{columns:1}
}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensureGrowthStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = GROWTH_CSS;
  document.head.appendChild(style);
}
