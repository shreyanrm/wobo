'use client';

/**
 * The surface registry — Wobo's screen sense (docs/WOBO-PLAN.md §1, docs/WOBO-TASKS.md §5.1).
 *
 * Every screen declares what is on it: a surface with a title, a description, and a list of
 * semantic targets. A target has a stable id, a kind, a label, a live `rect()` and, optionally,
 * the actions it supports. Nothing is ever placed by pixels — Wobo's ink anchors to a target id
 * from this registry, and the registry re-measures on scroll and resize so an anchor survives
 * layout shift.
 *
 * The shape is WebMCP's `registerTool` deliberately: `{ name, description, inputSchema, run }`.
 * `toModelContextTools()` already emits that shape, so a `navigator.modelContext` adapter is one
 * small file the day Chrome ships it — no rewrite of a single screen.
 *
 * `snapshot()` is the "what is on screen" half of the context packet: deterministic JSON under a
 * byte budget (2 KB by default, docs/BOARD.md §10), trimmed by a fixed ladder so the same screen
 * always produces the same bytes. No screenshot of our own UI, ever.
 */

import { createElement, type ReactElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { scrollHold } from './scroll-hold';

// --- The contract --------------------------------------------------------------------------------

/** A plain JSON Schema object — the WebMCP tool-input shape, with no schema library in the way. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** A viewport rect. `DOMRect` satisfies this structurally, so `getBoundingClientRect` just works. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One thing a target can do — named, described, schema'd, runnable. WebMCP's `registerTool`. */
export interface TargetAction {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * A semantic part of a screen: a card, a control, an axis, a cell, a region of a diagram.
 * `kind` is free text so a new interactive never needs a change here; `label` is what Wobo reads.
 */
export interface SurfaceTarget {
  id: string;
  kind: string;
  label: string;
  description?: string;
  /** Live viewport rect — read at resolve time, never cached across a layout change. */
  rect: () => Rect | null;
  /** The DOM element, when there is one, so a pointer can be resolved to this target. */
  element?: () => Element | null;
  /** Live value the learner can see (a slider's number, a cell's contents). */
  value?: () => unknown;
  /** Live text content, when it is not already the label. */
  text?: () => string;
  actions?: TargetAction[];
  /** Higher sorts first in the snapshot. Default 0. */
  priority?: number;
}

export interface SurfaceDefinition {
  id: string;
  title: string;
  description?: string;
  targets: SurfaceTarget[];
  /** Higher sorts first in the snapshot; ties break on registration order. Default 0. */
  priority?: number;
}

/** A surface as the registry holds it: its own declared targets plus any attached by `useTarget`. */
export interface ResolvedSurface {
  id: string;
  title: string;
  description?: string;
  priority: number;
  targets: SurfaceTarget[];
}

// --- The snapshot (the "what is on screen" half of the context packet) ----------------------------

export interface TargetSnapshot {
  id: string;
  kind: string;
  label: string;
  description?: string;
  value?: unknown;
  text?: string;
  actions?: string[];
}

export interface SurfaceSnapshot {
  id: string;
  title: string;
  description?: string;
  targets: TargetSnapshot[];
  /** How many of this surface's targets were dropped to fit the budget. */
  more?: number;
}

export interface RegistrySnapshot {
  v: 1;
  route?: string;
  surfaces: SurfaceSnapshot[];
  /** How many whole surfaces were dropped to fit the budget. */
  more?: number;
  truncated?: boolean;
}

/** The screen snapshot's share of the context packet (docs/BOARD.md §10). */
export const SNAPSHOT_BYTE_BUDGET = 2048;

/** Field clamps, applied before the budget ladder so a single long label can never dominate. */
const CLAMP = { label: 64, description: 120, text: 160, value: 80 } as const;

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

/** UTF-8 byte length of a string — what the budget is actually measured in. */
export function byteLength(text: string): number {
  if (encoder) return encoder.encode(text).length;
  // No TextEncoder (an exotic runtime): assume the worst case rather than under-count.
  return text.length * 4;
}

/** Serialized byte size of a snapshot. */
export function snapshotBytes(snapshot: RegistrySnapshot): number {
  return byteLength(JSON.stringify(snapshot));
}

/** Deterministic clamp: never mid-surrogate, always the same output for the same input. */
export function clampText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** A value small enough to ride in the snapshot: numbers and booleans whole, everything else clamped. */
export function clampValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clampText(value, CLAMP.value);
  try {
    return clampText(JSON.stringify(value), CLAMP.value);
  } catch {
    return undefined;
  }
}

/** Drop `undefined` fields so the serialized bytes are stable and free of noise. */
function compact<T extends Record<string, unknown>>(object: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function readTarget(target: SurfaceTarget): TargetSnapshot {
  let value: unknown;
  let text: string | undefined;
  try {
    value = clampValue(target.value?.());
  } catch {
    value = undefined; // a target that throws while being read is simply quiet this turn
  }
  try {
    const raw = target.text?.();
    text = raw ? clampText(raw, CLAMP.text) : undefined;
  } catch {
    text = undefined;
  }
  const actions = target.actions?.map((a) => a.name);
  return compact({
    id: target.id,
    kind: target.kind,
    label: clampText(target.label, CLAMP.label),
    description: target.description ? clampText(target.description, CLAMP.description) : undefined,
    value,
    text,
    actions: actions && actions.length > 0 ? actions : undefined,
  });
}

/**
 * The full, unbudgeted snapshot of a set of surfaces — pure, so it is unit-testable without a DOM.
 * Surfaces and targets keep the order they were given; `fitSnapshot` does the trimming.
 */
export function buildSnapshot(surfaces: ResolvedSurface[], route?: string): RegistrySnapshot {
  return compact({
    v: 1 as const,
    route,
    surfaces: surfaces.map((surface) =>
      compact({
        id: surface.id,
        title: clampText(surface.title, CLAMP.label),
        description: surface.description
          ? clampText(surface.description, CLAMP.description)
          : undefined,
        targets: surface.targets.map(readTarget),
      }),
    ),
  });
}

/** A structural clone that keeps `undefined`-free shape (the snapshot is plain JSON by construction). */
function cloneSnapshot(snapshot: RegistrySnapshot): RegistrySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as RegistrySnapshot;
}

/**
 * Trim a snapshot to a byte budget by a fixed ladder, so the same screen always yields the same
 * bytes. Least useful information leaves first; a target's identity (id, kind, label) is the last
 * thing to go, because ink anchors to it.
 *
 *   1. surface descriptions
 *   2. target descriptions
 *   3. target text
 *   4. target action names
 *   5. trailing targets, from the last surface that still has more than one (counted in `more`)
 *   6. whole trailing surfaces (counted in the top-level `more`)
 */
export function fitSnapshot(
  snapshot: RegistrySnapshot,
  budget: number = SNAPSHOT_BYTE_BUDGET,
): RegistrySnapshot {
  const out = cloneSnapshot(snapshot);
  let truncated = false;
  const fits = () => snapshotBytes(out) <= budget;
  if (fits()) return out;

  for (const surface of out.surfaces) {
    if (surface.description !== undefined) {
      surface.description = undefined;
      truncated = true;
    }
  }
  const stages: ((t: TargetSnapshot) => boolean)[] = [
    (t) => {
      if (t.description === undefined) return false;
      t.description = undefined;
      return true;
    },
    (t) => {
      if (t.text === undefined) return false;
      t.text = undefined;
      return true;
    },
    (t) => {
      if (t.actions === undefined) return false;
      t.actions = undefined;
      return true;
    },
  ];
  for (const stage of stages) {
    if (fits()) break;
    for (const surface of out.surfaces) {
      for (const target of surface.targets) {
        if (stage(target)) truncated = true;
      }
    }
  }

  // Drop trailing targets, then trailing surfaces. Bounded so a pathological budget cannot spin.
  let guard = 4000;
  while (!fits() && guard > 0) {
    guard -= 1;
    const index = lastIndexWhere(out.surfaces, (s) => s.targets.length > 1);
    if (index >= 0) {
      const surface = out.surfaces[index] as SurfaceSnapshot;
      surface.targets.pop();
      surface.more = (surface.more ?? 0) + 1;
      truncated = true;
      continue;
    }
    if (out.surfaces.length > 1) {
      out.surfaces.pop();
      out.more = (out.more ?? 0) + 1;
      truncated = true;
      continue;
    }
    // One surface, one target: this is the floor. Drop its last remaining target rather than lie.
    const only = out.surfaces[0];
    if (only && only.targets.length > 0) {
      only.targets.pop();
      only.more = (only.more ?? 0) + 1;
      truncated = true;
      continue;
    }
    break;
  }

  if (truncated) out.truncated = true;
  // Re-serialize through JSON so dropped fields leave the object rather than sit as `undefined`.
  return JSON.parse(JSON.stringify(out)) as RegistrySnapshot;
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

// --- The registry --------------------------------------------------------------------------------

/** A tool in `navigator.modelContext` shape — the adapter is one file on top of this. */
export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface Entry {
  token: symbol;
  order: number;
  definition: SurfaceDefinition;
  /** Targets attached by `useTarget`, keyed by id, kept across a surface re-registration. */
  attached: Map<string, SurfaceTarget>;
}

/** How long a burst of scroll events is coalesced before targets are treated as re-measured. */
const SCROLL_THROTTLE_MS = 100;

export class SurfaceRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private nextOrder = 0;
  private version = 0;
  private route: string | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private detachLayout: (() => void) | null = null;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Register a whole screen. Returns the unregister; call it on unmount. */
  registerSurface(definition: SurfaceDefinition): () => void {
    const previous = this.entries.get(definition.id);
    const token = Symbol(definition.id);
    this.entries.set(definition.id, {
      token,
      // A re-registration of the same id keeps its place in the snapshot ordering.
      order: previous?.order ?? this.nextOrder++,
      definition,
      attached: previous?.attached ?? new Map(),
    });
    this.ensureLayoutWatch();
    this.observeElements(definition.targets);
    this.bump();
    return () => {
      const current = this.entries.get(definition.id);
      // A stale unregister (the surface already re-registered) must not delete the live one.
      if (!current || current.token !== token) return;
      if (current.attached.size > 0) {
        // Targets attached by children outlive the surface's own definition.
        this.entries.set(definition.id, { ...current, definition: { ...definition, targets: [] } });
      } else {
        this.entries.delete(definition.id);
      }
      if (this.entries.size === 0) this.stopLayoutWatch();
      this.bump();
    };
  }

  /**
   * Attach one target to a surface. The surface need not exist yet — a placeholder is created and
   * filled in when the screen registers, so a child never depends on mount order.
   */
  addTarget(surfaceId: string, target: SurfaceTarget): () => void {
    let entry = this.entries.get(surfaceId);
    if (!entry) {
      entry = {
        token: Symbol(surfaceId),
        order: this.nextOrder++,
        definition: { id: surfaceId, title: surfaceId, targets: [] },
        attached: new Map(),
      };
      this.entries.set(surfaceId, entry);
    }
    entry.attached.set(target.id, target);
    this.ensureLayoutWatch();
    this.observeElements([target]);
    this.bump();
    return () => {
      const current = this.entries.get(surfaceId);
      if (!current) return;
      if (current.attached.get(target.id) !== target) return; // replaced by a newer registration
      current.attached.delete(target.id);
      if (current.attached.size === 0 && current.definition.targets.length === 0) {
        this.entries.delete(surfaceId);
      }
      if (this.entries.size === 0) this.stopLayoutWatch();
      this.bump();
    };
  }

  /** The route the learner is on, carried into the snapshot. */
  setRoute(route: string | undefined): void {
    if (this.route === route) return;
    this.route = route;
    this.bump();
  }

  getRoute(): string | undefined {
    return this.route;
  }

  /** Every registered surface, ordered by priority then registration. */
  getSurfaces(): ResolvedSurface[] {
    const resolved = Array.from(this.entries.values()).map((entry) => {
      const declared = entry.definition.targets;
      const seen = new Set(declared.map((t) => t.id));
      const attached = Array.from(entry.attached.values()).filter((t) => !seen.has(t.id));
      const targets = [...declared, ...attached].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      );
      return {
        entry,
        surface: {
          id: entry.definition.id,
          title: entry.definition.title,
          description: entry.definition.description,
          priority: entry.definition.priority ?? 0,
          targets,
        } satisfies ResolvedSurface,
      };
    });
    resolved.sort(
      (a, b) => b.surface.priority - a.surface.priority || a.entry.order - b.entry.order,
    );
    return resolved.map((r) => r.surface);
  }

  /** Every registered target, across every surface, in snapshot order. */
  getTargets(): SurfaceTarget[] {
    return this.getSurfaces().flatMap((s) => s.targets);
  }

  getTarget(id: string): SurfaceTarget | undefined {
    return this.getTargets().find((t) => t.id === id);
  }

  /** The surface a target belongs to — for the focus object's owner state. */
  getSurfaceOf(targetId: string): ResolvedSurface | undefined {
    return this.getSurfaces().find((s) => s.targets.some((t) => t.id === targetId));
  }

  /** Ids of the targets under a viewport point, innermost first. Never a screenshot. */
  targetIdsAt(x: number, y: number): string[] {
    const stack =
      typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [];
    const hits: { id: string; depth: number }[] = [];
    for (const target of this.getTargets()) {
      const element = safeCall(target.element);
      if (element) {
        const depth = stack.findIndex((node) => node === element || element.contains(node));
        if (depth >= 0) hits.push({ id: target.id, depth });
        continue;
      }
      const rect = safeCall(target.rect);
      if (rect && pointInRect(x, y, rect))
        hits.push({ id: target.id, depth: Number.MAX_SAFE_INTEGER });
    }
    hits.sort((a, b) => a.depth - b.depth);
    return hits.map((h) => h.id);
  }

  /** Ids of the targets whose rect intersects a region — the lasso's hit test. */
  targetIdsIn(region: Rect): string[] {
    const out: string[] = [];
    for (const target of this.getTargets()) {
      const rect = safeCall(target.rect);
      if (rect && rectsIntersect(rect, region)) out.push(target.id);
    }
    return out;
  }

  /** The screen snapshot, trimmed to the byte budget. */
  snapshot(options?: { budget?: number; route?: string }): RegistrySnapshot {
    const route = options?.route ?? this.route;
    return fitSnapshot(
      buildSnapshot(this.getSurfaces(), route),
      options?.budget ?? SNAPSHOT_BYTE_BUDGET,
    );
  }

  /** Run one target action by name. Rejects rather than guessing when it does not exist. */
  async callAction(
    targetId: string,
    actionName: string,
    input: Record<string, unknown> = {},
  ): Promise<unknown> {
    const action = this.getTarget(targetId)?.actions?.find((a) => a.name === actionName);
    if (!action) throw new Error(`no action ${actionName} on target ${targetId}`);
    return await action.run(input);
  }

  /**
   * Every registered action in `navigator.modelContext` shape. Names are namespaced by target id
   * so they are unique across the page, which is exactly what the browser API will require.
   */
  toModelContextTools(): ModelContextTool[] {
    const tools: ModelContextTool[] = [];
    for (const surface of this.getSurfaces()) {
      for (const target of surface.targets) {
        for (const action of target.actions ?? []) {
          tools.push({
            name: `${target.id}.${action.name}`,
            description: `${action.description} (${target.label}, on ${surface.title})`,
            inputSchema: action.inputSchema,
            execute: async (input) => await action.run(input),
          });
        }
      }
    }
    return tools;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Bumped on every registration change and every re-measure, so consumers re-read rects. */
  getVersion(): number {
    return this.version;
  }

  /**
   * The page may have moved: tell every consumer the rects it holds are stale. Scroll and resize
   * call this on their own; the scroll hold calls it the instant it lets the page go, so ink that
   * landed while the page was held re-anchors on the same frame the hold ends.
   */
  remeasure(): void {
    this.bump();
  }

  /** Test seam: forget everything. */
  reset(): void {
    this.entries.clear();
    this.nextOrder = 0;
    this.route = undefined;
    this.stopLayoutWatch();
    this.bump();
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  // Targets are measured lazily through `rect()`, so a re-measure is simply a version bump that
  // tells every consumer the numbers it holds are stale. Scroll is throttled; resize rides a
  // ResizeObserver on the root and on every registered element.
  private ensureLayoutWatch(): void {
    if (this.detachLayout || typeof window === 'undefined') return;
    const onScroll = () => {
      if (this.scrollTimer !== null) return;
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null;
        this.bump();
      }, SCROLL_THROTTLE_MS);
    };
    const onResize = () => this.bump();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.bump());
      if (typeof document !== 'undefined' && document.documentElement) {
        this.resizeObserver.observe(document.documentElement);
      }
      for (const target of this.getTargets()) this.observeElements([target]);
    }
    // The instant the scroll hold lets go, re-anchor: a scroll the hold could not refuse (a
    // programmatic one, a finger that was already moving) may have moved the page under a stroke.
    const unhold = scrollHold.subscribe((held) => {
      if (!held) this.bump();
    });
    this.detachLayout = () => {
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onResize);
      unhold();
    };
  }

  private observeElements(targets: SurfaceTarget[]): void {
    const observer = this.resizeObserver;
    if (!observer) return;
    for (const target of targets) {
      const element = safeCall(target.element);
      if (element) observer.observe(element);
    }
  }

  private stopLayoutWatch(): void {
    if (this.scrollTimer !== null) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.detachLayout?.();
    this.detachLayout = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}

