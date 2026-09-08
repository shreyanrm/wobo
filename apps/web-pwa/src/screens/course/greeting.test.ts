/**
 * The greeting never lies (learn-5). `performanceStars` forgives one stumble on the way to three
 * stars, which is a fair bar for the reward; the sentence attached to three stars was absolute, so
 * a learner whose one miss the app had just stopped to dramatise was told they never put a foot
 * wrong. The tolerance stays; the words follow the run.
 */

import { describe, expect, it } from 'bun:test';
import { performanceStars } from '../../ui/celebration';
import { provedLine } from './Greeting';

const clean = { bossCorrect: 3, bossTotal: 3, itemsTotal: 4 };

describe('what the greeting says it proved', () => {
  it('keeps the absolute sentence for a run with no miss at all', () => {
    const run = { ...clean, attemptsTotal: 4 };
    expect(performanceStars(run)).toBe(3);
    expect(provedLine(run)).toBe('You never put a foot wrong, the whole way through.');
  });

  it('does not say "never put a foot wrong" to a learner who missed once', () => {
    const run = { ...clean, attemptsTotal: 5 };
    expect(performanceStars(run)).toBe(3); // the reward is unchanged
    const line = provedLine(run);
    expect(line).not.toContain('never put a foot wrong');
    expect(line.length).toBeGreaterThan(10);
  });

  it('gives the two- and one-star runs their own lines, unchanged', () => {
    expect(provedLine({ bossCorrect: 2, bossTotal: 3, attemptsTotal: 8, itemsTotal: 6 })).toBe(
      'You found the through-line and held it.',
    );
    expect(provedLine({ bossCorrect: 2, bossTotal: 3, attemptsTotal: 12, itemsTotal: 6 })).toBe(
      'You got there, and that is what counts.',
    );
  });

  it('writes nothing a learner reads with an em dash (docs/copy/voice.md 10a)', () => {
    for (const attemptsTotal of [4, 5, 8, 12]) {
      expect(provedLine({ ...clean, attemptsTotal })).not.toContain('—');
    }
  });
});
