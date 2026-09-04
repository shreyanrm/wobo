/**
 * The pitch sheet is a port of the six pitch prototypes, rule for rule, under page prefixes. This
 * holds a sample of the ported rules to their sources — the same declarations, the same values —
 * and holds the whole sheet to the laws: no border line, no corner under 10px but the tails the
 * prototypes draw, no stroke under 2.5px, every colour a token, only the two faces, reduced
 * motion respected.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PITCH_CSS } from './styles';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const PROTO = join(REPO, 'design', 'prototypes');

function sheet(file: string): string {
  const html = readFileSync(join(PROTO, file), 'utf8');
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
}

/**
 * The prototypes' cream-at-N% tints, read as the paper mix the sheet writes them as; and a
 * keyframe's name, which the sheet prefixes so six pages' `draw`s and `fade`s cannot collide.
 */
function normalise(decl: string): string {
  return decl
    .replace(
      /rgba\((?:250,247,240|255,255,255),\.(\d+)\)/g,
      (_m, n: string) => `color-mix(in srgb,var(--paper) ${Number(`0.${n}`) * 100}%,transparent)`,
    )
    .replace(/^animation:[a-z-]+(?=[\s;]|$)/, 'animation:*');
}

/**
 * Every `selector{declarations}`, width media blocks flattened, selector groups split. The
 * reduced-motion block is left out on both sides: the sheet stills more than the prototypes do
 * (every drawn transition, not only the animations), and that is held by its own test below.
 */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/@media \(prefers-reduced-motion[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = (m[2] as string)
      .split(';')
      .map((d) => normalise(d.trim()))
      // The one declaration added to a prototype's rule: a finger holding the "Hold to talk"
      // button must not scroll the page out from under itself.
      .filter((d) => d && d !== 'touch-action:none');
    for (const raw of (m[1] as string).split(',')) {
      const selector = raw.trim();
      if (!selector) continue;
      out.set(selector, [...(out.get(selector) ?? []), ...decls]);
    }
  }
  return out;
}

const PITCH = rules(PITCH_CSS);

/** Assert the sheet's selector carries exactly the prototype selector's declarations. */
function ported(file: string, pairs: readonly [proto: string, ours: string][]): void {
  const source = rules(sheet(file));
  for (const [theirs, ours] of pairs) {
    expect([theirs, PITCH.get(ours)]).toEqual([theirs, source.get(theirs)]);
  }
}

describe('the pitch sheet is the prototypes, rule for rule', () => {
  it('ports the security page from site-security.html', () => {
    ported('site-security.html', [
      ['.shield .draw', '.sc-shield .sc-draw'],
      ['.short', '.sc-short'],
      ['.tbl .r', '.sc-tbl .sc-r'],
      ['.flow .box', '.sc-flow .sc-box'],
      ['.who .r', '.sc-who .sc-r'],
      ['.never div', '.sc-never div'],
      // `.posture .col` is not here: law v5 sits the two compliance columns on paper-2 where the
      // prototype still washes one of them in mint.
      ['.subs div', '.sc-subs div'],
      // `.panel` is not here: the prototype washes the two closing panels in rose and pig, and
      // law v5 sits them on paper-2 and keeps the pigment for the mark inside them.
      ['.docs a', '.sc-docs a'],
      ['.req', '.sc-req'],
      ['.req p', '.sc-req p'],
      ['.req input', '.sc-req input'],
    ]);
  });

  it('ports the meet page from site-meet.html', () => {
    ported('site-meet.html', [
      ['.hero .bubble', '.mt-bubble'],
      ['.chapter', '.pt-chapter'],
      ['.chapter h2 .hl::before', '.pt-chapter h2 .pt-hl::before'],
      ['.chapter li', '.mt-list li'],
      // `.art` is not here: the prototype leaves the art panel untinted and paints a wash on the
      // variant class; law v5 sits every panel on paper-2 instead. `site/law-v5.test.ts` asserts it.
      ['.ink', '.pt-ink'],
      ['.draw', '.pt-draw'],
      ['.never div', '.mt-never div'],
      ['.demo', '.mt-demo'],
      ['.demo .hold', '.mt-hold'],
      ['.demo .say', '.mt-say'],
      ['.demo .ring', '.mt-ring'],
    ]);
  });

  it('ports the parents page from site-parents.html', () => {
    ported('site-parents.html', [
      ['.env .letter', '.pa-env .pa-letter'],
      // `.env .flap` is not here: the prototype's envelope has been redrawn without a flap rule.
      // The page still opens its flap, and `pitch.test.ts` holds the copy around it.
      ['.chapter .caps div', '.pa-caps div'],
      ['.mock', '.pa-mock'],
      ['.mock .row', '.pa-mock .pa-row'],
      ['.mock .note', '.pa-mock .pa-note'],
      ['.cost', '.pa-cost'],
      ['.allow', '.pa-allow'],
      ['.faq details', '.pa-faq details'],
      ['.faq summary', '.pa-faq summary'],
    ]);
  });

  it('ports the students page from site-students.html', () => {
    ported('site-students.html', [
      ['.film', '.su-film'],
      ['.film .frame', '.su-frame'],
      ['.film .q', '.su-q'],
      ['.chat .me', '.pt-chat .pt-me'],
      ['.chat .wo', '.pt-chat .pt-wo'],
      ['.grid4', '.su-grid4'],
      ['.grid4 button', '.su-grid4 button'],
      ['.grid4 svg path', '.su-grid4 svg path'],
      ['.puzzle .line', '.su-line'],
      ['.streak .days i', '.su-days i'],
      ['.streak .n', '.su-n'],
    ]);
  });

  it('ports the how page from site-how.html', () => {
    ported('site-how.html', [
      ['.step', '.hw-step'],
      ['.step::before', '.hw-step::before'],
      ['.step .n', '.hw-n'],
      ['.dragpt svg', '.hw-dragpt svg'],
      ['.kinds div', '.hw-kinds div'],
      ['.week .chart i', '.hw-chart i'],
      ['.note', '.hw-note'],
    ]);
  });

  it('ports the subjects page from site-subjects.html', () => {
    ported('site-subjects.html', [
      // `.tiles a` is not here for the same reason: a subject tile is paper-2, not a wash.
      ['.tiles a:hover', '.sb-tiles a:hover'],
      ['.boards', '.sb-boards'],
      ['.typeahead', '.sb-type'],
      ['.typeahead .opt', '.sb-type .sb-opt'],
      ['.chapter .span div', '.sb-span div'],
    ]);
  });
});

