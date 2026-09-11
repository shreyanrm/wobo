/**
 * The conversation renders on the lesson plane, so chat.css adds only the thread on the canvas and
 * the ask box in the say row. This holds those rules to the law, and holds the screen to the
 * promise the wave made of it: the plane, not a chat app — no bubble, no side, no tail.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE_SHEET_VH, SHEET_ATTRIBUTE, SHEET_VAR } from '@wobo/wobo';
import { readingWindow } from '../ChatScreen';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const APP = readFileSync(join(REPO, 'design', 'prototypes', 'app-v1.html'), 'utf8');
const CSS = readFileSync(join(import.meta.dir, 'chat.css'), 'utf8');
const TSX = readFileSync(join(import.meta.dir, '..', 'ChatScreen.tsx'), 'utf8');

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

/**
 * What a padding declaration is worth in px on a given viewport. `padding-bottom:` is read
 * directly, a `padding:` shorthand gives up its bottom, `var(--x, fallback)` is read at its
 * fallback (the value that paints before the plane's effect runs) and `vh` against the height
 * passed in. Enough for the two forms this sheet uses, and it fails loudly on anything else
 * rather than quietly returning a number nobody measured.
 */
function resolvePadding(decl: string, view: { vh: number }): number {
  const [prop, ...rest] = decl.split(':');
  const value = rest.join(':').trim();
  let expr = value;
  if (prop === 'padding') {
    const parts = value.split(/\s+/);
    // top | top right | top right bottom | top right bottom left
    expr = (parts.length >= 3 ? parts[2] : parts[0]) as string;
  } else if (prop !== 'padding-bottom') {
    throw new Error(`not a padding declaration: ${decl}`);
  }
  const inner = expr.startsWith('calc(') ? expr.slice(5, -1) : expr;
  const terms = inner
    .replace(/var\(\s*--[\w-]+\s*,\s*([^)]+)\)/g, '$1')
    .split('+')
    .map((t) => t.trim());
  let px = 0;
  for (const t of terms) {
    const vh = /^(-?[\d.]+)vh$/.exec(t);
    const abs = /^(-?[\d.]+)px$/.exec(t);
    if (vh) px += (Number(vh[1]) / 100) * view.vh;
    else if (abs) px += Number(abs[1]);
    else if (t === '0') continue;
    else throw new Error(`unreadable length in ${decl}: ${t}`);
  }
  return px;
}

const mine = rules(CSS);

describe('the conversation is the lesson plane, not a chat app', () => {
  it('is built from the plane, its canvas, its say row and its side column', () => {
    for (const cls of [
      'ls-lesson',
      'ls-plane',
      'ls-bar',
      'ls-canvas',
      'ls-stage',
      'ls-say',
      'ls-side',
    ]) {
      expect(TSX).toContain(cls);
    }
    expect(TSX).toContain("import './course/lesson.css'");
  });

  it('keeps the board’s two side cards, in the board’s own words', () => {
    expect(TSX).toContain('Ask about this');
    expect(TSX).toContain('Circle any part of the board and ask why. Or just say it.');
    expect(TSX).toContain('Your place');
    expect(TSX).toContain('Saved as you go. Leave any time, come back to this line.');
  });

  it('asks in the say row, with the kit’s own ask box', () => {
    expect(TSX).toContain('<AskBox');
    expect(TSX).toMatch(/className="ls-say ch-say"/);
  });

  it('draws no bubble — nothing in the thread is aligned to a side or given a tail', () => {
    expect(CSS).not.toMatch(/align-self/);
    expect(CSS).not.toMatch(/border-radius/);
  });
});

describe('the chat stylesheet keeps the law (DESIGN.md §2, §3)', () => {
  it('prefixes every class, so nothing meets an older screen’s rule', () => {
    for (const selector of mine.keys()) {
      for (const cls of selector.matchAll(/\.([\w-]+)/g)) {
        const c = cls[1] ?? '';
        expect(c.startsWith('ch-') || c.startsWith('wk-')).toBe(true);
      }
    }
  });

  it('draws no hairline and no border', () => {
    expect(CSS).not.toMatch(/border[^;]*:\s*1px/);
    expect(CSS).not.toMatch(/border[^;]*:\s*0?\.\d+px/);
  });

  it('names no colour of its own', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const rgba of CSS.matchAll(/rgba?\([^)]+\)/g)) expect(APP).toContain(rgba[0]);
  });

  it('uses the two faces only, through the tokens, and never under the 13px floor', () => {
    expect(CSS).not.toMatch(/font-family\s*:\s*(?!inherit|var\()/);
    for (const [, decls] of mine) {
      for (const d of decls) {
        for (const size of d.matchAll(/(?:^font-size:|font:[^;]*?\s)(\d+)px/g)) {
          expect(Number(size[1])).toBeGreaterThanOrEqual(13);
        }
      }
    }
  });
});

