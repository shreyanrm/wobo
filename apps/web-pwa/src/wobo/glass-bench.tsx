'use client';

/**
 * The glass bench: Wobo's ink on a real page, measured (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 *
 * A worked example is rendered as a page would render it (a heading, prose, four steps labelled
 * with their meaning), the glass map is read off it, and a plan is streamed to the REAL conductor
 * (`board-turn.ts`) over a fake wire: the same SSE frames, the same sentence gate, the same
 * utterance clock, the same fixed surface over the page, the same hold and release. Nothing here
 * is a second copy of the hand; it is the hand, on a page it can be watched on.
 *
 * Reachable in dev at `/board-bench.html#glass/<scene>` (the entry switches on the hash). Everything
 * a test needs is on `window.__woboGlass` (`GlassBenchApi`): the scenes, a play call, the first
 * stroke with its box in viewport px, what is on the surface right now, and the holds.
 */

import {
  type BoardEvent,
  BoardSurface,
  DEFAULT_IGNORE,
  type GlassMap,
  type GlassRead,
  glassHold,
  handFont,
  plane,
  type RectLike,
  readGlass,
  scrollHold,
  WoboPlane,
} from '@wobo/wobo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardTurn, screenStore } from './board-turn';

// --- The scenes ----------------------------------------------------------------------------------

/** One frame on the wire, `at` ms after the request. */
interface Frame {
  at: number;
  data: Record<string, unknown>;
}

export interface GlassScene {
  name: string;
  /** The learner's word about the surface, when they said one. */
  override?: 'plane' | 'screen';
  frames: Frame[];
}

const accent = { ink: 'accent', weight: 2 } as const;
const say = (at: number, text: string): Frame => ({ at, data: { type: 'say', text, t: at } });
const ink = (at: number, object: Record<string, unknown>): Frame => ({
  at,
  data: { type: 'ink', object, t: at },
});
const ask = (at: number, prompt: string, targets: string[]): Frame => ({
  at,
  data: { type: 'ask', prompt, targets, t: at },
});
const done = (at: number): Frame => ({ at, data: { type: 'done', t: at } });

/**
 * The plan the brain returns for "which step is wrong here?" on this page (the gateway's own
 * fixture, services/gateway/tests/fixtures/glass/which-step-is-wrong.json): a ring on step 2 with
 * the first sentence, an underline under step 1 with the second, and a question that holds them.
 */
const WHICH_STEP: GlassScene = {
  name: 'which-step',
  frames: [
    say(20, 'Step 2 is the first line that does not follow from the one above it.'),
    ink(30, {
      id: 's0m0',
      kind: 'ring',
      anchor: { target: 'w2' },
      pad: 8,
      style: accent,
      beat: { with: 0 },
      words: 'step 2',
    }),
    say(50, 'Compare it with step 1, the line just above.'),
    ink(60, {
      id: 's1m0',
      kind: 'underline',
      anchor: { target: 'w1' },
      style: accent,
      beat: { with: 1 },
      words: 'step 1',
    }),
    ask(80, 'What changed between step 1 and step 2?', ['w2', 'w1']),
    done(90),
  ],
};

/** Every mark the hand knows, one sentence each, no question: they linger, then go. */
const ALL_MARKS: GlassScene = {
  name: 'all-marks',
  frames: [
    say(20, 'Here is the line that went wrong, and the one it should follow.'),
    ink(30, {
      id: 'ring',
      kind: 'ring',
      anchor: { target: 'w2' },
      pad: 8,
      style: accent,
      beat: { with: 0 },
      words: 'step 2',
    }),
    ink(32, {
      id: 'note',
      kind: 'note',
      anchor: { target: 'w2' },
      text: 'sign flips here',
      style: accent,
      beat: { with: 0, lag: 400 },
      words: 'the sign flips',
    }),
    say(50, 'Step 1 is right, step 3 and step 4 only carry the mistake on.'),
    ink(60, {
      id: 'tick',
      kind: 'tick',
      anchor: { target: 'w1' },
      style: accent,
      beat: { with: 1 },
      words: 'step 1 is right',
    }),
    ink(62, {
      id: 'bracket',
      kind: 'bracket',
      anchor: { target: 'w3' },
      side: 'right',
      beat: { with: 1, lag: 300 },
      words: 'these two',
    }),
    say(70, 'Bring the five across, and the sign flips with it.'),
    ink(80, {
      id: 'arrow',
      kind: 'arrow',
      from: { target: 'w1' },
      anchor: { target: 'w3' },
      style: accent,
      beat: { with: 2 },
      words: 'across',
    }),
    ink(82, {
      id: 'cross',
      kind: 'cross',
      anchor: { target: 'w4' },
      style: accent,
      beat: { with: 2, lag: 300 },
      words: 'not ten',
    }),
    ink(84, {
      id: 'point',
      kind: 'point',
      anchor: { target: 'w1' },
      beat: { with: 2, lag: 500 },
      words: 'the five',
    }),
    done(90),
  ],
};

