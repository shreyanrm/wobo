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
import { SurfaceRegistry } from '@wobo/wobo';
import {
  checkBeats,
  contentRect,
  doubtSurfaceId,
  frameRecorder,
  offPageStrokes,
  photoSurface,
  type RecordedFrame,
  readingLine,
  regionRect,
  regionTargetId,
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
