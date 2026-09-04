/**
 * The home and learn screens are ports of boards 01 and 02 of design/prototypes/app-v1.html. This
 * holds every screen rule (Home.css, Learn.css) to its source, declaration for declaration, the way
 * src/ui/primitives/ui.test.ts holds the kit — and holds both stylesheets to the law: no line, no
 * corner, no colour of their own.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const APP = readFileSync(join(REPO, 'design', 'prototypes', 'app-v1.html'), 'utf8');
const HOME = readFileSync(join(import.meta.dir, 'Home.css'), 'utf8');
const LEARN = readFileSync(join(import.meta.dir, '..', 'learn', 'Learn.css'), 'utf8');
const HOME_TSX = readFileSync(join(import.meta.dir, '..', 'Home.tsx'), 'utf8');
/** The home's words and its arithmetic; the copy check reads the screen and this together. */
const TODAY_TS = readFileSync(join(import.meta.dir, 'today.ts'), 'utf8');
const LEARN_TSX = readFileSync(join(import.meta.dir, '..', 'Learn.tsx'), 'utf8');

/** Every `selector{declarations}` in a stylesheet, media blocks flattened, comments dropped. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
    const decls = (m[2] as string)
      .split(';')
      .map((d) =>
        d
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*:\s*/, ':'),
      )
      .filter(Boolean);
    if (!selector || selector.startsWith('@')) continue;
    out.set(selector, [...(out.get(selector) ?? []), ...decls]);
  }
  return out;
}

const proto = rules(APP);
const home = rules(HOME);
const learn = rules(LEARN);

/**
 * The 13px floor (DESIGN.md §2, "label 500 at 13"): the provenance pill's line is prose the
 * prototype set at 12px; the screen writes it at 13. The only departure from a straight port.
 */
const LIFTED: Record<string, string> = {
  'font:500 12px/1 var(--sans)': 'font:500 13px/1 var(--sans)',
};
const lift = (decls: string[] | undefined) => decls?.map((d) => LIFTED[d] ?? d);

/** screen selector → prototype selector, desktop and phone declarations together. */
const HOME_PORT: Record<string, string> = {
  '.hm-greet': '.greet',
  '.hm-greet h1': '.greet h1',
  '.hm-greet h1 .hand': '.greet h1 .hand',
  '.hm-greet p': '.greet p',
  '.hm-greet > div:last-child': '.greet > div:last-child',
  '.hm-today': '.today',
  '.hm-split': '.split',
  '.hm-week': '.week',
};

const LEARN_PORT: Record<string, string> = {
  '.ln-subjects': '.subjects',
  '.ln-units': '.units',
  '.ln-unit': '.unit',
  '.ln-unit .ln-n': '.unit .n',
  '.ln-unit b': '.unit b',
  '.ln-unit span': '.unit span',
  '.ln-unit .ln-prog': '.unit .prog',
  '.ln-unit .ln-prog i': '.unit .prog i',
  '.ln-unit.ln-now': '.unit.now',
  '.ln-unit.ln-now .ln-n': '.unit.now .n',
  '.ln-unit.ln-done .ln-n': '.unit.done .n',
  '.ln-unit .ln-state': '.unit .state',
  '.ln-unit > .wk-btn,.ln-unit > .ln-state': '.unit > .btn,.unit > .state',
  '.ln-prov': '.prov',
  '.ln-prov i': '.prov i',
};

describe('every home rule is the prototype’s rule', () => {
  for (const [mine, theirs] of Object.entries(HOME_PORT)) {
    it(`${mine} ← ${theirs}`, () => {
      expect(proto.get(theirs)).toBeDefined();
      expect(home.get(mine)).toEqual(proto.get(theirs));
    });
  }

  it('the head’s column is the prototype’s inline style', () => {
    expect(APP).toContain('<div style="display:grid;place-items:end center">');
    expect(home.get('.hm-greet .hm-head')).toEqual(['display:grid', 'place-items:end center']);
  });

  it('the phone head is 120px through the size prop, not the prototype’s !important', () => {
    expect(proto.get('.greet > div:last-child svg')).toEqual(['width:120px !important']);
    expect(HOME_TSX).toContain('size={phone ? 120 : 180}');
  });

  it('adds no rule of its own — the ask input’s focus ring is the kit’s', () => {
    const own = [...home.keys()].filter((s) => !(s in HOME_PORT) && s !== '.hm-greet .hm-head');
    expect(own).toEqual([]);
  });
});

describe('every learn rule is the prototype’s rule', () => {
  for (const [mine, theirs] of Object.entries(LEARN_PORT)) {
    it(`${mine} ← ${theirs}`, () => {
      expect(proto.get(theirs)).toBeDefined();
      expect(learn.get(mine)).toEqual(lift(proto.get(theirs)));
    });
  }

  it('the headline and Wobo’s line are the prototype’s inline styles', () => {
    expect(APP).toContain('<h1 style="font:700 34px/1.1 var(--sans);margin-top:10px">');
    expect(learn.get('.ln-h1')).toEqual(['font:700 34px/1.1 var(--sans)', 'margin-top:10px']);
    expect(APP).toContain(
      '<div style="display:flex;gap:10px;align-items:center;color:var(--ink-3);font-size:13px">',
    );
    expect(learn.get('.ln-wobo')).toEqual([
      'display:flex',
      'gap:10px',
      'align-items:center',
      'color:var(--ink-3)',
      'font-size:13px',
    ]);
  });

  it('adds no rule of its own', () => {
    const own = [...learn.keys()].filter(
      (s) => !(s in LEARN_PORT) && s !== '.ln-h1' && s !== '.ln-wobo',
    );
    expect(own).toEqual([]);
  });
});

