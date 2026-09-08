'use client';

/**
 * MapScene — the social-studies geography engine (SUBJECTS.md §5-social). One spec-driven component,
 * three interaction modes chosen by `interaction.mode`:
 *
 *   • label      — tap the named region ("tap Maharashtra"). Correct iff the tapped point falls
 *                  INSIDE that region's polygon, tested with d3.geoContains (true point-in-polygon on
 *                  the sphere — not a bounding box). A point in Gujarat is wrong for "tap Maharashtra".
 *   • locate     — place a city / river ("place Mumbai"). Correct iff the tap lands within a
 *                  tolerance (great-circle km via d3.geoDistance) of the authored coordinate.
 *   • choropleth — regions shaded by an authored value with a legend the learner READS; the task is
 *                  to tap the extreme (most / least). The answer is DERIVED from the values (argmax /
 *                  argmin), never separately authored, so it can never disagree with the shading.
 *
 * Geometry is BUNDLED (./geo/india-lite.json) — a deliberately simplified, recognizable set of 8
 * Indian states, hand-authored as clean non-overlapping polygons. Rendered to SVG with d3-geo
 * (geoMercator + geoPath). No MapLibre, no tiles, no API key: works offline, CSP-safe. topojson-client
 * decodes the bundle if it is ever shipped as a Topology (today it is a plain GeoJSON FeatureCollection).
 *
 * Registers as a Wobo scene target (kind 'region'): Wobo reads the mode/prompt/solved state
 * (getSceneState), knows the valid moves (getValidActions) and can DRIVE the map — highlight a named
 * state, reveal the answer (applyTutorAction). Reduced-motion + mute aware; both themes (land / water /
 * stroke bind to CSS vars + the passed hue); sentence-case copy.
 *
 * The parser mirrors the gateway's `plexus/map.py` gate exactly (one grammar, both ends): a malformed
 * spec returns null and is dropped silently — the card still teaches via its base kind.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { geoContains, geoDistance, geoMercator, geoPath } from 'd3-geo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { feature as topoFeature } from 'topojson-client';
import type { BarState } from '../screens/course/shared';
import {
  CardBody,
  captionSurface,
  cardTitle,
  lead,
  Stage,
  whisper,
} from '../screens/course/shared';
import { sfx } from '../ui/sound';
import rawGeo from './geo/india-lite.json';

// --- bundled geometry -----------------------------------------------------------------------------

/** A minimal GeoJSON polygon feature (the only shape india-lite ships). */
interface RegionFeature {
  type: 'Feature';
  properties: { id: string; name: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

/** Load the bundle once. Accept a plain FeatureCollection OR a TopoJSON Topology (decoded via
 * topojson-client) — so the same engine serves either representation without a code change. */
const REGIONS: RegionFeature[] = (() => {
  const g = rawGeo as unknown as Record<string, unknown>;
  if (g.type === 'Topology' && g.objects && typeof g.objects === 'object') {
    // ponytail: today the bundle is GeoJSON; this branch keeps a Topology bundle drop-in.
    const objects = g.objects as Record<string, unknown>;
    const first = Object.values(objects)[0];
    // biome-ignore lint/suspicious/noExplicitAny: topojson types are loose across versions
    const decoded = topoFeature(g as any, first as any) as any;
    const feats = decoded.type === 'FeatureCollection' ? decoded.features : [decoded];
    return feats as RegionFeature[];
  }
  return (g.features ?? []) as RegionFeature[];
})();

const REGION_BY_ID: ReadonlyMap<string, RegionFeature> = new Map(
  REGIONS.map((f) => [f.properties.id, f]),
);
/** The catalog of region ids a spec may reference (mirrors map.py's `_REGION_IDS`). */
export const MAP_REGION_IDS: ReadonlySet<string> = new Set(REGION_BY_ID.keys());

// --- the spec (discriminated by interaction.mode) -------------------------------------------------

export interface MapLabelInteraction {
  mode: 'label';
  prompt: string;
  /** The region the learner must tap (must be one of the shown regions). */
  targetId: string;
}
export interface MapLocateInteraction {
  mode: 'locate';
  prompt: string;
  /** Human label of the place (city / river) being placed, e.g. "Mumbai". */
  label: string;
  lon: number;
  lat: number;
  /** Acceptance radius in km (great-circle); default 150. */
  toleranceKm?: number;
  /** Optional: the region this place sits in — the gateway checks the pin actually falls there. */
  inRegionId?: string;
}
export interface MapChoroplethValue {
  id: string;
  value: number;
}
export interface MapChoroplethInteraction {
  mode: 'choropleth';
  prompt: string;
  /** Whether the learner hunts the maximum or the minimum value. */
  extreme: 'max' | 'min';
  unit?: string;
  values: MapChoroplethValue[];
}
export type MapInteraction = MapLabelInteraction | MapLocateInteraction | MapChoroplethInteraction;

export interface MapSpec {
  kind: 'map';
  id: string;
  title: string;
  caption?: string;
  /** Which region ids to draw (subset of MAP_REGION_IDS), 1..8, distinct. */
  regions: string[];
  interaction: MapInteraction;
}

// --- validation (mirrors plexus/map.py; a spec that cannot render/run is refused) ------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const INDIA_BBOX = { lonMin: 68, lonMax: 98, latMin: 6, latMax: 37 };
const inIndia = (lon: number, lat: number) =>
  lon >= INDIA_BBOX.lonMin &&
  lon <= INDIA_BBOX.lonMax &&
  lat >= INDIA_BBOX.latMin &&
  lat <= INDIA_BBOX.latMax;

function parseRegions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const r of raw) {
    if (!str(r) || !MAP_REGION_IDS.has(r) || out.includes(r)) continue;
    out.push(r);
  }
  return out.length >= 1 && out.length <= MAP_REGION_IDS.size ? out : null;
}

