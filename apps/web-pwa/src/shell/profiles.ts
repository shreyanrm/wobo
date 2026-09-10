/**
 * EVERY PLACE WOBO EXISTS OFF THIS SITE. ONE FILE, AND THIS IS IT.
 *
 * Three products share the name today, and the strongest of them is a job-search app with an App
 * Store listing, Trustpilot reviews and a Product Hunt page. Ask an engine what "Wobo AI tutor" is
 * and it answers about that one (docs/GROWTH-ENTITY.md). An engine decides what a name refers to by
 * walking from a site to the listings that agree with it, so the `sameAs` array this file feeds is
 * the single piece of markup that says "the LinkedIn page, the YouTube channel and the Wikidata
 * item are all the same thing as this site" (§4).
 *
 * ═══ THIS IS THE LIST TO EXTEND AS LISTINGS ARE CLAIMED ═══
 *
 * The claim order is docs/GROWTH-ENTITY.md §7, and it is an owner action with a browser, not a
 * build step. When a listing exists:
 *
 *   1. set `claimed: true` on its row,
 *   2. put the address the platform gave it in `url` (some platforms assign one, which is why
 *      `url` may be null until the day the listing is made),
 *   3. and nothing else. Every page's Organization markup picks it up on the next build.
 *
 * NOTHING UNCLAIMED IS EVER PUBLISHED, and that is the whole discipline of the file. A `sameAs`
 * pointing at a handle nobody has taken is a broken promise made to the exact machine we are
 * trying to convince, and pointing at a page somebody else holds would be worse than silence. So
 * `sameAs()` reads the flag and nothing else, and `profiles.test.ts` holds it to that.
 *
 * THE NAMING LAW APPLIES HERE TOO (§2). Every listing is NAMED **Wobo**. `heywobo` is a handle
 * inside an address and `heywobo.com` is the website field; neither is ever what the thing is
 * called. `@heywobo` was chosen over a better-but-inconsistent handle because one handle used
 * identically everywhere is what makes an engine confident, and it is free on every platform that
 * answers a check truthfully.
 *
 * No React and no app imports: the build script and the tests are the only readers.
 */

import { BRAND_NAME } from './head';

/** The name every one of these listings is created under. Never "HeyWobo" (GROWTH-ENTITY §2). */
export const LISTING_NAME = BRAND_NAME;

/** The handle taken everywhere it is free, so the same string identifies us on every platform. */
export const HANDLE = 'heywobo';

/** What kind of signal a listing is, which is roughly how much an engine weighs it. */
export type ProfileKind =
  /** A profile a person follows. */
  | 'social'
  /** A company or product record an engine reads as a fact about an organisation. */
  | 'listing'
  /** The structured item an engine resolves a name against. */
  | 'knowledge'
  /** An app store entry, which is one of the strongest entity signals there is (§3). */
  | 'store';

export interface EntityProfile {
  /** Stable id, used by the claim ledger and by the tests. Never shown to anyone. */
  id: string;
  /** The platform, as a person would name it. */
  platform: string;
  kind: ProfileKind;
  /**
   * The address the listing lives at, or null where the platform assigns one when the listing is
   * created (a Wikidata Q-number, a Crunchbase slug, a Play Store package). Guessing one of those
   * would put a dead link in the graph on the day it is claimed, which is the failure this whole
   * file exists to avoid.
   */
  url: string | null;
  /** True only once the listing EXISTS and is ours. Until then it stays out of `sameAs`. */
  claimed: boolean;
  /** Why it is on the list, or what stands in the way. One sentence, no em dash (voice.md). */
  note: string;
}

/**
 * The ledger, in the order docs/GROWTH-ENTITY.md §7 says to claim them.
 *
 * Every row is `claimed: false` as of 2026-09-09, which is the honest state of the world: the
 * handles were checked that day and were free, which means nobody holds them, which means WE do
 * not hold them either. The section that lists them is titled "claim them today"; this file is
 * what turns each of those owner actions into a published signal with a one-word edit.
 */