describe('the copy is the prototype’s', () => {
  const LINES = [
    // The clock law (DESIGN.md §0, owner) outranks the port-verbatim rule: the prototype's
    // "this evening" pictures a child at a table late, and this is the first line the home
    // says to them. app-v1.html was corrected in the same commit, so the port is still verbatim.
    'what are we figuring out today?',
    'Ask anything from your syllabus, or paste question 7',
    "Shade, drag and draw. Wobo rings the gap when you're close.",
    "That's exactly how learning looks. It goes in the Sunday note.",
    "This week, in Wobo's words",
    "Rest days don't break it. Learning does not need guilt.",
    'days in a row',
  ];
  for (const line of LINES) {
    it(`home says “${line}”`, () => {
      expect(APP).toContain(line);
      expect(HOME_TSX + TODAY_TS).toContain(line);
    });
  }
  it('learn says its lines', () => {
    for (const line of ['Your subjects', ', where your class is this week', 'Mastered', 'Later']) {
      expect(APP).toContain(line);
      expect(
        LEARN_TSX + readFileSync(join(import.meta.dir, '..', 'learn', 'units.ts'), 'utf8'),
      ).toContain(line);
    }
    const wobo =
      "Something your school does differently? Tell me and I'll reorder, add or drop a chapter for you.";
    expect(APP).toContain(wobo);
    expect(LEARN_TSX.replace(/\s+/g, ' ')).toContain(wobo);
  });
});

describe('the screens keep the law (DESIGN.md §2, §3)', () => {
  for (const [name, css, prefix] of [
    ['Home.css', HOME, 'hm-'],
    ['Learn.css', LEARN, 'ln-'],
  ] as const) {
    it(`${name} prefixes every class, so nothing meets an older screen’s rule`, () => {
      for (const selector of rules(css).keys()) {
        for (const cls of selector.matchAll(/\.([\w-]+)/g)) {
          const c = cls[1] ?? '';
          expect(c.startsWith(prefix) || c.startsWith('wk-') || c === 'hand').toBe(true);
        }
      }
    });
    it(`${name} draws no hairline`, () => {
      expect(css).not.toMatch(/border[^;]*:\s*1px/);
      expect(css).not.toMatch(/border[^;]*:\s*0?\.\d+px/);
    });
    it(`${name} names no colour of its own`, () => {
      const hexes = new Set([...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()));
      for (const h of hexes) expect(['#fff']).toContain(h);
      for (const rgba of css.matchAll(/rgba?\([^)]+\)/g)) expect(APP).toContain(rgba[0]);
    });
    it(`${name} uses the two faces only, through the tokens`, () => {
      expect(css).not.toMatch(/font-family\s*:\s*['"]?(?!var\()/);
    });
  }
});

/**
 * The row of three is a row of THREE. A card that renders only when a condition holds leaves a
 * hole in the row, and a hole is "emptiness that is just absence" (DESIGN.md §2) — the exact thing
 * the law forbids. Each slot here has a fallback, and the last one's fallback is the ask box's own
 * question as a card.
 */
describe('the today row never has a hole in it', () => {
  const row = HOME_TSX.slice(
    HOME_TSX.indexOf('className="hm-today"'),
    HOME_TSX.indexOf('className="hm-split"'),
  );

  it('always draws Continue, whatever the learner has started', () => {
    expect(row).toContain('<Tag>Continue</Tag>');
    // four readings of "continue": the topic in flight, the next one, the subjects, the board
    expect(row.match(/<Tag>Continue<\/Tag>/g)?.length).toBe(4);
    expect(row).toContain('Open your subjects');
  });

  it('always draws Practice, falling back to the set itself', () => {
    expect(row).toContain('<Tag>Practice</Tag>');
    expect(row).toContain('SET_TITLE');
  });

  it('draws the third card either way — what Wobo noticed, else the door to asking', () => {
    expect(row).toContain('<Tag>Wobo noticed</Tag>');
    expect(row).toContain('<Tag>Ask Wobo</Tag>');
    // a ternary, never a bare `{seen && ...}` that can render nothing
    expect(row).toContain('{seen ? (');
    expect(row).not.toContain('{seen && (');
  });

  it("prints the observation's own words, never a constant sentence", () => {
    expect(row).toContain('<p>{seen.body}</p>');
    expect(row).not.toContain("That's exactly how learning looks");
  });
});

/** One sentence under "This week, in Wobo's words", computed in exactly one place. */
describe('the home and You read one weekly note', () => {
  const YOU_TSX = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');

  it('both screens ask weeklyNote, and neither builds its own summary', () => {
    for (const [name, src] of [
      ['Home.tsx', HOME_TSX],
      ['You.tsx', YOU_TSX],
    ] as const) {
      expect([name, src.includes('weeklyNote(')]).toEqual([name, true]);
      expect([name, src.includes('summarise(')]).toEqual([name, false]);
    }
  });
});