function parseInteraction(raw: unknown, regions: string[]): MapInteraction | null {
  if (!isRecord(raw) || !str(raw.prompt)) return null;
  const shown = new Set(regions);

  if (raw.mode === 'label') {
    if (!str(raw.targetId) || !shown.has(raw.targetId)) return null;
    return { mode: 'label', prompt: raw.prompt.trim(), targetId: raw.targetId };
  }

  if (raw.mode === 'locate') {
    if (!str(raw.label) || !num(raw.lon) || !num(raw.lat)) return null;
    if (!inIndia(raw.lon, raw.lat)) return null;
    const toleranceKm = num(raw.toleranceKm) && raw.toleranceKm > 0 ? raw.toleranceKm : 150;
    let inRegionId: string | undefined;
    if (str(raw.inRegionId)) {
      if (!shown.has(raw.inRegionId)) return null;
      // the pin must ACTUALLY fall inside the region it claims — same point-in-polygon truth as label
      const f = REGION_BY_ID.get(raw.inRegionId);
      if (!f || !geoContains(f as GeoPermissibleObjects, [raw.lon, raw.lat])) return null;
      inRegionId = raw.inRegionId;
    }
    return {
      mode: 'locate',
      prompt: raw.prompt.trim(),
      label: raw.label.trim(),
      lon: raw.lon,
      lat: raw.lat,
      toleranceKm,
      inRegionId,
    };
  }

  if (raw.mode === 'choropleth') {
    if (raw.extreme !== 'max' && raw.extreme !== 'min') return null;
    const values: MapChoroplethValue[] = [];
    const seen = new Set<string>();
    for (const v of Array.isArray(raw.values) ? raw.values : []) {
      if (!isRecord(v) || !str(v.id) || !shown.has(v.id) || seen.has(v.id) || !num(v.value))
        continue;
      seen.add(v.id);
      values.push({ id: v.id, value: v.value });
    }
    if (values.length < 2) return null;
    return {
      mode: 'choropleth',
      prompt: raw.prompt.trim(),
      extreme: raw.extreme,
      unit: str(raw.unit) ? raw.unit.trim() : undefined,
      values,
    };
  }

  return null;
}

/** Validate a generated MapScene spec — anything unrenderable/unrunnable is refused (client parity). */
export function parseMapScene(raw: unknown): MapSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (src.verified === false) return null; // gateway said no
  if (src.kind !== 'map') return null;
  const regions = parseRegions(src.regions);
  if (!regions) return null;
  const interaction = parseInteraction(src.interaction, regions);
  if (!interaction) return null;
  return {
    kind: 'map',
    id: str(src.id) ? src.id : 'map',
    title: str(src.title) ? src.title : 'the map',
    caption: str(src.caption) ? src.caption : undefined,
    regions,
    interaction,
  };
}

// --- correctness (the same math the gateway trusts; the flagship point-in-polygon lives here) ------

const EARTH_KM = 6371;

/** The correct region id for a choropleth task — argmax / argmin of the authored values. */
export function choroplethAnswer(it: MapChoroplethInteraction): string {
  let best = it.values[0] as MapChoroplethValue;
  for (const v of it.values) {
    if (it.extreme === 'max' ? v.value > best.value : v.value < best.value) best = v;
  }
  return best.id;
}

