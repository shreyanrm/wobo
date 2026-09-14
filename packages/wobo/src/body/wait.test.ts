/**
 * The wait, as a law rather than a drawing.
 *
 * Every number a waiting screen depends on lives in `wait.ts` and is pinned here: the three lengths
 * (docs/THE-WAIT.md §1), the seven scenes (docs/EMAILS-AND-ANIMATIONS.md §3), the ten second loop,
 * and the one rule that makes the scenes cheap to animate — a scene has the SAME marks at every
 * moment of its loop, so a renderer allocates its elements once and writes attributes after that.
 *
 * There is no browser here and there does not need to be: a scene is a pure function of one number.
 */

import { describe, expect, it } from 'bun:test';
import {
  WAIT_GAME_AT_MS,
  WAIT_LOOP_MS,
  WAIT_SCENE_AT_MS,
  WAIT_SCENE_NAMES,
  WAIT_STILL_AT,
  WAIT_VIEW,
  type WaitMark,
  type WaitSceneName,
  waitFrame,
  waitLength,
  waitSceneFor,
  waitStill,
} from './wait';

const FRAMES = 41;
const at = (i: number) => i / (FRAMES - 1);

describe('the three lengths of a wait', () => {
  it('leaves a wait under two seconds to the orb’s own breath', () => {
    expect(waitLength(0)).toBe('breath');
    expect(waitLength(WAIT_SCENE_AT_MS - 1)).toBe('breath');
  });

  it('gives the subject’s scene to the waits between two and ten seconds', () => {
    expect(waitLength(WAIT_SCENE_AT_MS)).toBe('scene');
    expect(waitLength(6_000)).toBe('scene');
    expect(waitLength(WAIT_GAME_AT_MS - 1)).toBe('scene');
  });

  it('offers the game only past ten seconds', () => {
    expect(waitLength(WAIT_GAME_AT_MS)).toBe('game');
    expect(waitLength(45_000)).toBe('game');
    expect(WAIT_GAME_AT_MS).toBe(10_000);
    expect(WAIT_SCENE_AT_MS).toBe(2_000);
  });

  it('reads an unknown length as the middle one, which is the safe one', () => {
    expect(waitLength(Number.NaN)).toBe('scene');
  });
});

describe('which scene a subject gets', () => {
  it('gives every family of the product its own thing', () => {
    expect(waitSceneFor('math')).toBe('numberLine');
    expect(waitSceneFor('physics')).toBe('pendulum');
    expect(waitSceneFor('chemistry')).toBe('beakers');
    expect(waitSceneFor('biology')).toBe('cell');
    expect(waitSceneFor('cs')).toBe('caret');
    expect(waitSceneFor('social')).toBe('map');
    expect(waitSceneFor('doubt')).toBe('page');
  });

  it('takes a board’s own name for a subject and the aliases the app already uses', () => {
    expect(waitSceneFor('maths')).toBe('numberLine');
    expect(waitSceneFor('physical_science')).toBe('pendulum');
    expect(waitSceneFor('computer')).toBe('caret');
    expect(waitSceneFor('history_civics')).toBe('map');
    expect(waitSceneFor('social_science')).toBe('map');
    expect(waitSceneFor('science')).toBe('beakers');
  });

  it('never fails on a subject nobody has taught yet', () => {
    expect(WAIT_SCENE_NAMES).toContain(waitSceneFor('astrophysics of the unknown'));
    expect(WAIT_SCENE_NAMES).toContain(waitSceneFor(''));
  });

  it('is the whole library and nothing else', () => {
    expect([...WAIT_SCENE_NAMES].sort()).toEqual([
      'beakers',
      'caret',
      'cell',
      'map',
      'numberLine',
      'page',
      'pendulum',
    ]);
  });
});

