/**
 * The responsive proof harness (WOBO-PLAN §18 — device agnostic, handcrafted).
 *
 * Everything here is measurement, never repair. The harness walks every address the router can
 * reach, at three widths and in both themes, and records what a real learner's device would
 * actually show: a page wider than the screen, a word cut in half by a clipping box, a target too
 * small for a thumb, copy below the readable floor, a control that takes focus without showing it.
 *
 * The findings are DATA, not opinions — each one carries a CSS selector precise enough for the
 * screen's owner to open the file and see the element, so a UI raise can act on this report
 * without re-deriving it.
 *
 * Determinism is the other half of the contract. A flaky harness is worse than no harness: the
 * measurements below run only after fonts are loaded, layout has settled and every running
 * animation has either finished or been frozen, and every threshold is compared with a sub-pixel
 * tolerance so a fractional layout value can never flip a verdict between runs.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// --- the matrix ---------------------------------------------------------------------------------

export interface Viewport {
  width: number;
  height: number;
}

/** Phone, tablet, laptop — the three shapes the plan names (§18). */
export const WIDTHS: readonly Viewport[] = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

export type Theme = 'light' | 'dark';
export const THEMES: readonly Theme[] = ['light', 'dark'] as const;

/** The width the reduced-motion pass runs at. */
export const REDUCED_MOTION_WIDTH = 820;

export interface RouteCase {
  /** Stable id used in file names and the README's first column. */
  id: string;
  /** The address, exactly as the router parses it (src/shell/router.tsx). */
  path: string;
  /**
   * The readiness signal: text (or a pattern) that must be on screen before anything is measured.
   * A pattern, not a locator, so a copy change inside a card cannot silently turn this suite into
   * a measurement of the wrong screen — and an alternation covers a screen with two valid resting
   * states (the frame theatre welcomes a seeded board, or offers to find an unseeded one).
   */
  ready: string | RegExp;
  /**
   * One gesture between arriving and measuring, for chrome that only exists once something is
   * open. The board's plane is the case that forced it: it draws nothing until it is summoned, so
   * a matrix that only navigates measured every surface EXCEPT the one a learner sees Wobo work
   * on. Keep these to something a learner could actually do — a click on a real control.
   */
  open?: (page: Page) => Promise<void>;
}

/**
 * Every route the app can be at, enumerated from the `Route` union and the `Screen` switch in
 * src/App.tsx. Parameterised routes are instantiated with ids from the seeded catalog
 * (src/data/catalog.ts): the `math` subject and the atom topic `m2-1`, which is the one topic
 * carried fully in the seed.
 */
