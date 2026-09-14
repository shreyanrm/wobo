/**
 * THE public site's stylesheet — the shell every site page wears, and the page rules for /about,
 * /help and every article, /plans and /plans/checkout, /gift, /contact, the two doors, the legal
 * set and /sitemap. One sheet, one id, injected once.
 *
 * Every shell rule is design/prototypes/site-plans.html (the header, the pill nav, the buttons,
 * the close panel, the footer, the reveal) and the ask block is site-about.html, ported
 * declaration for declaration under `st-` names; the About and Plans page rules are their
 * prototypes the same way. `styles.test.ts` holds each of those rules to its source.
 *
 * One deliberate change from the prototypes: the ink panels (the footer, the close panel, the team
 * panel, the Max card) tint their text with `rgba(250,247,240,.6)` — cream at sixty percent. On the
 * night theme the panel's ink IS cream, so that text vanished in the prototype's own dark frames.
 * Here the same tints are written as `color-mix(in srgb, var(--paper) 60%, transparent)`: the same
 * colour on paper, and navy at sixty percent on the cream panel at night. The test normalises the
 * two spellings before comparing.
 *
 * The laws that hold everywhere (DESIGN.md §2): no border lines — surfaces separate by tone, space
 * and shape; corners 10 / 16 / 24 and up; a soft tinted shadow only under what floats (the pinned
 * mission note, the checkout card, a sticker); Poppins for every word and Caveat only for what
 * Wobo writes; every colour a law-v5 token — and, since law v5 (DESIGN.md §0), no tinted section
 * ground anywhere: the paper is white, a card is `--paper-2`, and a wash may tint a pill, a tick or
 * a selected row but never a card, a tile, a panel or a section.
 */

const STYLE_ID = 'wobo-site';

