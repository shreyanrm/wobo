/**
 * Law v5 (DESIGN.md §0) over the authenticated screens.
 *
 * The white ground is a token change, and Worker A made it; what this file holds is the part a
 * token cannot enforce — that no screen puts a WASH behind a card, a panel or a section to say it
 * is one. Fable's own words for the rule, written into design/prototypes/site-parents.html when
 * the site pages moved: "a wash tints a pill, a tick or a selected row — never a card, a tile, a
 * panel or a section. Surfaces are paper-2."
 *
 * So the sanctioned washes are listed by name here, one line each saying what job it is doing, and
 * anything else that reaches for `--*-w` fails. Adding a wash means adding a line and defending it.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;

const SHEETS: Record<string, string> = {
  'home/Home.css': readFileSync(join(HERE, 'home', 'Home.css'), 'utf8'),
  'learn/Learn.css': readFileSync(join(HERE, 'learn', 'Learn.css'), 'utf8'),
  'course/lesson.css': readFileSync(join(HERE, 'course', 'lesson.css'), 'utf8'),
  'subject/subject.css': readFileSync(join(HERE, 'subject', 'subject.css'), 'utf8'),
  'chat/chat.css': readFileSync(join(HERE, 'chat', 'chat.css'), 'utf8'),
  'you/you.css': readFileSync(join(HERE, 'you', 'you.css'), 'utf8'),
  // "Your plan" and its cancel confirmation. In the map, not only in plan.test.ts: that file can
  // hold this sheet to the law in ISOLATION, but only the cross-sheet set below can catch the one
  // failure a single sheet never sees — a short class name that means two things (DESIGN.md §0,
  // trap 1).
  'you/plan.css': readFileSync(join(HERE, 'you', 'plan.css'), 'utf8'),
  'practice/practice.css': readFileSync(join(HERE, 'practice', 'practice.css'), 'utf8'),
  'onboarding/onboarding.css': readFileSync(join(HERE, 'onboarding', 'onboarding.css'), 'utf8'),
};

const SCREENS = [
  'Home.tsx',
  'Learn.tsx',
  'Course.tsx',
  'SubjectScreen.tsx',
  'ChatScreen.tsx',
  'Practice.tsx',
  'ProgressScreen.tsx',
  'You.tsx',
  'Onboarding.tsx',
  'FrameBuilding.tsx',
].map((f) => [f, readFileSync(join(HERE, f), 'utf8')] as const);

/** selector → the job the pigment is doing there. Every entry is a pill, a tick or a selected row. */
const SANCTIONED_WASHES: Record<string, string> = {
  '.ln-unit .ln-n': 'the chapter number — a badge, the size of a pill',
  '.ln-unit.ln-now': 'the chapter the learner is standing in — a selected row',
  '.ln-unit.ln-done .ln-n': 'a finished chapter is ticked — the badge, in mint',
  '.ls-notes button.ls-on': 'the saved board being read — a selected row',
  '.pr-set button.pr-on': 'the item being answered — a selected row',
  '.ob-ta .ob-opt.ob-on': 'the board under the keyboard — a selected row',
  '.ob-note': "Wobo's handwritten Sunday note — the highlighter, as site-parents.html keeps it",
  '.wy-mock .wy-row .wy-ok': 'a lesson mastered — a pill with a tick in it',
  '.wy-mock .wy-note': "Wobo's handwritten Sunday note — the same one, in the parent's view",
};

/** Rules, comments stripped, media blocks flattened. */
function rules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
    if (!selector || selector.startsWith('@')) continue;
    out.set(selector, `${out.get(selector) ?? ''};${m[2] as string}`);
  }
  return out;
}

describe('law v5 — a wash never marks a surface', () => {
  it('every wash in an app stylesheet is one of the listed jobs', () => {
    const found: string[] = [];
    for (const [name, css] of Object.entries(SHEETS)) {
      for (const [selector, decls] of rules(css)) {
        if (/var\(--[a-z]+-w\)/.test(decls) && !(selector in SANCTIONED_WASHES)) {
          found.push(`${name} — ${selector}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('every listed job is still a real rule somewhere', () => {
    const all = new Set(Object.values(SHEETS).flatMap((css) => [...rules(css).keys()]));
    for (const selector of Object.keys(SANCTIONED_WASHES)) {
      expect(all.has(selector), selector).toBe(true);
    }
  });

  it('the panels a learner works on are tonal surfaces, not pigment', () => {
    // the two the wave found: the practice item (a 560px mint slab) and the parent's report panel
    expect(rules(SHEETS['practice/practice.css'] as string).get('.pr-item')).toContain(
      'background:var(--paper-2)',
    );
    expect(rules(SHEETS['you/you.css'] as string).get('.wy-art')).toContain(
      'background:var(--paper-2)',
    );
  });
});

describe('law v5 — one pointer per view', () => {
  it('no app screen washes a Card in a pigment', () => {
    for (const [name, source] of SCREENS) {
      expect(source.match(/<Card[^>]*\stint=/), name).toBeNull();
    }
  });

  it('the home points at exactly one thing, and it is the next best action', () => {
    const home = SCREENS.find(([f]) => f === 'Home.tsx')?.[1] ?? '';
    // one pig BUTTON per branch of the Continue card, and no pig anywhere else on the screen
    expect([...home.matchAll(/tone="pig"/g)]).toHaveLength(4);
    expect(home).not.toContain('tint=');
  });
});

describe('law v5 §8 — one owner per animated property', () => {
  it('no app stylesheet transitions a property a script also drives', () => {
    for (const [name, css] of Object.entries(SHEETS)) {
      expect(css.match(/transition\s*:[^;}]*\b(transform|opacity|all)\b/), name).toBeNull();
    }
  });

  it('nothing in the app screens tweens a layout property', () => {
    for (const [name, source] of SCREENS) {
      expect(source.match(/animate=\{\{\s*(width|height|top|left)\s*:/), name).toBeNull();
    }
    // the two fills the wave converted: a held button and a progress segment, both on scaleX
    const shared = readFileSync(join(HERE, 'course', 'shared.tsx'), 'utf8');
    expect(shared).not.toMatch(/animate=\{\{\s*width:/);
    expect([...shared.matchAll(/transformOrigin: 'left'/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('the house button no longer chases the pointer with its own box', () => {
    const kit = readFileSync(join(HERE, '..', 'ui', 'kit.tsx'), 'utf8');
    const button = kit.slice(
      kit.indexOf('export function MagneticButton'),
      kit.indexOf('export function Kbd'),
    );
    expect(button.length).toBeGreaterThan(500);
    expect(button).not.toContain('onPointerMove');
    expect(button).not.toContain('useSpring');
    expect(button).toContain("boxShadow: hover && !disabled ? 'var(--lift)' : 'none'");
  });

  it('no shared control transitions `all`', () => {
    const kit = readFileSync(join(HERE, '..', 'ui', 'kit.tsx'), 'utf8');
    expect(kit).not.toMatch(/transition: '[^']*\ball\b/);
  });
});
