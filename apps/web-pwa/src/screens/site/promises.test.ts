/**
 * The honesty law: a published page may promise a control only while the control exists.
 *
 * The conformance register of 2026-09-04 found the same failure in four shapes. The help centre
 * published "there is a quiet flag on every lesson, question, board and diagram" and an error
 * screen told a child to use it, and there is no flag component, no endpoint, no queue and no
 * reviewer. Five documents promised a download of your data, and there is no export route at all.
 * The children's privacy notice promised parents that memory, voice, photographs and the parent
 * link wait for their consent, and `consent_tier` is written by nothing. Three documents offered
 * account deletion, and no code in the repository deletes an account.
 *
 * A child told to report something and unable to find the control learns that nobody is listening.
 * That is the reason this file is a test and not a note in a review.
 *
 * HOW IT WORKS, and why it retires itself. Each rule carries a PROBE — a real search of the source
 * for the thing the sentence promises. While the probe finds nothing, the promise may only appear
 * in a sentence that also disclaims it ("there is no flag control in Wobo yet"). The moment somebody
 * BUILDS the control, the probe finds it, the rule turns itself off, and the copy is free again.
 * So this guard never has to be remembered, and never outlives its own reason.
 *
 * Scope: the reviewed copy that compiles into /about and /help (`docs/copy/**`), the legal set that
 * renders at /legal/* (`docs/legal/**`), and the error screens. Other public screens belong to other
 * work and are deliberately not scanned here.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../../../../../', import.meta.url).pathname;

function filesUnder(dir: string, ext: RegExp): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(filesUnder(full, ext));
    else if (ext.test(name)) out.push(full);
  }
  return out;
}

/** Every published sentence, with the file it came from. */
function publishedLines(): { file: string; line: string }[] {
  const files = [
    ...filesUnder(join(REPO, 'docs', 'copy'), /\.md$/),
    // `docs/legal/README.md` is the folder's own index and the checklist for counsel. It is not
    // rendered at /legal (`screens/legal/catalog.ts` reads it for the index and publishes the ten
    // documents beside it), and it has to be able to NAME a promise in order to ask about it.
    ...filesUnder(join(REPO, 'docs', 'legal'), /\.md$/).filter((f) => !f.endsWith('README.md')),
    join(REPO, 'apps', 'web-pwa', 'src', 'screens', 'states', 'pages.tsx'),
  ];
  const out: { file: string; line: string }[] = [];
  for (const file of files) {
    let body: string;
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // A `[REVIEW: ...]` note is a message to counsel about a doubt, not a promise to a reader, and
    // the site strips it before rendering (`markdown.ts` stripReviewTags). It is not copy.
    body = body.replace(/\[REVIEW:[^\]]*\]/gi, '');
    for (const raw of body.split('\n')) {
      // A markdown table row is ONE unit: a two-column table puts the promise in the left cell and
      // the honest answer in the right one, and splitting on the pipe would read the promise alone.
      for (const sentence of raw.split(/(?<=[.:;])\s+/)) {
        const line = sentence.trim();
        if (line.length > 3) out.push({ file: file.slice(REPO.length), line });
      }
    }
  }
  return out;
}

