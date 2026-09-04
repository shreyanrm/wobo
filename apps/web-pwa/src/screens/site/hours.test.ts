/**
 * The clock law (DESIGN.md section 0, owner 2026-09-04, corrected twice).
 *
 * No public surface may picture a child studying late. Not "10pm", not "tonight", not "midnight",
 * not "when everyone is asleep". Children go to bed early, the parents we sell to do not want a
 * product that keeps them up, and a page that names a late hour is describing the problem rather
 * than the answer. What those lines were always reaching for is availability and choice, and the
 * vocabulary for that is not scarce: after school, over the weekend, on a holiday, between classes,
 * on the way home, whenever they want, wherever they are, the way they want it explained.
 *
 * This test exists because the rule was broken twice after being given. A law that depends on
 * remembering is not a law.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

/** The public surfaces. Behind the door a late hour may legitimately appear (a clock, a reminder). */
const PUBLIC_DIRS = [
  'screens/landing',
  'screens/site',
  'screens/pitch',
  'screens/plans',
  'screens/gift',
  'screens/donate',
  'screens/contact',
];

/** Each pattern with the phrase that replaces it, so a failure teaches rather than only refusing. */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(9|10|11|12)\s*(pm|p\.m\.)/i,
    'say "after school", "over the weekend" or "whenever they want"',
  ],
  [/\btonight\b/i, 'name availability, not an hour: "whenever they want", "after school"'],
  [/\bmidnight\b/i, 'drop the hour entirely: "overnight", "on your own clock", "once a day"'],
  [/\blate at night\b/i, 'say "whenever they want, wherever they are"'],
  [/\bwhen everyone (else )?is asleep\b/i, 'say "on their own time"'],
  [
    /\bthe night before (the |an )?exam/i,
    'we are not a cramming tool: say "a bit at a time, so the exam is revision"',
  ],
  /*
    THE PARAPHRASE THIS ROW CLOSES. "Set it up once, this evening." was the PARENTS close — the
    payer's closing headline — twenty-eight lines under a comment in `handoffs.ts` that bans
    "tonight" and gives the reason. It survived because the two rows above used to name their own
    evasions as the remedy: the `tonight` row said 'say "this evening"' and the `midnight` row said
    'say "after hours"'. A law whose failure message teaches the way around it is not a law, so both
    remedies now name availability instead, and the paraphrase is banned in its own right.

    "Evening" on its own is left alone: "across five evenings" reports when learning happened and
    "no nudges after hours" is a promise of restraint. What is banned is the CLOSE that asks a
    tired parent for one more thing before bed.
  */
  [
    /\bthis evening\b/i,
    'a close that names an hour is the thing the law is about: say "whenever it suits you"',
  ],
  /*
    THE HOLE THIS ROW CLOSES. The bare-hour row above wants "9" or "10" immediately before "pm",
    so it never saw `9:40 pm`, `9:46 pm` or `9:41 pm` — and those were sitting on four beats of the
    how-it-works timeline, in a parent's report card and in a chat mock, after the rule had been
    given twice. A clock reading is the late hour spelled with minutes, and it pictures the same
    child at the same table.

    It starts at six because an evening reading is what the law is about, and it requires the
    minutes so the morning allowance reset ("resets 6:00 am") and a note that arrives at "Sunday,
    6 pm" are not swept up with it. A beat on a story does not need a clock at all: "after school",
    "a minute later", "same sitting" say when without naming an hour.
  */
  [
    /\b(6|7|8|9|10|11|12)[:.]\d{2}\s*(pm|p\.m\.)/i,
    'a clock reading is the late hour with minutes on it: say "after school", "a minute later" or "same sitting"',
  ],
];

/**
 * WHAT THIS USED TO MISS, and why the misses were the whole point.
 *
 * The walker took `/\.(ts|tsx)$/` and nothing else, so two classes of LIVE public surface were
 * invisible to a law written because the rule had already been broken twice:
 *
 *   · `screens/site/content/*.json` — the compiled help centre and /about. `help.json` is imported
 *     by `help-content.ts` and rendered at /help, and it carried "The day rolls over at midnight
 *     where you are" on a public page.
 *   · `design/prototypes/*.html` — the pages every worker ports verbatim. This is exactly how
 *     `landing-v8.html` carried "at ten at night" after the rule had been given twice, and how
 *     "9 pm" and four clock readings were still sitting on the site prototypes.
 *
 * And the gateway's email templates, which are as public as a page and are the FIRST thing a new
 * family reads. The welcome email said "Three things to try tonight".
 */
const CONTENT = /\.(ts|tsx|json)$/;

function filesUnder(dir: string, ext: RegExp = CONTENT): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(filesUnder(full, ext));
    } else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const REPO = new URL('../../../../../', import.meta.url).pathname;

/**
 * The prototypes that are NOT a public surface, so the walk does not fail on history.
 *
 * `landing-v3` to `v7` are superseded drafts kept for reference; `app-v1`, `onboarding-v2` and
 * `wobo-rig` are behind the door, where a clock on a screen or a reminder at a real time is the
 * honest thing to draw. Everything else in that directory is scanned by default, so a prototype
 * added tomorrow is covered without anyone remembering to add it.
 */
const NOT_PUBLIC = /^(landing-v[1-7]|app-v1|onboarding-v\d+|wobo-rig|.*-bench)\.html$/;

function prototypes(): string[] {
  const dir = join(REPO, 'design', 'prototypes');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.html') && !NOT_PUBLIC.test(n)).map((n) => join(dir, n));
}

/** The gateway's transactional email, which reaches a parent before any page does. */
function emailTemplates(): string[] {
  const file = join(REPO, 'services', 'gateway', 'src', 'wobo_gateway', 'email_templates.py');
  try {
    statSync(file);
  } catch {
    return [];
  }
  return [file];
}

/** Comments carry the reasoning and often quote the banned phrase to explain it. Only copy counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the clock law', () => {
  const files = [
    ...PUBLIC_DIRS.flatMap((d) => filesUnder(join(ROOT, d))),
    ...prototypes(),
    ...emailTemplates(),
  ];

  it('has public surfaces to check', () => {
    expect(files.length > 0).toBe(true);
  });

  it('sees the three surface classes it was blind to', () => {
    const has = (needle: string) => files.some((f) => f.endsWith(needle));
    expect(has('screens/site/content/help.json'), 'the compiled help centre renders at /help').toBe(
      true,
    );
    expect(has('design/prototypes/landing-v8.html'), 'the prototype every port copies').toBe(true);
    expect(has('wobo_gateway/email_templates.py'), 'the first thing a new family reads').toBe(true);
    expect(files.some((f) => f.endsWith('design/prototypes/landing-v7.html'))).toBe(false);
  });

  for (const [pattern, instead] of BANNED) {
    it(`never names ${pattern.source} on a public page`, () => {
      const guilty: string[] = [];
      for (const file of files) {
        const body = stripComments(readFileSync(file, 'utf8'));
        const hit = body.match(pattern);
        if (hit) guilty.push(`${file.slice(ROOT.length)}: "${hit[0]}" — ${instead}`);
      }
      expect(guilty).toEqual([]);
    });
  }
});
