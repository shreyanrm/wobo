/**
 * The trace (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace): one pen, in CSS px, from the element's real
 * box. Everything measurable without a browser is measured here; the rest is measured on real
 * screens in apps/web-pwa/tests/trace.spec.ts.
 */

import { describe, expect, it } from 'bun:test';
import {
  frameOf,
  offGlass,
  pxPerUnit,
  rectToBoard,
  unitsHigh,
  unitsWide,
} from '../../src/board/anchors';
import { geometryOf } from '../../src/board/geometry';
import { placeNote } from '../../src/board/layout';
import { traceDurationMs } from '../../src/board/pen';
import type { BoardObject } from '../../src/board/schema';
import { MARK_KINDS } from '../../src/board/schema';
import { BoardStore, DEFAULT_TTL, FADE_MS } from '../../src/board/store';

// --- The frame in CSS px --------------------------------------------------------------------------

describe('a screen frame is measured in CSS px, not in thousandths of the viewport', () => {
  it('one unit is one pixel whatever the width', () => {
    for (const width of [390, 834, 1440]) {
      const frame = frameOf({ x: 0, y: 0, width, height: 800 }, { scale: 1 });
      expect(pxPerUnit(frame)).toBe(1);
      expect(unitsWide(frame)).toBe(width);
      expect(unitsHigh(frame)).toBe(800);
    }
  });

  it('a target rect comes through unchanged, so a 9 px pad is 9 px at 390 and at 1440', () => {
    const frame = frameOf({ x: 0, y: 0, width: 390, height: 844 }, { scale: 1 });
    expect(rectToBoard(frame, { x: 66, y: 214, width: 258, height: 145 })).toEqual({
      x: 66,
      y: 214,
      w: 258,
      h: 145,
    });
  });

  it('a board frame still maps 1000 units across its own width', () => {
    const frame = frameOf({ x: 0, y: 0, width: 500, height: 300 });
    expect(pxPerUnit(frame)).toBe(0.5);
    expect(unitsWide(frame)).toBe(1000);
  });
});

describe('a target that has left the glass', () => {
  const frame = frameOf({ x: 0, y: 0, width: 390, height: 844 }, { scale: 1 });
  it('is off the glass when its rect is wholly outside the viewport', () => {
    expect(offGlass({ x: 66, y: -214, width: 258, height: 145 }, frame)).toBe(true);
    expect(offGlass({ x: 66, y: 900, width: 258, height: 40 }, frame)).toBe(true);
  });
  it('is on the glass while any of it shows', () => {
    expect(offGlass({ x: 66, y: -100, width: 258, height: 145 }, frame)).toBe(false);
    expect(offGlass({ x: 66, y: 300, width: 258, height: 40 }, frame)).toBe(false);
  });
});

// --- The pen's clock, in px ------------------------------------------------------------------------

describe('how long a mark takes, in screen px', () => {
  it('a ring closes in 300 to 600 ms, small or large', () => {
    expect(traceDurationMs('circle', 60)).toBe(300);
    expect(traceDurationMs('ring', 60)).toBe(300);
    expect(traceDurationMs('circle', 3000)).toBe(600);
    const mid = traceDurationMs('circle', 320);
    expect(mid).toBeGreaterThanOrEqual(300);
    expect(mid).toBeLessThanOrEqual(600);
  });

  it('an underline and a bracket take their length', () => {
    const short = traceDurationMs('underline', 80);
    const long = traceDurationMs('underline', 480);
    expect(long).toBeGreaterThan(short);
    expect(traceDurationMs('bracket', 400)).toBeGreaterThan(traceDurationMs('bracket', 100));
  });

  it('a tick, a cross and a point are quick', () => {
    for (const kind of ['tick', 'cross', 'point'] as const) {
      const ms = traceDurationMs(kind, 60);
      expect(ms).toBeGreaterThanOrEqual(180);
      expect(ms).toBeLessThanOrEqual(420);
    }
  });

  it('never faster than a hand and never slower than a sentence', () => {
    expect(traceDurationMs('arrow', 1)).toBeGreaterThanOrEqual(180);
    expect(traceDurationMs('note', 100_000)).toBeLessThanOrEqual(2400);
  });
});

// --- The marks ----------------------------------------------------------------------------------------

const px = frameOf({ x: 0, y: 0, width: 1440, height: 900 }, { scale: 1 });
const subject = { x: 404, y: 500, width: 512, height: 24 };

