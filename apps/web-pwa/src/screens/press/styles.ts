/**
 * /press's own stylesheet, on top of the site shell's (`site/styles.ts`), which already carries the
 * header, the pill nav, the buttons, the chapter head, the tiles and the footer.
 *
 * The page is a WORKING DOCUMENT rather than a pitch, and the design follows from that: a
 * journalist opens it to take something. So every liftable block is a panel with its own copy
 * control in the same place, the facts are a table that survives being pasted into a document, and
 * nothing animates in front of the text. The one piece of warmth is the hand under the founder,
 * which is the same Caveat every other page writes in.
 *
 * The laws (DESIGN.md §2): no border lines, surfaces separate by tone and space; corners 10 / 16 /
 * 24 and up; a soft tinted shadow only under what floats; Poppins for every word and Caveat only
 * for what Wobo writes; every colour a law-v5 token, and no tinted section ground: the paper is
 * white and a panel is `--paper-2`.
 */

const STYLE_ID = 'wobo-press';

export const PRESS_CSS = `
/* --- the head ------------------------------------------------------------------------------- */
.pr-hero{padding:var(--s6) 0 var(--s4)}
.pr-hero h1{font:700 clamp(32px,4.6vw,54px)/1.04 var(--sans);letter-spacing:-.03em;max-width:18ch}
.pr-hero p{color:var(--ink-2);font-size:18px;max-width:60ch;margin-top:var(--s2)}
.pr-hero .pr-jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--s3)}
.pr-hero .pr-jump a{font:500 14px/1 var(--sans);color:var(--ink-2);background:var(--paper-2);padding:10px 14px;border-radius:999px}
.pr-hero .pr-jump a:hover{color:var(--ink)}

/* --- a liftable block: the words, and one control to take them ------------------------------ */
.pr-block{background:var(--paper-2);border-radius:24px;padding:var(--s3);display:grid;gap:var(--s2)}
.pr-block .pr-top{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap}
.pr-block h3{font:600 19px/1.25 var(--sans);margin:0}
.pr-block .pr-where{color:var(--ink-3);font-size:14px}
.pr-block .pr-copy{margin-left:auto}
.pr-words{display:grid;gap:14px;font-size:17px;line-height:1.62;color:var(--ink)}
.pr-words.pr-lead{font:500 clamp(19px,2.2vw,24px)/1.4 var(--sans);letter-spacing:-.01em}
.pr-copy{font:500 14px/1 var(--sans);background:var(--paper);color:var(--ink);border:0;border-radius:10px;padding:10px 14px;min-height:40px;cursor:pointer}
.pr-copy:hover{background:var(--ink);color:var(--paper)}
.pr-copy[data-done="yes"]{background:var(--mint);color:#14142B}
.pr-stack{display:grid;gap:var(--s2)}

/* --- the facts ------------------------------------------------------------------------------ */
.pr-facts{display:grid;gap:0;background:var(--paper-2);border-radius:24px;padding:6px var(--s3) var(--s3);overflow-x:auto}
.pr-facts .pr-row{display:grid;grid-template-columns:160px 1fr;gap:var(--s2);padding:14px 0;align-items:baseline}
.pr-facts .pr-row+.pr-row{box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 8%,transparent)}
.pr-facts dt{font:600 15px/1.4 var(--sans);color:var(--ink-2);margin:0}
.pr-facts dd{margin:0;font-size:17px;color:var(--ink)}

/* --- the founder ---------------------------------------------------------------------------- */
.pr-founder{background:var(--paper-2);border-radius:24px;padding:var(--s3);display:grid;gap:8px;max-width:52ch}
.pr-founder b{font:600 21px/1.2 var(--sans)}
.pr-founder span{color:var(--ink-2);font-size:15px}
.pr-founder .hand{font-family:var(--hand);font-weight:600;font-size:22px;line-height:1.2;color:var(--pig)}

/* --- the files ------------------------------------------------------------------------------ */
.pr-files{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.pr-file{background:var(--paper-2);border-radius:22px;padding:var(--s3);display:grid;gap:10px;align-content:start;color:var(--ink)}
.pr-file .pr-art{height:90px;display:grid;place-items:center;background:var(--paper);border-radius:14px;padding:0 18px}
.pr-file .pr-art svg{width:100%;height:auto;max-height:44px;color:var(--ink)}
.pr-file b{font:600 17px/1.25 var(--sans)}
.pr-file span{color:var(--ink-2);font-size:14.5px}
.pr-file em{font-style:normal;color:var(--ink-3);font-size:13px}
a.pr-file{transition:transform .18s ease,box-shadow .18s ease}
a.pr-file:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(20,20,43,.10)}

/* --- the screenshots ------------------------------------------------------------------------ */
.pr-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.pr-shot{display:grid;gap:10px;align-content:start;color:var(--ink)}
.pr-shot img{width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top center;border-radius:18px;background:var(--paper-2);box-shadow:0 6px 20px rgba(20,20,43,.10)}
.pr-shot b{font:600 17px/1.25 var(--sans)}
.pr-shot span{color:var(--ink-2);font-size:14.5px}
.pr-shot em{font-style:normal;color:var(--ink-3);font-size:13px}

/* --- the contact ---------------------------------------------------------------------------- */
.pr-reach{display:grid;grid-template-columns:1.15fr .85fr;gap:var(--s3);align-items:start}
.pr-reach .pr-block{align-content:start}
.pr-mail{font:600 clamp(22px,2.8vw,30px)/1.2 var(--sans);color:var(--pig);word-break:break-word}
.pr-note{color:var(--ink-2);font-size:15.5px;max-width:52ch}

@media (max-width:860px){
  .pr-files,.pr-shots{grid-template-columns:1fr}
  .pr-reach{grid-template-columns:1fr}
  .pr-facts .pr-row{grid-template-columns:1fr;gap:4px;padding:12px 0}
}

@media print{
  .pr-copy,.pr-hero .pr-jump{display:none !important}
  .pr-block,.pr-facts,.pr-founder,.pr-file{background:var(--paper);box-shadow:none}
}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensurePressStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PRESS_CSS;
  document.head.appendChild(style);
}