describe('the laws hold over the whole sheet', () => {
  const decls = [...PITCH.values()].flat();

  it('draws no hairline and no 1px border', () => {
    for (const d of decls) {
      if (!/^border(-top|-right|-bottom|-left)?:/.test(d)) continue;
      // border:0 clears a control's default; a 2px rule is one Wobo draws (DESIGN.md §2).
      expect(d === 'border:0' || /^border(-top)?:2px solid var\(--paper(-2)?\)$/.test(d)).toBe(
        true,
      );
    }
    expect(PITCH_CSS).not.toMatch(/\b1px\b/);
    expect(PITCH_CSS).not.toMatch(/outline:1px|outline:2px/);
  });

  it("keeps every corner at 10px or more, but the prototypes' own tails and bar feet", () => {
    // A speech bubble's tail (4px) and the foot of a bar or the end of a drawn line (2px, 6px,
    // 8px) are marks, not surfaces; the prototypes draw them so and this sheet keeps them.
    const marks = new Set([
      'border-radius:20px 20px 20px 4px',
      'border-radius:14px 14px 4px 14px',
      'border-bottom-right-radius:4px',
      'border-bottom-left-radius:4px',
      'border-radius:8px 8px 4px 4px',
      'border-radius:2px',
      'border-radius:6px',
    ]);
    for (const d of decls) {
      const m = /^border(?:-[a-z-]+)?-radius:(.+)$/.exec(d);
      if (!m || marks.has(d)) continue;
      for (const part of (m[1] as string).split(/[\s/]+/)) {
        if (part === '50%' || part === '999px') continue;
        expect([d, Number.parseFloat(part) >= 10]).toEqual([d, true]);
      }
    }
  });

  it('draws no ink stroke under 2.5px', () => {
    for (const d of decls) {
      const m = /^stroke-width:(.+)$/.exec(d);
      if (!m) continue;
      expect([d, Number.parseFloat(m[1] as string) >= 2.5]).toEqual([d, true]);
    }
  });

  it("writes every colour as a token, apart from the prototypes' own", () => {
    // Ink on marigold is always the navy the prototypes name; a shadow is the prototypes' own
    // tinted navy; the white of a pig button; the parent's phone drawn in night's exact tones.
    const allowed = new Set([
      '#14142B',
      '#fff',
      'rgba(20,20,43,.10)',
      'rgba(20,20,43,.12)',
      'rgba(20,20,43,.14)',
      'rgba(20,20,43,.16)',
      'rgba(20,20,43,.18)',
      'rgba(20,20,43,.22)',
      'rgba(0,0,0,.35)',
    ]);
    for (const m of PITCH_CSS.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
      expect([m[0], allowed.has(m[0])]).toEqual([m[0], true]);
    }
  });

  it('uses no face but Poppins and Caveat', () => {
    for (const d of decls) {
      if (!/^font(-family)?:/.test(d)) continue;
      expect(/var\(--sans\)|var\(--hand\)/.test(d)).toBe(true);
    }
  });

  it('keeps the reduced-motion escape hatch, for the OS and for the app', () => {
    expect(PITCH_CSS).toContain('@media (prefers-reduced-motion:reduce)');
    expect(PITCH_CSS).toContain('[data-motion="reduce"] .pt-draw');
    expect(PITCH_CSS).toContain('[data-motion="reduce"] .sc-shield .sc-draw');
  });

  it('carries no backtick that would end its own template literal', () => {
    expect(PITCH_CSS).not.toContain('`');
  });
});
