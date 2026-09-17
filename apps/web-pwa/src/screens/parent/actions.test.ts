/**
 * THE FOUR DOORS on a parent's home: drawn from the server's own list, never from a guess at it,
 * and a door whose screen is not built keeps its shape and says so rather than leading nowhere.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { doorsFor, SCREEN_READY } from './actions';
import { PARENT_ACTIONS } from './api';

describe('the four doors', () => {
  it('are the server’s four, in the server’s order', () => {
    expect(doorsFor([...PARENT_ACTIONS]).map((d) => d.action)).toEqual([
      'ask',
      'pay',
      'refer',
      'donate',
    ]);
  });

  it('draw no door the server did not send', () => {
    expect(doorsFor(['ask']).map((d) => d.action)).toEqual(['ask']);
    expect(doorsFor([])).toEqual([]);
  });

  it('send each door to its own address, and giving to the page that already takes a gift', () => {
    const doors = doorsFor([...PARENT_ACTIONS]);
    expect(doors.find((d) => d.action === 'ask')?.to).toEqual({ name: 'parent', action: 'ask' });
    expect(doors.find((d) => d.action === 'pay')?.to).toEqual({ name: 'parent', action: 'pay' });
    expect(doors.find((d) => d.action === 'refer')?.to).toEqual({
      name: 'parent',
      action: 'refer',
    });
    expect(doors.find((d) => d.action === 'donate')?.to).toEqual({ name: 'donate' });
  });

  it('say which are open, from one table the builders of those screens flip', () => {
    for (const door of doorsFor([...PARENT_ACTIONS])) {
      expect(door.open).toBe(SCREEN_READY[door.action]);
    }
    // the donate page exists on the public site today
    expect(SCREEN_READY.donate).toBe(true);
  });
});

describe('every parent screen is one a parent can reach', () => {
  /*
   * GivePlace.tsx was built, tested and never mounted: ACTION_SCREENS leaves out `donate` and the
   * host sends /parent/donate to /donate. A screen nobody can open is copy nobody reviews, and it
   * put two money lines on one screen. Every component file here is imported by a non-test file.
   */
  it('has no component file that only its tests import', () => {
    const dir = import.meta.dir;
    const files = readdirSync(dir);
    const sources = files
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8'));
    const orphans = files
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
      .map((f) => f.replace(/\.tsx$/, ''))
      .filter((stem) => !sources.some((s) => s.includes(`'./${stem}'`)))
      .filter((stem) => stem !== 'ParentRuntime');
    expect(orphans).toEqual([]);
  });
});
