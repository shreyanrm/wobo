/**
 * The syllabus pages' own sheet, on top of the site shell's (`screens/site/styles.ts`), which
 * already draws the header, the footer, the ask block and the close panel.
 *
 * These pages are reference pages, and a reference page is read differently from a pitch page: a
 * reader arrives knowing what they want, scans for it, and leaves. So the rules here are about
 * scanning — a wide list that stays legible on a phone, a name that is bigger than everything
 * around it, and one quiet block for the provenance that never competes with the chapter.
 *
 * The laws of DESIGN.md §2 hold as everywhere else: no border lines, surfaces separate by tone and
 * space, corners at 10 / 16 / 24, a shadow only under what floats, Poppins for words and Caveat
 * only for what Wobo writes, and every colour a law-v5 token.
 */

const STYLE_ID = 'wobo-syllabus';

export const SYLLABUS_CSS = `
.sy{padding:40px 0 8px}
.sy .st-wrap{max-width:min(920px,calc(100% - 48px))}

/* --- the crumbs: where this sits, walkable up ------------------------------------------------- */
.sy-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font:500 14px/1.4 var(--sans);color:var(--ink-2);margin-bottom:20px}
.sy-crumbs a{color:var(--ink-2);border-radius:8px;padding:2px 4px}
.sy-crumbs a:hover{color:var(--ink)}
.sy-crumbs i{font-style:normal;opacity:.5}

/* --- the name, and the quiet line inside the same heading ------------------------------------- */
.sy-head{margin-bottom:16px}
.sy-head h1{display:flex;flex-direction:column;gap:8px;font:600 clamp(30px,5vw,44px)/1.12 var(--sans)}
.sy-head .sy-where{font:500 15px/1.3 var(--sans);color:var(--ink-2);letter-spacing:0;text-transform:none}
.sy-lead{margin:0 0 28px;font:400 19px/1.6 var(--sans);color:var(--ink);max-width:62ch}
.sy-none{margin-top:16px;font:400 17px/1.6 var(--sans);color:var(--ink-2);max-width:62ch}

/* The counted sentence under a handwritten opening: the same body size, quieter, because the
   opening is what a reader reads first and this is the line with the numbers in it. */
.sy-counted{margin:0 0 28px;font:400 17px/1.6 var(--sans);color:var(--ink-2);max-width:62ch}

/* The one question a landing page is really being asked, and its answer (Syllabus.tsx, Written). */
.sy-written{margin:36px 0;max-width:66ch}
.sy-written h2{font:600 clamp(19px,2.2vw,23px)/1.3 var(--sans);color:var(--ink);margin-bottom:10px}
.sy-written p{font:400 17px/1.65 var(--sans);color:var(--ink-2)}

/* --- the list of what is under this page ------------------------------------------------------ */
.sy-list{margin:32px 0}
.sy-list h2{font:600 15px/1.2 var(--sans);color:var(--ink-2);margin-bottom:12px}
.sy-list ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.sy-list li{margin:0}
.sy-list li a,.sy-list li .sy-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:14px 16px;border-radius:12px;background:var(--paper-2)}
.sy-list li a:hover{background:color-mix(in srgb,var(--pig) 8%,var(--paper-2))}
.sy-list b{font:500 17px/1.35 var(--sans);color:var(--ink)}
.sy-list span{font:400 14px/1.35 var(--sans);color:var(--ink-2);margin-left:auto}
.sy-list.sy-wide ul{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}

/* --- the provenance: quiet, and the reason this page is allowed to exist ----------------------- */
.sy-source{margin:36px 0;padding:20px 22px;border-radius:16px;background:var(--paper-2)}
.sy-source h2{font:600 15px/1.2 var(--sans);color:var(--ink-2);margin-bottom:10px}
.sy-source p{font:400 15px/1.6 var(--sans);color:var(--ink);max-width:70ch}
.sy-source p+p{margin-top:6px}
.sy-source a.sy-doc{display:inline-block;margin-top:12px;font:500 15px/1 var(--sans);color:var(--pig)}
.sy-source details{margin-top:12px}
.sy-source summary{font:500 14px/1.4 var(--sans);color:var(--ink-2);cursor:pointer}
.sy-source details ul{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:4px}
.sy-source details li{font:400 14px/1.5 var(--sans);color:var(--ink-2)}
.sy-hash{margin-top:10px;font:400 13px/1.5 var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--ink-2);word-break:break-all}
.sy-stale{margin-top:10px;font:500 14px/1.5 var(--sans);color:var(--ink)}

/* --- the way on: up, and the two beside ------------------------------------------------------- */
.sy-around{margin:36px 0 44px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.sy-around a{display:block;padding:14px 16px;border-radius:12px;background:var(--paper-2)}
.sy-around a:hover{background:color-mix(in srgb,var(--pig) 8%,var(--paper-2))}
.sy-around em{display:block;font:500 13px/1.4 var(--sans);font-style:normal;color:var(--ink-2);margin-bottom:2px}
.sy-around b{font:500 16px/1.35 var(--sans);color:var(--ink)}

/* --- the boards strip on a subject hub --------------------------------------------------------- */
.sy-hub{margin:32px 0;display:grid;gap:10px}
.sy-hub section{padding:18px 20px;border-radius:16px;background:var(--paper-2)}
.sy-hub h2{font:600 17px/1.25 var(--sans);color:var(--ink);margin-bottom:4px}
.sy-hub p{font:400 14px/1.5 var(--sans);color:var(--ink-2)}
.sy-hub .sy-links{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
.sy-hub .sy-links a{padding:8px 14px;border-radius:999px;background:var(--paper);font:500 14px/1.2 var(--sans);color:var(--ink)}

@media (max-width:720px){
  .sy{padding:24px 0 4px}
  .sy .st-wrap{max-width:calc(100% - 32px)}
  .sy-list li a,.sy-list li .sy-row{padding:12px 14px}
  .sy-list span{margin-left:0;flex-basis:100%}
}
`;

/** Inject the sheet once per document. Idempotent; a no-op wherever there is no document. */
export function ensureSyllabusStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SYLLABUS_CSS;
  document.head.appendChild(style);
}