/** A ring on the last step and no question, for scrolling its subject off the glass. */
const OFF_GLASS: GlassScene = {
  name: 'off-glass',
  frames: [
    say(20, 'This is the line to check.'),
    ink(30, {
      id: 'ring',
      kind: 'ring',
      anchor: { target: 'w4' },
      pad: 8,
      style: accent,
      beat: { with: 0 },
      words: 'the last line',
    }),
    ask(40, 'Is it right?', ['w4']),
    done(50),
  ],
};

/** "On the board": the brain only talked. No plane. */
const BOARD_TALK: GlassScene = {
  name: 'board-talk',
  override: 'plane',
  frames: [say(20, 'There is nothing to draw for that.'), done(40)],
};

/** "On the board": the brain drew an axis. The plane opens on it, and not before. */
const BOARD_AXIS: GlassScene = {
  name: 'board-axis',
  override: 'plane',
  frames: [
    say(20, 'A number line, from zero to ten.'),
    ink(30, {
      id: 'x',
      kind: 'axis',
      anchor: { board: [120, 400] },
      orientation: 'x',
      min: 0,
      max: 10,
      step: 1,
      length: 700,
      label: 'x',
      beat: { with: 0 },
    }),
    done(60),
  ],
};

export const GLASS_SCENES: GlassScene[] = [
  WHICH_STEP,
  ALL_MARKS,
  OFF_GLASS,
  BOARD_TALK,
  BOARD_AXIS,
];

// --- The wire -------------------------------------------------------------------------------------

const WIRE = 'http://glass.bench';

