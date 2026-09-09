/**
 * The blog's own rules, in a sheet of their own.
 *
 * They are NOT in `site/styles.ts`, and that is deliberate twice over. The site sheet is held rule
 * by rule to the prototypes it was ported from (`site/styles.test.ts`), and the blog has no
 * prototype: adding rules with no source to a file whose whole point is that every rule has one
 * would weaken the test that keeps the rest honest. And a visitor reading /plans should not
 * download the article layout.
 *
 * Everything below is built from the primitives the site sheet already defines. No colour is
 * written literally: every one is a law-v5 token (DESIGN.md §0), there are no border lines, the
 * corners are 10 / 16 / 24 and the only shadow is the soft tinted one under a thing that floats.
 * The article column is set at a measure a person can actually read, which is the one thing a
 * blog has to get right.
 */

const STYLE_ID = 'wobo-blog';

export const BLOG_CSS = `
/* --- the index and the tag pages ------------------------------------------------------------ */
.bl-list{display:flex;flex-direction:column;gap:var(--s3)}
.bl-card{display:block;background:var(--paper-2);border-radius:24px;padding:var(--s4)}
.bl-card h2{font:600 24px/1.25 var(--sans);margin:0 0 10px}
.bl-card p{color:var(--ink-2);max-width:68ch}
.bl-card:hover h2{color:var(--pig)}
.bl-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;color:var(--ink-2);font:400 14px/1.5 var(--sans);margin-bottom:12px}
.bl-meta .bl-dot{width:3px;height:3px;border-radius:999px;background:var(--ink-2);opacity:.55;display:inline-block}
.bl-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--s3)}
.bl-tag{background:var(--paper-2);border-radius:999px;padding:8px 14px;font:500 14px/1 var(--sans);color:var(--ink-2)}
.bl-tag:hover,.bl-tag[aria-current="page"]{background:var(--ink);color:var(--paper)}
.bl-count{color:var(--ink-2);font:400 15px/1.6 var(--sans);margin-top:12px}

/* --- one post ------------------------------------------------------------------------------- */
.bl-article{width:min(720px,calc(100% - 48px));margin:0 auto;padding:var(--s5) 0 var(--s6)}
.bl-article h1{font:700 clamp(30px,4.4vw,44px)/1.12 var(--sans);margin:0 0 var(--s3)}
.bl-lead{font:400 clamp(19px,2.2vw,22px)/1.55 var(--sans);color:var(--ink);margin:0 0 var(--s4)}
.bl-article .st-prose{font-size:18px;line-height:1.72}
.bl-article .st-prose h2{font:600 25px/1.3 var(--sans);margin:var(--s5) 0 var(--s2)}
.bl-article .st-prose p{margin:0 0 var(--s3);color:var(--ink);max-width:68ch}
.bl-article .st-prose ul,.bl-article .st-prose ol{margin:0 0 var(--s3);padding-left:1.2em;color:var(--ink)}
.bl-article .st-prose li{margin:0 0 8px}
.bl-article .st-prose blockquote{margin:0 0 var(--s3);padding:var(--s3);background:var(--paper-2);border-radius:16px;color:var(--ink-2)}

/* --- the byline, which is a DIV and not a paragraph ------------------------------------------ */
/* The pre-render reads a page's opening paragraphs to write its description (scripts/prerender.ts).
   A byline set as a <p> would come first in the DOM and become the page's meta description on
   every post, so it is set as a row of spans and the lead is the first paragraph on the page. */
.bl-by{display:flex;flex-wrap:wrap;align-items:center;gap:10px;color:var(--ink-2);font:400 15px/1.6 var(--sans);margin:0 0 var(--s4)}
.bl-note{background:var(--paper-2);border-radius:16px;padding:var(--s3);color:var(--ink-2);font:400 15px/1.6 var(--sans);margin:var(--s5) 0 0}
.bl-note b{color:var(--ink);font-weight:600}
.bl-about{color:var(--ink-2);font:400 15px/1.6 var(--sans);margin:var(--s3) 0 0}
.bl-next{display:flex;flex-wrap:wrap;gap:var(--s3);margin:var(--s5) 0 0}
.bl-next a{background:var(--paper-2);border-radius:16px;padding:var(--s3);flex:1 1 260px}
.bl-next b{display:block;font:600 17px/1.35 var(--sans);margin-top:6px}
.bl-feed{color:var(--ink-2);font:400 15px/1.6 var(--sans);margin-top:var(--s4)}
.bl-feed a{text-decoration:underline}

@media (max-width:700px){
  .bl-article{width:calc(100% - 32px);padding-top:var(--s4)}
  .bl-card{padding:var(--s3)}
}
`;

/** Inject the sheet once. Called at import time by every blog page, like the site's own sheet. */
export function ensureBlogStyles(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BLOG_CSS;
  doc.head.appendChild(style);
}
