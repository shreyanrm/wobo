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
 * WHAT CHANGED FROM THE PREVIOUS BUILD, and why it is simpler:
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
 *
 * The one door on the page is early access. There is no "start learning" anywhere, because the
 * product is not open yet and law v5 says to promote before inviting.
 */

import { useRef } from 'react';
import { LandingDefs } from './art';
import { useLandingMotion } from './engine';
import { ensureLandingStyles, ROOT } from './page-styles';
import { Ask } from './sections/Ask';
import { Climb } from './sections/Climb';
import { Close } from './sections/Close';
import { Devices } from './sections/Devices';
import { Faq } from './sections/Faq';
import { Forms } from './sections/Forms';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { Loop } from './sections/Loop';
import { PageFooter } from './sections/PageFooter';
import { Parents } from './sections/Parents';
import { Practice } from './sections/Practice';
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
        <Loop />
        <Forms />
        <Teaches />
        <Students />
        <Practice />
        <Climb />
        <Parents />
        <Subjects />
        <Safe />
        <Ask />
        <Faq />
        <Devices />
        <Close />
      </main>
      <PageFooter />
    </div>
  );
}
