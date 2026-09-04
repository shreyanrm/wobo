'use client';

/**
 * The landing page — what someone who has never met Wobo sees first.
 *
 * It is the unauthenticated root route, and it is a faithful port of the owner-approved prototype
 * `design/prototypes/landing-v8.html`: the same composition, the same copy word for word, the same
 * colours, densities and timings. This file is only the assembly — the words are in `page-copy.ts`,
 * the look is in `page-styles.ts`, the drawn pieces are in `art.tsx`, each chapter is its own
 * section, and every piece of motion belongs to `engine/**`.
 *
 * THE ORDER OF THE SECTIONS IS THE ARGUMENT, and it is the whole point of this file.
 *
 * It used to be a FEATURE TOUR in the order the features were built — hero, loop, forms, teaches,
 * students, practice, climb, parents, subjects, safe, ask, faq, devices — which answered the
 * doubts a stranger actually has in the order 1, 3, 3, 3, 4, 4, 5, 2, 6. Two of those placements
 * cost real money: "does it cover my board and my class" is the single biggest qualifying
 * objection and it sat NINTH, and letting someone ask and be answered with no account is the
 * strongest asset this company has and it sat ELEVENTH.
 *
 * It is now the ladder in docs/SELL.md §3, and every section below is one rung of it:
 *
 *   1  hero      what even is this — one question answered four ways, and the TRY, in the first
 *                screen, as the loud thing. Signing up is the ghost beside it.
 *   2  subjects  will it work for MY board and MY class — the qualifier, answered second, so a
 *                visitor can find themselves in the page within seconds
 *   3  teaches   is this just a chatbot with a logo — everything a great teacher does, and the six
 *      forms     things named there, each SHOWN rather than asserted: the ground under a chapter,
 *      students  a second route when the first misses, what stays learnt, the four answer forms,
 *      practice  the film you can stop and question, and a problem handed back to you
 *   4  climb     will my child actually use it
 *      parents   and will I see that it is working
 *   5  price     what does it cost — on this page, not behind a link, WITH doubt 7 (what if it
 *                does not work out) answered in the same breath, because they are one fear
 *   6  safe      is my child safe here
 *   8  Close     one call to action, in the site's one phrase
 *
 * WHAT CAME OUT, and why (a page that scrolls past its own point is twelve chances to leave):
 *
 *  · LOOP, the five-step "what actually happens" strip. It TOLD, in the abstract, what the four
 *    chapters under it SHOW. Its one load-bearing job — never letting the board look like the whole
 *    product — moved into the teaching chapter's six, which name the film, the practice, the
 *    memory and the report alongside the drawn board.
 *  · ASK, as a section of its own. It is the try, so it moved into the hero where it converts.
 *    The row of other assistants that rode under it moved to `safe`, where "do not take our word
 *    for it" is the natural last line.
 *  · FAQ. Four of its five answers were the same answers `subjects`, `safe` and `price` give in
 *    full, one screen earlier; the fifth (which languages) is now the last line of `subjects`.
 *  · DEVICES. Real, and true, but it answers no doubt on the ladder — it was a feature with a
 *    section. What a reader needs from it, that this runs in a browser with nothing to install, is
 *    the product being open in front of them.
 *
 * WHAT CHANGED IN THE BUILD, and why it is simpler:
 *
 *  · NO PORTAL. The old header was `position: fixed`, and the app wraps every screen in an element
 *    carrying `will-change: transform` — which makes that wrapper the containing block for every
 *    fixed descendant, so the header had to be rendered into `<body>` to stay put. v8's header is
 *    STICKY, which needs no containing block, so the whole chrome host, the depth layer and the
 *    portal it all lived in are gone.
 *  · NO PEN CURSOR. Law v5's page is white paper and ink; the pen of light, its ribbon canvas and
 *    the four blurred colour blobs behind the page went with the cream ground they were drawn for.
 *  · ONE MOTION HOOK. `useLandingMotion` mounts every timeline and takes every one of them back
 *    down, so leaving the route leaves the document as it found it.
 */

import { useRef } from 'react';
import { LandingDefs } from './art';
import { useLandingMotion } from './engine';
import { ensureLandingStyles, ROOT } from './page-styles';
import { Climb } from './sections/Climb';
import { Close } from './sections/Close';
import { Forms } from './sections/Forms';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { PageFooter } from './sections/PageFooter';
import { Parents } from './sections/Parents';
import { Practice } from './sections/Practice';
import { Price } from './sections/Price';
import { Safe } from './sections/Safe';
import { Students } from './sections/Students';
import { Subjects } from './sections/Subjects';
import { Teaches } from './sections/Teaches';

// The chunk arriving IS the page being opened, so the stylesheet goes in at import time rather than
// in an effect — an effect would let the first paint land unstyled for a frame.
ensureLandingStyles();

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);

  useLandingMotion({ root, hero });

  return (
    <div className={ROOT} ref={root}>
      <LandingDefs />
      <Header />
      <main>
        <Hero sectionRef={hero} />
        <Subjects />
        <Teaches />
        <Forms />
        <Students />
        <Practice />
        <Climb />
        {/* THE PRICE MOVED UP ONE PLACE, above the parent's report.
            docs/SELL.md §3 answers the doubts in a fixed order and rung 5 — "what does it cost" —
            follows rung 4 (the climb) directly. Measured at 390px before this wave, <Price /> began
            at y=14,467 on a 19,455px page: screen 17.1 of 23, which is sixteen screens of scrolling
            before a worried parent is told it is free. The report is proof for the payer rather
            than a rung of its own, and it reads better between the price and the safety chapter —
            what it costs, then what you will see for it, then what protects the child. */}
        <Price />
        <Parents />
        <Safe />
        <Close />
      </main>
      <PageFooter />
    </div>
  );
}