/**
 * THE SHEET NEVER TAKES THE SENTENCE IT IS EXPLAINING (docs/INK-FOUR.md, craft: "nothing under a
 * panel, sheet, toast or pill"; experience: "the page the learner is looking at is never taken
 * away to make room for the answer"). The adversary, wave 47 finding 10; re-measured wave 53.
 *
 * The mechanism is two halves and this pins the half that lives here. `ChatScreen.followInPage`
 * scrolls the PAGE until Wobo's last line sits at `innerHeight - 62vh - 16`; it can only do that
 * if the thread has left that much room below itself to scroll into. Take the reserve away and the
 * page runs out of scroll first, and the line stops wherever it stopped.
 *
 * Measured on a real screen at 390x844, four from-scratch boards, light, dark and reduced motion,
 * after a real conversation (eight plain turns, then the drawing) — the last line Wobo said:
 *
 *   with the reserve      bottom 304-305 px, sheet top 321 px, 16 px clear, covered by nothing
 *   reserve back to 16px  bottom 325-326 px, 4-5 px of it BEHIND the sheet's own header
 *
 * so this is not a style preference: the numbers move the moment the declaration does.
 */
describe('the sheet never takes the sentence it is explaining', () => {
  const foot = [...mine].find(([selector]) => selector.includes(SHEET_ATTRIBUTE));

  it('keeps the foot of the thread clear, and only while the sheet is actually up', () => {
    expect(foot).toBeTruthy();
    const [selector, decls] = foot as [string, string[]];
    // keyed on the attribute the plane publishes, and aimed at the thread rather than the screen:
    // nothing else moves, and the moment the sheet goes the reading line comes back down.
    expect(selector).toBe(`[${SHEET_ATTRIBUTE}] .ch-thread`);
    expect(decls.some((d) => d.startsWith('padding-bottom:'))).toBe(true);
    // it reserves; it must never hide or shrink the page the learner was reading
    for (const d of decls) {
      expect(d).not.toMatch(/^(display|visibility|overflow|max-height|height):/);
    }
  });

  it('reserves the whole sheet and a clearance on top of it, from the plane’s own number', () => {
    const [, decls] = foot as [string, string[]];
    const pad = decls.find((d) => d.startsWith('padding-bottom:')) as string;
    // the plane publishes its height on the root; the fallback is the same number, so a first
    // paint that beats the effect still clears the sheet
    expect(pad).toContain(SHEET_VAR);
    expect(pad).toContain(`${PHONE_SHEET_VH}vh`);
    // and what it actually resolves to, in the phone the frames were taken on
    const px = resolvePadding(pad, { vh: 844 });
    expect(px).toBeGreaterThanOrEqual((PHONE_SHEET_VH / 100) * 844);
    // a clearance, so the line is above the edge rather than touching it — and a real one: the
    // measured margin at 390 is 16 px, and the note in the margin law is 24
    expect(px - (PHONE_SHEET_VH / 100) * 844).toBeGreaterThanOrEqual(16);
  });

  it('is not narrowed away by the phone rules that come before it', () => {
    // the reserve is written after the `max-width:900px` block and outside it, so it applies at
    // every width the sheet can take — a rule that only fired inside one media query would leave
    // the boards that open a sheet on a tall narrow window uncovered.
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = body.indexOf(`[${SHEET_ATTRIBUTE}] .ch-thread`);
    expect(at).toBeGreaterThan(-1);
    const before = body.slice(0, at);
    // every media block opened before it is closed before it
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length);
    // and the plain rule it overrides asks for less, or the reserve would be doing nothing
    const plain = mine.get('.ch-thread') ?? [];
    const plainPad = plain.find((d) => d.startsWith('padding:') || d.startsWith('padding-bottom:'));
    expect(plainPad).toBeTruthy();
    expect(resolvePadding(plainPad as string, { vh: 844 })).toBeLessThan(
      resolvePadding(
        (foot as [string, string[]])[1].find((d) => d.startsWith('padding-bottom:')) as string,
        { vh: 844 },
      ),
    );
  });
});

