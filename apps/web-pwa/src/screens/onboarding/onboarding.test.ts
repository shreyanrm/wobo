/**
 * onboarding.css is a port of design/prototypes/onboarding-v2.html, rule for rule. This holds every
 * `ob-` rule to its source and lists, by name, the few departures: the artboard chrome the screen
 * does not have, the element resets, and the handwritten reply in the aha canvas.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO = readFileSync(join(REPO, 'design', 'prototypes', 'onboarding-v2.html'), 'utf8');
const SHEET = readFileSync(join(import.meta.dir, 'onboarding.css'), 'utf8');

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

const proto = rules(PROTO);
const sheet = rules(SHEET);

/** ob- selector → the prototype's. */
const PORT: Record<string, string> = {
  '.ob-btn': '.btn',
  '.ob-btn.ob-pig': '.btn.pig',
  '.ob-btn.ob-link': '.btn.link',
  '.ob-btn:focus-visible,.ob-field input:focus-visible': '.btn:focus-visible,input:focus-visible',
  '.ob-top': '.top',
  '.ob-top .ob-wm svg': '.top .wm svg',
  '.ob-body': '.body',
  '.ob-card': '.card',
  '.ob-card .ob-wobo': '.card .wobo',
  '.ob-card .ob-bub': '.card .bub',
  '.ob-card h1': '.card h1',
  '.ob-card p.ob-sub': '.card p.sub',
  '.ob-form': '.form',
  '.ob-field': '.field',
  '.ob-field label,.ob-field legend': '.field label',
  '.ob-field input': '.field input',
  '.ob-field input::placeholder': '.field input::placeholder',
  '.ob-fine': '.fine',
  '.ob-ta': '.ta',
  '.ob-ta .ob-list': '.ta .list',
  '.ob-ta .ob-opt': '.ta .opt',
  '.ob-ta .ob-opt.ob-on': '.ta .opt.on',
  '.ob-ta .ob-opt span': '.ta .opt span',
  '.ob-ta .ob-opt mark': '.ta .opt mark',
  '.ob-ta .ob-own': '.ta .own',
  '.ob-ta .ob-own b': '.ta .own b',
  '.ob-chips': '.chips',
  '.ob-chips span': '.chips span',
  '.ob-chips span.ob-on': '.chips span.on',
  '.ob-aha': '.aha',
  '.ob-aha .ob-bar': '.aha .bar',
  '.ob-aha .ob-bar b': '.aha .bar b',
  '.ob-aha .ob-live': '.aha .live',
  '.ob-aha .ob-live i': '.aha .live i',
  '.ob-aha .ob-canvas': '.aha .canvas',
  '.ob-aha .ob-ask': '.aha .ask',
  '.ob-aha .ob-ask input': '.aha .ask input',
  '.ob-aha .ob-ask .ob-btn': '.aha .ask .btn',
  '.ob-chipsq': '.chipsq',
  '.ob-chipsq span': '.chipsq span',
  '.ob-parent': '.parent',
  '.ob-note': '.note',
  '.ob-note em': '.note em',
  '.ob-note small': '.note small',
  '.ob-allow': '.allow',
  '.ob-allow b': '.allow b',
  '.ob-allow .ob-bar': '.allow .bar',
  '.ob-allow .ob-bar i': '.allow .bar i',
  '.ob-allow span': '.allow span',
  '.ob-confetti': '.confetti',
  '.ob-confetti i': '.confetti i',
};

/**
 * Named departures: the screen is the page (no artboard corners), resets, the written reply, and
 * the bar. The bar's two controls (back, and the quiet way past a step) are pressable, so they
 * read in ink-2 rather than the prototype's ink-3, which is 3.6:1 on white and under the floor
 * for a control; the run across the top is the door's own stepper (auth/Steps.tsx), so the
 * prototype's dots are not ported at all and below 640 the bar wraps to give the run a row.
 */
const OWN = new Set([
  '.ob-screen',
  '.ob-top .ob-skip',
  '.ob-top .ob-ways',
  '.ob-screen>.ob-top',
  '.ob-card h1:focus',
  '.ob-btn:disabled',
  '.ob-refuse',
  '.ob-top .au-steps',
  '.ob-top .au-steps ol',
  'button.ob-skip',
  'button.ob-opt,button.ob-own',
  '.ob-chips button',
  '.ob-chips button:disabled',
  '.ob-chipsq button',
  '.ob-chips button,.ob-chipsq button',
  'fieldset.ob-field',
  '.ob-field legend',
  '.ob-aha .ob-canvas .ob-hw',
  '.ob-aha .ob-canvas .ob-hw.ob-pig',
]);

