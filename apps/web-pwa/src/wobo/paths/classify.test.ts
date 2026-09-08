import { describe, expect, it } from 'bun:test';
import { classifyLocal, resolveTurnExtras } from './classify';

describe('a drawing that never arrived is not stubbed (DESIGN.md §0.x)', () => {
  it('a visualization turn with no real svg stays prose', () => {
    const extras = resolveTurnExtras(
      { path: 'visualization', viz: { kind: 'diagram' } },
      'draw it',
    );
    expect(extras.path).toBe('inline');
  });

  it('a visualization turn with real ink keeps it', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';
    const extras = resolveTurnExtras(
      { path: 'visualization', viz: { kind: 'diagram', spec: { svg, caption: 'a lever' } } },
      'draw a lever',
    );
    expect(extras.path).toBe('visualization');
    expect(extras.viz?.spec.svg).toBe(svg);
  });

  it('names no placeholder concept when there is nothing to name', () => {
    expect(classifyLocal('quiz me').concept).toBe('');
    const extras = resolveTurnExtras({ path: 'component', component: { kind: 'quiz' } }, 'quiz me');
    expect(extras.component?.concept).toBe('');
  });
});

describe('the local action why passes the subject test (DESIGN.md §0.x)', () => {
  it('"teach me fractions" is explained by what was asked, not by what Wobo will do', () => {
    const local = classifyLocal('teach me fractions');
    expect(local.path).toBe('action');
    expect(local.why).toBe('You asked to learn fractions');
  });

  it('no local why announces an action or carries an em dash', () => {
    for (const text of [
      'teach me fractions',
      'make a course on cells',
      'quiz me',
      'open the twin',
    ]) {
      const why = classifyLocal(text).why ?? '';
      expect(why).not.toMatch(/\bI(?:'ll| will)\b/);
      expect(why).not.toContain('—');
    }
  });
});

describe('a board-stream card is the bare payload, and still lands (DESIGN.md §0.x)', () => {
  // The gateway's card frame carries `output.viz` or `output.component` on its own, without the
  // `path` wrapper the ordinary turn has. Read as an ordinary turn it had no svg under `.viz`, so
  // every keyless drawing degraded to prose while its say still read the drawing aloud.
  it('a bare viz card with real ink renders as the drawing', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 10 L5 0 L10 10 Z"/></svg>';
    const extras = resolveTurnExtras(
      { kind: 'diagram', spec: { svg, caption: 'triangle' } },
      'draw a triangle for me',
    );
    expect(extras.path).toBe('visualization');
    expect(extras.viz?.spec.svg).toBe(svg);
    expect(extras.viz?.spec.caption).toBe('triangle');
  });

  it('a bare component card keeps its spec', () => {
    const spec = { items: [{ prompt: '2+2', answer: '4' }] };
    const extras = resolveTurnExtras({ kind: 'quiz', concept: 'sums', spec }, 'quiz me on sums');
    expect(extras.path).toBe('component');
    expect(extras.component?.spec).toBe(spec);
  });
});
