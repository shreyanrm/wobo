/**
 * THE DOOR IS CLOSED, AND NOTHING PUBLIC OFFERS A WAY THROUGH IT.
 *
 * `docs/DOORS-CLOSED.md`, owner 2026-09-09: *"Block any account creations for now until further
 * notice, because we have SEO, AEO and GEO but no product yet."* 438 public pages are about to
 * start earning visitors from search, and a person who arrives, signs up and meets a tutor that is
 * not ready is lost permanently. A first impression is spent once.
 *
 * So this file holds two rules at once, and they are opposite halves of the same law:
 *
 *  · **While the dial is off**, every door on every public page is the invitation to the list, and
 *    no public surface names an address that creates an account. Not the header, not a close panel,
 *    not the plans page, not the 404.
 *  · **When the owner turns the dial on**, the site is the site it was: "Start free", pointing at
 *    the first run, with no release in between (§4). Nothing about the open door was deleted to
 *    close it, which is what makes reopening a switch rather than a rebuild.
 *
 * The source scan at the bottom is the one that actually holds the line. A page that reads its
 * door from `cta.ts` directly, or types `/onboarding` into an href, has re-opened the door for
 * itself, and no assertion about the table would notice.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { type Route, routeToPath } from '../../shell/router';
import { GIFT_PAGE, giftDoor, giftNote } from '../gift/copy';
import { PLANS_PAGE, planDoor } from '../plans/copy';
import { PLAN_TIERS } from '../plans/prices';
import { CTA, ctaFor, doorFor, JOIN_LIST_HREF, LIST_DOOR, START_FREE_HREF } from './cta';
import { HANDOFFS, handoff, type PublicPage } from './handoffs';
import { LIST } from './invitation';
import { headerDoors } from './nav';

const SCREENS = join(import.meta.dir, '..');
/** Every lane a signed-out visitor can read, plus the state pages a lost one lands on. */
const LANES = [
  'pitch',
  'site',
  'plans',
  'contact',
  'legal',
  'landing',
  'states',
  'growth',
  // The gift page is public, linked from the footer of every built file, and it shipped three
  // live purchase doors under a header that said "Join the list". A lane that is not scanned is
  // a lane nobody checks.
  'gift',
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'content') sources(path, out);
    } else if (
      ['.ts', '.tsx'].includes(extname(entry.name)) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(path);
    }
  }
  return out;
}