/**
 * THE LAST LINE IS NEVER PARKED UNDER THE PAGE'S OWN FURNITURE (docs/INK-FOUR.md, craft: "nothing
 * under a panel, sheet, toast or pill"; experience: "after the turn the learner can act on what
 * they see"). The adversary, wave 42, finding 1 — the SAY half of the 390 chrome overlap.
 *
 * The ink half was closed in chat.css. This is the other half, and it was open: `followInPage`'s
 * floor was `innerHeight - reserve - 16`, and the reserve is ZERO whenever no board is open. So on
 * /chat at 390 with ten lines on screen and no sheet, the last of them — Wobo's answer — sat under
 * the Tell Wobo pill and the doubt camera, with 430 px of page scroll still unused.
 *
 * MEASURED ON A REAL SCREEN, 390x844 and 1440x900, light and dark, motion and reduced motion, in
 * two states (after a five-ask conversation, and on arrival after a reload) — the last line's box
 * and what was painted over it:
 *
 *   before   [42,728,306,27], bottom 755, scrollY 0 of 430  covered by the pill (top 716) and
 *                                                           the doubt camera (top 708)
 *   after    [42,665,306,27], bottom 692, scrollY 63 of 430  covered by nothing, 8 runs of 8
 *
 * and with a painted `pointer-events:none` bar planted across the foot at top 608 — the shape of
 * `.ls-resume`, which `elementsFromPoint` cannot see at all — the line lands at bottom 592. The
 * floor is measured from what the page PAINTS, not from a list of selectors and not from a hit
 * test: a selector list is exactly what missed these two pieces for two waves running.
 *
 * These numbers are the lab's own, replayed through the same pure function the screen uses.
 */
describe('the last line is never parked under the page’s own furniture', () => {
  // the three pieces the lab measured standing over the foot of /chat at 390x844
  const PILL = { top: 716, bottom: 760, left: 12, right: 133 };
  const CAMERA = { top: 708, bottom: 760, left: 326, right: 378 };
  const RAIL = { top: 773, bottom: 844, left: 0, right: 390 };
  const PHONE = { height: 844, reserve: 0 };
  const LINE = { left: 42, right: 348 };

  it('puts the floor above the lowest-standing pill, not at the foot of the screen', () => {
    const { floor } = readingWindow(PHONE, LINE, [PILL, CAMERA, RAIL]);
    // what the screen used to do — and what left the answer under the camera
    expect(844 - 0 - 16).toBe(828);
    // what it does now: 16 px clear of the camera, the highest-standing of the three
    expect(floor).toBe(692);
    // the line the lab measured at bottom 755 therefore moves 63 px, which is what it moved
    expect(755 - floor).toBe(63);
  });

  it('sees a painted pill that no hit test can find', () => {
    const PLANTED = { top: 608, bottom: 664, left: 0, right: 390 };
    const { floor } = readingWindow(PHONE, LINE, [PILL, CAMERA, RAIL, PLANTED]);
    expect(floor).toBe(592);
  });

  it('is not moved by furniture in another column', () => {
    // 1440x900: the doubt camera is at the right edge and the thread is in the plane card
    const wide = readingWindow({ height: 900, reserve: 0 }, { left: 470, right: 849 }, [
      { top: 720, bottom: 772, left: 1368, right: 1420 },
      { top: 0, bottom: 900, left: 0, right: 96 }, // the rail, a column down the left
    ]);
    expect(wide.floor).toBe(884);
    expect(wide.ceiling).toBe(0);
  });

  it('raises the ceiling for what stands at the head, and never the floor', () => {
    const { floor, ceiling } = readingWindow(PHONE, LINE, [
      { top: 0, bottom: 64, left: 0, right: 390 },
    ]);
    expect(ceiling).toBe(80);
    expect(floor).toBe(828);
  });

  it('leaves a layer that spans the middle alone — that is the sheet’s law, not this one', () => {
    // Wobo's own ink layer is a transparent host the size of the screen; the sheet is the page
    // for as long as it is up. Neither is chrome over a page, and the reserve owns the sheet.
    const { floor } = readingWindow(PHONE, LINE, [{ top: 0, bottom: 844, left: 0, right: 390 }]);
    expect(floor).toBe(828);
  });

  it('keeps the sheet’s reserve when the sheet is up, and it still wins', () => {
    const reserve = (PHONE_SHEET_VH / 100) * 844;
    const { floor } = readingWindow({ height: 844, reserve }, LINE, [PILL, CAMERA, RAIL]);
    // the wave 47 number the frames were taken against: the line lands at 304-305
    expect(Math.round(floor)).toBe(305);
    expect(floor).toBeLessThan(692);
  });
});
