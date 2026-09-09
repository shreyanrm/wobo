/**
 * The gate, held to the thing it exists for: a page with nothing on it must not be able to ship,
 * and the word count must be a measurement rather than a promise.
 */

import { describe, expect, it } from 'bun:test';
import {
  checkedDay,
  gate,
  hostOf,
  latest,
  onDay,
  onHost,
  shortHash,
  WORD_FLOOR,
  words,
} from './gate';

const enough = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('the word count', () => {
  it('counts words and skips what is not one', () => {
    expect(words('one two three')).toBe(3);
    expect(words(null, undefined, false, '')).toBe(0);
    expect(words('  spaced   out  ')).toBe(2);
  });

  it('flattens a nested section, so a page can hand over a block at a time', () => {
    expect(words(['a b', ['c', ['d e']]], 'f')).toBe(6);
  });

  it('counts a number as the word it prints as, and not punctuation on its own', () => {
    expect(words(133, 'chapters')).toBe(2);
    expect(words('·', '/', '—')).toBe(0);
  });
});

describe('the gate', () => {
  const full = { sources: 3, drawn: false, door: true, words: WORD_FLOOR };

  it('publishes a page with the floor of words and at least one of the three', () => {
    expect(gate(full).publishable).toBe(true);
  });

  it('refuses a page below the word floor, and says by how much', () => {
    const verdict = gate({ ...full, words: WORD_FLOOR - 1 });
    expect(verdict.publishable).toBe(false);
    expect(verdict.because.join(' ')).toContain(String(WORD_FLOOR));
  });

  it('refuses a page carrying none of provenance, a drawing or a door', () => {
    const verdict = gate({ ...full, sources: 0, drawn: false, door: false });
    expect(verdict.publishable).toBe(false);
    expect(verdict.because).toContain('no provenance, no drawn explanation and no tutor door');
  });

  it('lets a page through on the door alone, which is what tier one has', () => {
    expect(gate({ ...full, sources: 0, door: true }).publishable).toBe(true);
  });

  it('reports every reason at once, so one run says everything that is wrong', () => {
    expect(gate({ sources: 0, drawn: false, door: false, words: 3 }).because).toHaveLength(2);
  });

  it('counts the words a page really renders, not a number a page claims', () => {
    // The whole discipline in one assertion: the evidence is built by counting the copy object.
    const copy = { lead: enough(WORD_FLOOR), aside: '' };
    expect(
      gate({ sources: 1, drawn: false, door: true, words: words(copy.lead, copy.aside) })
        .publishable,
    ).toBe(true);
  });
});

describe('dates', () => {
  const now = new Date('2026-09-09T12:00:00Z');

  it('prints a day a person reads, in UTC, with no relative phrasing', () => {
    expect(onDay('2026-09-03T07:03:44Z')).toBe('3 September 2026');
  });

  it('prints nothing for a value that is not a date', () => {
    expect(onDay('not a date')).toBe('');
  });

  it('accepts a day in the past and refuses one in the future', () => {
    expect(checkedDay('2026-09-03', now)).toBe(true);
    expect(checkedDay('2026-09-09T12:00:00Z', now)).toBe(true);
    expect(checkedDay('2026-12-01', now)).toBe(false);
    expect(checkedDay('', now)).toBe(false);
  });

  it('finds the most recent of a set, ignoring the ones that do not parse', () => {
    expect(latest(['2026-09-03T00:00:00Z', 'nonsense', '2026-09-09T00:00:00Z'])).toBe(
      '2026-09-09T00:00:00Z',
    );
    expect(latest(['nonsense'])).toBe('');
  });
});

describe('hosts', () => {
  it('reads a host, and returns nothing for a string that is not a URL', () => {
    expect(hostOf('https://CBSEacademic.nic.in/x.pdf')).toBe('cbseacademic.nic.in');
    expect(hostOf('/exams/cbse')).toBe('');
  });

  it('accepts the host itself and a subdomain of it', () => {
    expect(onHost('https://cisce.org/a.pdf', ['cisce.org'])).toBe(true);
    expect(onHost('https://www.cisce.org/a.pdf', ['cisce.org'])).toBe(true);
  });

  /** The one that matters: a lookalike domain must not pass a suffix check. */
  it('refuses a host that merely ends in the allowed one', () => {
    expect(onHost('https://notcisce.org/a.pdf', ['cisce.org'])).toBe(false);
    expect(onHost('https://cisce.org.example.com/a.pdf', ['cisce.org'])).toBe(false);
  });
});

describe('a hash a reader can use', () => {
  it('prints the first twelve characters and keeps the rest in the data', () => {
    expect(shortHash('d773e7c12b99e0bd498067e2b8268c76')).toBe('d773e7c12b99');
  });
});