export const PROFILES: readonly EntityProfile[] = [
  {
    id: 'linkedin',
    platform: 'LinkedIn',
    kind: 'listing',
    url: `https://www.linkedin.com/company/${HANDLE}`,
    claimed: true,
    note: 'The bare name was free on 2026-09-09 and a company page is one of the strongest entity signals there is, so this one is taken under Wobo rather than under the handle.',
  },
  {
    id: 'youtube',
    platform: 'YouTube',
    kind: 'social',
    url: `https://www.youtube.com/@${HANDLE}`,
    claimed: false,
    note: 'Where the drawn explanations live, so it carries the entity signal and the wedge at the same time.',
  },
  {
    id: 'x',
    platform: 'X',
    kind: 'social',
    url: `https://x.com/${HANDLE}`,
    claimed: true,
    note: 'Free on 2026-09-09 under the handle; the bare name is held by another product.',
  },
  {
    id: 'github',
    platform: 'GitHub',
    kind: 'listing',
    url: `https://github.com/${HANDLE}`,
    claimed: false,
    note: 'The organisation, not a personal account: an engine reads an organisation as a fact about a company.',
  },
  {
    id: 'producthunt',
    platform: 'Product Hunt',
    kind: 'listing',
    url: `https://www.producthunt.com/@${HANDLE}`,
    claimed: false,
    note: 'Parked before the launch, because a handle costs nothing now and is unobtainable once somebody notices the product.',
  },
  {
    id: 'substack',
    platform: 'Substack',
    kind: 'social',
    url: `https://${HANDLE}.substack.com`,
    claimed: false,
    note: 'Parked even if the newsletter ends up living elsewhere, so the handle stays the same string everywhere.',
  },
  {
    id: 'instagram',
    platform: 'Instagram',
    kind: 'social',
    url: `https://www.instagram.com/${HANDLE}`,
    claimed: true,
    note: 'Held by the owner under the handle, confirmed 2026-09-10.',
  },
  {
    id: 'threads',
    platform: 'Threads',
    kind: 'social',
    url: `https://www.threads.net/@${HANDLE}`,
    claimed: false,
    note: 'Checked by hand while signed in, for the same reason as Instagram.',
  },
  {
    id: 'pinterest',
    platform: 'Pinterest',
    kind: 'social',
    url: `https://www.pinterest.com/${HANDLE}`,
    claimed: false,
    note: 'Checked by hand while signed in, for the same reason as Instagram.',
  },
  {
    id: 'telegram',
    platform: 'Telegram',
    kind: 'social',
    url: `https://t.me/${HANDLE}`,
    claimed: false,
    note: 'Checked by hand while signed in, for the same reason as Instagram.',
  },
  {
    id: 'crunchbase',
    platform: 'Crunchbase',
    kind: 'listing',
    url: null,
    claimed: false,
    note: 'Crunchbase assigns the organisation slug when the profile is created, so the address is filled in on the day rather than guessed now.',
  },
  {
    id: 'wikidata',
    platform: 'Wikidata',
    kind: 'knowledge',
    url: null,
    claimed: false,
    note: 'The item an engine reads to decide the name refers to a thing; its Q-number does not exist until the item does.',
  },
  {
    id: 'play-store',
    platform: 'Google Play',
    kind: 'store',
    url: null,
    claimed: false,
    note: 'The listing address is built from the package id, which is set when the app name is reserved in Play Console.',
  },
  {
    id: 'app-store',
    platform: 'App Store',
    kind: 'store',
    url: null,
    claimed: false,
    note: 'The listing address carries the numeric app id Apple issues, so it is filled in when the shell ships.',
  },
  {
    id: 'google-business',
    platform: 'Google Business Profile',
    kind: 'listing',
    url: null,
    claimed: false,
    note: 'Created for Dot eVentures rather than for the product, and Google assigns its address on verification.',
  },
];

/**
 * The `sameAs` array one Organization publishes: every listing that EXISTS and is ours, in the
 * order the ledger declares them. Empty until the first claim lands, and an empty array is
 * published as nothing at all rather than as an empty key.
 */
export function sameAs(profiles: readonly EntityProfile[] = PROFILES): string[] {
  return profiles.filter((p) => p.claimed && p.url).map((p) => p.url as string);
}

/** What is still to claim, in the order to claim it. The owner's list, read off the same rows. */
export function unclaimed(profiles: readonly EntityProfile[] = PROFILES): EntityProfile[] {
  return profiles.filter((p) => !p.claimed);
}