/** A file's shipped words: block comments and whole-line `//` notes taken out. */
function shipped(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

const PAGES = LANES.flatMap((lane) => sources(join(SCREENS, lane))).map((path) => ({
  name: relative(SCREENS, path),
  text: shipped(path),
}));

/** The one place allowed to name the open door: the constant every surface reads it from. */
const KEEPER = 'site/cta.ts';

describe('while the dial is off', () => {
  it('scans the pages it claims to scan', () => {
    expect(PAGES.length).toBeGreaterThan(30);
    expect(PAGES.map((p) => p.name)).toContain('site/cta.ts');
    expect(PAGES.map((p) => p.name)).toContain('plans/Plans.tsx');
    expect(PAGES.map((p) => p.name)).toContain('states/pages.tsx');
    expect(PAGES.map((p) => p.name)).toContain('gift/Gift.tsx');
  });

  it('turns the one call to action into the invitation to the list', () => {
    expect(ctaFor(false)).toEqual(LIST_DOOR);
    expect(LIST_DOOR.label).toBe(LIST.label);
    expect(routeToPath(LIST_DOOR.to)).toBe(JOIN_LIST_HREF);
  });

  it('sends every close on every public page to the list and to nowhere else', () => {
    for (const page of Object.keys(HANDOFFS) as PublicPage[]) {
      const close = handoff(page, false);
      for (const action of [close.primary, close.quiet]) {
        const path = action.to ? routeToPath(action.to) : (action.href ?? '');
        expect([page, path]).not.toEqual([page, START_FREE_HREF]);
      }
    }
  });

  it('keeps the header door, and makes it the invitation', () => {
    const doors = headerDoors(false);
    expect(doors.getStarted.label).toBe(LIST.label);
    expect(routeToPath(doors.getStarted.to)).toBe(JOIN_LIST_HREF);
  });

  it('leaves the sign-in door exactly where it was, for anyone who has an account', () => {
    expect(headerDoors(false).signIn).toEqual(headerDoors(true).signIn);
    expect(routeToPath(headerDoors(false).signIn.to)).toBe('/sign-in');
  });

  it('names no address that creates an account, on any public page', () => {
    /**
     * `site/invitation.ts` names the first run once, as a VALUE in `SOURCE_PATH`, and that is not
     * a door: it is where a reader WAS standing when they joined the list, which the gateway
     * stores as a path (`waiting_list.py` refuses a page name). The scan skips that one table
     * entry and the test below holds the rest of the file to the same rule as every other page.
     */
    const RECORD = /^[a-z'-]+: '\/onboarding',$/;
    const hits = PAGES.filter((page) => page.name !== KEEPER).flatMap((page) =>
      page.text
        .split('\n')
        .filter((line) => /['"`]\/onboarding|name: ?'onboarding'|name: ?"onboarding"/.test(line))
        .filter((line) => !(page.name === 'site/invitation.ts' && RECORD.test(line.trim())))
        .map((line) => `${page.name}: ${line.trim().slice(0, 110)}`),
    );
    expect(
      hits,
      'a public page that names the first run has re-opened the door for itself',
    ).toEqual([]);
  });

  it('offers no way through the one address the invitation is allowed to record', () => {
    const text = PAGES.find((page) => page.name === 'site/invitation.ts')?.text ?? '';
    expect(text).toContain("onboarding: '/onboarding'");
    // A record, never a door: no route to it, no anchor to it, nothing a reader can press.
    expect(text).not.toMatch(/name: ?'onboarding'/);
    expect(text).not.toMatch(/href="\//);
  });

  it('lets no public page read the open door around the dial', () => {
    const allowed = new Set([KEEPER, 'site/handoffs.ts']);
    const hits = PAGES.filter((page) => !allowed.has(page.name)).flatMap((page) =>
      page.text
        .split('\n')
        .filter((line) =>
          /\bCTA\.(label|to|under)\b|\bSTART_FREE(_HREF|_ROUTE|_LABEL)?\b/.test(line),
        )
        .map((line) => `${page.name}: ${line.trim().slice(0, 110)}`),
    );
    expect(hits, 'a door that does not read the dial cannot follow it within a minute').toEqual([]);
  });

  it('gives every plan card the same door, not only the free one', () => {
    // The page said "Wobo is not open yet" in the hero and offered "Choose Pro" and "Choose Max"
    // three cards down. A page arguing with itself is what the swap exists to prevent (§5).
    for (const tier of PLAN_TIERS) {
      const door = planDoor(tier, false);
      expect([tier.id, door.kind]).toEqual([tier.id, 'list']);
      expect([tier.id, door.label]).toEqual([tier.id, LIST.label]);
      expect([tier.id, routeToPath((door as { to: Route }).to)]).toEqual([tier.id, JOIN_LIST_HREF]);
    }
  });

  it('lets no plan card draw its own door around the dial', () => {
    const page = PAGES.find((p) => p.name === 'plans/Plans.tsx')?.text ?? '';
    expect(page).toContain('planDoor(');
    // `tier.cta` written straight into the card is how the paid doors escaped the dial.
    expect(page).not.toMatch(/\{tier\.cta\}/);
  });

  it('closes the gift page own doors, which the law names by hand', () => {
    // Three live purchase buttons on a public page, under a header saying "Join the list".
    for (const label of [GIFT_PAGE.cta, GIFT_PAGE.cardCta('Pro'), GIFT_PAGE.cardCta('Max')]) {
      const door = giftDoor(false, label);
      expect([label, door.label]).toEqual([label, LIST.label]);
      expect([label, routeToPath(door.to as Route)]).toEqual([label, JOIN_LIST_HREF]);
    }
    // and it says the one thing the whole site says about when
    expect(giftNote(false)).toBe(LIST.under);
    expect(giftNote(true)).toBe(GIFT_PAGE.ctaNote);
  });

  it('lets the gift page draw no door of its own around the dial', () => {
    const page = PAGES.find((p) => p.name === 'gift/Gift.tsx')?.text ?? '';
    expect(page).toContain('giftDoor(');
    expect(page).toContain('giftNote(open)');
    // The note under the hero is the dial's, not the page's own sentence about payments.
    expect(page).not.toContain('{GIFT_PAGE.ctaNote}');
    // And every press that would buy goes through the ONE control that reads the dial.
    expect(page.match(/onClick=\{give\}/g) ?? []).toHaveLength(1);
  });

  it('says the same thing about when on the plans page, and keeps every price', () => {
    // the prices are the prices, closed or open (docs/PRICING.md)
    const pro = PLAN_TIERS.find((tier) => tier.id === 'pro');
    expect(pro?.price?.IN).toEqual({ currency: 'INR', amount: 1999 });
    expect(pro?.yearly?.IN.perMonth).toEqual({ currency: 'INR', amount: 1666 });
    // and the page says what every other page says about when, in the same words
    expect(PLANS_PAGE.when).toBe(LIST.under);
    expect(handoff('plans', false).quiet.label).toBe(`${LIST.label} instead`);
    expect(routeToPath(handoff('plans', false).quiet.to as Route)).toBe(JOIN_LIST_HREF);
  });
});

describe('when the owner turns the dial on', () => {
  it('is the site it was, with no release in between', () => {
    expect(ctaFor(true)).toEqual(CTA);
    expect(CTA.label).toBe('Start free');
    expect(routeToPath(CTA.to)).toBe(START_FREE_HREF);
    expect(headerDoors(true).getStarted.label).toBe('Start free');
  });

  it('hands every page back its own close', () => {
    for (const page of Object.keys(HANDOFFS) as PublicPage[]) {
      expect(handoff(page, true)).toEqual(HANDOFFS[page]);
    }
  });

  it('swaps a door and leaves every other action alone', () => {
    const plans = { label: 'See plans', href: '/plans' };
    expect(doorFor(plans, false)).toEqual(plans);
    expect(doorFor(plans, true)).toEqual(plans);
  });
});