function safeCall<T>(fn: (() => T | null) | undefined): T | null {
  if (!fn) return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The one registry the app registers into. Wobo's screen sense is a single, shared sense. */
export const surfaceRegistry = new SurfaceRegistry();

// --- React hooks ---------------------------------------------------------------------------------

/** The identity of a surface for effect purposes — changes only when its shape genuinely changes. */
function surfaceKey(definition: SurfaceDefinition): string {
  return [
    definition.id,
    definition.title,
    definition.priority ?? 0,
    definition.targets.map((t) => `${t.id}:${t.kind}:${t.label}`).join(','),
  ].join('|');
}

/**
 * Register a screen for as long as the component is mounted. Inline closures are safe: the targets
 * are proxied through a ref, so a re-render never re-registers and the reads stay live.
 */
export function useSurface(
  definition: SurfaceDefinition,
  registry: SurfaceRegistry = surfaceRegistry,
): void {
  const latest = useRef(definition);
  latest.current = definition;
  const key = surfaceKey(definition);
  // The effect reads the definition through a ref on purpose, so inline closures never churn the
  // registry; only a genuine change of shape (ids, kinds, labels) re-registers the surface, and
  // `key` is exactly that change, expressed as a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the re-registration trigger
  useEffect(() => {
    const proxied = latest.current.targets.map((target, index) =>
      proxyTarget(target, () => latest.current.targets[index]),
    );
    return registry.registerSurface({
      id: latest.current.id,
      title: latest.current.title,
      description: latest.current.description,
      priority: latest.current.priority,
      targets: proxied,
    });
  }, [key, registry]);
}

/** Hold a target's identity steady while its closures stay live through the ref. */
function proxyTarget(initial: SurfaceTarget, read: () => SurfaceTarget | undefined): SurfaceTarget {
  const current = () => read() ?? initial;
  return {
    id: initial.id,
    kind: initial.kind,
    label: initial.label,
    description: initial.description,
    priority: initial.priority,
    rect: () => current().rect(),
    element: () => current().element?.() ?? null,
    value: initial.value ? () => current().value?.() : undefined,
    text: initial.text ? () => current().text?.() ?? '' : undefined,
    actions: initial.actions?.map((action) => ({
      name: action.name,
      description: action.description,
      inputSchema: action.inputSchema,
      run: (input) => {
        const live = current().actions?.find((a) => a.name === action.name);
        return (live ?? action).run(input);
      },
    })),
  };
}

export type UseTargetOptions = Omit<SurfaceTarget, 'rect' | 'element'> & {
  /** Override the measurement; by default the element's own bounding rect is used. */
  rect?: () => Rect | null;
};

/**
 * Attach one element to a surface as a semantic target. Put the returned ref on the element:
 *
 *   const ref = useTarget('home', { id: 'streak', kind: 'stat', label: 'the streak count' });
 *   return <div ref={ref}>7 days</div>;
 *
 * The element also carries `data-wobo-target`, so the gesture layer can resolve a pointer to it
 * without walking the whole registry.
 */
export function useTarget<T extends HTMLElement = HTMLElement>(
  surfaceId: string,
  options: UseTargetOptions,
  registry: SurfaceRegistry = surfaceRegistry,
): { current: T | null } {
  const ref = useRef<T | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { id, kind, label } = options;
  useEffect(() => {
    const element = ref.current;
    if (element) element.setAttribute('data-wobo-target', id);
    const unregister = registry.addTarget(surfaceId, {
      id,
      kind,
      label,
      get description() {
        return latest.current.description;
      },
      priority: latest.current.priority,
      rect: () => latest.current.rect?.() ?? ref.current?.getBoundingClientRect() ?? null,
      element: () => ref.current,
      value: () => latest.current.value?.(),
      text: () => latest.current.text?.() ?? ref.current?.textContent?.trim() ?? '',
      actions: latest.current.actions,
    });
    return () => {
      element?.removeAttribute('data-wobo-target');
      unregister();
    };
  }, [surfaceId, id, kind, label, registry]);
  return ref;
}

/** Re-renders whenever the registry changes or the page re-measures. */
export function useRegistryVersion(registry: SurfaceRegistry = surfaceRegistry): number {
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getVersion(),
    () => 0,
  );
}

