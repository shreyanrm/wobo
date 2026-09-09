/**
 * THE LISTING LEDGER HAS TO BE HONEST BEFORE IT IS USEFUL.
 *
 * `sameAs` is the one line of markup that tells an engine "the LinkedIn page, the YouTube channel
 * and the Wikidata item are all the same thing as this site" (docs/GROWTH-ENTITY.md §4). It only
 * works if every address in it resolves to a page we actually hold: a `sameAs` pointing at a
 * handle nobody has claimed is a broken promise to the exact machine we are trying to convince,
 * and pointing at somebody else's page would be worse than saying nothing.
 *
 * So the ledger carries every listing we intend to hold, each with a flag saying whether it EXISTS
 * yet, and only the claimed ones are published. These are the rules that keeps that true.
 */

import { describe, expect, it } from 'bun:test';
import { BRAND_NAME } from './head';
import { LISTING_NAME, PROFILES, sameAs, unclaimed } from './profiles';

describe('the ledger of listings', () => {
  it('gives every listing an id of its own', () => {
    const ids = PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has an entry for every listing the entity law names', () => {
    const ids = new Set(PROFILES.map((p) => p.id));
    for (const named of [
      'linkedin',
      'youtube',
      'x',
      'github',
      'producthunt',
      'substack',
      'instagram',
      'wikidata',
      'crunchbase',
      'play-store',
      'app-store',
    ]) {
      expect(ids.has(named)).toBe(true);
    }
  });

  it('writes every address it does know as an https URL and nothing else', () => {
    for (const profile of PROFILES) {
      if (profile.url === null) continue;
      expect(() => new URL(profile.url as string)).not.toThrow();
      expect(new URL(profile.url as string).protocol).toBe('https:');
    }
  });

  it('leaves the address null exactly where the platform assigns it on creation', () => {
    // A Wikidata Q-number and a Play Store package id do not exist until the listing does, and
    // guessing one would put a dead link in the graph the day it is claimed.
    const open = PROFILES.filter((p) => p.url === null).map((p) => p.id);
    expect(open.length).toBeGreaterThan(0);
    for (const id of open) {
      const profile = PROFILES.find((p) => p.id === id);
      expect(profile?.claimed).toBe(false);
    }
  });

  it('says why every listing is there, in a sentence', () => {
    for (const profile of PROFILES) {
      expect(profile.note.length).toBeGreaterThan(20);
      expect(profile.note).not.toContain('—');
    }
  });
});

describe('the naming law, in the ledger itself', () => {
  it('names every listing Wobo, never HeyWobo', () => {
    expect(LISTING_NAME).toBe(BRAND_NAME);
    expect(LISTING_NAME).toBe('Wobo');
    for (const profile of PROFILES) {
      expect(profile.platform).not.toMatch(/heywobo/i);
    }
  });

  it('lets heywobo be a handle inside an address and never a name', () => {
    // `@heywobo` is how you reach the brand; "Wobo" is what it is called (GROWTH-ENTITY §2).
    const handles = PROFILES.filter((p) => p.url?.includes('heywobo'));
    expect(handles.length).toBeGreaterThan(0);
    for (const profile of handles) {
      expect(profile.url).toMatch(/heywobo/);
      expect(profile.url).not.toMatch(/HeyWobo/);
    }
  });
});

describe('what gets published', () => {
  it('publishes a listing only once it is claimed and has an address', () => {
    for (const url of sameAs()) {
      const profile = PROFILES.find((p) => p.url === url);
      expect(profile?.claimed).toBe(true);
      expect(profile?.url).not.toBeNull();
    }
  });

  it('publishes every claimed listing, and no listing twice', () => {
    const claimed = PROFILES.filter((p) => p.claimed && p.url).map((p) => p.url as string);
    expect(sameAs()).toEqual(claimed);
    expect(new Set(sameAs()).size).toBe(sameAs().length);
  });

  it('publishes nothing at all for a ledger where nothing is claimed', () => {
    expect(sameAs([{ ...(PROFILES[0] as (typeof PROFILES)[number]), claimed: false }])).toEqual([]);
  });

  it('publishes a claimed listing the moment its flag is flipped, with no other edit', () => {
    const ledger = PROFILES.map((p) =>
      p.id === 'linkedin'
        ? { ...p, claimed: true, url: 'https://www.linkedin.com/company/wobo' }
        : p,
    );
    expect(sameAs(ledger)).toContain('https://www.linkedin.com/company/wobo');
  });

  it('leaves the owner a list of what is still to claim', () => {
    expect(unclaimed().map((p) => p.id)).toEqual(
      PROFILES.filter((p) => !p.claimed).map((p) => p.id),
    );
  });
});
