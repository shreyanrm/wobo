/**
 * The photo as a surface (the doubt solver, owner 2026-09-05), held to three of its laws without
 * a browser:
 *
 *  · LAW 3, nothing is placed by pixels from a model's guess: a vision line is a normalised box on
 *    the page as photographed; it becomes a registry target under the gateway's own line id with a
 *    LIVE rect that maps through the rendered photo, so it survives zoom, rotation and resize. A
 *    stroke that resolves off the page is a measured failure, not a shrug.
 *  · LAW 5, it explains while it draws: over the recorded frames of a doubt turn, every ink frame
 *    anchored to a line of the photo lands inside the window of a say frame. All the ink then a
 *    paragraph fails; a paragraph then all the ink fails.
 *  · LAW 1's line: what Wobo read is said back in one sentence the learner can correct.
 */

import { describe, expect, it } from 'bun:test';
import { type Rect, SurfaceRegistry } from '@wobo/wobo';
import {
  checkBeats,
  contentRect,
  doubtSurfaceId,
  frameRecorder,
  MIN_HIT_PX,
  offPageStrokes,
  photoSurface,
  placeRegions,
  type RecordedFrame,
  readingLine,
  regionRect,
  regionTargetId,
  strayMarks,
  strokeHold,
} from './doubt-surface';

const LINE = {
  id: 'r1',
  label: 'the equation',
  text: '3x + 5 = 20',
  box: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 },
};

describe('law 3 — a line rides the rendered photo', () => {
  it('letterboxes a portrait page inside a wide box, and a rotated one the other way', () => {
    const box = { x: 0, y: 0, width: 1000, height: 500 };
    const upright = contentRect(box, { width: 600, height: 800 }, 0);
    // 600x800 into 1000x500: the height rules, scale 0.625 → 375 wide, centred
    expect(upright).toEqual({ x: 312.5, y: 0, width: 375, height: 500 });
    const turned = contentRect(box, { width: 600, height: 800 }, 90);
    // rotated it is 800x600: still the height rules, scale 0.8333.. → 666.6 wide
    expect(turned.width).toBeCloseTo(666.667, 2);
    expect(turned.height).toBeCloseTo(500, 6);
    expect(turned.x).toBeCloseTo(166.667, 2);
  });

  it('maps a line through the content rect, upright and at every quarter turn', () => {
    const frame = { rect: { x: 100, y: 50, width: 400, height: 800 }, rotation: 0 as const };
    expect(regionRect(LINE, frame)).toEqual({ x: 140, y: 210, width: 200, height: 80 });
    // a quarter turn clockwise: the rendered image is 800 wide, 400 tall; the line's left edge
    // (u=0.1) becomes a top edge and its top (v=0.2) becomes the right side
    const cw = { rect: { x: 0, y: 0, width: 800, height: 400 }, rotation: 90 as const };
    expect(regionRect(LINE, cw)).toEqual({ x: 560, y: 40, width: 80, height: 200 });
    const flipped = { rect: { x: 0, y: 0, width: 400, height: 800 }, rotation: 180 as const };
    expect(regionRect(LINE, flipped)).toEqual({ x: 160, y: 560, width: 200, height: 80 });
    const ccw = { rect: { x: 0, y: 0, width: 800, height: 400 }, rotation: 270 as const };
    expect(regionRect(LINE, ccw)).toEqual({ x: 160, y: 160, width: 80, height: 200 });
  });

  it("registers every line as a live target under the gateway's own id, on the gateway's surface", () => {
    const registry = new SurfaceRegistry();
    let frame = { rect: { x: 0, y: 0, width: 400, height: 800 }, rotation: 0 as const };
    const off = registry.registerSurface(photoSurface('d9f3', [LINE], () => frame));
    // the ink frames say `{ target: "r1" }`: the id must survive untouched
    expect(regionTargetId('d9f3', 'r1')).toBe('r1');
    const target = registry.getTarget('r1');
    expect(target?.kind).toBe('photo-region');
    expect(target?.label).toBe('the equation');
    expect(target?.text?.()).toBe('3x + 5 = 20');
    expect(target?.rect()).toEqual({ x: 40, y: 160, width: 200, height: 80 });
    // the photo zoomed: the same target, a new rect, no re-registration
    frame = { rect: { x: 0, y: 0, width: 800, height: 1600 }, rotation: 0 };
    expect(target?.rect()).toEqual({ x: 80, y: 320, width: 400, height: 160 });
    expect(registry.getSurfaceOf('r1')?.id).toBe(doubtSurfaceId('d9f3'));
    expect(doubtSurfaceId('d9f3')).toBe('doubt:d9f3');
    off();
    expect(registry.getTarget('r1')).toBeUndefined();
  });

  it('a target with no frame yet (the photo not painted) is quiet, not wrong', () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface(photoSurface('d9f3', [LINE], () => null));
    expect(registry.getTarget('r1')?.rect()).toBeNull();
  });

  it('measures a stroke that lands off the page, and one aimed at a line the reading never had', () => {
    const page = { x: 100, y: 100, width: 400, height: 600 };
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
      r1: { x: 150, y: 150, width: 100, height: 40 },
      r2: { x: 480, y: 150, width: 60, height: 40 },
      r3: { x: 700, y: 150, width: 60, height: 40 },
    };
    const objects = [
      { id: 'a', anchor: { target: 'r1' }, pad: 8 },
      { id: 'b', anchor: { target: 'r2' }, pad: 8 },
      { id: 'c', anchor: { target: 'r3' } },
      { id: 'd', anchor: { board: [10, 10] as [number, number] } }, // not on the photo at all
      { id: 'e', anchor: { target: 'home-composer' } }, // another screen's target, not a line
    ];
    const bad = offPageStrokes(objects, (id) => rects[id] ?? null, page, {
      targets: new Set(['r1', 'r2', 'r3']),
    });
    expect(bad.map((b) => b.id)).toEqual(['b', 'c', 'e']);
    expect(bad.find((b) => b.id === 'e')?.why).toBe('unknown target');
    expect(bad.find((b) => b.id === 'b')?.why).toBe('off the page');
  });
});