// --- The dev inspector ---------------------------------------------------------------------------

/**
 * The inspector is off unless a developer turns it on: `localStorage['wobo-inspect'] = '1'`, or
 * `globalThis.__WOBO_INSPECT__ = true` from the console. It never ships on by accident.
 */
export function inspectorEnabled(): boolean {
  const flagged = (globalThis as { __WOBO_INSPECT__?: boolean }).__WOBO_INSPECT__;
  if (flagged === true) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('wobo-inspect') === '1';
  } catch {
    return false; // private mode — the inspector is a convenience, never a hard dependency
  }
}

/**
 * Outlines every registered target with its id, so QA can see exactly what Wobo can see. Purely
 * decorative and non-interactive: `pointer-events: none`, `aria-hidden`, no shadows, 3 px radius.
 */
export function RegistryInspector(props?: {
  enabled?: boolean;
  registry?: SurfaceRegistry;
}): ReactElement | null {
  const registry = props?.registry ?? surfaceRegistry;
  const version = useRegistryVersion(registry);
  const on = props?.enabled ?? inspectorEnabled();
  if (!on) return null;
  const boxes = registry
    .getTargets()
    .map((target) => ({ target, rect: safeCall(target.rect) }))
    .filter((entry): entry is { target: SurfaceTarget; rect: Rect } => entry.rect !== null);
  return createElement(
    'div',
    {
      key: version,
      'aria-hidden': true,
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        pointerEvents: 'none',
      } as const,
    },
    boxes.map(({ target, rect }) =>
      createElement(
        'div',
        {
          key: target.id,
          // The id on the node itself, so a QA pass can assert what Wobo can see rather than
          // counting rectangles in a screenshot.
          'data-wobo-inspect': target.id,
          style: {
            position: 'fixed',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '1px solid rgba(31,53,224,0.55)',
            borderRadius: 3,
            pointerEvents: 'none',
          } as const,
        },
        createElement(
          'span',
          {
            style: {
              position: 'absolute',
              top: -14,
              left: 0,
              font: '10px/12px ui-monospace, monospace',
              color: '#FFFFFF',
              background: '#1F35E0',
              padding: '1px 3px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
            } as const,
          },
          `${target.id} · ${target.kind}`,
        ),
      ),
    ),
  );
}
