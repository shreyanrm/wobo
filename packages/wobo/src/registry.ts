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
 * What the brain is told about the screen is no longer read from here: the glass map
 * (`glass/`) reads every rendered line and element straight off the page, and a registration is a
 * label on it, never a precondition (docs/INK-FREEZE-PLAN-TRACE.md §3). The registry keeps what
 * only a component can say: a live rect for a thing with no element of its own (a photo's lines,
 * a paused frame's parts), a scene's state, and the actions Wobo may run on it.
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

// --- Clamps (a scene value that rides the packet is never allowed to dominate it) ----------------

/** Field clamps for a value read off a target. */
const CLAMP = { value: 80 } as const;

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

/** UTF-8 byte length of a string — what the budget is actually measured in. */
export function byteLength(text: string): number {
  if (encoder) return encoder.encode(text).length;
  // No TextEncoder (an exotic runtime): assume the worst case rather than under-count.
  return text.length * 4;
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

/**
 * The glass read the registry lends out as the page's own targets (docs/INK-FREEZE-PLAN-TRACE.md
 * §3, §4): every entry on the map, with its live measure and its element. The registry keeps by
 * hand only what has no element of its own (a photo's lines, a paused frame's parts, the plane);
 * everything else is read off the page, so nothing has to register to be pointed at.
 */
export interface GlassSource {
  map: { entries: readonly { id: string; role: string; text: string; meaning?: string }[] };
  rectOf(id: string): readonly [number, number, number, number] | null;
  elementOf(id: string): Element | null;
}

/** The id of the surface the glass is lent under. Never registered by hand. */
export const GLASS_SURFACE_ID = 'glass';

export class SurfaceRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private nextOrder = 0;
  private version = 0;
  private route: string | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private detachLayout: (() => void) | null = null;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private glass: (() => GlassSource | null) | null = null;

  /**
   * Read the page's targets off the glass from now on. The source is a getter, because the read
   * is replaced on every turn and the registry must always lend the current one; pass null to
   * stop (a test seam).
   */
  readGlass(source: (() => GlassSource | null) | null): void {
    this.glass = source;
    this.bump();
  }

  /** The glass as a surface: an entry is a target whose kind is its role and whose label is its words. */
  private glassSurface(): ResolvedSurface | null {
    const read = this.glass?.();
    if (!read) return null;
    const targets: SurfaceTarget[] = read.map.entries.map((entry) => ({
      id: entry.id,
      kind: entry.role,
      label: entry.text,
      ...(entry.meaning ? { description: entry.meaning } : {}),
      rect: () => {
        const box = read.rectOf(entry.id);
        return box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : null;
      },
      element: () => read.elementOf(entry.id),
      text: () => entry.text,
    }));
    return { id: GLASS_SURFACE_ID, title: 'what is on the glass', priority: -1, targets };
  }

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

  /** Every registered surface, ordered by priority then registration, then the glass. */
  getSurfaces(): ResolvedSurface[] {
    const own = this.ownSurfaces();
    const glass = this.glassSurface();
    return glass ? [...own, glass] : own;
  }

  /**
   * Only what was registered by hand, in order. Never asks the glass: a reader takes these as
   * its `registered` while it reads, and a source that reads on demand would read again.
   */
  private ownSurfaces(): ResolvedSurface[] {
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

  /** Every target, registered by hand or read off the glass, in snapshot order. */
  getTargets(): SurfaceTarget[] {
    return this.getSurfaces().flatMap((s) => s.targets);
  }

  /** Only what was registered by hand: what a glass reader is lent, never the glass itself. */
  ownTargets(): SurfaceTarget[] {
    return this.ownSurfaces().flatMap((s) => s.targets);
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
    this.glass = null;
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
