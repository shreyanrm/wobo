import { beforeEach, describe, expect, it } from 'bun:test';
import {
  byteLength,
  clampText,
  clampValue,
  inspectorEnabled,
  pointInRect,
  type Rect,
  rectsIntersect,
  SurfaceRegistry,
  type SurfaceTarget,
} from '../src/registry';

const rect = (x: number, y: number, w = 10, h = 10): Rect => ({ x, y, width: w, height: h });

const target = (id: string, over: Partial<SurfaceTarget> = {}): SurfaceTarget => ({
  id,
  kind: 'control',
  label: `the ${id}`,
  rect: () => rect(0, 0),
  ...over,
});

describe('clamping', () => {
  it('collapses whitespace and is idempotent', () => {
    expect(clampText('  a   b \n c ', 40)).toBe('a b c');
    expect(clampText(clampText('  a   b ', 40), 40)).toBe('a b');
  });

  it('cuts deterministically with an ellipsis, never past the budget', () => {
    const out = clampText('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
    expect(clampText('abcdefghij', 5)).toBe(out);
  });

  it('keeps numbers and booleans whole and clamps everything else', () => {
    expect(clampValue(42)).toBe(42);
    expect(clampValue(false)).toBe(false);
    expect(clampValue(undefined)).toBeUndefined();
    expect(clampValue({ a: 1 })).toBe('{"a":1}');
    expect(String(clampValue('x'.repeat(200))).length).toBe(80);
  });
});

describe('registration', () => {
  let registry: SurfaceRegistry;
  beforeEach(() => {
    registry = new SurfaceRegistry();
  });

  it('registers and unregisters a surface', () => {
    const off = registry.registerSurface({ id: 'home', title: 'Home', targets: [target('a')] });
    expect(registry.getTargets().map((t) => t.id)).toEqual(['a']);
    off();
    expect(registry.getTargets()).toHaveLength(0);
  });

  it('bumps the version on every change, so anchors re-measure', () => {
    const before = registry.getVersion();
    const off = registry.registerSurface({ id: 'home', title: 'Home', targets: [] });
    expect(registry.getVersion()).toBeGreaterThan(before);
    const mid = registry.getVersion();
    off();
    expect(registry.getVersion()).toBeGreaterThan(mid);
  });

  it('notifies subscribers', () => {
    let hits = 0;
    const stop = registry.subscribe(() => {
      hits += 1;
    });
    registry.registerSurface({ id: 'home', title: 'Home', targets: [] });
    expect(hits).toBe(1);
    stop();
    registry.registerSurface({ id: 'other', title: 'Other', targets: [] });
    expect(hits).toBe(1);
  });

  it('a stale unregister never deletes the surface that replaced it', () => {
    const off = registry.registerSurface({ id: 'home', title: 'Home v1', targets: [target('a')] });
    registry.registerSurface({ id: 'home', title: 'Home v2', targets: [target('b')] });
    off();
    expect(registry.getSurfaces()[0]?.title).toBe('Home v2');
    expect(registry.getTargets().map((t) => t.id)).toEqual(['b']);
  });

  it('keeps its place in the ordering across a re-registration', () => {
    registry.registerSurface({ id: 'first', title: 'First', targets: [] });
    registry.registerSurface({ id: 'second', title: 'Second', targets: [] });
    registry.registerSurface({ id: 'first', title: 'First again', targets: [] });
    expect(registry.getSurfaces().map((s) => s.id)).toEqual(['first', 'second']);
  });

  it('sorts by priority, then by registration', () => {
    registry.registerSurface({ id: 'a', title: 'A', targets: [] });
    registry.registerSurface({ id: 'b', title: 'B', targets: [], priority: 5 });
    registry.registerSurface({ id: 'c', title: 'C', targets: [] });
    expect(registry.getSurfaces().map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('attaches a target to a surface that has not registered yet', () => {
    const off = registry.addTarget('late', target('early'));
    expect(registry.getTarget('early')).toBeDefined();
    registry.registerSurface({ id: 'late', title: 'Late', targets: [target('declared')] });
    expect(registry.getTargets().map((t) => t.id)).toEqual(['declared', 'early']);
    off();
    expect(registry.getTargets().map((t) => t.id)).toEqual(['declared']);
  });

  it('a declared target wins over an attached one with the same id', () => {
    registry.addTarget('home', target('x', { label: 'attached' }));
    registry.registerSurface({
      id: 'home',
      title: 'Home',
      targets: [target('x', { label: 'declared' })],
    });
    expect(registry.getTargets()).toHaveLength(1);
    expect(registry.getTarget('x')?.label).toBe('declared');
  });
});

describe('hit testing', () => {
  it('finds element-less targets by rect containment', () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface({
      id: 'board',
      title: 'Board',
      targets: [
        target('near', { rect: () => rect(0, 0, 100, 100) }),
        target('far', { rect: () => rect(500, 500, 10, 10) }),
      ],
    });
    expect(registry.targetIdsAt(50, 50)).toEqual(['near']);
    expect(registry.targetIdsAt(505, 505)).toEqual(['far']);
    expect(registry.targetIdsAt(300, 300)).toEqual([]);
  });

  it('finds every target intersecting a region — the lasso hit test', () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface({
      id: 'board',
      title: 'Board',
      targets: [
        target('a', { rect: () => rect(0, 0, 50, 50) }),
        target('b', { rect: () => rect(40, 40, 50, 50) }),
        target('c', { rect: () => rect(400, 400, 10, 10) }),
      ],
    });
    expect(registry.targetIdsIn(rect(10, 10, 60, 60))).toEqual(['a', 'b']);
  });

  it('has honest rect predicates', () => {
    expect(pointInRect(5, 5, rect(0, 0, 10, 10))).toBe(true);
    expect(pointInRect(15, 5, rect(0, 0, 10, 10))).toBe(false);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toBe(false);
  });
});

describe('actions', () => {
  it('runs a named action on a target', async () => {
    const registry = new SurfaceRegistry();
    let moved = 0;
    registry.registerSurface({
      id: 'sim',
      title: 'Sim',
      targets: [
        target('slider', {
          actions: [
            {
              name: 'setValue',
              description: 'move the slider',
              inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
              run: (input) => {
                moved = Number(input.value);
                return moved;
              },
            },
          ],
        }),
      ],
    });
    await expect(registry.callAction('slider', 'setValue', { value: 7 })).resolves.toBe(7);
    expect(moved).toBe(7);
    await expect(registry.callAction('slider', 'nope')).rejects.toThrow('no action nope');
  });

  it('emits WebMCP-shaped tools, namespaced by target', async () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface({
      id: 'sim',
      title: 'The pendulum',
      targets: [
        target('slider', {
          actions: [
            {
              name: 'setValue',
              description: 'move the slider',
              inputSchema: { type: 'object' },
              run: () => 'done',
            },
          ],
        }),
      ],
    });
    const [tool] = registry.toModelContextTools();
    expect(tool?.name).toBe('slider.setValue');
    expect(tool?.description).toContain('The pendulum');
    expect(tool?.inputSchema).toEqual({ type: 'object' });
    await expect(tool?.execute({})).resolves.toBe('done');
  });
});

describe('the byte ruler', () => {
  it('measures UTF-8, not code units', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('é')).toBe(2);
  });
});

