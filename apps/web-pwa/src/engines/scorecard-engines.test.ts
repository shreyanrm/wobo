/**
 * The engine half of the wave-30 content scorecard (SCORECARD.md 3.5, #3, #15, #17): a discovery
 * mark a finger can find, a maths canvas in the app's own ink on the spec's own domain, and scene
 * titles left exactly as they were verified.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyFill, hitRadius, type Mark, scrollBoardIntoView } from './Discovery';
import { mafsFrame } from './MathScene';

const src = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');

describe('#3 a discovery mark a finger can hit', () => {
  it('the hit disc is at least 44 css px across at every scale', () => {
    // 390 wide phone: the stage svg is about 330 px for 100 units, so 3.3 px per unit
    expect(hitRadius(4, 3.3) * 2 * 3.3).toBeGreaterThanOrEqual(44);
    // a tiny electron mark at 1.9 units
    expect(hitRadius(1.9, 3.3) * 2 * 3.3).toBeGreaterThanOrEqual(44);
    // 1440 wide: 640 px max for 100 units
    expect(hitRadius(4, 6.4) * 2 * 6.4).toBeGreaterThanOrEqual(44);
    // a big mark keeps its own size plus a margin, never shrinks to the floor
    expect(hitRadius(20, 6.4)).toBeGreaterThan(20);
    // before the first measurement the floor still holds for a phone
    expect(hitRadius(4, 0) * 2 * 3.3).toBeGreaterThanOrEqual(44);
  });

  it('a tap target and a drag handle always have a filled body; structure stays an outline', () => {
    const circle: Mark = { id: 'm', shape: 'circle', x: 50, y: 31, r: 4 };
    expect(bodyFill(circle, 'target')).toBe('soft');
    expect(bodyFill(circle, 'handle')).toBe('solid');
    expect(bodyFill(circle, 'static')).toBeUndefined();
    expect(bodyFill({ ...circle, fill: 'solid' }, 'target')).toBe('solid');
    expect(bodyFill({ ...circle, fill: 'soft' }, 'static')).toBe('soft');
    const axis: Mark = { id: 'a', shape: 'line', x: 0, y: 31, x2: 100, y2: 31 };
    expect(bodyFill(axis, 'target')).toBeUndefined();
  });

  it('the board scrolls into view on entry, and never throws where scrollIntoView is missing', () => {
    const calls: unknown[] = [];
    scrollBoardIntoView({ scrollIntoView: (o: unknown) => calls.push(o) }, false);
    expect(calls).toEqual([{ block: 'start', behavior: 'smooth' }]);
    scrollBoardIntoView({ scrollIntoView: (o: unknown) => calls.push(o) }, true);
    expect(calls[1]).toEqual({ block: 'start', behavior: 'auto' });
    expect(() => scrollBoardIntoView({}, false)).not.toThrow();
    expect(() => scrollBoardIntoView(null, false)).not.toThrow();
  });

  it('the hit disc is painted, so the interior takes the tap and not only the stroke', () => {
    const s = src('Discovery.tsx');
    expect(s).toContain('fill="transparent"');
    expect(s).toContain('pointerEvents="all"');
  });
});

describe('#15 the maths canvas', () => {
  it('binds the Mafs theme on .MafsView itself, which is where Mafs sets black on white', () => {
    const css = src('mathscene.css');
    const rule = css.match(/\.wobo-mathscene\s+\.MafsView\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('--mafs-bg: transparent');
    expect(body).toContain('--mafs-fg: var(--wobo-ink-900)');
    expect(body).toContain('--mafs-line-color:');
    expect(body).toContain('--grid-line-subdivision-color:');
    const tsx = src('MathScene.tsx');
    expect(tsx).toContain("import './mathscene.css'");
    expect(tsx).toContain('className="wobo-mathscene"');
  });

  it('honours the declared domain: the frame height follows the view, so contain adds nothing', () => {
    const view = { x: [-1, 6] as [number, number], y: [-1, 3] as [number, number] };
    const f = mafsFrame('plot', view, 640);
    // (3 - -1 + 0.8) / (6 - -1 + 0.8) = 4.8 / 7.8 of the width, within the clamp
    expect(f.preserveAspectRatio).toBe('contain');
    expect(f.height).toBeCloseTo((640 * 4.8) / 7.8, 3);
  });

  it('a tall plot the clamp stops still keeps its declared domain', () => {
    const view = { x: [-1, 6] as [number, number], y: [-1, 10] as [number, number] };
    const f = mafsFrame('plot', view, 640);
    // the ideal (640 * 11.8 / 7.8 = 968 px) is over the clamp, so contain would widen the domain
    expect(f.height).toBe(480);
    expect(f.preserveAspectRatio).toBe(false);
  });

  it('when the frame cannot follow the view, a plot keeps the domain and geometry keeps its shape', () => {
    const wide = { x: [0, 100] as [number, number], y: [0, 1] as [number, number] };
    expect(mafsFrame('plot', wide, 640).preserveAspectRatio).toBe(false);
    expect(mafsFrame('numberline', wide, 640).preserveAspectRatio).toBe(false);
    expect(mafsFrame('geometry', wide, 640).preserveAspectRatio).toBe('contain');
    expect(mafsFrame('plot', wide, 640).height).toBeGreaterThanOrEqual(220);
  });

  it('never exceeds the tall clamp on a phone', () => {
    const tall = { x: [0, 1] as [number, number], y: [0, 40] as [number, number] };
    expect(mafsFrame('areaProof', tall, 350).height).toBeLessThanOrEqual(480);
    expect(mafsFrame('plot', tall, 0).height).toBeGreaterThanOrEqual(220);
  });
});

describe('#17 a verified scene title is rendered as it was verified', () => {
  const engines = [
    'AnatomyScene.tsx',
    'BioScene.tsx',
    'ChemScene.tsx',
    'CompareInteractive.tsx',
    'ConceptMap.tsx',
    'MapScene.tsx',
    'MathScene.tsx',
    'PerturbationSandbox.tsx',
    'PhysicsScene.tsx',
    'SocialScene.tsx',
    'WhatIfNumerical.tsx',
  ];
  for (const name of engines) {
    it(`${name} never lowercases spec.title`, () => {
      expect(src(name)).not.toMatch(/spec\.title\.toLowerCase\(\)/);
    });
  }
  it('MapScene never lowercases the prompt either: Dandi is a place, not a word', () => {
    expect(src('MapScene.tsx')).not.toMatch(/prompt\.toLowerCase\(\)/);
  });
});