/** Answer the conductor's request with the scene's frames, on the scene's clock. */
function serveScene(frames: Frame[]): (url: string, init?: RequestInit) => Promise<Response> {
  return async (_url, init) => {
    const signal = init?.signal ?? null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // torn down already
          }
        };
        signal?.addEventListener('abort', () => {
          for (const t of timers) clearTimeout(t);
          if (closed) return;
          closed = true;
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // torn down already
          }
        });
        let last = 0;
        for (const frame of frames) {
          last = Math.max(last, frame.at);
          timers.push(
            setTimeout(() => {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame.data)}\n\n`));
            }, frame.at),
          );
        }
        timers.push(setTimeout(close, last + 10));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

// --- What a test can see ---------------------------------------------------------------------------

export interface GlassBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlassMarkRow {
  id: string;
  generation: number;
  /** In the settled layer: the pen has finished with it. */
  settled: boolean;
  /** Still revealing along its dash: the pen is on it. */
  drawing: boolean;
  opacity: number;
  /** The union of its paths, in viewport px. */
  box: GlassBox | null;
  /** The first path's `d`, so a test can tell "faded where it was" from "moved". */
  d: string | null;
  /** The first path's computed stroke colour. */
  stroke: string | null;
  /** performance.now() when it was first in the DOM, and when it first settled. */
  firstSeen: number | null;
  settledAt: number | null;
}

export interface GlassBenchApi {
  scenes: string[];
  /** Run a scene through the conductor. Resolves when the turn resolves. */
  play(scene: string): Promise<{ completed: boolean; objects: number; ask: string | null }>;
  current: string | null;
  /** performance.now() when the last play began. */
  startedAt: number | null;
  active(): boolean;
  /** The first mark in the DOM since the last play: when, which, and where. */
  firstStroke: { t: number; id: string; box: GlassBox } | null;
  /** performance.now() of each sentence's start since the last play, by index. */
  sentences(): number[];
  marks(): GlassMarkRow[];
  /** Ink the store is fading, by id, with the clock instant the fade began. */
  fading(id: string): number | null;
  /** performance.now() when an object first reached the screen store, by id. */
  landedAt(id: string): number | null;
  /**
   * The hand's font is parsed and in hand. In the app the surface mounts at the root, so this is
   * true long before a turn; a test waits for it so it measures the hand and not a cold server.
   */
  fontReady(): boolean;
  /** Long tasks on the main thread since the last play, as performance.now() offsets from it. */
  longTasks(): { at: number; ms: number; name: string }[];
  /** Animation frame gaps over the first 1.5 s of the last play, in ms. */
  frameGaps(): number[];
  held(): { glass: boolean; scroll: boolean };
  map(): GlassMap;
  /** The live box of a glass id, in viewport px. */
  subject(id: string): GlassBox | null;
  interrupt(): void;
  planeOpen(): boolean;
  /** Times the plane was seen open with no object on it, since the last play. */
  emptyPlaneOpenings: number;
  now(): number;
}

declare global {
  interface Window {
    __woboGlass?: GlassBenchApi;
    __woboTiming?: unknown[];
  }
}

function unionBox(a: GlassBox | null, b: DOMRect): GlassBox {
  if (!a) return { x: b.x, y: b.y, w: b.width, h: b.height };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.width) - x,
    h: Math.max(a.y + a.h, b.y + b.height) - y,
  };
}

function boxOf(group: Element): GlassBox | null {
  let box: GlassBox | null = null;
  for (const el of Array.from(group.querySelectorAll('path, text, image'))) {
    const r = (el as SVGGraphicsElement).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    box = unionBox(box, r);
  }
  return box;
}

// --- The page --------------------------------------------------------------------------------------

const PAGE_CSS = `
.gb-page{max-width:640px;margin:0 auto;padding:16px 16px 40px;font-size:16px;line-height:1.5}
.gb-header{display:flex;align-items:center;gap:12px;min-height:56px;color:var(--wobo-ink-500,#6E6E76);font-size:13px}
.gb-card{border:1px solid var(--wobo-ink-200,#E2E2E8);border-radius:3px;padding:16px 20px;margin:12px 0}
.gb-card h2{font-size:22px;line-height:1.3;margin:0 0 8px}
.gb-card p{margin:8px 0}
.gb-steps{margin:12px 0;padding:0}
.gb-row{line-height:36px;height:36px}
.gb-step{display:inline-block;font-size:20px;font-variant-numeric:tabular-nums;padding:0 4px}
.gb-filler{height:1400px}
.gb-chrome{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.gb-chrome button,.gb-chrome select{font-size:13px;min-height:44px;padding:0 10px}
`;

export function GlassBench() {
  const pageRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<GlassRead | null>(null);
  const [scene, setScene] = useState<string>(() => sceneFromHash(window.location.hash));
  const [, setTick] = useState(0);
  const strokes = useRef(new Map<string, GlassMarkRow>());
  const landed = useRef(new Map<string, number>());
  const api = useRef<GlassBenchApi | null>(null);
  const tasks = useRef<{ at: number; ms: number; name: string }[]>([]);
  const gaps = useRef<number[]>([]);

  // When each object reached the store, so a late first stroke can be laid at the wire's door or
  // the renderer's.
  useEffect(
    () =>
      screenStore.subscribe(() => {
        const now = performance.now();
        for (const s of screenStore.snapshot()) {
          if (!landed.current.has(s.object.id)) landed.current.set(s.object.id, now);
        }
      }),
    [],
  );

  /** The glass map of this page, read once per play and measured live after that. */
  const remap = useCallback((question: string) => {
    const read = readGlass({
      root: pageRef.current,
      question,
      ignore: [...DEFAULT_IGNORE, '.gb-chrome', '.gb-header'],
      route: 'learn',
    });
    readRef.current = read;
    return read;
  }, []);

  const rectOf = useCallback((id: string): RectLike | null => {
    const b = readRef.current?.rectOf(id);
    return b ? { x: b[0], y: b[1], width: b[2], height: b[3] } : null;
  }, []);

  const targets = useCallback(
    () =>
      (readRef.current?.map.entries ?? []).map((e) => ({
        id: e.id,
        getRect: () => {
          const r = rectOf(e.id);
          return r ? new DOMRect(r.x, r.y, r.width, r.height) : null;
        },
      })),
    [rectOf],
  );

  /** The page's own text near a subject, so a note lands in the margin and never on the words. */
  const avoid = useCallback(
    (near: RectLike) => {
      const out: RectLike[] = [];
      for (const e of readRef.current?.map.entries ?? []) {
        if (e.role !== 'line' && e.role !== 'step' && e.role !== 'heading') continue;
        const r = rectOf(e.id);
        if (!r) continue;
        if (
          r.x < near.x + near.width &&
          near.x < r.x + r.width &&
          r.y < near.y + near.height &&
          near.y < r.y + r.height
        ) {
          out.push(r);
        }
      }
      return out;
    },
    [rectOf],
  );

  // Escape and a tap interrupt, exactly as the app's runtime wires them.
  useEffect(() => {
    const cut = () => {
      if (boardTurn.get().active) boardTurn.interrupt();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cut();
    };
    window.addEventListener('pointerdown', cut, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', cut, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);

  // Watch the fixed surface for marks, so a test reads the pen off the DOM and never off pixels.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const now = performance.now();
      for (const g of Array.from(document.querySelectorAll('[data-wobo-object]'))) {
        const key = g.getAttribute('data-wobo-object') ?? '';
        const settled = Boolean(g.closest('[data-wobo-settled]'));
        const row = strokes.current.get(key);
        if (!row) {
          const box = boxOf(g);
          const [id, gen] = key.split('#');
          const fresh: GlassMarkRow = {
            id: id ?? key,
            generation: Number(gen ?? 0),
            settled,
            drawing: !settled,
            opacity: Number(g.getAttribute('opacity') ?? 1),
            box,
            d: g.querySelector('path')?.getAttribute('d') ?? null,
            stroke: null,
            firstSeen: now,
            settledAt: settled ? now : null,
          };
          strokes.current.set(key, fresh);
          const a = api.current;
          if (a && a.firstStroke === null && box) {
            a.firstStroke = { t: now, id: fresh.id, box };
          }
        } else if (settled && row.settledAt === null) {
          row.settledAt = now;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, []);

  // The plane must never be seen open with nothing on it.
  useEffect(
    () =>
      plane.subscribe(() => {
        queueMicrotask(() => {
          const a = api.current;
          if (!a || !plane.get().open) return;
          if (boardTurn.get().objects === 0) a.emptyPlaneOpenings += 1;
        });
      }),
    [],
  );

  const play = useCallback(
    async (name: string) => {
      const found = GLASS_SCENES.find((s) => s.name === name);
      if (!found) throw new Error(`no scene ${name}`);
      const a = api.current;
      strokes.current.clear();
      landed.current.clear();
      tasks.current = [];
      gaps.current = [];
      window.__woboTiming = [];
      const started = performance.now();
      try {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const attr = (e as { attribution?: { name?: string; containerSrc?: string }[] })
              .attribution;
            tasks.current.push({
              at: Math.round(e.startTime - started),
              ms: Math.round(e.duration),
              name: attr?.map((x) => `${x.name ?? ''}:${x.containerSrc ?? ''}`).join(',') ?? e.name,
            });
          }
        });
        po.observe({ entryTypes: ['longtask'] });
        setTimeout(() => po.disconnect(), 3000);
      } catch {
        // no long task timing here
      }
      {
        let last = started;
        const sample = () => {
          const now = performance.now();
          gaps.current.push(Math.round(now - last));
          last = now;
          if (now - started < 1500) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }
      if (a) {
        a.firstStroke = null;
        a.current = name;
        a.startedAt = performance.now();
        a.emptyPlaneOpenings = 0;
      }
      setScene(name);
      remap(name === 'which-step' ? 'which step is wrong here?' : 'show me');
      const real = window.fetch;
      const serve = serveScene(found.frames);
      window.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        return href.startsWith(WIRE) ? serve(href, init) : real(url, init);
      }) as typeof window.fetch;
      try {
        const outcome = await boardTurn.run({
          gatewayUrl: WIRE,
          payload: {},
          route: 'learn',
          title: 'glass bench',
          ...(found.override ? { override: found.override } : {}),
          origin: { x: window.innerWidth - 56, y: window.innerHeight - 60 },
        });
        return {
          completed: outcome.completed,
          objects: outcome.objects,
          ask: outcome.ask?.prompt ?? null,
        };
      } finally {
        if (window.fetch !== real) window.fetch = real;
        setTick((n) => n + 1);
      }
    },
    [remap],
  );

  useEffect(() => {
    const a: GlassBenchApi = {
      scenes: GLASS_SCENES.map((s) => s.name),
      play,
      current: null,
      startedAt: null,
      active: () => boardTurn.get().active,
      firstStroke: null,
      sentences: () =>
        (window.__woboTiming ?? [])
          .filter((row): row is { t: number; kind: string; sentence: number } => {
            const r = row as { kind?: unknown };
            return r.kind === 'sentence';
          })
          .sort((p, q) => p.sentence - q.sentence)
          .map((row) => row.t),
      marks: () => {
        const out: GlassMarkRow[] = [];
        for (const g of Array.from(document.querySelectorAll('[data-wobo-object]'))) {
          const key = g.getAttribute('data-wobo-object') ?? '';
          const known = strokes.current.get(key);
          const [id, gen] = key.split('#');
          const path = g.querySelector('path');
          const dashed = Boolean(path?.getAttribute('stroke-dasharray'));
          out.push({
            id: id ?? key,
            generation: Number(gen ?? 0),
            settled: Boolean(g.closest('[data-wobo-settled]')),
            drawing: dashed,
            opacity: Number(g.getAttribute('opacity') ?? 1),
            box: boxOf(g),
            d: path?.getAttribute('d') ?? null,
            stroke: path ? getComputedStyle(path).stroke : null,
            firstSeen: known?.firstSeen ?? null,
            settledAt: known?.settledAt ?? null,
          });
        }
        return out;
      },
      fading: (id) => screenStore.get(id)?.fadingAt ?? null,
      landedAt: (id) => landed.current.get(id) ?? null,
      fontReady: () => handFont() !== null,
      longTasks: () => tasks.current,
      frameGaps: () => gaps.current,
      held: () => ({ glass: glassHold.held, scroll: scrollHold.held }),
      map: () =>
        readRef.current?.map ?? { v: 1, viewport: { w: 0, h: 0, scrollY: 0 }, entries: [] },
      subject: (id) => {
        const r = rectOf(id);
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      },
      interrupt: () => {
        boardTurn.interrupt();
      },
      planeOpen: () => plane.get().open,
      emptyPlaneOpenings: 0,
      now: () => screenStore.time(),
    };
    api.current = a;
    window.__woboGlass = a;
    return () => {
      if (window.__woboGlass === a) window.__woboGlass = undefined;
    };
  }, [play, rectOf]);

  const empty = useMemo(() => () => [], []);

  return (
    <div data-testid="glass-bench" data-scene={scene}>
      <style>{PAGE_CSS}</style>
      <div ref={pageRef} className="gb-page">
        <header className="gb-header">linear equations in one variable</header>
        <div className="gb-card" data-glass="card" data-glass-text="a worked example">
          <h2 data-glass="heading" data-glass-id="h1">
            Solve 2x + 5 = 15
          </h2>
          <p>
            A friend worked this one through and got x = 10. Read each line against the one above
            it: every step has to follow from the last, or the answer is only a guess.
          </p>
          <div className="gb-steps">
            <div className="gb-row">
              <span
                className="gb-step"
                data-glass="step"
                data-glass-id="w1"
                data-glass-meaning="step:1"
              >
                2x + 5 = 15
              </span>
            </div>
            <div className="gb-row">
              <span
                className="gb-step"
                data-glass="step"
                data-glass-id="w2"
                data-glass-meaning="step:2 misconception:moves-term-without-sign"
              >
                2x = 15 + 5
              </span>
            </div>
            <div className="gb-row">
              <span
                className="gb-step"
                data-glass="step"
                data-glass-id="w3"
                data-glass-meaning="step:3"
              >
                2x = 20
              </span>
            </div>
            <div className="gb-row">
              <span
                className="gb-step"
                data-glass="step"
                data-glass-id="w4"
                data-glass-meaning="step:4"
              >
                x = 10
              </span>
            </div>
          </div>
          <p>
            Check it by putting the answer back: 2 times 10 plus 5 is 25, not 15. So one line does
            not follow from the line above it.
          </p>
        </div>
        <div className="gb-chrome">
          <select
            aria-label="which scene to play"
            value={scene}
            onChange={(e) => {
              window.location.hash = `glass/${e.target.value}`;
              void play(e.target.value);
            }}
          >
            {GLASS_SCENES.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void play(scene)}>
            play
          </button>
        </div>
        <div className="gb-filler" aria-hidden="true" />
      </div>
      <BoardSurface
        fixed
        store={screenStore}
        targets={targets}
        focusRegions={empty}
        avoid={avoid}
        label="Wobo's ink on this screen"
      />
      <WoboPlane targets={targets} />
    </div>
  );
}

function sceneFromHash(hash: string): string {
  const raw = hash.replace(/^#/, '').replace(/^glass\/?/, '');
  const [name] = raw.split('/');
  return name && GLASS_SCENES.some((s) => s.name === name) ? name : (GLASS_SCENES[0]?.name ?? '');
}

/** True when the hash asks for the glass bench rather than the board bench. */
export function wantsGlassBench(hash: string): boolean {
  return hash.startsWith('#glass');
}

// The plan's own timing is kept on the wire exactly as the app sends it; nothing here retimes.
export type { BoardEvent };