export const APP_ROUTES: readonly RouteCase[] = [
  { id: 'home', path: '/', ready: 'Practice' },
  { id: 'learn', path: '/learn', ready: 'Your subjects' },
  { id: 'practice', path: '/practice', ready: 'This set' },
  { id: 'chat', path: '/chat', ready: 'One conversation, always' },
  // `/progress` is the knowledge map and the parent's report (src/screens/progress). It used to
  // hand over to `/you` and this row asserted the handover; the surfaces behind it were then
  // unreachable from anywhere in the app, which is why the row now measures the screen itself.
  { id: 'progress', path: '/progress', ready: 'Your map' },
  { id: 'you', path: '/you', ready: 'Learning strengths' },
  // The doubt solver's capture screen (screens/doubt): the camera on a phone, the picker and the
  // drop zone on a laptop. Keyless it can go no further than this, which is the surface to measure.
  { id: 'doubt', path: '/doubt', ready: 'Take a photo of the doubt' },
  // The parent's read-only view of the You page, reached from its Parents card.
  { id: 'parent', path: '/parent', ready: 'Questions word for word' },
  // A subject door is addressed by the subject's own name — the registry keys subjects by what
  // the framework calls them, and `/subject/math/...` was a slug from before that was true. The
  // seeded world teaches Mathematics, so this is the address the tiles themselves link to.
  { id: 'subject-math-learn', path: '/subject/Mathematics/learn', ready: 'Learn · Mathematics' },
  {
    id: 'subject-math-practice',
    path: '/subject/Mathematics/practice',
    ready: 'Practice · Mathematics',
  },
  // And the address as it was written before subjects were keyed by their own name. Every bookmark,
  // palette entry and external link still arrives here, so the slug stays watched: it must resolve
  // to the subject it means and hand over to the canonical address, never print itself as a name.
  {
    id: 'subject-slug',
    path: '/subject/math/learn',
    ready: 'Learn · Mathematics',
    open: async (page) => {
      const at = new URL(page.url()).pathname;
      if (at !== '/subject/Mathematics/learn') {
        throw new Error(
          `/subject/math/learn did not hand over to its canonical address — at ${at}`,
        );
      }
    },
  },
  {
    id: 'course-m2-1',
    path: '/course/m2-1',
    ready: /solving equations with the variable on one side/i,
  },
  { id: 'sandbox', path: '/sandbox', ready: 'Free play' },
  { id: 'concept-engines', path: '/concept/engines', ready: 'engine gallery' },
  // Onboarding and the frame theatre are Wobo's own full-screen flows: they settle on a final
  // beat (the door, the welcome) and wait there for a tap, so the settled beat is the signal.
  // Keyless, the flow opens on step two ("Who's learning"); with an account layer, on step one.
  { id: 'onboarding', path: '/onboarding', ready: /make this yours|Who's learning/ },
  { id: 'building', path: '/building', ready: /Step in|Choose your board/ },
  // The board's own chrome, on the hermetic bench page — the one address where the full board and
  // the plane are both mounted and drawing. `WoboFullBoard` and `WoboPlane` are reached from no
  // app route (the app opens them through the stage), so without this row the frame around Wobo's
  // ink was the only surface in the product that nothing in the matrix ever measured.
  {
    id: 'board-chrome',
    path: '/board-bench.html#board-bench/pythagoras-handwritten/chrome',
    // The bench's own status line — the board's name lives in an aria-label and in a <select>,
    // neither of which is text on the page.
    ready: /events, \d+ refused/,
    open: async (page) => {
      // land the whole plan, then summon the plane: the chrome measured is the frame around ink
      // that is actually there, on both surfaces at once.
      await page.getByTestId('bench-instant').click();
      await page.getByTestId('bench-plane').click();
    },
  },
] as const;

/**
 * The PUBLIC addresses — everything a visitor with no account can open.
 *
 * They are in the same matrix as the app's own screens for one reason: they are the pages a
 * stranger meets first, on whatever phone they happen to have. The suite used to walk only the
 * thirteen in-app addresses, so the fourteen public ones — the front door, both doors in, the
 * about page, the help centre and an article, the legal set and a document, plans, checkout, gift,
 * donate and contact — shipped unmeasured.
 *
 * The list mirrors `src/screens/states/routes.ts` (`PUBLIC_ROUTES`), which is what the sitemap is
 * built from, plus one instance each of the two parameterised families: a help article and a legal
 * document stand for the thirty-three and the ten behind them, because they render through one
 * component apiece and measuring all forty-three would spend the run's budget proving the same
 * thing forty-three times. `public-routes.test.ts` asserts this list and that one do not drift.
 *
 * Each `ready` is a phrase the page's own reviewed copy carries, not a class name: a page that
 * renders its shell but not its content must fail here rather than photograph as a pass.
 */
export const PUBLIC_ROUTE_CASES: readonly RouteCase[] = [
  // `/` is not here: the suite seeds an onboarded learner, and an onboarded learner opening `/`
  // is shown their home screen, which the `home` case above already walks. The landing page is
  // what a SIGNED-OUT visitor sees at the same address and needs an unseeded session to reach;
  // it is proved by the landing page's own suite rather than measured here against a learner
  // who would never see it.
  { id: 'about', path: '/about', ready: 'The homework hour is where confidence is made or lost.' },
  // The six pitch pages, each on a line its own prototype carries (design/prototypes/site-*.html).
  { id: 'meet-wobo', path: '/meet-wobo', ready: 'Wobo has no gender. Wobo is just Wobo.' },
  { id: 'how-it-works', path: '/how-it-works', ready: 'Try one. Wobo rings the gap.' },
  { id: 'for-parents', path: '/for-parents', ready: 'Safe by design, not by promise.' },
  {
    id: 'for-students',
    path: '/for-students',
    ready: 'Free every day. No card. No trial that ends.',
  },
  { id: 'subjects', path: '/subjects', ready: 'Every proof drawn, every number computed.' },
  {
    id: 'security',
    path: '/security',
    ready: 'Every row here has a purpose, a shelf life and a delete button.',
  },
  { id: 'help', path: '/help', ready: /articles, in three groups/i },
  {
    id: 'help-article',
    path: '/help/wobo-basics/what-is-wobo',
    ready: /More in wobo basics/i,
  },
  { id: 'legal', path: '/legal', ready: 'The legal set.' },
  {
    id: 'legal-document',
    path: '/legal/terms-of-service',
    ready: /open for counsel/i,
  },
  { id: 'plans', path: '/plans', ready: 'What changes between plans, and what never does.' },
  { id: 'plans-checkout', path: '/plans/checkout', ready: /Checkout opens with launch/i },
  { id: 'gift', path: '/gift', ready: /Give someone a tutor who sits beside them/i },
  {
    id: 'donate',
    path: '/donate',
    ready: /Not a smaller version, not a trial, not the good parts locked/i,
  },
  { id: 'contact', path: '/contact', ready: /Every mailbox/i },
  { id: 'sign-in', path: '/sign-in', ready: 'Welcome back' },
  { id: 'sign-up', path: '/sign-up', ready: /Let’s make this yours|Let's make this yours/ },
  { id: 'not-found', path: '/no-such-page', ready: "This page isn't here" },
] as const;

/**
 * Everything the harness walks: the app's own screens, then the public site.
 *
 * The suite iterates THIS, so adding a public address to `PUBLIC_ROUTE_CASES` puts it in the
 * matrix with no edit to the spec.
 */
export const ROUTES: readonly RouteCase[] = [...APP_ROUTES, ...PUBLIC_ROUTE_CASES];

// --- findings -----------------------------------------------------------------------------------

export type CheckId =
  | 'route-unreachable'
  | 'horizontal-overflow'
  | 'clipped-text'
  | 'tap-target'
  | 'font-size'
  | 'focus-visible';

export interface Finding {
  check: CheckId;
  /** A CSS selector the screen's owner can paste into the console to see the element. */
  selector: string;
  /** What was measured, in the units of the check. */
  detail: string;
  /**
   * The same measurement at full precision, used ONLY to tell a still element from a moving one
   * between samples, then stripped before the finding is written down.
   *
   * `detail` rounds to whole pixels because that is what a person wants to read — and rounding is
   * exactly what lets a slowly breathing element look identical in two samples taken half a second
   * apart. Comparing the unrounded values instead makes agreement mean what it should: nothing
   * moved.
   */
  raw?: string;
}

export interface CaseResult {
  route: string;
  path: string;
  width: number;
  theme: Theme | 'reduced-motion';
  findings: Finding[];
  screenshot: string;
}

export interface RouteReport {
  route: string;
  path: string;
  cases: CaseResult[];
}

// --- the browser-side audit ----------------------------------------------------------------------

/**
 * The whole measurement, as one function evaluated inside the page.
 *
 * It is a single round trip on purpose: reading layout element-by-element over the CDP wire is
 * both slow (this suite has a four-minute budget) and racy (the page can reflow between reads).
 * One pass, one layout, one answer.
 */
const AUDIT = (opts: { tapTargets: boolean }): Finding[] => {
  type F = { check: string; selector: string; detail: string; raw?: string };
  const out: F[] = [];
  const CAP = 12; // per check — a broken screen reports its shape, not every instance
  const EPS = 1; // sub-pixel tolerance: fractional layout must never flip a verdict

  /** A selector precise enough to find the element again, short enough to read. */
  const sel = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    let hops = 0;
    while (node && node.nodeType === 1 && hops < 4) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      let step = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((c) => c && !/^[a-z]*-?\d{2,}/.test(c))
        .slice(0, 2);
      if (cls.length > 0) step += `.${cls.join('.')}`;
      const role = node.getAttribute('role');
      if (role) step += `[role="${role}"]`;
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node?.tagName);
        if (sibs.length > 1) step += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(step);
      node = node.parentElement;
      hops += 1;
    }
    return parts.join(' > ');
  };

  const label = (el: Element): string => {
    const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const aria = el.getAttribute('aria-label');
    return aria ? `"${aria}"` : t ? `"${t}"` : '(no text)';
  };

  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };

  /**
   * True for a box that exists ONLY for a screen reader: the 1px clipped span that carries a word
   * a sighted reader gets from a drawn mark ("included" beside a tick), and the board's own text
   * transcript. It is one pixel wide on purpose and its text is meant to overflow it, so measuring
   * it as clipped text reports the accessibility feature as the defect — and, worse, buries a real
   * clipped heading under twelve copies of the word "included".
   */
  const screenReaderOnly = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width > 2 || r.height > 2) return false;
    const cs = getComputedStyle(el);
    return (
      cs.position === 'absolute' ||
      cs.position === 'fixed' ||
      cs.clipPath !== 'none' ||
      cs.clip !== 'auto'
    );
  };

  const push = (check: string, el: Element, detail: string, raw?: string) => {
    if (out.filter((f) => f.check === check).length >= CAP) return;
    const entry: F = { check, selector: sel(el), detail: `${label(el)} — ${detail}` };
    if (raw !== undefined) entry.raw = raw;
    out.push(entry);
  };

  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'));

  // 1 — the page must never be wider than the screen. A learner should never have to scroll
  //     sideways to read a sentence.
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollWidth > window.innerWidth + EPS) {
    // Name the widest offender so the finding is actionable, not just a number.
    let worst: Element | null = null;
    let worstRight = window.innerWidth + EPS;
    for (const el of all) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > worstRight) {
        worstRight = r.right;
        worst = el;
      }
    }
    out.push({
      check: 'horizontal-overflow',
      selector: worst ? sel(worst) : 'html',
      detail: `document scrollWidth ${doc.scrollWidth} > innerWidth ${window.innerWidth}${
        worst ? ` — widest visible box ends at x=${Math.round(worstRight)}` : ''
      }`,
    });
  }

  // 2 — a clipping box narrower than the text inside it. Deliberate truncation (text-overflow) and
  //     genuine scrollers (overflow auto/scroll) are design, not defects; a hard `hidden` that eats
  //     a word with no ellipsis and no way to scroll to it is a defect.
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflow !== 'hidden') continue;
    if (cs.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth <= el.clientWidth + EPS) continue;
    // A one-pixel box whose text is meant to overflow it is a screen-reader label, not a defect.
    if (screenReaderOnly(el)) continue;
    // Only text matters here: a clipped decorative layer (a gradient, a glow) is intentional.
    const own = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1,
    );
    if (!own) continue;
    push(
      'clipped-text',
      el,
      `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
      `${el.scrollWidth}/${el.clientWidth}/${el.getBoundingClientRect().width.toFixed(3)}`,
    );
  }

  // 3 — a thumb needs 44 px. Only checked at the phone width, where it actually bites, and only on
  //     block-level controls.
  //
  //     THE EXCEPTION, and it is WCAG 2.5.8's own: a target "in a sentence or block of text" is
  //     exempt, because making it 44px tall would break the line it sits in. That is exactly what
  //     the terms link inside a consent sentence, the cross-reference inside a legal clause, and
  //     the "create an account" button at the end of "New here?" are. The test is the SHAPE, not
  //     the tag: the control renders inline, and its nearest block is a text container. A link
  //     styled as a block, or one sitting in a navigation bar, is still measured.
  if (opts.tapTargets) {
    const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]';
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>(INTERACTIVE))) {
      if (!visible(el)) continue;
      if (el.getAttribute('tabindex') === '-1') continue;
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
      const TEXT_FLOW = 'p, li, label, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4';
      const display = getComputedStyle(el).display;
      if ((display === 'inline' || display === 'inline-block') && el.closest(TEXT_FLOW)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 44 - EPS && r.height >= 44 - EPS) continue;
      push(
        'tap-target',
        el,
        `${Math.round(r.width)}×${Math.round(r.height)} px, below the 44×44 floor`,
        `${r.width.toFixed(3)}x${r.height.toFixed(3)}`,
      );
    }
  }

  // 4 — body copy below the readable floor is unreadable on a cheap phone. Measured on elements
  //     that carry their OWN text (a wrapper's font-size is inherited, not shown), excluding the
  //     typographic exceptions where small is correct.
  //
  //     THE FLOOR is DESIGN.md §2's own smallest size: "label 500 at 13". Body copy is 16–17 and
  //     a label is 13; nothing the law allows is smaller, so anything under 13 is a defect and
  //     anything at 13 is a label the law permits.
  //
  //     BODY COPY, precisely: a run of at least 20 characters — a phrase somebody reads. A chip
  //     ("+45"), a count ("3"), a one-word tab label is a glyph the eye recognises by shape, and
  //     holding those to the prose floor would bury the real findings under design intent.
  //
  //     CHAPTER MARKERS are exempt too: DESIGN.md §2 allows "all-caps tracked labels only for
  //     chapter markers" (the kit's Tag at 11px, its Label at 12px). Tracked capitals are read by
  //     shape, like a chip, and the law names them as the one place small tracked type belongs.
  const SMALL_BY_DESIGN = new Set(['SUP', 'SUB', 'CODE', 'KBD']);
  const BODY_COPY_MIN_CHARS = 20;
  const FONT_FLOOR = 13;
  for (const el of all) {
    if (SMALL_BY_DESIGN.has(el.tagName) || el.closest('sup, sub')) continue;
    if (!visible(el)) continue;
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    if (text.length < BODY_COPY_MIN_CHARS) continue;
    const cs = getComputedStyle(el);
    const size = Number.parseFloat(cs.fontSize);
    if (!Number.isFinite(size) || size >= FONT_FLOOR - 0.01) continue;
    const tracked = Number.parseFloat(cs.letterSpacing);
    if (cs.textTransform === 'uppercase' && Number.isFinite(tracked) && tracked >= size * 0.08) {
      continue;
    }
    push(
      'font-size',
      el,
      `font-size ${size.toFixed(1)}px, below the ${FONT_FLOOR}px floor`,
      size.toFixed(4),
    );
  }

  return out as Finding[];
};

// --- driving the page -----------------------------------------------------------------------------

/**
 * Wait until the page is worth measuring: fonts resolved, a frame rendered, and every running
 * animation either finished or past the point where it moves layout. Capped, because a looping
 * ambient animation (Wobo breathing) never finishes by design.
 */
export async function settle(page: Page, budgetMs = 700): Promise<void> {
  await page.evaluate(async (budget: number) => {
    await document.fonts.ready;

    /**
     * A cheap fingerprint of the whole layout: every visible box's edges, rounded to the pixel.
     * Two identical fingerprints a frame apart mean nothing is moving any more.
     *
     * This is measured geometry rather than a list of animations on purpose. Framer Motion drives
     * springs and tweens from its own rAF loop, so they never appear in `document.getAnimations()`
     * — a harness that waited on that list would measure a star mid-flight and report a different
     * number on every run. Geometry cannot lie about whether the page has stopped moving.
     */
    const fingerprint = (): string => {
      let acc = 0;
      let n = 0;
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        n += 1;
        acc =
          (acc * 31 +
            Math.round(r.left) * 7 +
            Math.round(r.top) * 13 +
            Math.round(r.width) * 17 +
            Math.round(r.height) * 19) %
          2_147_483_647;
      }
      return `${n}:${acc}`;
    };

    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    // Bounded on purpose. A settled screen leaves in ~160ms; a screen with a perpetual ambient
    // beat (Wobo breathing, a drifting mote) would never agree with itself, and waiting forever
    // for it would cost the suite its four-minute budget. Whatever motion outlives this window is
    // caught by the two-sample confirmation in `auditViewport` instead.
    const deadline = Date.now() + budget;
    let last = '';
    let stable = 0;
    while (Date.now() < deadline && stable < 2) {
      await new Promise((r) => setTimeout(r, 80));
      await frame();
      const fp = fingerprint();
      stable = fp === last ? stable + 1 : 0;
      last = fp;
    }
    await frame();
    await frame();
  }, budgetMs);
}

/**
 * Freeze ambient motion before anything is measured.
 *
 * Every check in this harness is a LAYOUT question — how wide, how tall, how big is the box. A
 * screen that breathes (the constellation's stars, Wobo's idle, a drifting mote) answers those
 * questions differently on every frame, and a harness whose numbers move between runs is worse
 * than no harness at all.
 *
 * The app already has a switch for exactly this: every ambient loop is gated on
 * `useReducedMotion()` (packages/motion), which is live on the media query. Asking the page for
 * reduced motion therefore stops the loops at their resting pose without touching layout, so the
 * box that gets measured is the box a still frame of the screen actually shows.
 *
 * This is applied AFTER boot, so entrance animations still run for real — the separate
 * reduced-motion pass is the one that boots with motion off from the first frame.
 */
export async function freezeMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A long first settle, once per route. Entrance choreography is staggered — the last star in a
  // constellation starts nearly a second after the first — and a cold dev server makes it slower
  // still. Paying for the full arrival here, once, is what keeps every later measurement (and the
  // whole run) identical to the run before it.
  await settle(page, 3_000);
}

/**
 * Walk the whole page once before a capture: down in viewport-sized steps, then back to the top.
 *
 * The site pages reveal their chapters on intersection (a block below the fold rests faded and
 * 18px low until a fifth of it scrolls into view). A full-page screenshot taken from the top
 * therefore photographs every unrevealed chapter as blank paper — the proof under-documents the
 * page, and a finding on a faded block is a finding about the harness, not the screen. A real
 * reader scrolls; so does the harness, and every reveal has fired before anything is measured.
 */
export async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const doc = document.scrollingElement ?? document.documentElement;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    for (let y = 0; y < doc.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await frame();
      await frame();
    }
    window.scrollTo(0, doc.scrollHeight);
    await frame();
    window.scrollTo(0, 0);
    await frame();
  });
}

/** Put the app in a theme the way the app itself does — `data-theme` on the root (src/ui/theme.ts). */
export async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

/** Number-free wording for a finding whose measurement moves between samples. */
const STABLE_DETAIL: Record<CheckId, string> = {
  'route-unreachable': 'the address did not render its screen',
  'horizontal-overflow': 'the page is wider than the screen (the exact width moves as it animates)',
  'clipped-text': 'the box clips the text inside it (the exact width moves as it animates)',
  'tap-target': 'below the 44×44 floor (the exact size moves as the element animates)',
  'font-size': 'below the 13px floor (the exact size moves as the element animates)',
  'focus-visible': 'no visible focus ring',
};

/**
 * Run the layout audit for the current viewport — twice, when the first pass found anything.
 *
 * The confirmation pass is the harness's own honesty check. A screen can still hold a beat that
 * outlives `settle` (a star's slow pulse), and a single sample of a moving element would report a
 * different number on every run — the report would be unciteable and the suite would look flaky
 * when the app is merely alive. So a finding must show up in BOTH samples to be reported, and if
 * the two samples disagree about the measurement, the number is dropped and the finding is stated
 * in words. Findings become facts about the screen, not about the moment it was measured.
 *
 * The second pass is skipped when the first is clean: a clean screen has nothing to confirm, and
 * this is the common case the time budget depends on.
 */
export async function auditViewport(page: Page, width: number): Promise<Finding[]> {
  const opts = { tapTargets: width <= 360 };
  const first = await page.evaluate(AUDIT, opts);
  if (first.length === 0) return first;

  // THREE samples, not two. Two is a coin toss on an element that breathes: the pair can happen to
  // agree, and the report would carry a number one run and a phrase the next. Three samples that
  // all agree means the element is genuinely still, and anything that moves at all is described in
  // words instead — the same output every run, either way.
  const rest: Finding[][] = [];
  for (let i = 0; i < 2; i += 1) {
    await page.waitForTimeout(150);
    rest.push(await page.evaluate(AUDIT, opts));
  }

  const key = (f: Finding) => `${f.check}::${f.selector}`;
  const seen = rest.map((sample) => new Map(sample.map((f) => [key(f), f])));
  const out: Finding[] = [];
  for (const f of first) {
    const others = seen.map((m) => m.get(key(f)));
    if (others.some((o) => !o)) continue; // a flicker in any sample is not a finding
    const mark = (x: Finding) => x.raw ?? x.detail;
    const same = others.every((o) => o && mark(o) === mark(f));
    const { raw: _raw, ...reported } = f;
    out.push(same ? reported : { ...reported, detail: STABLE_DETAIL[f.check] });
  }
  return out;
}

/**
 * Focus must be visible. Tab three times from the top of the page and prove each landing control
 * paints something a sighted keyboard user can see — an outline, a ring, or a border change.
 *
 * The comparison is against the element's OWN resting style, so a design that rings with
 * box-shadow passes as readily as one that uses `outline`.
 */
export async function auditFocusVisible(page: Page): Promise<Finding[]> {
  // Reset the sequential focus navigation starting point to the top of the document. A bare
  // `blur()` does NOT do this — Chromium keeps the blurred element as the starting point, so the
  // next Tab resumes mid-page and the audit would measure a different three controls on every
  // pass. Focusing the body (made programmatically focusable for one tick) moves the start back.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  const findings: Finding[] = [];
  const seen: string[] = [];
  // Up to six presses to collect three DISTINCT controls: a wrapper that forwards focus to its
  // child can consume a press without landing anywhere new.
  for (let press = 0; press < 6 && seen.length < 3; press += 1) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      const cs = getComputedStyle(el);
      const focused = {
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        shadow: cs.boxShadow,
        border: `${cs.borderWidth} ${cs.borderColor}`,
        bg: cs.backgroundColor,
      };
      // The resting style of the same element, read from a clone that is not focused.
      const clone = el.cloneNode(false) as HTMLElement;
      clone.style.position = 'absolute';
      clone.style.left = '-99999px';
      el.parentElement?.appendChild(clone);
      const rc = getComputedStyle(clone);
      const resting = {
        outline: `${rc.outlineStyle} ${rc.outlineWidth} ${rc.outlineColor}`,
        shadow: rc.boxShadow,
        border: `${rc.borderWidth} ${rc.borderColor}`,
        bg: rc.backgroundColor,
      };
      clone.remove();
      const ring =
        focused.outline !== resting.outline ||
        focused.shadow !== resting.shadow ||
        focused.border !== resting.border ||
        focused.bg !== resting.bg;
      const hasOutline = cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0;
      const path: string[] = [];
      let n: Element | null = el;
      let hops = 0;
      while (n && hops < 3) {
        let step = n.tagName.toLowerCase();
        const cls = (n.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length > 0) step += `.${cls.join('.')}`;
        path.unshift(step);
        n = n.parentElement;
        hops += 1;
      }
      return {
        visible: ring || hasOutline,
        selector: path.join(' > '),
        name:
          el.getAttribute('aria-label') ??
          (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      };
    });
    if (!result) continue;
    const key = `${result.selector}::${result.name}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    if (!result.visible) {
      findings.push({
        check: 'focus-visible',
        selector: result.selector,
        detail: `"${result.name}" takes focus but paints no visible ring (outline, shadow, border and background are unchanged)`,
      });
    }
  }
  if (seen.length === 0) {
    findings.push({
      check: 'focus-visible',
      selector: 'body',
      detail:
        'six Tab presses reached no focusable control — this screen is unreachable by keyboard',
    });
  }
  return findings;
}