function build(
  object: BoardObject,
  occupied: { x: number; y: number; w: number; h: number }[] = [],
) {
  return geometryOf(object, {
    frame: px,
    font: null,
    targetRect: (id) => (id === 'row' ? subject : null),
    focusRect: () => null,
    objectBox: () => null,
    occupied,
    area: { x: 0, y: 0, w: 1440, h: 900 },
  });
}

describe('the plan grammar is the mark grammar', () => {
  it('ring, tick, cross and note are kinds the hand knows', () => {
    for (const kind of ['ring', 'tick', 'cross', 'note']) {
      expect([...MARK_KINDS] as string[]).toContain(kind);
    }
  });
});

describe('a ring on one row of text hugs the row', () => {
  it('a wide short row gets a lozenge, not an ellipse that strikes the rows beside it', () => {
    const g = build({ id: 'r', kind: 'ring', anchor: { target: 'row' } } as BoardObject);
    if (!g) throw new Error('no geometry');
    // The row is 24 px tall on a 36 px pitch; with 9 px of pad and 6 of breathing room the ring
    // must stay inside the pitch, or it strikes through the neighbouring lines (course-craft-3).
    expect(g.box.y).toBeGreaterThanOrEqual(subject.y - 9 - 8);
    expect(g.box.y + g.box.h).toBeLessThanOrEqual(subject.y + subject.height + 9 + 8);
    expect(g.strokes.length).toBe(1);
  });

  it('ring and circle are one mark', () => {
    const a = build({ id: 'r', kind: 'ring', anchor: { target: 'row' } } as BoardObject);
    const b = build({ id: 'r', kind: 'circle', anchor: { target: 'row' } } as BoardObject);
    expect(a?.box).toEqual(b?.box);
  });
});

describe('a tick and a cross', () => {
  it('a tick lands beside the thing, clear of its text', () => {
    const g = build({ id: 't', kind: 'tick', anchor: { target: 'row' } } as BoardObject);
    if (!g) throw new Error('no geometry');
    expect(g.strokes.length).toBeGreaterThanOrEqual(1);
    expect(g.length).toBeGreaterThan(0);
    // Beside the row's right end, on its line.
    expect(g.box.x).toBeGreaterThanOrEqual(subject.x + subject.width);
    expect(g.box.x).toBeLessThanOrEqual(subject.x + subject.width + 24);
    expect(g.box.y + g.box.h / 2).toBeCloseTo(subject.y + subject.height / 2, -1);
  });

  it('a tick steps right past a mark already beside the row', () => {
    const beside = { x: subject.x + subject.width + 4, y: subject.y - 4, w: 60, h: 32 };
    const g = build({ id: 't', kind: 'tick', anchor: { target: 'row' } } as BoardObject, [beside]);
    if (!g) throw new Error('no geometry');
    expect(overlaps(g.box, beside)).toBe(false);
    expect(g.box.x).toBeGreaterThanOrEqual(beside.x + beside.w);
    expect(g.box.y + g.box.h / 2).toBeCloseTo(subject.y + subject.height / 2, -1);
  });

  it('a ring round the row below, whose padded box grazes this row, does not move the tick', () => {
    // The ring's box round the next row (36 px pitch) reaches 14 px above that row: into this one.
    const ringBelow = { x: subject.x - 14, y: subject.y + 36 - 14, w: subject.width + 28, h: 52 };
    const plain = build({ id: 't', kind: 'tick', anchor: { target: 'row' } } as BoardObject);
    const g = build({ id: 't', kind: 'tick', anchor: { target: 'row' } } as BoardObject, [
      ringBelow,
    ]);
    if (!g || !plain) throw new Error('no geometry');
    expect(g.box).toEqual(plain.box);
  });

  it('a cross goes through the thing, corner to corner', () => {
    const g = build({ id: 'x', kind: 'cross', anchor: { target: 'row' } } as BoardObject);
    if (!g) throw new Error('no geometry');
    expect(g.strokes.length).toBe(2);
    expect(g.box.x).toBeLessThanOrEqual(subject.x);
    expect(g.box.x + g.box.w).toBeGreaterThanOrEqual(subject.x + subject.width);
  });
});