describe('law 5 — no ink without its sentence', () => {
  const say = (t: number, text: string, dur = 1500): RecordedFrame => ({
    type: 'say',
    t,
    text,
    dur,
  });
  const ink = (t: number, target: string): RecordedFrame => ({
    type: 'ink',
    t,
    target,
    id: target,
  });

  it('passes a turn where each stroke lands inside the sentence about it', () => {
    const frames = [
      say(0, 'First, look at the five.'),
      ink(200, 'r2'),
      say(1500, 'It moves to the other side and changes sign.'),
      ink(1700, 'r3'),
      { type: 'done', t: 3000 } as RecordedFrame,
    ];
    expect(checkBeats(frames)).toEqual({ ok: true, orphans: [], inks: 2, says: 2 });
  });

  it('fails all the ink, then a paragraph', () => {
    const frames = [ink(0, 'r2'), ink(100, 'r3'), say(400, 'So we move the five, then divide.')];
    const report = checkBeats(frames);
    expect(report.ok).toBe(false);
    expect(report.orphans.map((o) => o.target)).toEqual(['r2', 'r3']);
  });

  it('fails a paragraph, then all the ink', () => {
    const frames = [
      say(0, 'Move the five across, divide both sides by three, and x is five.', 3000),
      ink(3200, 'r2'),
      ink(3400, 'r3'),
    ];
    expect(checkBeats(frames).orphans).toHaveLength(2);
  });

  it("only holds the photo's own lines to the law when told which they are", () => {
    const frames = [say(0, 'Here.'), ink(5000, 'home-composer'), ink(100, 'r1')];
    expect(checkBeats(frames, { targets: new Set(['r1']) }).ok).toBe(true);
    expect(checkBeats(frames).ok).toBe(false); // every targeted stroke, by default
    // a diagram in board space carries no target and is the board law's business
    const diagram: RecordedFrame = { type: 'ink', t: 5000, id: 'axis' };
    expect(checkBeats([say(0, 'Here.'), diagram]).ok).toBe(true);
    expect(checkBeats([say(0, 'Here.'), diagram], { every: true }).ok).toBe(false);
  });

  it('a say with no duration is given one from its length, never zero', () => {
    const frames: RecordedFrame[] = [
      { type: 'say', t: 0, text: 'Look at the sign on the five, it is plus.' },
      ink(900, 'r2'),
    ];
    expect(checkBeats(frames).ok).toBe(true);
  });

  it('the recorder keeps the order the wire delivered, with the target each ink is about', () => {
    const rec = frameRecorder();
    rec.handlers.onSay?.('Look here.', 0, 1200);
    rec.handlers.onInk?.(
      {
        type: 'ink',
        object: { id: 'c1', kind: 'circle', anchor: { target: 'r2' }, pad: 10 },
        t: 100,
      } as never,
      100,
    );
    rec.handlers.onAsk?.('Which side is the five on?', ['r2'], 1300);
    rec.handlers.onDone?.({ objects: 1 });
    expect(rec.frames().map((f) => f.type)).toEqual(['say', 'ink', 'ask', 'done']);
    expect(rec.frames()[1]?.target).toBe('r2');
    expect(rec.frames()[0]?.dur).toBe(1200);
  });
});

