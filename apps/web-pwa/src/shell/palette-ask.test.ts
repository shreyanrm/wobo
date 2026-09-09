import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asksRather, readsAsQuestion } from './palette-ask';

describe('a question typed into the palette', () => {
  it('is a question, not a place to go', () => {
    for (const q of [
      'why does that step work?',
      'which step is wrong here',
      'draw me a graph of y = x squared',
      'show me a number line',
      'circle the effect',
      'explain this bit',
      'what is 2 to the power 5?',
    ]) {
      expect(readsAsQuestion(q)).toBe(true);
    }
  });

  it('leaves a destination alone', () => {
    for (const q of ['algebra', 'practice', 'linear equations', 'sign out', 'dark theme', 'what']) {
      expect(readsAsQuestion(q)).toBe(false);
    }
  });

  it('says nothing about an empty box', () => {
    expect(readsAsQuestion('')).toBe(false);
    expect(readsAsQuestion('   ')).toBe(false);
  });
});

describe('the stop Enter takes', () => {
  it('is the ask for a question', () => {
    expect(asksRather('why does that step work?', 'Solving equations')).toBe(true);
    expect(asksRather('draw me a graph of y = x squared', 'Graphs')).toBe(true);
  });

  it('is the row when the row is what was typed', () => {
    // The modes are rows a learner names word for word; naming one is not asking a question.
    expect(asksRather('show me', 'Show me')).toBe(false);
    expect(asksRather('do it for me', 'Do it for me')).toBe(false);
  });

  it('is the first match for anything that is not a question', () => {
    expect(asksRather('algebra', 'Algebra')).toBe(false);
    expect(asksRather('practice', 'Practice')).toBe(false);
  });
});

/**
 * The wiring, read off the palette itself: the ask never walks the learner to the chat first. The
 * proof that the ink then lands on the page they were on is tests/palette-ink.spec.ts.
 */
describe('the palette asks where the learner is', () => {
  const palette = readFileSync(join(import.meta.dir, 'CommandPalette.tsx'), 'utf8');

  it('never navigates to the chat before asking', () => {
    const askPath = palette.slice(palette.indexOf("if (it.id === '__ask__')"));
    const body = askPath.slice(0, askPath.indexOf('const item = byId.get'));
    expect(body.includes('chat.ask(q)')).toBe(true);
    expect(body.includes('router.navigate')).toBe(false);
  });

  it('makes the ask the default stop for a question', () => {
    expect(palette.includes('asksRather')).toBe(true);
  });
});