describe('the live registry', () => {
  it('forgets everything on reset', () => {
    const registry = new SurfaceRegistry();
    registry.setRoute('home');
    registry.registerSurface({ id: 'home', title: 'Home', targets: [target('a')] });
    registry.reset();
    expect(registry.getTargets()).toHaveLength(0);
    expect(registry.getRoute()).toBeUndefined();
  });
});

describe('the dev inspector', () => {
  it('is off unless a developer turns it on', () => {
    const flags = globalThis as { __WOBO_INSPECT__?: boolean };
    const before = flags.__WOBO_INSPECT__;
    flags.__WOBO_INSPECT__ = undefined;
    expect(inspectorEnabled()).toBe(false);
    flags.__WOBO_INSPECT__ = true;
    expect(inspectorEnabled()).toBe(true);
    flags.__WOBO_INSPECT__ = before;
  });
});

// --- The glass is the registry of the page (docs/INK-FREEZE-PLAN-TRACE.md §3, §4) ---------------

describe('the registry reads the page off the glass, never a bridge', () => {
  const read = () => ({
    map: {
      v: 1 as const,
      viewport: { w: 390, h: 844, scrollY: 0 },
      entries: [
        { id: 's-1', role: 'step' as const, text: '3x = 15', box: [20, 100, 120, 24] as const },
        {
          id: 'p-eff',
          role: 'figure-part' as const,
          text: 'effect',
          meaning: 'part:effect',
          box: [200, 300, 60, 60] as const,
        },
      ],
    },
    rectOf: (id: string): [number, number, number, number] | null =>
      id === 's-1' ? [20, 100, 120, 24] : id === 'p-eff' ? [200, 300, 60, 60] : null,
    elementOf: () => null,
  });

  it('lends every entry as a target with a live rect, after what the page registered by hand', () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface({ id: 'photo', title: 'the photo', targets: [target('r1')] });
    registry.readGlass(read);
    expect(registry.getTargets().map((t) => t.id)).toEqual(['r1', 's-1', 'p-eff']);
    const part = registry.getTarget('p-eff');
    expect(part?.kind).toBe('figure-part');
    expect(part?.label).toBe('effect');
    expect(part?.description).toBe('part:effect');
    expect(part?.rect()).toEqual({ x: 200, y: 300, width: 60, height: 60 });
    // the lasso and the long press hit the page's own lines
    expect(registry.targetIdsIn(rect(0, 90, 400, 40))).toEqual(['s-1']);
    expect(registry.targetIdsAt(230, 330)).toEqual(['p-eff']);
  });

  it('keeps what it registered by hand apart from what it read, so the reader is never lent the glass back', () => {
    const registry = new SurfaceRegistry();
    registry.registerSurface({ id: 'photo', title: 'the photo', targets: [target('r1')] });
    registry.readGlass(read);
    expect(registry.ownTargets().map((t) => t.id)).toEqual(['r1']);
    expect(registry.getSurfaces().map((s) => s.id)).toEqual(['photo', 'glass']);
  });

  it('is only what it registered once the glass is gone', () => {
    const registry = new SurfaceRegistry();
    registry.readGlass(read);
    expect(registry.getTargets()).toHaveLength(2);
    registry.readGlass(() => null);
    expect(registry.getTargets()).toHaveLength(0);
    registry.readGlass(null);
    expect(registry.getSurfaces()).toEqual([]);
  });
});