describe('the scroll holds during a stroke and releases after it', () => {
  it('locks once for overlapping strokes and unlocks when the last one ends', () => {
    let now = 0;
    const log: string[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    const hold = strokeHold({
      lock: () => log.push('lock'),
      unlock: () => log.push('unlock'),
      now: () => now,
      after: (ms, fn) => {
        timers.push({ at: now + ms, fn });
        return () => {
          const i = timers.findIndex((t) => t.fn === fn);
          if (i >= 0) timers.splice(i, 1);
        };
      },
    });
    const tick = (to: number) => {
      now = to;
      const due = timers.filter((t) => t.at <= now);
      for (const t of due) timers.splice(timers.indexOf(t), 1);
      for (const t of due) t.fn();
    };
    hold.onStroke(500);
    hold.onStroke(900); // a second stroke while the first is still drawing
    expect(log).toEqual(['lock']);
    tick(600);
    expect(log).toEqual(['lock']); // the second stroke is still going
    tick(900);
    expect(log).toEqual(['lock', 'unlock']);
    hold.dispose();
    expect(log).toEqual(['lock', 'unlock']); // nothing left to release
  });

  it('dispose releases a hold that is still running', () => {
    const log: string[] = [];
    const hold = strokeHold({
      lock: () => log.push('lock'),
      unlock: () => log.push('unlock'),
      now: () => 0,
      after: () => () => {},
    });
    hold.onStroke(2000);
    hold.dispose();
    expect(log).toEqual(['lock', 'unlock']);
  });
});

describe('law 1 — Wobo says what it read before it says anything else', () => {
  it('one sentence, a question, never an em dash', () => {
    expect(readingLine('3x + 5 = 20')).toBe('I read this as 3x + 5 = 20. Is that right?');
    expect(readingLine('  What is photosynthesis?  ')).toBe(
      'I read this as What is photosynthesis? Is that right?',
    );
    expect(readingLine('')).toBe('I could not read anything on this page. Tell me what it says?');
    expect(readingLine('a — b')).not.toContain('—');
  });
});


// --- the wave-57 page, at 390, to the pixel -------------------------------------------------------

/**
 * The six lines of the photographed exercise the adversary drove live at 390 on 2026-09-10, with
 * the boxes the reader gave them and the photo box the harness measured
 * (adv-lab/turns/doubt/w57-live-doubt-390/turn.json).
 */
const PAGE = { rect: { x: 112.703, y: 94, width: 164.578, height: 219.438 }, rotation: 0 as const };
const LINES = [
  { id: 'r1', box: { x: 0.16, y: 0.11, w: 0.22, h: 0.03 } },
  { id: 'r2', box: { x: 0.16, y: 0.16, w: 0.4, h: 0.03 } },
  { id: 'r3', box: { x: 0.16, y: 0.22, w: 0.48, h: 0.03 } },
  { id: 'r4', box: { x: 0.16, y: 0.28, w: 0.22, h: 0.03 } },
  { id: 'r5', box: { x: 0.16, y: 0.34, w: 0.23, h: 0.03 } },
  { id: 'r6', box: { x: 0.16, y: 0.4, w: 0.23, h: 0.03 } },
];

describe('a line keeps its own box, and the thumb gets a band around it', () => {
  it('lays the button out on the line itself, never on the thumb\'s slab', () => {
    const placed = placeRegions(LINES, PAGE, { bounds: PAGE.rect });
    for (const [i, p] of placed.entries()) {
      // The button IS the line: the same rect the registry hands the pen, to the thousandth.
      expect(p.box).toEqual(regionRect(LINES[i] as { box: typeof LINES[0]['box'] }, PAGE));
    }
    // ... and that box is about seven pixels tall at 390, not forty-four.
    expect((placed[1] as { box: { height: number } }).box.height).toBeCloseTo(6.583, 2);
  });

  it('reaches to the thumb\'s floor where there is room, and stops at the halfway line', () => {
    const placed = placeRegions(LINES, PAGE, { bounds: PAGE.rect });
    const band = (p: (typeof placed)[number]) => ({
      top: p.box.y - p.reach.top,
      bottom: p.box.y + p.box.height + p.reach.bottom,
    });
    // Six lines about 13 px apart: no band may cross into the next one's half of the gap.
    for (let i = 1; i < placed.length; i += 1) {
      const above = band(placed[i - 1] as (typeof placed)[number]);
      const here = band(placed[i] as (typeof placed)[number]);
      expect(here.top).toBeGreaterThanOrEqual(above.bottom - 0.001);
    }
    // The bands still partition the page: no gap between two of them either.
    for (let i = 1; i < placed.length; i += 1) {
      const above = band(placed[i - 1] as (typeof placed)[number]);
      const here = band(placed[i] as (typeof placed)[number]);
      expect(here.top - above.bottom).toBeLessThan(0.001);
    }
    // Sideways there is room, so the short lines reach the thumb's floor.
    const r1 = placed[0] as (typeof placed)[number];
    expect(r1.box.width + r1.reach.left + r1.reach.right).toBeGreaterThanOrEqual(MIN_HIT_PX - 0.001);
    // And never past the photo.
    for (const p of placed) {
      expect(p.box.x - p.reach.left).toBeGreaterThanOrEqual(PAGE.rect.x - 0.001);
      expect(p.box.x + p.box.width + p.reach.right).toBeLessThanOrEqual(
        PAGE.rect.x + PAGE.rect.width + 0.001,
      );
    }
  });

  it('a lone line takes the whole floor in both directions', () => {
    const [only] = placeRegions([LINES[1] as (typeof LINES)[0]], PAGE, { bounds: PAGE.rect });
    const it_ = only as NonNullable<typeof only>;
    expect(it_.box.height + it_.reach.top + it_.reach.bottom).toBeCloseTo(MIN_HIT_PX, 3);
  });
});

describe('the probe: every mark on the line it names', () => {
  const lines = placeRegions(LINES, PAGE, { bounds: PAGE.rect }).map((p) => ({
    id: p.id,
    rect: p.box,
  }));
  const rectOf = (id: string) => (lines.find((l) => l.id === id) as { rect: Rect }).rect;
  /** A mark drawn around a rect, with the pen's own padding. */
  const around = (rect: Rect, pad: number): Rect => ({
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  });

  it('passes a ring drawn on its own line', () => {
    const marks = [
      { id: 's0m0', target: 'r2', rect: around(rectOf('r2'), 4) },
      { id: 's1m0', target: 'r3', rect: around(rectOf('r3'), 4) },
    ];
    expect(strayMarks(marks, lines)).toEqual([]);
  });

  it('passes an underline drawn beneath its line, and a note beside it', () => {
    const line = rectOf('r3');
    const marks = [
      // an underline sits UNDER the words; it never contains them
      {
        id: 'u',
        target: 'r3',
        rect: { x: line.x, y: line.y + line.height + 2, width: line.width, height: 3 },
      },
      // a note in the margin, within the note law's own 24 px
      {
        id: 'n',
        target: 'r3',
        rect: { x: line.x + line.width + 10, y: line.y - 4, width: 30, height: 14 },
      },
    ];
    expect(strayMarks(marks, lines)).toEqual([]);
  });

  it('catches the wave-57 sprawl: a slab-anchored ring over the two lines beside it', () => {
    // What the bug drew: the anchor was the 44 px hit slab centred on r2, so the ellipse swallowed
    // r1 and r3 whole while the caption named r2 and r3.
    const slab = (id: string): Rect => {
      const r = rectOf(id);
      return {
        x: r.x,
        y: r.y + r.height / 2 - MIN_HIT_PX / 2,
        width: r.width,
        height: MIN_HIT_PX,
      };
    };
    const marks = [{ id: 's0m0', target: 'r2', rect: around(slab('r2'), 6) }];
    const stray = strayMarks(marks, lines);
    expect(stray).toHaveLength(1);
    expect(stray[0]?.why).toBe('over another line');
    expect(['r1', 'r3']).toContain(stray[0]?.over as string);
  });

  it('catches a mark that missed its line entirely, and a target the reading never had', () => {
    const marks = [
      { id: 'a', target: 'r2', rect: around(rectOf('r5'), 2) },
      { id: 'b', target: 'r9', rect: around(rectOf('r2'), 2) },
    ];
    expect(strayMarks(marks, lines).map((s) => [s.id, s.why])).toEqual([
      ['a', 'off its line'],
      ['b', 'unknown target'],
    ]);
  });
});