describe('every scene, over its whole loop', () => {
  const names = WAIT_SCENE_NAMES as readonly WaitSceneName[];

  it('loops in ten seconds', () => {
    expect(WAIT_LOOP_MS).toBe(10_000);
  });

  it('holds the same marks at every moment, so a renderer allocates once', () => {
    for (const name of names) {
      const shape = waitFrame(name, 0).map((m) => m.kind);
      for (let i = 0; i < FRAMES; i++) {
        expect(waitFrame(name, at(i)).map((m) => m.kind)).toEqual(shape);
      }
    }
  });

  it('is pure: the same moment draws the same thing twice', () => {
    for (const name of names) {
      expect(waitFrame(name, 0.37)).toEqual(waitFrame(name, 0.37));
    }
  });

  it('stays inside its own box, at every frame', () => {
    const inside = (v: number, max: number) => v >= -1 && v <= max + 1;
    for (const name of names) {
      for (let i = 0; i < FRAMES; i++) {
        for (const m of waitFrame(name, at(i))) {
          for (const [x, y] of pointsOf(m)) {
            expect(inside(x, WAIT_VIEW.width)).toBe(true);
            expect(inside(y, WAIT_VIEW.height)).toBe(true);
          }
        }
      }
    }
  });

  it('never goes fully blank — a wait that shows nothing is a blank screen', () => {
    for (const name of names) {
      for (let i = 0; i < FRAMES; i++) {
        const lit = waitFrame(name, at(i)).filter((m) => m.o > 0.05);
        expect(lit.length).toBeGreaterThan(0);
      }
    }
  });

  it('joins up at the ends, so the loop has no jump in it', () => {
    // The law is about what is SEEN: a mark that is invisible at both ends may be anywhere, and a
    // mark that is lit at either end has to be in the same place and at the same strength.
    for (const name of names) {
      const first = waitFrame(name, 0);
      const last = waitFrame(name, 1);
      first.forEach((m, i) => {
        const n = last[i] as WaitMark;
        expect(Math.abs(m.o - n.o)).toBeLessThan(0.2);
        if (m.o <= 0.05 && n.o <= 0.05) return;
        const a = pointsOf(m).flat();
        const b = pointsOf(n).flat();
        a.forEach((v, j) => expect(Math.abs(v - (b[j] as number))).toBeLessThan(2));
      });
    }
  });

  it('moves: a scene that never changes is a still, not a scene', () => {
    for (const name of names) {
      const start = JSON.stringify(waitFrame(name, 0.1));
      const middle = JSON.stringify(waitFrame(name, 0.55));
      expect(start).not.toBe(middle);
    }
  });

  it('keeps its pigment scarce — at most two marks carry the subject’s colour', () => {
    for (const name of names) {
      for (let i = 0; i < FRAMES; i++) {
        const pigment = waitFrame(name, at(i)).filter((m) => m.pigment);
        expect(pigment.length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('the still, which is what a learner who asked for less motion sees', () => {
  it('lands on a legible moment of every scene, never the empty first frame', () => {
    for (const name of WAIT_SCENE_NAMES as readonly WaitSceneName[]) {
      const still = waitStill(name);
      expect(still).toEqual(waitFrame(name, WAIT_STILL_AT[name]));
      expect(still.filter((m) => m.o > 0.3).length).toBeGreaterThan(1);
      expect(WAIT_STILL_AT[name]).toBeGreaterThan(0.3);
    }
  });
});

/** Every coordinate a mark puts on the page, so a test can check it is on the page. */
function pointsOf(m: WaitMark): [number, number][] {
  switch (m.kind) {
    case 'line':
      return [
        [m.x1, m.y1],
        [m.x2, m.y2],
      ];
    case 'dot':
      return [
        [m.cx - m.r, m.cy - m.r],
        [m.cx + m.r, m.cy + m.r],
      ];
    case 'rect':
      return [
        [m.x, m.y],
        [m.x + m.w, m.y + m.h],
      ];
    case 'path': {
      const nums = m.d.match(/-?\d+(?:\.\d+)?/g) ?? [];
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        out.push([Number(nums[i]), Number(nums[i + 1])]);
      }
      return out;
    }
  }
}