describe('a note in the margin', () => {
  it('stays within 24 px of its subject and never lands on page text', () => {
    // The lines above and below the row, as the glass map reports them.
    const lines = [
      { x: 404, y: 464, w: 512, h: 24 },
      { x: 404, y: 536, w: 512, h: 24 },
    ];
    const g = build(
      { id: 'n', kind: 'note', anchor: { target: 'row' }, text: 'sign flips here' } as BoardObject,
      lines,
    );
    if (!g) throw new Error('no geometry');
    const gap = distance(g.box, {
      x: subject.x,
      y: subject.y,
      w: subject.width,
      h: subject.height,
    });
    expect(gap).toBeLessThanOrEqual(24);
    for (const line of lines) expect(overlaps(g.box, line)).toBe(false);
    expect(g.text?.lines.join(' ')).toBe('sign flips here');
  });

  it('sits beside a ring already round its subject, on the same line, never a row above it', () => {
    const lines = [
      { x: 404, y: 464, w: 512, h: 24 },
      { x: 404, y: 536, w: 512, h: 24 },
    ];
    // The ring's own box, as the renderer hands it in: the subject padded, plus breathing room.
    const ring = build({ id: 'r', kind: 'ring', anchor: { target: 'row' } } as BoardObject);
    if (!ring) throw new Error('no ring');
    const g = build(
      { id: 'n', kind: 'note', anchor: { target: 'row' }, text: 'sign flips here' } as BoardObject,
      [...lines, ring.box],
    );
    if (!g) throw new Error('no geometry');
    // Right of the ring, not over it, and on the row's own line.
    expect(g.box.x).toBeGreaterThanOrEqual(ring.box.x + ring.box.w);
    expect(g.box.y + g.box.h).toBeGreaterThan(subject.y);
    expect(g.box.y).toBeLessThan(subject.y + subject.height);
    for (const line of lines) expect(overlaps(g.box, line)).toBe(false);
    // And still within reach of the row itself, ring or no ring.
    const row = { x: subject.x, y: subject.y, w: subject.width, h: subject.height };
    expect(distance(g.box, row)).toBeLessThanOrEqual(24);
  });

  it('goes to the right margin when the row leaves one, left when it does not', () => {
    const size = { w: 120, h: 27 };
    const right = placeNote({ x: 404, y: 500, w: 512, h: 24 }, size, [], px, 8, 24);
    expect(right.x).toBeGreaterThanOrEqual(404 + 512);
    const flush = placeNote({ x: 0, y: 500, w: 1400, h: 24 }, size, [], px, 8, 24);
    // No room on either side: under it, still within 24 px.
    expect(flush.y).toBeGreaterThanOrEqual(524);
    expect(flush.y - 524).toBeLessThanOrEqual(24);
  });

  it('never leaves the glass', () => {
    const size = { w: 120, h: 27 };
    const edge = placeNote({ x: 1300, y: 500, w: 130, h: 24 }, size, [], px, 8, 24);
    expect(edge.x + size.w).toBeLessThanOrEqual(1440);
    expect(edge.x).toBeGreaterThanOrEqual(0);
  });
});

// --- Ink that holds ------------------------------------------------------------------------------------

describe('screen ink holds until it is released', () => {
  it('has no six-second life of its own any more', () => {
    expect(DEFAULT_TTL.screen).toBeUndefined();
  });

  it('release fades everything live, and a sweep forgets what has faded', () => {
    let now = 1000;
    const store = new BoardStore({ presentation: 'screen', clock: () => now });
    store.beginUtterance();
    store.ink({ id: 'a', kind: 'circle', anchor: { board: [1, 1] }, t: { start: 0, dur: 300 } });
    store.ink({ id: 'b', kind: 'underline', anchor: { board: [1, 1] }, t: { start: 0, dur: 300 } });
    now = 9000;
    expect(store.get('a')?.fadingAt).toBeUndefined();
    store.release();
    expect(store.get('a')?.fadingAt).toBe(9000);
    expect(store.get('b')?.fadingAt).toBe(9000);
    // Releasing again does not restart a fade already under way.
    now = 9100;
    store.release();
    expect(store.get('a')?.fadingAt).toBe(9000);
    now = 9000 + FADE_MS + 1;
    store.sweep();
    expect(store.snapshot()).toHaveLength(0);
  });

  it('release can be scheduled for later: the linger after a turn with no question', () => {
    let now = 0;
    const store = new BoardStore({ presentation: 'screen', clock: () => now });
    store.ink({ id: 'a', kind: 'circle', anchor: { board: [1, 1] }, t: { start: 0, dur: 300 } });
    store.release(4000);
    expect(store.get('a')?.fadingAt).toBe(4000);
    now = 2000;
    store.sweep();
    expect(store.snapshot()).toHaveLength(1);
  });
});

// --- helpers --------------------------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function distance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}
