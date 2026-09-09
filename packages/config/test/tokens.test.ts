import { describe, expect, it } from 'bun:test';
import {
  accent,
  cssVariables,
  radius,
  subjectAccents,
  tokens,
  ultramarine,
  woboHighlight,
  woboMolten,
} from '../src/index';

describe('design tokens (DESIGN.md §2 is law)', () => {
  it('carries the signature pigment: ultramarine, reserved for brand and mastery', () => {
    expect(ultramarine).toBe('#1F35E0');
  });

  it('reserves Molten for Wobo and never assigns it to a subject', () => {
    expect(woboMolten).toBe('#FF5A1F');
    expect(accent.molten).toBe('#FF5A1F');
    expect(subjectAccents).not.toContain('molten');
  });

  it('keeps the accent family rare and intentional: molten, magenta, acid', () => {
    expect(Object.keys(accent).sort()).toEqual(['acid', 'magenta', 'molten']);
    expect(accent.magenta).toBe('#CC1E7A');
    expect(accent.acid).toBe('#66B300');
  });

  it('uses sharp corners: 3px default radius; large radii only for Wobo and overlays', () => {
    expect(radius.sm).toBe(3);
    expect(radius.jelly).toBeGreaterThan(radius.lg);
  });

  it('never defines a drop-shadow token (depth is hairline, tonal step, frost)', () => {
    const json = JSON.stringify(tokens).toLowerCase();
    expect(json).not.toContain('shadow');
    expect(json).not.toContain('box-shadow');
  });

  it('emits CSS custom properties for the web root', () => {
    const css = cssVariables();
    expect(css).toContain('--wobo-ink-900: #0D0D10;');
    expect(css).toContain('--wobo-ultramarine: #1F35E0;');
    expect(css).toContain('--wobo-molten: #FF5A1F;');
    expect(css).toContain('--wobo-radius-sm: 3px;');
  });

  it('draws every Wobo mark in the one pigment: no warm token survives in the palette', () => {
    expect(woboHighlight.ink).toBe(ultramarine);
    expect(woboHighlight.inkDark).toBe('#7B8CFF');
    // the salmon that used to lead this palette is gone — nothing can reach for it
    expect(Object.keys(woboHighlight)).not.toContain('primary');
    expect(JSON.stringify(woboHighlight)).not.toContain(woboMolten);
    expect(JSON.stringify(woboHighlight).toLowerCase()).not.toContain(accent.molten.toLowerCase());
  });

  it('caps the frost inside the ring at 4% and holds the ring to a 1.5px nib on 3px corners', () => {
    expect(woboHighlight.frostAlpha).toBe(0.04);
    expect(woboHighlight.frost).toBe('rgba(31,53,224,0.04)');
    expect(woboHighlight.frostDark).toBe('rgba(123,140,255,0.04)');
    for (const frostValue of [woboHighlight.frost, woboHighlight.frostDark]) {
      const alpha = Number(frostValue.split(',')[3]?.replace(')', ''));
      expect(alpha).toBeLessThanOrEqual(woboHighlight.frostAlpha);
    }
    expect(woboHighlight.ringWidth).toBe(1.5);
    expect(woboHighlight.radius).toBe(radius.sm);
    expect(woboHighlight.drawMs).toBe(320);
    expect(woboHighlight.fadeMs).toBe(600);
  });

  it('emits the pointing ink as a theme var that lifts to dark-ink ultramarine on graphite', () => {
    const css = cssVariables();
    expect(css).toContain(`--wobo-highlight-ink: ${ultramarine};`);
    expect(css).toContain('--wobo-highlight-frost: rgba(31,53,224,0.04);');
    expect(css).toContain('--wobo-highlight-ink: #7B8CFF;');
    expect(css).toContain('--wobo-highlight-frost: rgba(123,140,255,0.04);');
    expect(css).not.toContain('--wobo-highlight-primary');
  });
});

describe("Wobo's ink on the screen (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace)", () => {
  it('sits above the companion panel and below a modal, so a ring at x >= 1020 is never under the chat', async () => {
    const { zIndex } = await import('../src/index');
    expect(zIndex.ink).toBeGreaterThan(zIndex.panel);
    expect(zIndex.ink).toBeLessThan(zIndex.modal);
  });
});