export const SITE_CSS = `
/* --- the page ------------------------------------------------------------------------------- */
.st{background:var(--paper);color:var(--ink);font:400 17px/1.6 var(--sans);-webkit-font-smoothing:antialiased;overflow-x:clip;display:flex;flex-direction:column;min-height:100vh}
.st>main{flex:1 0 auto}
.st h1,.st h2,.st h3{margin:0;letter-spacing:-.025em;text-wrap:balance}
.st p{margin:0}
/* :where keeps this at class weight, so a button drawn on an anchor (.st-btn) keeps its own colour */
.st :where(a){color:inherit;text-decoration:none}
.st-wrap{width:min(1120px,calc(100% - 48px));margin:0 auto}
.st-btn{font:500 15px/1 var(--sans);padding:14px 20px;border-radius:12px;border:0;background:var(--ink);color:var(--paper);display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;cursor:pointer}
.st-btn.st-pig{background:var(--pig);color:#fff}
.st-btn.st-quiet{background:var(--paper-2);color:var(--ink)}
.st-btn.st-marigold{background:var(--marigold);color:#14142B}
.st-btn:disabled{cursor:not-allowed;opacity:.42}
.st .st-btn:focus-visible,.st input:focus-visible,.st button:focus-visible,.st summary:focus-visible,.st a:focus-visible,.st select:focus-visible,.st textarea:focus-visible{outline:3px solid var(--marigold);outline-offset:2px}
.st-skip{position:fixed;left:12px;top:-80px;z-index:60;background:var(--paper-2);color:var(--ink);padding:12px 16px;border-radius:12px;transition:top 140ms ease}
.st-skip:focus{top:12px}

/* --- the header: sticky, blurred, the wordmark, the pill nav, the two doors ------------------ */
.st-header{position:sticky;top:0;z-index:20;backdrop-filter:blur(10px);background:color-mix(in srgb,var(--paper) 78%,transparent)}
.st-header .st-wrap{display:flex;align-items:center;gap:var(--s3);height:72px}
.st-header .st-wm svg{height:22px;width:auto;color:var(--ink);display:block}
.st-header nav{margin-left:auto;display:flex;gap:4px;background:var(--paper-2);padding:4px;border-radius:999px}
.st-header nav a{padding:10px 16px;border-radius:999px;font:500 14px/1 var(--sans);color:var(--ink-2)}
.st-header nav a.st-on{background:var(--ink);color:var(--paper)}
.st-header .st-cta{display:flex;gap:8px}
/* a door (sign in, sign up) has no pill nav: the one quiet button sits where the doors do */
.st-header .st-door{margin-left:auto}

/* --- reveal on scroll: visible at rest, a small rise while it is below the fold -------------- */
.st-reveal{opacity:1;transform:none;transition:opacity .6s ease,transform .6s ease}
.st-reveal.st-pre{opacity:0;transform:translateY(18px)}

/* --- a chapter: the label, the heading, the line under it ----------------------------------- */
/* ONE RHYTHM, AND --band IS IT. This read clamp(56px,7vw,92px), which never touched --band at
   all: at 1440 it gave 92 + 92 = 184px between two sections while the landing page's
   calc(var(--band)/2) gave 79.2 + 79.2 = 158.4px, and the two disagreed at every width (at 834:
   116.8 against 96). DESIGN.md §0 — "--band clamp(96px,11vw,184px) between sections (half from each
   side, so two sections never stack two bands of air). This line is the number, not a second
   opinion about it." Reading the token makes the site and the landing page agree everywhere and is
   the only way they stay agreed when the owner moves the number again. */
.st-section{padding:calc(var(--band) / 2) 0}
.st-head{display:grid;gap:var(--s2);max-width:64ch;margin-bottom:var(--s4)}
.st-head h2{font:700 clamp(28px,3.4vw,42px)/1.08 var(--sans)}
.st-head p{color:var(--ink-2);font-size:18px}

/* --- tiles: three across, every one on paper-2 --------------------------------------------- */
.st-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.st-grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s2)}
.st-tile{border-radius:22px;padding:var(--s3);background:var(--paper-2);display:grid;gap:10px;align-content:start}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.st-tile h3{font:600 19px/1.25 var(--sans)}
.st-tile p{color:var(--ink-2);font-size:15px}
.st-tile svg{width:44px;height:44px;fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}

/* --- the ask block: Wobo's head, a label, a line, the box, three chips ---------------------- */
.st-ask{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:auto 1fr;gap:var(--s3);align-items:center}
.st-ask h2{font:700 28px/1.1 var(--sans)}
.st-ask .wk-ask{display:flex;gap:10px;background:var(--paper);border-radius:16px;padding:8px 8px 8px 18px;align-items:center;margin-top:var(--s2);max-width:none}
.st-ask .wk-ask .wk-mic{background:var(--paper-2)}
.st-ask .st-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.st-ask .st-chips .wk-chip{font:500 13px/1 var(--sans);padding:8px 12px;border-radius:999px;background:var(--paper);color:var(--ink-2)}

/* --- the close panel: the early-access promotion ---------------------------------------------- */
.st-close{margin:var(--s5) 0 0;background:var(--ink);color:var(--paper);padding:var(--s6) 0;text-align:center}
.st-close h2{font:700 clamp(34px,5vw,60px)/1.02 var(--sans);letter-spacing:-.035em}
.st-close .hand{font-size:30px;color:var(--marigold);display:block;margin-top:var(--s2)}
.st-close .st-row{display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s4);flex-wrap:wrap}
.st-close .st-btn{background:var(--marigold);color:#14142B}
.st-close .st-btn.st-q{background:color-mix(in srgb,var(--paper) 12%,transparent);color:var(--paper)}
.st-close .st-fine{margin:var(--s4) auto 0;max-width:60ch;color:color-mix(in srgb,var(--paper) 72%,transparent);font-size:15px}
.st-close .st-fine a{color:var(--marigold);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}

/* --- the footer: four columns and the line ------------------------------------------------- */
.st-footer{background:var(--ink);color:color-mix(in srgb,var(--paper) 60%,transparent);padding:var(--s4) 0 var(--s5);font-size:14px}
.st-footer .st-wrap{display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:var(--s3)}
.st-footer b{display:block;color:var(--paper);font-weight:600;margin-bottom:10px}
.st-footer a{display:block;padding:4px 0}
.st-footer .st-wm svg{height:22px;color:var(--paper)}
.st-footer a[aria-current="page"]{color:var(--paper)}
.st-footer .st-line{margin-top:10px;max-width:28ch}
/* Where to follow Wobo. Quiet by design: the footer's job is the columns, and these sit under the
   line as a row of words rather than a row of logos, because a brand mark we do not own is not
   ours to draw and a glyph set is weight for nothing. Phone hit areas clear 44px (DESIGN.md). */
.st-footer .st-social{margin-top:12px;display:flex;flex-wrap:wrap;gap:16px}
.st-footer .st-social a{color:var(--ink-2);font-size:15px;text-decoration:none;text-underline-offset:4px;padding:11px 0}
.st-footer .st-social a:hover,.st-footer .st-social a:focus-visible{color:var(--ink);text-decoration:underline}

/* --- prose: reviewed copy, rendered (help articles, the legal set, the gift page) ------------ */
.st-prose{color:var(--ink-2);font-size:17px;line-height:1.65;max-width:68ch}
.st-prose h2{font:700 clamp(24px,2.6vw,32px)/1.1 var(--sans);color:var(--ink);margin:var(--s4) 0 var(--s2);scroll-margin-top:88px}
.st-prose h3{font:600 20px/1.25 var(--sans);color:var(--ink);margin:var(--s3) 0 var(--s1);scroll-margin-top:88px}
.st-prose h2:first-child,.st-prose h3:first-child{margin-top:0}
.st-prose p{margin:0 0 var(--s2)}
.st-prose ul,.st-prose ol{margin:0 0 var(--s2);padding-left:22px}
.st-prose li{margin-bottom:8px}
.st-prose li::marker{color:var(--pig)}
.st-prose strong{color:var(--ink);font-weight:600}
.st-prose a{color:var(--pig);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.st-prose code{font:inherit;background:var(--paper-2);border-radius:10px;padding:2px 8px}
.st-prose hr{border:0;height:2px;border-radius:999px;background:var(--paper-3);margin:var(--s4) 0}
.st-prose>:last-child{margin-bottom:0}
/* an unfilled term in the reviewed copy, shown as the gap it is rather than invented */
.st-slot{color:var(--ink-3);background:var(--paper-2);border-radius:10px;padding:0 8px}
/* a table in a document: the plans table's shape */
.st-scroll{margin:0 0 var(--s3);overflow-x:auto;border-radius:24px}
.st-grid{border-collapse:collapse;width:100%;min-width:560px;background:var(--paper-2);font-size:15px}
.st-grid th,.st-grid td{padding:14px var(--s3);text-align:left;vertical-align:top}
.st-grid th{font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);background:var(--paper-3);padding:var(--s2) var(--s3)}
.st-grid tr+tr td{border-top:2px solid var(--paper)}
.st-grid td:first-child{font-weight:500;color:var(--ink)}
/* the "in plain words" card: the highlighter, Wobo's hand, then the honest summary */
.st-plain{background:var(--paper-2);border-radius:24px;padding:var(--s3);margin:0 0 var(--s4);box-shadow:inset 3px 0 0 var(--marigold)}
.st-plain .hand{display:block;font-size:26px;color:var(--ink);margin-bottom:var(--s1)}
.st-plain p{color:var(--ink-2);font-size:17px;margin:0 0 12px}
.st-plain p:last-child{margin-bottom:0}
/* a note card: a tag and a line */
.st-note{background:var(--paper-2);border-radius:20px;padding:20px var(--s3);display:grid;gap:8px}
.st-note p{color:var(--ink-2);font-size:15px}
/* a crumb: where the page sits */
.st-crumb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font:500 14px/1.3 var(--sans);color:var(--ink-3);margin-bottom:var(--s3)}
.st-crumb a{display:inline-flex;align-items:center;min-height:44px;min-width:44px}
.st-crumb a:hover{color:var(--ink)}
.st-crumb b{font-weight:500;color:var(--ink-2)}
/* a field: a small label over a tonal input */
.st-field{display:grid;gap:6px;text-align:left}
.st-field label{font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.st-field input,.st-field select,.st-field textarea{font:400 17px/1.4 var(--sans);padding:14px 16px;border-radius:12px;border:0;background:var(--paper-2);color:var(--ink);width:100%;min-height:50px}
.st-field input::placeholder,.st-field textarea::placeholder{color:var(--ink-3)}
.st-field textarea{min-height:180px;resize:vertical;line-height:1.55}
.st-field select{appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--ink) 50%),linear-gradient(135deg,var(--ink) 50%,transparent 50%);background-position:calc(100% - 24px) 22px,calc(100% - 18px) 22px;background-size:6px 6px;background-repeat:no-repeat;padding-right:44px}
.st-fine{font-size:13px;color:var(--ink-3)}
.st-hint{font-size:14px;color:var(--ink-2)}
/* a page hero that announces itself: a label, a headline, a line */
.st-page-hero{padding:var(--s5) 0 var(--s4)}
.st-page-hero h1{font:700 clamp(36px,4.8vw,58px)/1.04 var(--sans);letter-spacing:-.035em;margin-top:var(--s2);max-width:18ch}
.st-page-hero h1 em{font-style:normal;color:var(--pig)}
.st-page-hero p.st-sub{font-size:19px;color:var(--ink-2);max-width:52ch;margin-top:var(--s3)}
.st-page-hero .hand{font-size:26px;color:var(--pig);display:block;margin-top:var(--s2)}
.st-page-hero .st-row{display:flex;gap:var(--s2);margin-top:var(--s4);flex-wrap:wrap;align-items:center}
.st-chips{display:flex;gap:8px;flex-wrap:wrap}
.st-lines{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.st-lines li{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;font-size:16px}
.st-lines li i{width:22px;height:22px;border-radius:50%;background:var(--mint);display:grid;place-items:center;margin-top:2px}
.st-lines li i svg{width:12px;height:12px;fill:none;stroke:#14142B;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.st-quiet-card{background:var(--paper-2);border-radius:20px;padding:var(--s3);color:var(--ink-3);font-size:15px;max-width:60ch}
.st-link{color:var(--pig);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}

/* --- /about ------------------------------------------------------------------------------- */
.ab-hero{padding:clamp(40px,5vw,72px) 0 clamp(56px,7vw,92px)}
.ab-hero .st-wrap{display:grid;grid-template-columns:1fr 1fr;gap:var(--s5);align-items:center}
.ab-hero h1{font:700 clamp(36px,4.8vw,58px)/1.04 var(--sans);letter-spacing:-.035em;margin-top:var(--s2)}
.ab-hero h1 em{font-style:normal;color:var(--pig)}
.ab-hero p.ab-sub{font-size:19px;color:var(--ink-2);max-width:46ch;margin-top:var(--s3)}
.ab-hero .st-row{display:flex;gap:var(--s3);margin-top:var(--s4);flex-wrap:wrap;align-items:center}
.ab-hero .ab-under{font-size:15px;color:var(--ink-3)}
.ab-mission{background:var(--paper-2);border-radius:28px;padding:var(--s4);position:relative;transform:rotate(-1.5deg);box-shadow:0 26px 50px rgba(20,20,43,.12)}
.ab-mission .hand{font-size:clamp(28px,3vw,40px);line-height:1.12}
.ab-mission .hand em{font-style:normal;color:var(--rose)}
.ab-mission .ab-sig{margin-top:var(--s3);display:flex;align-items:center;gap:10px;font-family:var(--hand);font-weight:700;font-size:24px}
.ab-mission .ab-pin{position:absolute;top:-14px;left:50%;width:28px;height:28px;border-radius:50%;background:var(--marigold);transform:translateX(-50%);box-shadow:0 8px 16px rgba(20,20,43,.16)}
.ab-story{display:grid;grid-template-columns:1fr 1fr;gap:var(--s5);align-items:start}
.ab-story p{color:var(--ink-2);font-size:18px;max-width:52ch}
.ab-story p+p{margin-top:var(--s2)}
.ab-story .ab-pull{font-family:var(--hand);font-weight:600;font-size:30px;line-height:1.15;color:var(--ink);background:var(--paper-2);border-radius:24px;padding:var(--s3)}
.ab-story .ab-pull em{font-style:normal;color:var(--rose)}
.ab-promises{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--s2)}
.ab-promise{display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start;background:var(--paper-2);border-radius:20px;padding:var(--s3)}
.ab-promise i{width:44px;height:44px;border-radius:50%;background:var(--marigold);display:grid;place-items:center;font:700 22px/1 var(--hand);font-style:normal;color:var(--ink)}
.ab-promise b{display:block;font-weight:600;font-size:17px}
.ab-promise span{color:var(--ink-2);font-size:15px}
.ab-team{display:grid;grid-template-columns:1.1fr .9fr;gap:var(--s4);align-items:center;background:var(--ink);color:var(--paper);border-radius:32px;padding:var(--s5) var(--s4)}
.ab-team h2{font:700 clamp(28px,3.4vw,42px)/1.06 var(--sans)}
.ab-team p{color:color-mix(in srgb,var(--paper) 72%,transparent);margin-top:var(--s2);max-width:46ch}
.ab-team .hand{font-size:28px;color:var(--marigold);margin-top:var(--s3)}
.ab-team .ab-cards{display:grid;gap:12px}
.ab-team .ab-card{background:color-mix(in srgb,var(--paper) 8%,transparent);border-radius:18px;padding:18px 20px;display:grid;grid-template-columns:48px 1fr;gap:14px;align-items:center}
.ab-team .ab-card .ab-a{width:48px;height:48px;border-radius:50%;background:var(--marigold);display:grid;place-items:center;font:700 18px/1 var(--sans);color:#14142B}
.ab-team .ab-card b{display:block;font-weight:600}
.ab-team .ab-card span{font-size:14px;color:color-mix(in srgb,var(--paper) 60%,transparent)}
.ab-team .ab-card .ab-a.ab-paper{background:var(--paper)}
.ab-team .ab-card .ab-a.ab-plus{background:color-mix(in srgb,var(--paper) 14%,transparent);color:var(--paper)}
.ab-team .st-label{color:var(--marigold)}

/* --- /plans ------------------------------------------------------------------------------- */
.pl-hero{padding:var(--s5) 0 var(--s4);text-align:center}
.pl-hero h1{font:700 clamp(38px,5.4vw,64px)/1.0 var(--sans);letter-spacing:-.035em;margin:var(--s2) auto 0;max-width:18ch}
.pl-hero h1 em{font-style:normal;color:var(--pig)}
.pl-hero p.pl-sub{font-size:19px;color:var(--ink-2);max-width:52ch;margin:var(--s3) auto 0}
.pl-hero p.pl-when{font-size:17px;color:var(--ink);max-width:52ch;margin:var(--s2) auto 0}
.pl-hero .st-row{display:flex;gap:var(--s2);justify-content:center;margin-top:var(--s4);flex-wrap:wrap}
/* law v5: where someone reads from is inferred from the browser's time zone, never asked. There is no country switch on this page. */
.pl-allow{margin:var(--s4) auto 0;max-width:560px;background:var(--paper-2);border-radius:24px;padding:var(--s3);text-align:left;display:grid;gap:12px;position:relative}
.pl-allow b{font-weight:600}
.pl-allow .pl-bar{height:14px;border-radius:7px;background:var(--paper-3);overflow:hidden;position:relative}
.pl-allow .pl-bar i{position:absolute;left:0;top:0;height:100%;width:100%;border-radius:7px;background:var(--marigold);transform:scaleX(0);transform-origin:left;will-change:transform;transition:transform 1.4s cubic-bezier(.6,0,.2,1)}
.pl-allow > span:not(.wk-sticker){font-size:13px;color:var(--ink-2)}
.pl-allow .hand{font-size:24px;color:var(--pig)}
.pl-allow .wk-sticker{right:-14px;top:-16px}
.pl-plans{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);align-items:start}
.pl-plan{border-radius:28px;padding:var(--s3);display:grid;gap:14px;background:var(--paper-2);position:relative}
.pl-plan.pl-pro{background:var(--paper-2);box-shadow:inset 0 0 0 3px var(--pig)}
.pl-plan.pl-max{background:var(--ink);color:var(--paper)}
.pl-plan .pl-name{font:600 14px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.pl-plan.pl-max .pl-name{color:color-mix(in srgb,var(--paper) 60%,transparent)}
.pl-plan .pl-price{font:700 44px/1 var(--sans);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pl-plan .pl-price small{font:500 15px/1 var(--sans);letter-spacing:0;color:var(--ink-3);margin-left:6px}
.pl-plan.pl-max .pl-price small{color:color-mix(in srgb,var(--paper) 60%,transparent)}
.pl-plan .pl-x{font-family:var(--hand);font-weight:700;font-size:26px;color:var(--pig);line-height:1}
.pl-plan.pl-max .pl-x{color:var(--marigold)}
.pl-plan p{font-size:15px;color:var(--ink-2)}
.pl-plan.pl-max p{color:color-mix(in srgb,var(--paper) 75%,transparent)}
.pl-plan ul{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.pl-plan li{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;font-size:15px}
.pl-plan li i{width:22px;height:22px;border-radius:50%;background:var(--mint);display:grid;place-items:center}
.pl-plan li i svg{width:12px;height:12px;fill:none;stroke:#14142B;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pl-plan .st-btn{margin-top:6px}
.pl-plan.pl-max .st-btn{background:var(--marigold);color:#14142B}
.pl-plan .pl-free{background:var(--paper)}
.pl-plan .pl-best{position:absolute;right:18px;top:-14px;background:var(--marigold);color:#14142B;font-family:var(--hand);font-weight:700;font-size:20px;padding:5px 12px;border-radius:10px;transform:rotate(4deg);box-shadow:0 10px 20px rgba(20,20,43,.12)}
.pl-plan .pl-fine{font-size:13px;color:var(--ink-3)}
.pl-plan.pl-max .pl-fine{color:color-mix(in srgb,var(--paper) 50%,transparent)}
.pl-tbl{border-radius:24px;overflow:hidden;background:var(--paper-2)}
.pl-tbl .pl-r{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;align-items:center}
.pl-tbl .pl-r+.pl-r{border-top:2px solid var(--paper)}
.pl-tbl .pl-r>div{padding:14px var(--s3);font-size:15px}
.pl-tbl .pl-r.pl-h>div{font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);background:var(--paper-3);padding:var(--s2) var(--s3)}
.pl-tbl .pl-r>div:first-child{font-weight:500}
.pl-tbl .pl-same{color:var(--ink-3)}
.pl-tbl .pl-y{display:inline-flex;align-items:center;gap:6px}
.pl-tbl .pl-y i{width:10px;height:10px;border-radius:50%;background:var(--mint)}
.pl-checkout{display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);align-items:center}
.pl-checkout .pl-card{background:var(--paper);border-radius:24px;padding:var(--s3);box-shadow:0 18px 40px rgba(20,20,43,.10);display:grid;gap:14px}
.pl-checkout .pl-row{display:flex;justify-content:space-between;font-size:15px}
.pl-checkout .pl-row b{font-weight:600}
.pl-checkout label{display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start;font-size:14px;color:var(--ink-2);padding:12px;border-radius:14px;background:var(--paper-2)}
.pl-checkout label input{width:22px;height:22px;accent-color:var(--pig);margin:1px 0 0}
.pl-checkout label b{color:var(--ink);font-weight:600;display:block}
/* The consent boxes (checkout, and the sign-up agreement below). The box a learner SEES stays the
   prototype's 22px; the box a thumb has to HIT is 44 (the touch floor, DESIGN.md §2). A native
   checkbox cannot do that — its drawn size is its box — so the box is drawn here instead: a tonal
   well on the label's ground, Wobo blue with a cream tick once it is ticked. */
.pl-checkout label>input[type=checkbox],.wa-consent>input[type=checkbox]{appearance:none;-webkit-appearance:none;width:44px;height:44px;margin:-11px 0 -11px -11px;padding:0;background:transparent;cursor:pointer;display:grid;grid-template-areas:'box';place-items:center}
.pl-checkout label>input[type=checkbox]::before,.wa-consent>input[type=checkbox]::before{content:'';grid-area:box;width:22px;height:22px;border-radius:10px;background:var(--paper-3)}
.pl-checkout label>input[type=checkbox]:checked::before,.wa-consent>input[type=checkbox]:checked::before{background:var(--pig)}
.pl-checkout label>input[type=checkbox]::after,.wa-consent>input[type=checkbox]::after{content:'';grid-area:box;width:14px;height:14px;background:var(--paper);clip-path:polygon(14% 44%,0 58%,38% 96%,100% 34%,86% 20%,38% 68%);opacity:0}
.pl-checkout label>input[type=checkbox]:checked::after,.wa-consent>input[type=checkbox]:checked::after{opacity:1}
.pl-checkout .pl-total{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid var(--paper-2);padding-top:12px}
.pl-checkout .pl-total b{font:700 28px/1 var(--sans)}
.pl-checkout .pl-say{font-family:var(--hand);font-weight:600;font-size:26px;line-height:1.15;margin-top:var(--s3)}
.pl-checkout .pl-say em{font-style:normal;color:var(--rose)}
.pl-checkout .pl-head h2{font:700 clamp(28px,3.4vw,42px)/1.08 var(--sans);margin-top:10px}
.pl-checkout .pl-head p{color:var(--ink-2);margin-top:var(--s2);max-width:46ch}
.pl-checkout .pl-card .st-fine{font-size:13px;color:var(--ink-3)}
.pl-gift{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;grid-template-columns:1.1fr .9fr;gap:var(--s4);align-items:center}
.pl-gift h2{font:700 clamp(26px,3vw,36px)/1.08 var(--sans)}
.pl-gift p{color:var(--ink-2);margin-top:var(--s2)}
.pl-gift .pl-row{display:flex;gap:var(--s2);margin-top:var(--s3);flex-wrap:wrap}
.pl-gift .st-btn.st-quiet{background:var(--paper)}
.pl-gift svg{width:min(100%,300px);justify-self:center;overflow:visible;filter:drop-shadow(0 20px 30px rgba(20,20,43,.14))}
.pl-gift .st-label{color:var(--ink-2)}
.pl-gift .pl-art{position:relative;justify-self:center;width:min(100%,300px)}
.pl-gift .pl-art .wk-head{position:absolute;right:-6px;top:-28px}
.pl-gift h2{margin-top:8px}
.pl-faq{display:grid;gap:10px}
.pl-faq details{background:var(--paper-2);border-radius:18px;padding:0 var(--s3)}
.pl-faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:var(--s2);padding:18px 0;font-weight:500;font-size:17px}
.pl-faq summary::-webkit-details-marker{display:none}
.pl-faq summary::after{content:"+";font:600 24px/1 var(--sans);color:var(--pig);transition:transform .3s}
.pl-faq details[open] summary::after{transform:rotate(45deg)}
.pl-faq details p{color:var(--ink-2);padding:0 0 18px;max-width:64ch}
.pl-faq details p a{color:var(--pig);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
/* the checkout page: the honest state, a list of promises */
.pl-promises{margin:var(--s3) 0 0;padding:0;list-style:none;display:grid;gap:10px;max-width:62ch}
.pl-promises li{background:var(--paper-2);border-radius:16px;padding:14px 20px;font-size:16px;color:var(--ink-2)}

/* --- /help ---------------------------------------------------------------------------------- */
.hp-search{display:flex;gap:10px;background:var(--paper-2);border-radius:16px;padding:8px 8px 8px 18px;align-items:center;margin-top:var(--s3);max-width:560px}
.hp-search input{flex:1;border:0;background:transparent;font:400 17px/1.4 var(--sans);color:var(--ink);outline:none;min-width:0;min-height:40px}
.hp-search input::placeholder{color:var(--ink-3)}
.hp-search input::-webkit-search-cancel-button{appearance:none;display:none}
.hp-count{font-size:14px;color:var(--ink-3);margin-top:12px}
.hp-groups{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);align-items:start}
.hp-group{border-radius:22px;padding:var(--s3);background:var(--paper-2);display:grid;gap:10px;align-content:start}
/* law v5: a wash tints a pill, a tick or a selected row — never a card, a tile, a panel or a section. Surfaces are paper-2. */
.hp-group h2{font:600 22px/1.2 var(--sans)}
.hp-group>p{color:var(--ink-2);font-size:15px}
.hp-mark{width:44px;height:44px;fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.hp-list{display:grid;gap:2px;margin-top:var(--s1)}
.hp-list a{display:flex;align-items:center;min-height:44px;padding:6px 12px;border-radius:12px;font:500 15px/1.3 var(--sans);color:var(--ink)}
.hp-list a:hover{background:var(--paper)}
.hp-list a[aria-current="page"]{background:var(--ink);color:var(--paper)}
.hp-results{display:grid;gap:10px}
.hp-result{background:var(--paper-2);border-radius:18px;padding:18px var(--s3);display:grid;gap:4px}
.hp-result:hover{transform:translateY(-1px);box-shadow:var(--lift)}
.hp-result b{font:600 17px/1.3 var(--sans);color:var(--ink)}
.hp-result span{font-size:15px;color:var(--ink-2)}
.hp-empty{color:var(--ink-2);font-size:17px;max-width:52ch}
.hp-article{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:var(--s5);align-items:start;padding:var(--s4) 0 var(--s5)}
.hp-article h1{font:700 clamp(30px,3.6vw,44px)/1.08 var(--sans);letter-spacing:-.03em}
.hp-lead{font:500 clamp(19px,1.8vw,22px)/1.45 var(--sans);color:var(--ink);margin:var(--s2) 0 var(--s3);max-width:46ch}
.hp-next{margin-top:var(--s4);background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:6px}
.hp-next a{font:600 19px/1.25 var(--sans);color:var(--ink);display:inline-flex;align-items:center;min-height:44px}
.hp-next a:hover{color:var(--pig)}
.hp-aside{position:sticky;top:88px;background:var(--paper-2);border-radius:22px;padding:var(--s3);display:grid;gap:10px}
.hp-aside h2{font:600 16px/1.2 var(--sans)}
.hp-article .st-ask{margin-top:var(--s4)}

/* --- /legal ----------------------------------------------------------------------------------- */
.lg-rows{display:grid;gap:12px}
.lg-row{background:var(--paper-2);border-radius:20px;padding:20px var(--s3);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,.9fr);gap:6px var(--s3);align-items:baseline}
.lg-row:hover{transform:translateY(-1px);box-shadow:var(--lift)}
.lg-row-title{font:600 17px/1.3 var(--sans);color:var(--ink)}
.lg-row-what{font-size:15px;color:var(--ink-2)}
.lg-row-who{font-size:14px;color:var(--ink-3)}
.lg-doc{display:grid;grid-template-columns:240px minmax(0,1fr);gap:var(--s5);align-items:start;padding:var(--s4) 0 var(--s5)}
.lg-toc{position:sticky;top:88px;background:var(--paper-2);border-radius:22px;padding:var(--s3)}
.lg-toc ol{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:2px}
.lg-toc a{display:flex;align-items:center;min-height:44px;padding:6px 12px;border-radius:12px;font-size:14px;line-height:1.35;color:var(--ink-2)}
.lg-toc a:hover{background:var(--paper);color:var(--ink)}
.lg-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--s3)}
.lg-meta .wk-pill{background:var(--paper-2);font-size:14px;padding:8px 12px}

/* --- /gift ----------------------------------------------------------------------------------- */
.gf-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2)}
.gf-step{display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start;background:var(--paper-2);border-radius:20px;padding:var(--s3)}
.gf-step i{width:44px;height:44px;border-radius:50%;background:var(--marigold);display:grid;place-items:center;font:700 22px/1 var(--hand);font-style:normal;color:var(--ink)}
.gf-step p{color:var(--ink-2);font-size:15px}
.gf-boards{margin-top:var(--s3)}
.gf-boards .st-fine{margin-top:12px;display:block}

/* --- /contact ------------------------------------------------------------------------------- */
.ct-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:var(--s4);align-items:start}
.ct-form{background:var(--paper-2);border-radius:28px;padding:var(--s4);display:grid;gap:var(--s2)}
.ct-form .st-field input,.ct-form .st-field select,.ct-form .st-field textarea{background:var(--paper)}
.ct-form .st-row{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}
.ct-boxes{display:grid;gap:10px}
.ct-box{background:var(--paper-2);border-radius:18px;padding:16px 20px;display:grid;gap:4px}
.ct-box a{font:600 16px/1.3 var(--sans);color:var(--pig);display:inline-flex;align-items:center;min-height:44px}
.ct-box span{font-size:14px;color:var(--ink-2)}
.ct-aside h2{font:600 22px/1.2 var(--sans);margin-bottom:var(--s2)}
.ct-aside .st-hint{margin-top:var(--s2)}

/* --- the two doors ---------------------------------------------------------------------------- */
.wa{display:grid;place-items:center;padding:var(--s4) 0 var(--s5)}
.wa-card{width:min(560px,100%);display:grid;gap:22px;justify-items:center;text-align:center}
.wa-bub{background:var(--paper-2);border-radius:18px 18px 18px 4px;padding:12px 18px;font-family:var(--hand);font-weight:700;font-size:26px;line-height:1.1;color:var(--ink);max-width:420px}
.wa-card h1{font:700 clamp(28px,3.6vw,40px)/1.08 var(--sans)}
.wa-card p.wa-sub{color:var(--ink-2);font-size:17px;max-width:44ch}
.wa-form{width:100%;display:grid;gap:10px}
.wa-form .st-btn{width:100%;min-height:48px;padding:15px 22px}
.wa-or{display:flex;align-items:center;gap:12px;font:500 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);width:100%}
.wa-or::before,.wa-or::after{content:"";flex:1;height:3px;border-radius:999px;background:var(--paper-2)}
.wa-fine{font-size:13px;color:var(--ink-3);max-width:44ch;margin:0 auto}
.wa-parent{background:var(--paper-2);border-radius:20px;padding:var(--s3);display:grid;gap:8px;text-align:left}
.wa-parent h2{font:600 17px/1.25 var(--sans)}
.wa-parent p{font-size:15px;color:var(--ink-2)}
.wa-consent{display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start;font-size:14px;color:var(--ink-2);padding:12px;border-radius:14px;background:var(--paper-2);text-align:left}
.wa-consent input{width:22px;height:22px;accent-color:var(--pig);margin:1px 0 0}
.wa-consent a{color:var(--ink);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
.wa-error{background:var(--rose-w);border-radius:14px;padding:12px 16px;font-size:15px;color:var(--ink);text-align:left;width:100%}
.wa-switch{font-size:14px;color:var(--ink-2)}
.wa-switch button{background:none;border:0;padding:0;font:inherit;font-weight:500;color:var(--ink);cursor:pointer;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;min-height:44px}
.wa-glyph{width:16px;height:16px;flex:none}

/* --- /sitemap ---------------------------------------------------------------------------------- */
.sm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);align-items:start}
.sm-col{background:var(--paper-2);border-radius:22px;padding:var(--s3);display:grid;gap:2px;align-content:start}
.sm-col h2{font:600 19px/1.25 var(--sans);margin-bottom:8px}
.sm-col a{display:flex;align-items:center;min-height:44px;padding:4px 12px;border-radius:12px;font:500 15px/1.3 var(--sans);color:var(--ink)}
.sm-col a:hover{background:var(--paper)}

/* --- a phone ---------------------------------------------------------------------------------- */
@media (max-width:900px){
  .st-header nav{display:none}
  /* the touch floor (DESIGN.md §2): the wordmark and every footer link are a thumb's 44px tall */
  .st-header .st-wm{display:inline-flex;align-items:center;min-height:44px}
  .st-footer .st-wrap a{display:flex;align-items:center;min-height:44px;padding:0}
  .st-footer .st-wrap{grid-template-columns:1fr 1fr}
  /* the allowance sticker overhangs its card by 14px on a wide screen; on a phone the card is
     the width of the screen less the gutter, so the overhang sits inside the card's corner */
  .pl-allow .wk-sticker{right:4px}
  .hp-search input{min-height:44px}
  .st-ask{grid-template-columns:1fr}
  .st-grid3,.st-grid2{grid-template-columns:1fr}
  .ab-hero .st-wrap{grid-template-columns:1fr}
  .ab-mission{transform:none}
  .ab-story{grid-template-columns:1fr}
  .ab-promises{grid-template-columns:1fr}
  .ab-team{grid-template-columns:1fr}
  .pl-plans{grid-template-columns:1fr}
  .pl-tbl{overflow-x:auto}
  .pl-tbl .pl-r{min-width:640px}
  .pl-checkout{grid-template-columns:1fr}
  .pl-gift{grid-template-columns:1fr}
  .hp-groups{grid-template-columns:1fr}
  .hp-article{grid-template-columns:1fr}
  .hp-aside{position:static}
  .lg-row{grid-template-columns:1fr}
  .lg-doc{grid-template-columns:1fr}
  .lg-toc{position:static}
  .gf-steps{grid-template-columns:1fr}
  .ct-grid{grid-template-columns:1fr}
  .sm-grid{grid-template-columns:1fr}
}
/* --- the invitation, where the door was (docs/DOORS-CLOSED.md §3) ---------------------------- */
/* One column, narrow enough to read in one line of sight, and nothing on it but the words, two
   fields and the door. No card, no wash, no panel: law v5's white ground, with the one saturated
   thing on the page being the action, exactly as every other site page is built. */
.jl{padding:var(--s5) 0 var(--s6)}
.jl-wrap{width:min(560px,calc(100% - 48px))}
.jl-title{font:700 clamp(32px,5vw,52px)/1.04 var(--sans);letter-spacing:-.035em}
.jl-what{color:var(--ink-2);font-size:19px;margin-top:var(--s3)}
.jl-promise{color:var(--ink);font-size:17px;margin-top:var(--s2)}
.jl-form{margin-top:var(--s4)}
.jl-lab{display:block;font:500 15px/1.2 var(--sans);color:var(--ink);margin-top:var(--s3)}
.jl-field{display:block;width:100%;margin-top:10px;min-height:52px;padding:14px 16px;border:0;border-radius:12px;background:var(--paper-2);color:var(--ink);font:400 17px/1.4 var(--sans)}
.jl-hint{color:var(--ink-3);font-size:15px;margin-top:8px}
.jl-go{margin-top:var(--s3);width:100%;min-height:52px}
.jl-said{margin-top:var(--s3);color:var(--ink-2);font-size:16px}
.jl-done{font-size:20px;color:var(--ink);margin-top:var(--s4)}
.jl-quiet{margin-top:var(--s4);font-size:15px;color:var(--ink-2)}
.jl-quiet a{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}

@media (prefers-reduced-motion:reduce){
  .st-skip,.pl-allow .pl-bar i,.hp-result,.lg-row{transition:none}
}

/* --- print: a legal page has to survive being printed and filed ------------------------------ */
@media print{
  .st-header,.st-footer,.st-close,.st-skip,.lg-toc,.st-ask,.st-print-hide{display:none !important}
  .st{background:#fff;color:#000}
  .lg-doc{display:block;padding:0}
  .st-prose{max-width:none}
  .st-prose h2,.st-prose h3{break-after:avoid}
  .st-prose p,.st-prose li,.st-plain{break-inside:avoid}
  .st-reveal{opacity:1 !important;transform:none !important}
}
`;

/**
 * Inject the sheet once per document. Idempotent; a no-op wherever there is no document, and
 * wherever the document cannot hold a sheet (a page still mounting, or a stand-in some test left
 * behind; the same tolerance `themeNow` in wobo/glass.ts gives such a document). The chunk that
 * imports this IS the page being opened, so it runs at import time and must never throw there.
 */
export function ensureSiteStyles(): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SITE_CSS;
  document.head.appendChild(style);
}