// --- the report ------------------------------------------------------------------------------------

/**
 * Where the proof lands. `WOBO_PROOF_DIR` wins (scripts/proofs.sh sets it); otherwise the run
 * writes into the repo's own gitignored QA directory, so the harness is machine-independent — a
 * hard-coded absolute path only ever works on the machine it was written on.
 */
export const PROOF_DIR = process.env.WOBO_PROOF_DIR ?? join(process.cwd(), 'shots', 'responsive');

export function ensureProofDir(): string {
  mkdirSync(PROOF_DIR, { recursive: true });
  return PROOF_DIR;
}

export function screenshotPath(route: string, width: number, theme: string): string {
  return join(ensureProofDir(), `${route}-${width}-${theme}.png`);
}

/** One JSON per route, written before the assertion so a failing route still reaches the README. */
export function writeRouteReport(report: RouteReport): void {
  writeFileSync(
    join(ensureProofDir(), `${report.route}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

const CHECK_TITLES: Record<CheckId, string> = {
  'route-unreachable': 'Route did not render',
  'horizontal-overflow': 'Horizontal overflow',
  'clipped-text': 'Clipped text',
  'tap-target': 'Tap target < 44px',
  'font-size': 'Body copy < 13px',
  'focus-visible': 'Focus not visible',
};

/**
 * Fold every per-route JSON into one table. Idempotent and order-independent, so it can be run
 * from a test hook, from scripts/proofs.sh, or by hand after a partial run.
 */
export function writeSummary(): string {
  const dir = ensureProofDir();
  const reports: RouteReport[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RouteReport)
    .sort(
      (a, b) =>
        ROUTES.findIndex((r) => r.id === a.route) - ROUTES.findIndex((r) => r.id === b.route),
    );

  const lines: string[] = [];
  lines.push('# Responsive proof — every route, every width, both themes');
  lines.push('');
  lines.push(
    'Generated by `apps/web-pwa/tests/responsive.spec.ts` (WOBO-PLAN §18 — device agnostic).',
  );
  lines.push(
    'Every route the router can reach is opened at 360×780, 820×1180 and 1440×900, in light and dark,',
  );
  lines.push(
    'plus a reduced-motion pass at 820. Screenshots sit beside this file as `<route>-<width>-<theme>.png`.',
  );
  lines.push('');
  lines.push(
    'Findings are measurements, not fixes. Each one carries a selector the screen owner can act on.',
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    '| Route | Address | Reached | Overflow | Clipped text | Tap targets | Font size | Focus | Total |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');

  const count = (r: RouteReport, check: CheckId): number =>
    r.cases.reduce((n, c) => n + c.findings.filter((f) => f.check === check).length, 0);

  let grand = 0;
  for (const r of reports) {
    const nums = (
      [
        'horizontal-overflow',
        'clipped-text',
        'tap-target',
        'font-size',
        'focus-visible',
      ] as CheckId[]
    ).map((c) => count(r, c));
    const unreachable = count(r, 'route-unreachable');
    const total = nums.reduce((a, b) => a + b, 0) + unreachable;
    grand += total;
    const cell = (n: number) => (n === 0 ? 'clean' : String(n));
    const reached = unreachable === 0 ? 'yes' : 'NO';
    lines.push(
      `| \`${r.route}\` | \`${r.path}\` | ${reached} | ${nums.map(cell).join(' | ')} | ${total === 0 ? 'clean' : total} |`,
    );
  }
  lines.push('');
  lines.push(`**${reports.length} routes audited · ${grand} findings.**`);
  lines.push('');

  lines.push('## Findings by route');
  lines.push('');
  for (const r of reports) {
    const withFindings = r.cases.filter((c) => c.findings.length > 0);
    lines.push(`### \`${r.route}\` — \`${r.path}\``);
    lines.push('');
    if (withFindings.length === 0) {
      lines.push('No findings at any width or theme.');
      lines.push('');
      continue;
    }
    for (const c of withFindings) {
      lines.push(`**${c.width} px · ${c.theme}** — ${c.findings.length} finding(s)`);
      lines.push('');
      lines.push('| Check | Selector | Detail |');
      lines.push('| --- | --- | --- |');
      for (const f of c.findings) {
        const detail = f.detail.replace(/\|/g, '\\|');
        lines.push(
          `| ${CHECK_TITLES[f.check]} | \`${f.selector.replace(/\|/g, '\\|')}\` | ${detail} |`,
        );
      }
      lines.push('');
    }
  }

  const body = `${lines.join('\n')}\n`;
  writeFileSync(join(dir, 'README.md'), body, 'utf8');
  return body;
}