/** True iff a tap at [lon,lat] solves the task. Pure — extracted for the node self-check. */
export function isTapCorrect(spec: MapSpec, lonlat: [number, number]): boolean {
  const it = spec.interaction;
  if (it.mode === 'label') {
    const f = REGION_BY_ID.get(it.targetId);
    return !!f && geoContains(f as GeoPermissibleObjects, lonlat);
  }
  if (it.mode === 'locate') {
    return geoDistance(lonlat, [it.lon, it.lat]) * EARTH_KM <= (it.toleranceKm ?? 150);
  }
  const f = REGION_BY_ID.get(choroplethAnswer(it));
  return !!f && geoContains(f as GeoPermissibleObjects, lonlat);
}

/** Which shown region a tap fell inside (for feedback / highlight), or null for water/outside. */
function regionAt(regions: string[], lonlat: [number, number]): string | null {
  for (const id of regions) {
    const f = REGION_BY_ID.get(id);
    if (f && geoContains(f as GeoPermissibleObjects, lonlat)) return id;
  }
  return null;
}

// --- rendering ------------------------------------------------------------------------------------

const VB_W = 360;
const VB_H = 340;
const PAD = 22;

function MapSceneImpl({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: MapSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const reduced = useReducedMotion();
  const it = spec.interaction;
  const [solved, setSolved] = useState(false);
  const [touched, setTouched] = useState(false);
  const [wrongId, setWrongId] = useState<string | null>(null); // last wrong region (feedback flash)
  const [highlightId, setHighlightId] = useState<string | null>(null); // Wobo-driven highlight
  const [pin, setPin] = useState<[number, number] | null>(null); // locate: placed point (lon,lat)
  const svgRef = useRef<SVGSVGElement>(null);

  // projection fitted to exactly the shown regions
  const shownFc = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: spec.regions
        .map((id) => REGION_BY_ID.get(id))
        .filter((f): f is RegionFeature => !!f),
    }),
    [spec.regions],
  );
  const projection = useMemo(
    () =>
      geoMercator().fitExtent(
        [
          [PAD, PAD],
          [VB_W - PAD, VB_H - PAD],
        ],
        shownFc as GeoPermissibleObjects,
      ),
    [shownFc],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  // choropleth: normalized shading per region + the derived answer
  const choro = useMemo(() => {
    if (it.mode !== 'choropleth') return null;
    const vals = it.values.map((v) => v.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const byId = new Map(it.values.map((v) => [v.id, v.value]));
    return { lo, hi, span, byId, answer: choroplethAnswer(it) };
  }, [it]);

  const win = () => {
    if (solved) return;
    setSolved(true);
    setWrongId(null);
    sfx.bloom();
  };

  const handleTap = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (solved) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VB_W;
    const y = ((e.clientY - rect.top) / rect.height) * VB_H;
    const ll = projection.invert?.([x, y]);
    if (!ll) return;
    const lonlat: [number, number] = [ll[0], ll[1]];
    if (!touched) {
      setTouched(true);
      sfx.tap();
    }
    if (it.mode === 'locate') setPin(lonlat);
    if (isTapCorrect(spec, lonlat)) {
      win();
    } else {
      sfx.wrong();
      setWrongId(regionAt(spec.regions, lonlat));
    }
  };

  // continue unlocks on solve
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !solved, onClick: onDone } });
  }, [solved, setBar, onDone]);

  // clear the wrong-flash shortly after it shows
  useEffect(() => {
    if (!wrongId) return;
    const t = setTimeout(() => setWrongId(null), 700);
    return () => clearTimeout(t);
  }, [wrongId]);

  // Wobo seams — Wobo reads mode/prompt/solved and can highlight a named state or reveal the answer
  const answerId =
    it.mode === 'label' ? it.targetId : it.mode === 'choropleth' ? (choro?.answer ?? null) : null;
  const applyTutorAction = (patch: Record<string, unknown>) => {
    const set = isRecord(patch.set) ? patch.set : patch;
    if (str(set.highlight) && MAP_REGION_IDS.has(set.highlight)) {
      setHighlightId(set.highlight);
      return;
    }
    if (set.action === 'reveal') {
      if (answerId) setHighlightId(answerId);
      if (it.mode === 'locate') setPin([it.lon, it.lat]);
    }
  };
  const ref = useRegisterTarget<HTMLDivElement>(`map-${spec.id}`, {
    kind: 'region',
    label: `the map task "${spec.title}" — ${it.prompt}`,
    getSceneState: () => ({
      mode: it.mode,
      prompt: it.prompt,
      regionsShown: spec.regions.map((id) => REGION_BY_ID.get(id)?.properties.name ?? id),
      solved,
      highlighted: highlightId ? (REGION_BY_ID.get(highlightId)?.properties.name ?? null) : null,
    }),
    getValidActions: () => [
      ...spec.regions.map((id) => `highlight ${REGION_BY_ID.get(id)?.properties.name ?? id}`),
      'reveal the answer',
    ],
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `map-${spec.id}`,
      steps: [
        `task: ${it.prompt}`,
        `mode: ${it.mode}`,
        `states on the map: ${spec.regions
          .map((id) => REGION_BY_ID.get(id)?.properties.name ?? id)
          .join(', ')}`,
        solved ? 'solved — the learner found it' : 'not solved yet',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, it, spec.regions, solved]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  // per-region fill
  const fillFor = (id: string): string => {
    if (solved && id === answerId) return hue;
    if (highlightId === id) return hue;
    if (wrongId === id) return 'var(--wobo-feedback-wrongSoft, rgba(214,69,34,0.22))';
    if (choro) {
      const v = choro.byId.get(id);
      if (v === undefined) return 'var(--wobo-hairline-on-paper)';
      const t = (v - choro.lo) / choro.span; // 0..1
      return withAlpha(hue, 0.12 + t * 0.5);
    }
    return withAlpha(hue, 0.1);
  };

  const showNames = it.mode !== 'label' || solved; // label mode hides names until solved (the challenge)

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>{it.prompt}</div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage
          hue={hue}
          tint={0.04}
          minHeight={300}
          style={{ padding: 'clamp(10px, 2.4vw, 18px)' }}
        >
          <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              width="100%"
              style={{
                maxWidth: 460,
                touchAction: 'manipulation',
                cursor: solved ? 'default' : 'pointer',
              }}
              role="img"
              aria-label={`map — ${it.prompt}`}
              onPointerDown={handleTap}
            >
              {shownFc.features.map((f) => {
                const d = path(f as GeoPermissibleObjects) ?? '';
                const c = path.centroid(f as GeoPermissibleObjects);
                const id = f.properties.id;
                const active = (solved && id === answerId) || highlightId === id;
                return (
                  <g key={id}>
                    <motion.path
                      d={d}
                      animate={{ fill: fillFor(id) }}
                      transition={{ duration: reduced ? 0 : 0.35 }}
                      stroke="var(--wobo-ink-500)"
                      strokeWidth={active ? 1.6 : 0.9}
                      strokeLinejoin="round"
                    />
                    {showNames && Number.isFinite(c[0]) && (
                      <text
                        x={c[0]}
                        y={c[1]}
                        fontSize="8.5"
                        textAnchor="middle"
                        dominantBaseline="central"
                        pointerEvents="none"
                        fill={active ? 'var(--wobo-paper)' : 'var(--wobo-ink-900)'}
                        style={{ fontWeight: active ? 620 : 500 }}
                      >
                        {f.properties.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* locate: the placed pin + the authored target once solved */}
              {it.mode === 'locate' && pin && renderPin(projection, pin, 'var(--wobo-ink-900)')}
              {it.mode === 'locate' &&
                solved &&
                renderPin(projection, [it.lon, it.lat], hue, it.label)}
            </svg>
          </div>
        </Stage>

        {/* choropleth: the legend the learner reads */}
        {choro && (
          <div
            style={{
              border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={whisper}>
              shading shows {it.mode === 'choropleth' && it.unit ? it.unit : 'the value'} — darker
              is more
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--wobo-ink-500)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {choro.lo}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  borderRadius: 10,
                  background: `linear-gradient(90deg, ${withAlpha(hue, 0.12)}, ${withAlpha(hue, 0.62)})`,
                }}
              />
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--wobo-ink-500)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {choro.hi}
              </span>
            </div>
          </div>
        )}

        <AnimatePresence>
          {solved && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                border: '1px solid var(--wobo-feedback-correct)',
                background: 'var(--wobo-feedback-correctSoft)',
                borderRadius: 10,
                padding: '14px 16px',
                fontSize: '1rem',
                lineHeight: 1.6,
                color: 'var(--wobo-ink-900)',
              }}
            >
              {solvedLine(spec)}
            </motion.div>
          )}
        </AnimatePresence>
        {!solved && (
          <div
            style={{
              ...lead,
              ...captionSurface,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {spec.caption ?? hintLine(spec)}
          </div>
        )}
      </motion.div>
    </CardBody>
  );
}

/** A small map pin at a lon/lat, optionally labeled. */
function renderPin(
  projection: ReturnType<typeof geoMercator>,
  lonlat: [number, number],
  color: string,
  label?: string,
) {
  const p = projection(lonlat);
  if (!p) return null;
  const [x, y] = p;
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={4.5} fill={color} stroke="var(--wobo-paper)" strokeWidth={1.4} />
      {label && (
        <text
          x={x + 7}
          y={y - 6}
          fontSize="8.5"
          fill="var(--wobo-ink-900)"
          style={{ fontWeight: 600 }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function solvedLine(spec: MapSpec): string {
  const it = spec.interaction;
  if (it.mode === 'label')
    return `that is ${REGION_BY_ID.get(it.targetId)?.properties.name ?? 'it'} — you read the map by shape and place, not by a label.`;
  if (it.mode === 'locate') return `${it.label} sits right there. you placed it within range.`;
  const ans = REGION_BY_ID.get(choroplethAnswer(it))?.properties.name ?? 'that state';
  return `${ans} is the ${it.extreme === 'max' ? 'darkest' : 'lightest'} — the shading told you before you tapped.`;
}

function hintLine(spec: MapSpec): string {
  const it = spec.interaction;
  if (it.mode === 'label') return 'find it by its shape and where it sits — no labels to lean on.';
  if (it.mode === 'locate') return `tap where you think ${it.label} belongs on the map.`;
  return `read the legend, then tap the ${it.extreme === 'max' ? 'most' : 'least'}.`;
}

/** hue may be a CSS var (var(--x)) or a hex — for alpha fills fall back to color-mix for vars. */
function withAlpha(hue: string, a: number): string {
  if (hue.startsWith('#')) {
    const h = hue.slice(1);
    const n =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    const r = Number.parseInt(n.slice(0, 2), 16);
    const g = Number.parseInt(n.slice(2, 4), 16);
    const b = Number.parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // CSS var / named color — mix with transparent (supported in all target browsers)
  return `color-mix(in srgb, ${hue} ${Math.round(a * 100)}%, transparent)`;
}

export function MapScene(props: {
  spec: MapSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  return <MapSceneImpl {...props} />;
}

// --- hand-authored demos (each passes parseMapScene; the gallery bench renders them) ---------------

const ALL_STATES = [
  'rajasthan',
  'gujarat',
  'maharashtra',
  'madhya-pradesh',
  'uttar-pradesh',
  'karnataka',
  'kerala',
  'tamil-nadu',
];

export const MAP_LABEL_DEMO: MapSpec = {
  kind: 'map',
  id: 'demo-label-maharashtra',
  title: 'find the state',
  regions: ALL_STATES,
  interaction: { mode: 'label', prompt: 'tap Maharashtra', targetId: 'maharashtra' },
  caption: 'no labels — find Maharashtra by its shape and where it sits on the west coast.',
};

export const MAP_LOCATE_DEMO: MapSpec = {
  kind: 'map',
  id: 'demo-locate-mumbai',
  title: 'place the city',
  regions: ALL_STATES,
  interaction: {
    mode: 'locate',
    prompt: 'place Mumbai',
    label: 'Mumbai',
    // slightly inland of the true 72.87°E — the bundled coastline is deliberately simplified
    lon: 73.0,
    lat: 19.05,
    toleranceKm: 150,
    inRegionId: 'maharashtra',
  },
  caption: 'Mumbai is on the Arabian Sea coast. tap where you think it belongs.',
};

export const MAP_CHOROPLETH_DEMO: MapSpec = {
  kind: 'map',
  id: 'demo-choropleth-population',
  title: 'read the shading',
  regions: ['uttar-pradesh', 'maharashtra', 'gujarat', 'karnataka', 'tamil-nadu'],
  interaction: {
    mode: 'choropleth',
    prompt: 'tap the most populous state',
    extreme: 'max',
    unit: 'population (crore)',
    // rounded 2011-census-ish magnitudes — the shading, not these numbers, is what the learner reads
    values: [
      { id: 'uttar-pradesh', value: 20 },
      { id: 'maharashtra', value: 11 },
      { id: 'gujarat', value: 6 },
      { id: 'karnataka', value: 6 },
      { id: 'tamil-nadu', value: 7 },
    ],
  },
  caption: 'darker means more people. read the legend, then tap the darkest state.',
};

export const MAP_DEMOS: MapSpec[] = [MAP_LABEL_DEMO, MAP_LOCATE_DEMO, MAP_CHOROPLETH_DEMO];