/**
 * The touch floor (DESIGN.md §2: "touch targets are 44 px or more"): on a phone the sheet grows a
 * pressable box to 44px and moves nothing else. The only declarations added to a ported rule.
 */
const FLOOR = new Set(['min-height:44px', 'display:inline-flex', 'align-items:center']);

const HERE = import.meta.dir;
/** A source with its comments stripped: what it says to a learner, not what it says about itself. */
function spoken(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const ONBOARDING = spoken(readFileSync(join(HERE, '..', 'Onboarding.tsx'), 'utf8'));
const AUTH = spoken(readFileSync(join(HERE, '..', 'auth', 'Auth.tsx'), 'utf8'));
const PARENT_INVITE = spoken(readFileSync(join(HERE, '..', 'you', 'ParentInvite.tsx'), 'utf8'));

describe('onboarding.css is onboarding-v2, rule for rule', () => {
  it('ports every rule declaration for declaration', () => {
    for (const [mine, theirs] of Object.entries(PORT)) {
      const source = proto.get(theirs) ?? [];
      const ported = sheet.get(mine) ?? [];
      expect(
        ported.filter((d) => !FLOOR.has(d) || source.includes(d)),
        mine,
      ).toEqual(source);
    }
  });
  it('has no rule the prototype does not, beyond the named departures', () => {
    for (const selector of sheet.keys()) {
      expect(selector in PORT || OWN.has(selector), selector).toBe(true);
    }
  });
  it('is the page, not an artboard', () => {
    const screen = sheet.get('.ob-screen') ?? [];
    expect(screen).toContain('background:var(--paper)');
    expect(screen).toContain('min-height:100dvh');
    expect(screen.some((d) => d.startsWith('border-radius'))).toBe(false);
  });
  it('draws no hairline and no border on a surface', () => {
    expect(SHEET).not.toMatch(/0\.5px|1px solid|hairline/);
  });
});

/**
 * ONE SIGN-IN, NOT TWO.
 *
 * The first thing a new learner saw was this screen's own copy of the sign-in: seventy-odd `ob-`
 * classes, its own field, its own error strings, a button that said "Continue with a sign-in
 * provider". The doors in auth/ were rebuilt; the copy was not; the owner screenshotted the copy.
 * Step one is `<Auth mode="sign-up">` now, and this holds that there is no second door here.
 */
describe('step one is the door, and there is no second door', () => {
  it('renders the doors component for step one', () => {
    expect(ONBOARDING).toMatch(/import \{ Auth \} from '\.\/auth\/Auth';/);
    expect(ONBOARDING).toMatch(/<Auth\s+mode="sign-up"/);
  });

  it('carries no email, phone, code or provider form of its own', () => {
    for (const trace of [
      'inputMode="email"',
      'inputMode="tel"',
      'autoComplete="username"',
      'one-time-code',
      'requestPhoneOtp',
      'verifyPhoneOtp',
      'signInWithGoogle',
      'normalizePhone',
      'sign-in provider',
      'Send me a code',
      'ob-address',
      'ob-code',
    ]) {
      expect([trace, ONBOARDING.includes(trace)]).toEqual([trace, false]);
    }
    // the sheet lost the sign-in's rules with the sign-in
    for (const selector of ['.ob-or', '.ob-btn.ob-quiet', '.ob-dots']) {
      expect([selector, SHEET.includes(selector)]).toEqual([selector, false]);
    }
  });

  it('draws the run with the same stepper the door draws it with', () => {
    expect(ONBOARDING).toContain("from './auth/Steps'");
    expect(AUTH).toContain("from './Steps'");
    // and neither keeps a private stepper as a picture
    for (const [name, source] of [
      ['Onboarding.tsx', ONBOARDING],
      ['Auth.tsx', AUTH],
    ] as const) {
      expect([name, /role="img"[^>]*aria-label=\{?[`'"]step/i.test(source)]).toEqual([name, false]);
    }
  });

  it('remembers where the run is, and clears it on finish', () => {
    expect(ONBOARDING).toContain('restoreStep(readSavedStep(');
    expect(ONBOARDING).toContain('saveStep(stepStore(), next)');
    expect((ONBOARDING.match(/clearStep\(stepStore\(\)\)/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('does not count an anonymous session as somebody signed in', () => {
    expect(ONBOARDING).toContain('!account.isAnonymous()');
  });

  it('uses the first name it asked for from then on', () => {
    // the aha's bar, the sample Sunday note, and the last headline all carry it
    expect((ONBOARDING.match(/firstName/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('never refuses in silence: no primary button is disabled on an empty form', () => {
    // step two's "That's me" was `disabled={!ready2}`, drawn in full pig blue over three empty
    // fields with no rule to say so; a tap on the brightest thing on the page did nothing
    expect(ONBOARDING).not.toContain('disabled={!ready2}');
    expect(ONBOARDING).not.toMatch(/if \(!line \|\| chat\.busy\) return;/);
    // each refusal is one line, announced, and pointed at the control it is about
    expect(ONBOARDING).toContain('nameField.current?.focus()');
    expect(ONBOARDING).toContain('boardField.current?.focus()');
    expect(ONBOARDING).toContain('askField.current?.focus()');
    expect((ONBOARDING.match(/className="ob-refuse"[^>]*role="alert"/g) ?? []).length).toBe(2);
    // and the sheet draws a button that cannot be pressed as one
    expect(sheet.get('.ob-btn:disabled')).toContain('opacity:.62');
  });

  it("asks for the board before the class, because the classes are the board's", () => {
    const board = ONBOARDING.indexOf('id="ob-board"');
    const klass = ONBOARDING.indexOf('<legend>Class</legend>');
    expect(board).toBeGreaterThan(0);
    expect(klass).toBeGreaterThan(board);
  });

  it('offers one quiet way past a step, never two', () => {
    // step four's way past is the form's own "I'll do this later"; the bar said "Not now" above it
    expect(ONBOARDING).not.toContain("'Not now'");
    expect(PARENT_INVITE).toContain("I'll do this later");
    // step three: the bar's word until a question is asked, the button under the answer after
    expect(ONBOARDING).toMatch(/askedAt === null \? \{ 3: 'Skip for now' \} : \{\}/);
    expect(ONBOARDING).toMatch(/\{askedAt !== null \? \(\s*<button/);
  });

  it('never tells a learner who just walked the door to sign in, and draws no bar it cannot read', () => {
    expect(ONBOARDING).not.toContain('Sign in and this');
    expect(ONBOARDING).toContain('ALLOWANCE_UNREAD_LINE');
    expect(ONBOARDING).toMatch(/\{share !== null \? \(\s*<div className="ob-bar"/);
  });

  it('names the provider, and writes no em dash anywhere a learner reads', () => {
    for (const [name, source] of [
      ['Onboarding.tsx', ONBOARDING],
      ['ParentInvite.tsx', PARENT_INVITE],
      ['onboarding.css', SHEET],
    ] as const) {
      expect([name, source.includes('\u2014')]).toEqual([name, false]);
    }
  });
});

describe("the aha keeps its promise (2026-09-05)", () => {
  it("step three asks for the hand outright, because the headline says \"I'll draw it\"", () => {
    // The three sample questions are prose; read as words alone they came back as handwriting
    // under a headline that promised ink. The screen that made the promise asks for the drawing.
    const raw = readFileSync(join(HERE, '..', 'Onboarding.tsx'), 'utf8');
    expect(raw).toContain('chat.ask(line, { draw: true })');
    expect(raw).not.toContain('chat.ask(line);');
  });
});

/**
 * THE TOUCH FLOOR APPLIES AT EVERY WIDTH.
 *
 * DESIGN.md says "touch targets are 44 px or more" and says nothing about a viewport. The floor
 * was written inside `@media (max-width:900px)`, so at 1440 the class chips and the sample
 * questions measured 24.8px tall, the aha's Ask button 38px and the ask input 23px: the <button>
 * standing in for the prototype's <span> is inline, and an inline box takes no vertical padding.
 * A 1440 laptop is a touchscreen as often as not, and a mouse held by an unsteady hand needs the
 * same 44px a thumb does.
 */
describe('the touch floor is not conditional on a small screen', () => {
  /** The sheet with every @media block removed: what applies at every width. */
  function unconditional(source: string): string {
    // Comments first: one of them quotes the media query this block used to live in.
    const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
    let out = '';
    let i = 0;
    for (;;) {
      const at = css.indexOf('@media', i);
      if (at === -1) return out + css.slice(i);
      out += css.slice(i, at);
      let depth = 0;
      let j = css.indexOf('{', at);
      if (j === -1) return out;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      i = j;
    }
  }

  const base = rules(unconditional(SHEET));

  it('gives every pressable box 44px at 1440 as well as at 390', () => {
    for (const selector of [
      '.ob-btn.ob-link',
      '.ob-chips button,.ob-chipsq button',
      'button.ob-opt,button.ob-own',
      '.ob-aha .ob-ask .ob-btn',
      '.ob-aha .ob-ask input',
    ]) {
      expect([selector, base.get(selector)?.includes('min-height:44px')]).toEqual([selector, true]);
    }
  });

  it('makes the chip button a box that can take the height at all', () => {
    // min-height on an inline box does nothing; this is why the chips measured 24.8px.
    const chips = base.get('.ob-chips button,.ob-chipsq button') ?? [];
    expect(chips).toContain('display:inline-flex');
    expect(chips).toContain('align-items:center');
  });
});
