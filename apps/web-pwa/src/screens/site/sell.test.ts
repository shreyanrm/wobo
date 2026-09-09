/**
 * THE SELL LAWS — docs/SELL.md and DESIGN.md §0, held over every public surface at once.
 *
 * Each `describe` below closes a defect that shipped. The rule is the one the owner gave for this
 * wave: an untraceable claim is closed by DELETING it, never by softening the wording, and a page
 * that sells by running something down is closed by rewriting it around what Wobo can do. So most
 * of what follows asserts an ABSENCE with the evidence for the absence written beside it, and where
 * a claim is allowed to stand it is pinned to the module or the register row that makes it true.
 *
 * Everything here reads the shipped source. These are copy and structure laws — what a page may
 * say, how many loud doors it may have, and where the words on those doors come from — and the
 * source is where the next person will look for them.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_DESCRIPTION } from '../../shell/head';
import { canonicalUrl } from '../../shell/router';
import { GIFT_PAGE } from '../gift/copy';
import { FORMS_END } from '../landing/engine/choreography';
import { FORMS, HERO, HERO_FORMS, SAFE, SUBJECTS } from '../landing/page-copy';
import BOARDS from '../pitch/boards.json' with { type: 'json' };
import { PLAN_TIERS } from '../plans/prices';
import { handoff } from './handoffs';

const SRC = join(import.meta.dir, '..', '..');
const REPO = join(SRC, '..', '..', '..');

/** A file's shipped words: block comments and whole-line `//` notes taken out. */
function shipped(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

/** The same, raw, for the times a test needs to see a comment. */
const raw = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');
const repoFile = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf8');

/** Every public page's own source, by the name a failure should print. */
const PUBLIC_SOURCES: readonly [string, string][] = [
  ['landing/page-copy.ts', shipped('screens', 'landing', 'page-copy.ts')],
  ['landing/sections/Hero.tsx', shipped('screens', 'landing', 'sections', 'Hero.tsx')],
  ['landing/sections/Safe.tsx', shipped('screens', 'landing', 'sections', 'Safe.tsx')],
  ['pitch/ForParents.tsx', shipped('screens', 'pitch', 'ForParents.tsx')],
  ['pitch/ForStudents.tsx', shipped('screens', 'pitch', 'ForStudents.tsx')],
  ['pitch/MeetWobo.tsx', shipped('screens', 'pitch', 'MeetWobo.tsx')],
  ['pitch/Security.tsx', shipped('screens', 'pitch', 'Security.tsx')],
  ['pitch/HowItWorks.tsx', shipped('screens', 'pitch', 'HowItWorks.tsx')],
  ['pitch/Subjects.tsx', shipped('screens', 'pitch', 'Subjects.tsx')],
  ['site/About.tsx', shipped('screens', 'site', 'About.tsx')],
  ['site/handoffs.ts', shipped('screens', 'site', 'handoffs.ts')],
  ['plans/prices.ts', shipped('screens', 'plans', 'prices.ts')],
  ['gift/copy.ts', shipped('screens', 'gift', 'copy.ts')],
];

/** Fails with the file AND the phrase, so the fix is one grep away. */
function nowhere(pattern: RegExp, why: string): void {
  const guilty: string[] = [];
  for (const [name, body] of PUBLIC_SOURCES) {
    const hit = body.match(pattern);
    if (hit) guilty.push(`${name}: "${hit[0]}"`);
  }
  expect(guilty, why).toEqual([]);
}

// --- A. nothing claimed that cannot be shown working ---------------------------------------------

describe('the four security claims the conformance register marks NOT MET are off the live site', () => {
  const security = shipped('screens', 'pitch', 'Security.tsx');

  /**
   * "Least privilege — Staff have no standing access to learner data. A break-glass path exists for
   * support, and every use of it is written to a log the founder reviews."
   *
   * docs/conformance/privacy-and-children.md row A12 names Security.tsx and marks it NOT MET: the
   * gateway holds SUPABASE_SERVICE_ROLE_KEY, which bypasses every RLS policy, and there is no
   * access-logging code and no break-glass procedure anywhere in the tree.
   */
  it('makes no claim about staff access or a break-glass log', () => {
    expect(security).not.toMatch(/no standing access/i);
    expect(security).not.toMatch(/least privilege/i);
    expect(security).not.toMatch(/break-?glass, logged/i);
    expect(security).not.toMatch(/access is a deliberate act/i);
    // "break-glass" survives in exactly one place, and it is an ADMISSION rather than a claim:
    // the SCHEDULED list of what no outsider has checked yet, which is the register's own remedy.
    const mentions = security.match(/break-?glass/gi) ?? [];
    expect(mentions).toHaveLength(1);
    expect(security).toContain("'Staff break-glass access logging with monthly review',");
  });

  /** The register row has to stay red until somebody builds it, or this guard is meaningless. */
  it('still has the register row that says why, so the claim cannot quietly return', () => {
    const register = repoFile('docs', 'conformance', 'privacy-and-children.md');
    expect(register).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(register).toContain('NOT MET');
    // and the key really is held by code that runs, so this is not a stale note
    const memory = repoFile('services', 'gateway', 'src', 'wobo_gateway', 'memory.py');
    expect(memory).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  /**
   * "Backups that restore — Daily backups, kept for 30 days, and a restore we actually rehearse."
   * docs/CONFORMANCE.md: "No backup has ever been restored and no restore has been rehearsed, and
   * backup configuration itself is unverified."
   */
  it('promises no rehearsed restore and no backup retention window', () => {
    expect(security).not.toMatch(/rehears/i);
    expect(security).not.toMatch(/daily backups/i);
    const conformance = repoFile('docs', 'CONFORMANCE.md');
    expect(conformance).toContain('No backup has ever been restored');
  });

  /**
   * "Gone from live systems at once and from backups within 30 days." The thirty is invented:
   * privacy-policy.md's own [REVIEW] says the retention window has never been read or recorded and
   * that no number can be published, and docs/copy/README.md still lists `[n]` as unfilled.
   */
  it('publishes no backup retention number anywhere, because none has been read', () => {
    nowhere(
      /\b(?:thirty|30)\s*days?\b(?=[^.]{0,60}backup)|backups?[^.]{0,60}\b(?:thirty|30)\s*days?\b/i,
      'docs/legal/privacy-policy.md forbids publishing a number until the hosting project is read',
    );
    expect(repoFile('docs', 'legal', 'privacy-policy.md')).toContain(
      'the backup retention window on the hosting project has never been read or recorded',
    );
  });

  /**
   * The RLS policies are real, but the service-role key our own gateway holds is precisely the
   * thing that walks through them, so "even if our own code slipped" was more than they buy.
   */
  it('does not claim the row locks survive our own code', () => {
    nowhere(/even if our (?:own )?(?:code|app)/i, 'the service-role key bypasses every policy');
  });
});

describe('the neutral rule says what the gateway actually does', () => {
  /**
   * The page said Wobo "names the textbook's position and steers back" — a richer, more reassuring
   * behaviour than the one that exists. `ask_public.py`: "On religion, politics, countries,
   * communities, other products, or anything people disagree about, you take no side and reply
   * UNKNOWN." Nothing reads a textbook's position; the phrase appeared exactly once in the whole
   * repository, in that line of marketing copy.
   */
  it('never says Wobo names a textbook position', () => {
    nowhere(/textbook'?s position/i, 'nothing in the tree reads or states a syllabus position');
    const item = SAFE.items.find((i) => i.title.startsWith('Neutral'));
    expect(item?.body).toContain('takes no side');
    const askPublic = repoFile('services', 'gateway', 'src', 'wobo_gateway', 'ask_public.py');
    expect(askPublic).toContain('you take no side and reply UNKNOWN');
  });
});

describe('mastery is described as the rule the code actually applies', () => {
  /**
   * There is no clock in the mastery rule. `computeBand()` reads counts of correct answers, an
   * independence score and a window of the last ten ANSWERS — not ten days — so three independent
   * correct answers in one sitting produces "secure" and nothing ever waits for a day to pass.
   *
   * The app already retracted this exact label: `screens/progress/Report.tsx` renamed the metric
   * "Right a week on" and wrote down why. Five marketing surfaces shipped the label the product
   * took down.
   */
  it('never says a chapter is done because days or a week passed', () => {
    nowhere(/comes back right days later/i, 'no clock exists in computeBand()');
    nowhere(/held a week later/i, 'the app renamed this metric; the pages had not');
    nowhere(/still true next week/i, 'nothing waits for next week');
    nowhere(/measured only after a week/i, 'the arithmetic requires no gap, only a first answer');
  });

  it('keeps the correction that names the reason, so nobody writes it back', () => {
    const report = raw('screens', 'progress', 'Report.tsx');
    expect(report).toContain('Right a week on');
    expect(report).toContain('heldLater` requires no gap');
    const band = repoFile('platform', 'kgtopg-contract-seed', 'src', 'reference', 'in-memory.ts');
    expect(band).toContain('const RECENT_WINDOW = 10;');
    expect(band).toContain('How many recent answers the reliability check looks at.');
  });
});

describe('the four answer forms are the four the product has', () => {
  /**
   * The fourth tile read "Your own writing, with the pen on it" over a marked-up paragraph.
   * Nothing reads a learner's own writing: no photo or file input for written work, and no essay
   * answer kind. The hero's rail has always named the four that exist.
   */
  it('names the same four forms the hero rail names', () => {
    expect(HERO_FORMS.map((f) => f.key)).toEqual(['draw', 'video', 'try', 'say']);
    expect(FORMS.nav.length).toBe(HERO_FORMS.length);
    expect(FORMS.nav[3]).toBe('Said out loud');
    nowhere(/your own writing/i, 'nothing in the tree ingests or marks up a learner’s writing');
  });

  it('has an engine behind the fourth, like the other three', () => {
    for (const module of ['board-stream.ts', 'video.ts', 'voice.ts']) {
      expect([module, readFileSync(join(SRC, 'wobo', module), 'utf8').length > 0]).toEqual([
        module,
        true,
      ]);
    }
  });
});

describe('the coverage line describes a set that is not empty', () => {
  /**
   * SUBJECTS.lede said "CBSE, ICSE and every state board we hold the official syllabus for". The
   * registry holds four boards and not one of them is a state board, so a parent in Telangana read
   * "mine is probably in there". /subjects two clicks away is exact about this; the front page was
   * the dishonest one.
   */
  it('names the boards the generated registry actually holds', () => {
    const held = BOARDS.boards.filter((b) => (b.chapters ?? 0) > 0).map((b) => b.short);
    expect(held.length).toBe(BOARDS.held.boards);
    for (const board of held) expect([board, SUBJECTS.lede.includes(board)]).toEqual([board, true]);
    // no state board is held, so no public surface may imply one is — and the front page was not
    // the only one saying it: /subjects headed a section "CBSE, ICSE, every state board" and
    // /for-parents answered its own coverage question with "CBSE, ICSE and the state boards".
    expect(held.some((b) => /state/i.test(b))).toBe(false);
    nowhere(
      /\b(?:every|all|the) state boards?\b/i,
      'the registry holds CBSE, ICSE, ISC and NIOS, and not one state board',
    );
  });

  it('says what happens for a board we do not hold, rather than leaving it implied', () => {
    expect(SUBJECTS.lede).toContain('syllabus once and Wobo builds the plan from that');
  });
});

// --- B. we never sell by running anything down, and we never name a late hour --------------------

describe('no public surface puts an age on the reader', () => {
  /**
   * A single age is not a range, so it cleared the letter of the no-grade-gate law and no test
   * flagged it — but "a tutor a ten-year-old talks to alone" was the H2 of objection-ladder rung 6,
   * and a parent of a fifteen-year-old reads it as a statement that this is aimed at younger
   * children. "A child" carries the identical reassurance with no number in it.
   */
  it('never pictures somebody sighing at a child either', () => {
    // "No sighing, no red ink" sits in a list of what Wobo never does, so it reads as Wobo's own
    // conduct — but the word still plants a person sighing at a child, which is the implication
    // ruling B forbids however gentle. The rest of the line makes the point without it.
    nowhere(/\bsigh/i, 'describe what Wobo does; never picture what anyone else does');
  });

  it('says "a child", never an age', () => {
    nowhere(
      /\b(?:five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|\d{1,2})[- ]year[- ]old\b/i,
      'name no age at all: "a child talking to a tutor alone" is the same reassurance',
    );
  });
});

describe('the money is never pegged to the exam crunch', () => {
  /**
   * Ruling D: we are not a cramming tool and must never be marketed as one. "A plan raises the
   * allowance for exam season" attached the upsell to the one moment the ruling says we do not sell
   * into, and it was the only place where the pricing argument and the anti-cramming argument
   * pointed in opposite directions.
   */
  it('sells a plan on the allowance, not on the exam', () => {
    nowhere(/for exam season/i, 'ruling D: the plan raises the daily allowance, full stop');
    nowhere(/test every fortnight/i, 'the same peg, worn as a plan blurb');
  });
});

describe('the allowance is described the way it actually resets', () => {
  /**
   * `budget.py`'s reset_at() is "the next UTC midnight". It is a morning only inside the time-zone
   * band the product was written for, and prices.ts serves several markets off the browser's own
   * locale, so an American family was told it refills every morning and found it refilling in the
   * afternoon.
   */
  it('never promises a morning to a reader whose morning is not UTC', () => {
    nowhere(/resets? (?:each|every) morning|reset each morning/i, 'say "once a day"');
    const budget = repoFile('services', 'gateway', 'src', 'wobo_gateway', 'budget.py');
    expect(budget).toContain('The next UTC midnight');
  });
});

describe('the copy law has no exception for a character', () => {
  /** Ported verbatim from a prototype that broke the law, which is why they survived. */
  it('carries no em dash in a rendered string', () => {
    const copy = raw('screens', 'landing', 'page-copy.ts');
    const strings = [...copy.matchAll(/'([^'\\\n]{4,})'|"([^"\\\n]{4,})"/g)].map(
      (m) => m[1] ?? m[2] ?? '',
    );
    const guilty = strings.filter((s) => s.includes('—'));
    expect(guilty, 'the law has no exception; the prototype it was ported from broke it').toEqual(
      [],
    );
  });

  /**
   * THE TEST ABOVE READ ONE FILE, so the character survived everywhere else: four pull-quote
   * attributions ("— Wobo"), the help centre's search-miss line, and the site's one meta
   * description, which is the Google snippet, the link preview and the PWA install text on every
   * one of the 61 published URLs (wave 29, site-4). Comments are stripped first, because a comment
   * is where a law is explained, not where a reader meets it; what is left of a page's source is
   * what it renders.
   */
  it('carries no em dash on any page a stranger reads, nor in the meta description', () => {
    const pages: [string, string][] = [
      ...PUBLIC_SOURCES,
      ['site/Help.tsx', shipped('screens', 'site', 'Help.tsx')],
      ['site/HelpArticle.tsx', shipped('screens', 'site', 'HelpArticle.tsx')],
      ['site/Sitemap.tsx', shipped('screens', 'site', 'Sitemap.tsx')],
      ['site/SiteShell.tsx', shipped('screens', 'site', 'SiteShell.tsx')],
      ['site/nav.ts', shipped('screens', 'site', 'nav.tsx')],
      ['plans/copy.ts', shipped('screens', 'plans', 'copy.ts')],
      ['plans/Plans.tsx', shipped('screens', 'plans', 'Plans.tsx')],
      [
        'landing/sections',
        readdirSync(join(SRC, 'screens', 'landing', 'sections'))
          .filter((n) => n.endsWith('.tsx'))
          .map((n) => shipped('screens', 'landing', 'sections', n))
          .join('\n'),
      ],
    ];
    const guilty = pages
      .filter(([, source]) => source.includes('—'))
      .map(([name, source]) => {
        const at = source.indexOf('—');
        return `${name}: …${source.slice(Math.max(0, at - 40), at + 20).replace(/\s+/g, ' ')}…`;
      });
    expect(guilty).toEqual([]);
    // THE ONE LINE OF COPY EVERY PUBLISHED ADDRESS CARRIES, and there is now exactly one of it:
    // `src/shell/head.ts` holds it, vite.config.ts takes the shell's and the install manifest's
    // description from there, and `scripts/prerender.ts` writes it as the front page's own. It is
    // the press kit's line word for word (docs/copy/press-kit.md), because an answer engine decides
    // what a name means by what independent sources agree on and sameness is the whole lever.
    //
    // It says "an AI tutor" on purpose. §17 forbids naming what is UNDERNEATH — a provider, a
    // model, a framework — and docs/copy/voice.md forbids "AI-powered" as marketing. Neither
    // forbids the category a parent searches for, and docs/GROWTH-ENTITY.md §4 requires the
    // qualifier on every surface until the engines stop answering "Wobo" with a job-search app.
    const vite = repoFile('apps', 'web-pwa', 'vite.config.ts');
    expect(vite).toContain('DEFAULT_APP_DESCRIPTION = BRAND_DESCRIPTION');
    expect(BRAND_DESCRIPTION.length).toBeGreaterThan(20);
    expect(BRAND_DESCRIPTION).not.toContain('—');
    // and it is written in the site's own register, not a feature list
    expect(BRAND_DESCRIPTION).not.toMatch(/mastery-first|wobot|AI-powered|powered by AI/i);
  });
});

// --- C. one page, one job, one call to action ----------------------------------------------------

describe('the hero asks for one thing, and it is the thing under it', () => {
  const hero = shipped('screens', 'landing', 'sections', 'Hero.tsx');
  const header = shipped('screens', 'landing', 'sections', 'Header.tsx');

  /**
   * The H1 was `Hey Wobo,` / `why do plants need sunlight?` — a syllabus question set as the
   * largest element on the page, with a text input 380px under it that answers questions about
   * WOBO and refuses that one. On a phone the drawn answer sat 229px below the fold, so a visitor
   * met a question, a box that rejects it, and no answer at all.
   */
  it('states a claim rather than staging a question the box cannot answer', () => {
    expect(HERO.title.lead + HERO.title.mark).not.toContain('?');
    expect(hero).toContain('{HERO.title.lead}');
    // and the staged question moved onto the card that carries its four answers
    expect(HERO.staged.question).toContain('?');
    expect(hero.indexOf('HERO.staged')).toBeGreaterThan(hero.indexOf('heroStage') - 400);
  });

  /**
   * DESIGN.md §0: "pig #2B45FF the pointer (one per view)". The sticky header's "Start free" and
   * the hero's "Ask" were both painted rgb(43,69,255) and both visible at 390x844, and the hero
   * carried a third instance of the phrase as a ghost — one call to action in three weights on one
   * screen. Two equal calls to action convert worse than one (docs/SELL.md §6).
   */
  it('paints exactly one pointer in the first screen', () => {
    expect(hero).not.toContain('btn pig');
    expect(header.match(/btn pig/g) ?? []).toHaveLength(1);
  });

  it('carries no second copy of the phrase in the hero body', () => {
    expect(hero).not.toContain('AUTH.start');
    expect(hero).not.toContain('CTA.to');
  });
});

describe('the ask block never competes with the close it sits above', () => {
  /**
   * The shared AskWobo block rendered a solid `.wk-btn.wk-pig` roughly six hundred pixels above
   * every ClosePanel, whose primary is the page's one conversion. Measured on eight public pages.
   * The ask is the demo; the close is the door.
   */
  it('draws the site ask in ink, and keeps pig for the app front door', () => {
    // BOTH ask blocks. `site/AskWobo.tsx` is the shell's; `pitch/Ask.tsx` is the one that actually
    // renders on /meet-wobo, /how-it-works, /for-parents, /for-students, /subjects and /security —
    // measured in Chromium, its pig "Ask" landed 722px above the marigold "Start free" on
    // /for-parents. Fixing only the first would have left every buyer page as it was.
    const askWobo = shipped('screens', 'site', 'AskWobo.tsx');
    expect(askWobo).toContain('tone="ink"');
    expect(shipped('screens', 'pitch', 'Ask.tsx')).toContain('tone="ink"');
    const askBox = raw('ui', 'primitives', 'AskBox.tsx');
    expect(askBox).toContain("tone = 'pig',");
    expect(askBox).toContain('<Button tone={tone}');
  });
});

describe('every close hands the reader forward', () => {
  /**
   * /security's quiet second pointed at `#collect`, back up the page just finished, so the only
   * forward move off the trust page was the primary.
   */
  it('never sends the reader back up the page they have just read', () => {
    expect(handoff('security', true).quiet.href).toBe('/legal');
  });

  /**
   * The gift button read "Give Plus". `plans/prices.ts` defines exactly three tiers and Plus is not
   * one of them, and it rendered three times in two weights beside a card labelled PRO.
   */
  it('names no plan that does not exist', () => {
    const tiers = PLAN_TIERS.map((t) => t.name);
    expect(tiers).toEqual(['Free', 'Pro', 'Max']);
    const invented = /\bPlus\b/;
    expect(invented.test(GIFT_PAGE.cta)).toBe(false);
    expect(GIFT_PAGE.cardCta('Pro, by the month')).toBe('Give Pro');
    expect(GIFT_PAGE.cardCta('Max, by the month')).toBe('Give Max');
    nowhere(/\bGive Plus\b/, 'Plus is not a tier this product sells');
  });
});

describe('the trust page prepares the reader for the draft notice one click away', () => {
  /**
   * Following "Children's privacy" from /security renders "Draft — Written by the Wobo team and not
   * yet reviewed by a lawyer" above the document. The honesty is right (docs/SELL.md §5); arriving
   * unannounced one click from the page whose job is removing fear is not.
   */
  it('says it first, in its own voice, above the links', () => {
    const security = raw('screens', 'pitch', 'Security.tsx');
    expect(security).toContain('const DOCS_NOTE =');
    expect(security).toContain('{DOCS_NOTE}');
    expect(security).toContain('a lawyer has not reviewed them yet');
    // and the notice it is preparing the reader for is still the one that renders
    expect(shipped('screens', 'legal', 'Legal.tsx')).toContain(
      'not yet reviewed by a\n        lawyer',
    );
  });
});

// --- D. friction, and where it hides -------------------------------------------------------------

describe('the page does not scroll past its own point', () => {
  /**
   * Measured in Chromium at 390x844: the homepage was 19,455px — 23.1 phone screens — with a
   * 3,195px pin-spacer around a 795px section and the price at y=14,467, screen 17.1 of 23.
   */
  it('holds the pinned chapter for at most a screen and a half', () => {
    expect(Number(FORMS_END.replace('+=', ''))).toBeLessThanOrEqual(844 * 1.5);
  });

  /**
   * Five outbound links to other assistants rendered 526px above the one and only close: five doors
   * out of the funnel at the point of conversion. Anywhere above the price it costs nothing.
   */
  it('keeps the outbound assistant row above the price, not above the close', () => {
    expect(shipped('screens', 'landing', 'sections', 'Teaches.tsx')).toContain('ASK.others');
    expect(shipped('screens', 'landing', 'sections', 'Safe.tsx')).not.toContain('ASK.others');
    const proto = repoFile('design', 'prototypes', 'landing-v8.html');
    expect(proto.indexOf('class="others')).toBeLessThan(proto.indexOf('<section id="price"'));
  });
});

describe('one spacing rhythm, and --band is it', () => {
  /**
   * `.st-section` read `clamp(56px,7vw,92px)` and never touched `--band`, so the site gave 184px
   * between sections at 1440 while the landing page gave 158.4px, and they disagreed at every
   * width. DESIGN.md §0: "This line is the number, not a second opinion about it."
   */
  it('reads the token on the site as well as on the landing page', () => {
    const site = raw('screens', 'site', 'styles.ts');
    expect(site).toContain('.st-section{padding:calc(var(--band) / 2) 0}');
    expect(site).not.toContain('.st-section{padding:clamp(56px,7vw,92px) 0}');
    const landing = raw('screens', 'landing', 'page-styles.ts');
    expect(landing).toContain('section{padding:calc(var(--band) / 2) 0');
  });
});

describe('the only control a visitor types in can be seen to have focus', () => {
  /**
   * `.ROOT input:focus-visible` and `.ROOT .ask input` both weigh (0,2,1) and the ask rule was
   * written later, so `outline:none` won and #askIn — the hero ask box — reported outlineWidth 0px,
   * outlineStyle none and no box-shadow while focused. It was the only control on the public site
   * with no focus state.
   */
  it('never kills the ring on a control that is focused from a keyboard', () => {
    const css = raw('screens', 'landing', 'page-styles.ts');
    expect(css).toContain('.ask input:not(:focus-visible){outline:none}');
    // the unguarded form is what shipped, and it must not come back
    expect(css).not.toMatch(/\.ask input\{[^}]*outline:\s*none/);
    expect(css).toContain('input:focus-visible{outline:3px solid var(--marigold)');
  });
});

describe('the front page has one declared address', () => {
  /**
   * Loading `/` replaceState-d the bar to `/landing`, an address `public/sitemap.xml` does not
   * contain, so every share and bookmark of the front page propagated a URL absent from the
   * sitemap — and there was no <link rel="canonical"> anywhere in the app.
   */
  it('canonicalises the landing page to the address the sitemap publishes', () => {
    expect(canonicalUrl({ name: 'landing' }, 'https://heywobo.com')).toBe('https://heywobo.com/');
    expect(canonicalUrl({ name: 'for-parents' }, 'https://heywobo.com')).toBe(
      'https://heywobo.com/for-parents',
    );
    const sitemap = readFileSync(join(SRC, '..', 'public', 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://heywobo.com/</loc>');
    expect(sitemap).not.toContain('/landing');
  });

  it('writes the tag, and leaves a bare slash alone', () => {
    const router = raw('shell', 'router.tsx');
    expect(router).toContain("canonical.rel = 'canonical'");
    // the head is written from one table (`headFor`), which is where a 404 is told apart
    expect(router).toContain('canonical.href = head.canonical');
    expect(router).toContain('const head = headFor(route)');
    expect(router).toContain(
      "writePath(bare ? '/' : routeToPath(stack[0] as Route), 1, 'replace')",
    );
  });
});
