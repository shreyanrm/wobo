/**
 * ONE weekly note, and one name for a board.
 *
 * "This week, in Wobo's words" is read on the home and on You. If each screen assembled its own
 * facts the two could drift a day or a number apart and say different things under the same
 * heading, so there is exactly one function — `weeklyNote` — and this holds it to the records it
 * is supposed to read: the activity marks, the awards counter, and the mind's own day ledger.
 *
 * The board's name is here too, because the crumb on both screens prints it: never the raw id.
 */

import { beforeEach, describe, expect, it } from 'bun:test';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { saveWorld } = await import('../../curriculum/world');
const { weeklyNote } = await import('./ledger');
const { boardName, frameworkLabel } = await import('./profile');
const { weekSentence } = await import('./week');

const NOW = new Date('2026-09-03T15:00:00Z'); // a Thursday
const BASE = {
  span: 'week' as const,
  marks: ['2026-09-01', '2026-09-02', '2026-09-03'],
  topicProgress: {},
  completed: new Set<string>(),
  now: NOW,
};

beforeEach(() => {
  store.clear();
  saveWorld(null);
});

/** A mind with a day in it, written the way the store writes it. */
function mind(days: Record<string, Partial<Record<string, number | boolean>>>): void {
  store.set('wobo-mind-v1', JSON.stringify({ days }));
}

describe('the weekly note', () => {
  it('reads the mind’s own day ledger, not a guess', () => {
    mind({
      '2026-09-01': { answered: 4, wrong: 1, asked: 2, entered: 1, seconds: 900 },
      '2026-09-03': { answered: 3, asked: 1, entered: 1, seconds: 700, evening: true },
    });
    const note = weeklyNote(BASE);
    expect(note.showedUp).toBe(3);
    expect(note.asked).toBe(3);
    expect(note.answered).toBe(7);
    expect(note.entered).toBe(2);
    expect(note.evenings).toBe(1);
    expect(note.tenMinuteDays).toBe(2);
  });

  it('is the same note whichever screen asks for it', () => {
    mind({ '2026-09-02': { answered: 2, asked: 1, entered: 1, seconds: 700 } });
    // the home always asks for the week; You asks for the span its control is on
    const home = weeklyNote({ ...BASE });
    const you = weeklyNote({ ...BASE, span: 'week' });
    expect(home).toEqual(you);
    expect(weekSentence(home)).toEqual(weekSentence(you));
  });

  it('says the week is quiet rather than inventing a good one', () => {
    const note = weeklyNote({ ...BASE, marks: [] });
    expect(note.showedUp).toBe(0);
    expect(weekSentence(note)).toEqual([
      { text: 'Rest is part of learning. Quiet days are allowed.' },
    ]);
  });

  it('carries the heading both screens print', () => {
    expect(weeklyNote(BASE).tag).toBe("This week, in Wobo's words");
    expect(weeklyNote({ ...BASE, span: 'month' }).tag).toBe("This month, in Wobo's words");
  });

  it('counts the awards-per-day counter alongside the ledger', () => {
    store.set('wobo-activity-counts-v1', JSON.stringify({ '2026-09-02': 3 }));
    const note = weeklyNote({ ...BASE, marks: [] });
    expect(note.showedUp).toBe(1);
  });
});

describe('the board’s name', () => {
  it('writes a bare id as the board’s initials', () => {
    expect(frameworkLabel('cbse')).toBe('CBSE');
    expect(frameworkLabel('icse')).toBe('ICSE');
  });

  it('leaves a real name exactly as it was given', () => {
    expect(frameworkLabel('CBSE')).toBe('CBSE');
    expect(frameworkLabel('Central Board of Secondary Education')).toBe(
      'Central Board of Secondary Education',
    );
    expect(frameworkLabel('my-own-syllabus-2026')).toBe('my-own-syllabus-2026');
    expect(frameworkLabel(null)).toBe('');
  });

  it('never prints the raw id a world was pinned from', () => {
    // onboarding can only pass on the id it was given, so the world's own name IS that id
    saveWorld({
      frameworkId: 'cbse',
      frameworkName: 'cbse',
      versionId: null,
      versionYear: null,
      status: 'provisional',
      label: '',
      level: '8',
      levels: [],
      subjects: [],
      personal: false,
    });
    expect(boardName('cbse')).toBe('CBSE');
    expect(frameworkLabel('cbse')).toBe('CBSE');
  });
});