/** Does the source tree contain the thing a sentence promises? */
function sourceMatches(pattern: RegExp, dirs: string[], ext: RegExp): boolean {
  for (const dir of dirs) {
    for (const file of filesUnder(join(REPO, dir), ext)) {
      if (/[./]test[s]?[./]|\.test\.|__pycache__|node_modules/.test(file)) continue;
      let body: string;
      try {
        body = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (pattern.test(body)) return true;
    }
  }
  return false;
}

/**
 * A sentence that says the thing is missing is not a promise. Deliberately narrow: a bare "not"
 * anywhere in a sentence would excuse everything, so only wording that actually disclaims the
 * control counts.
 */
const DISCLAIMS =
  /(there (is|are) no\b|does not exist|do not exist|is not built|are not built|not in the product|no such|no control|no flag|no export|no download|no consent|no account deletion|no parent controls|nothing (in the product )?(ever )?(writes|records|sends|reads)|not yet|does not reach|we do not have|by hand|earlier draft|intend to|will (be able to|ask|switch)|when (it|they) (exists?|do)|until (it|there|they))/i;

interface Rule {
  /** What the promise is. */
  what: string;
  /** The sentence shape that promises it. */
  promises: RegExp;
  /** Where the thing would live if it existed. While this finds nothing, the promise is banned. */
  probe: { pattern: RegExp; dirs: string[]; ext: RegExp };
  /** What to do instead, printed on failure. */
  instead: string;
}

const RULES: Rule[] = [
  {
    what: 'a flag control on content',
    promises:
      /(a quiet flag|flag control|the flag in the corner|raises the (same )?flag|every flag lands|flag it\b)/i,
    /*
      The promise is a CONTROL a child can find, so the probe looks in the app and not in the
      gateway. As of 2026-09-04 a `POST /v1/flags` intake exists in
      `services/gateway/src/wobo_gateway/reports.py` and nothing in the learner app calls it, so
      the endpoint is real and the control the copy promised still is not. The day a component
      posts to it, this rule turns itself off and the "there is no flag control" copy in
      `docs/copy/help-centre/product-features/12-flagging-something-wrong.md` and
      `docs/legal/community-and-flags.md` section 2 has to be rewritten in the same commit.
    */
    probe: {
      pattern: /v1\/flags|raiseFlag|FlagControl/,
      dirs: ['apps/web-pwa/src'],
      ext: /\.(ts|tsx)$/,
    },
    instead: 'point the reader at support@heywobo.com, or build the control first',
  },
  {
    what: 'a download or export of your own data',
    promises:
      /(portable file|export gives you|export or delete|\bexport(ing)? (it|them|your data|everything|all of it)\b|\bdownload(ing)? (it|your data|everything|all of it)\b|\*\*export\*\*|\*\*download\*\*)/i,
    // GET /v1/me/export, or an export seam on the SDK account. Neither exists.
    probe: {
      pattern: /me\/export|eraseRemoteData[\s\S]{0,200}exportRemoteData|exportSubjectRows/,
      dirs: ['services/gateway/src', 'packages/sdk/src'],
      ext: /\.(py|ts)$/,
    },
    instead: 'say there is no export and that a copy is assembled by hand on request',
  },
  {
    what: 'a consent gate in front of memory, voice, photographs or the parent link',
    promises:
      /(before consent\b|until a parent has (given )?consent|needs? a parent'?s consent before|if the parent has allowed|parent has allowed them|switches on memory)/i,
    /*
      Something that WRITES the tier the gateway already enforces, or the grant table
      `docs/CONSENT-PLAN.md` section 2 proposes. A bare mention of `consent_tier` is not enough:
      the column is read in a dozen places and written in none, which is the whole finding. If the
      consent record ships under different names, add them here in the same commit.

      The migrations directory is deliberately not searched: naming its path here would put a
      vendor's name in shipped source and the white-label gate refuses it. A table on its own is
      not a consent record anyway; the code that writes and reads it is, and that code is here.
    */
    probe: {
      pattern: /consent_grants|record_consent|set_consent_tier|grant_consent/,
      dirs: ['services/gateway/src', 'packages/sdk/src'],
      ext: /\.(py|ts)$/,
    },
    instead:
      'describe what actually ships, and put the plan in docs/CONSENT-PLAN.md rather than in the notice',
  },
  {
    what: 'deleting the whole account',
    promises:
      /(delete (your|the whole) account|deleting your account|delete one item, the memory, or the whole account)/i,
    // Deleting an account means calling the auth admin API. Nothing does.
    probe: {
      pattern: /auth\/v1\/admin|admin\.deleteUser|deleteUser\(/,
      dirs: ['services/gateway/src', 'packages/sdk/src', 'apps/web-pwa/src'],
      ext: /\.(py|ts|tsx)$/,
    },
    instead: 'say the account is deleted by hand on request, or build the admin delete',
  },
  {
    what: 'a parent-facing controls screen',
    promises: /parent controls/i,
    // A parent has no account and no screen. A route named for the parent's own session would show.
    probe: {
      pattern: /@app\.(post|get)\(["']\/v1\/parent\/(settings|controls|data)/i,
      dirs: ['services/gateway/src'],
      ext: /\.py$/,
    },
    instead: 'say a parent writes to support@heywobo.com, because that is the whole route today',
  },
];

describe('a published page promises only what the code does', () => {
  const lines = publishedLines();

  it('has published copy to check', () => {
    expect(lines.length).toBeGreaterThan(500);
  });

  for (const rule of RULES) {
    const built = sourceMatches(rule.probe.pattern, rule.probe.dirs, rule.probe.ext);

    it(`does not promise ${rule.what} while nothing implements it`, () => {
      if (built) {
        // Somebody built it. The rule has done its job and should be deleted in the same commit
        // that ships the control, along with the honest "this does not exist" copy it forced.
        expect(built).toBe(true);
        return;
      }
      const guilty = lines
        .filter(({ line }) => rule.promises.test(line) && !DISCLAIMS.test(line))
        .map(({ file, line }) => `${file}: "${line.slice(0, 120)}" — ${rule.instead}`);
      expect(guilty).toEqual([]);
    });
  }
});
