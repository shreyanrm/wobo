/**
 * THE CONSTELLATION'S GEOMETRY — the shape of a subject, composed rather than simulated.
 *
 * The twin that a bad commit deleted placed eight stars by hand, which was fine when the app knew
 * one board's class-8 maths and impossible now that it teaches whatever syllabus a learner brings
 * (the universal curriculum). So the layout is a rule instead of a drawing, and the rule is the
 * one a learner already carries in their head:
 *
 *   the centre     is the learner
 *   a wedge        is a subject
 *   a ring         is a chapter, further out the deeper into the subject it sits
 *   a star         is a topic, on its chapter's ring, in the board's own order
 *   a curve        is a prerequisite, bowed toward the centre so it reads as a relationship and
 *                  not as a wire
 *
 * Which means a learner can look at it and feel the shape of a subject: a wedge filling from the
 * inside out is a subject being learnt in order, a bright ring with dark ones outside it is a
 * chapter finished, and a lone lit star far out is somebody who read ahead.
 *
 * It is composed, deterministic and pure: same syllabus in, same sky out, every visit, no force
 * layout settling differently each time and nothing random. Unit-tested in `sky.test.ts`.
 */

import { scopedSession } from '../../store/scope';
import type { ProgressTopic, TopicState } from './evidence';

/**
 * The box the sky is drawn in. Everything below is in these units, so it scales at any width.
 *
 * It is WIDER than it is tall on purpose. The circle is sized from the height; the extra width is
 * the room the subject names need on the left and the right, and a name that has room is a name
 * that never pushes the page sideways (DESIGN.md §0, trap 4). The names themselves are HTML laid
 * over this box at a percentage of it, which is exact because the box's aspect ratio is fixed.
 */
export const SKY_W = 1240;
export const SKY_H = 720;
const CX = SKY_W / 2;
const CY = SKY_H / 2;
/**
 * The rings are ellipses, not circles: a screen is wider than it is tall, and a circle in a wide
 * box leaves two columns of nothing on either side of it while pushing the picture's own height
 * past what fits above the fold. Squashing the vertical axis fills the box the page actually has.
 */
const SQUASH = 0.72;
/** The innermost and outermost chapter rings. The names sit on a ring outside `R_OUT`. */
const R_IN = 150;
const R_OUT = 360;
const R_LABEL = 400;
const TAU = Math.PI * 2;

export interface SkyStar {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  chapterName: string;
  chapterIndex: number;
  state: TopicState;
  x: number;
  y: number;
  /** How big the core is drawn — a learnt star carries more light than one not started. */
  r: number;
}

export interface SkyEdge {
  id: string;
  fromId: string;
  toId: string;
  /** The bowed prerequisite curve, ready for a `<path d>`. */
  d: string;
  /** Both ends are behind the learner: the relationship is one they have actually walked. */
  lit: boolean;
  /** The subject the far end belongs to — a lit edge burns in the hue of what it unlocked. */
  subjectId: string;
}

export interface SkySubject {
  id: string;
  name: string;
  topics: number;
  learnt: number;
  /** Where the subject's name is set, and which way it reads away from the centre. */
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
  /** Baseline nudge so a name at the top or the bottom of the circle clears the stars under it. */
  dy: number;
}

export interface Sky {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** In syllabus order — subject, then chapter, then the board's own order inside the chapter. */
  stars: SkyStar[];
  edges: SkyEdge[];
  subjects: SkySubject[];
}

const CORE: Record<TopicState, number> = {
  learnt: 11,
  debt: 10,
  started: 10,
  untouched: 6,
};

/** Where a subject's name sits, and which way it reads, for a wedge centred on `mid`. */
function labelFor(mid: number): Pick<SkySubject, 'labelX' | 'labelY' | 'anchor' | 'dy'> {
  const cos = Math.cos(mid);
  const sin = Math.sin(mid);
  const anchor: SkySubject['anchor'] = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
  return {
    labelX: CX + cos * R_LABEL,
    labelY: CY + sin * R_LABEL * SQUASH,
    anchor,
    // a name directly above or below the circle needs its own baseline moved off the stars
    dy: anchor === 'middle' ? (sin > 0 ? 16 : -8) : 5,
  };
}

/**
 * A prerequisite, drawn as a quadratic bowed toward the centre.
 *
 * Both ends are pulled back off the star cores first, so a curve meets a star's edge rather than
 * spearing it, which is what lets a dense wedge stay readable.
 */
function bow(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const trim = Math.min(13, len / 3);
  const ux = (dx / len) * trim;
  const uy = (dy / len) * trim;
  const ax = x1 + ux;
  const ay = y1 + uy;
  const bx = x2 - ux;
  const by = y2 - uy;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // 22% of the way to the centre: enough for the curve to read as a relationship, not a slack wire
  const qx = mx + (CX - mx) * 0.22;
  const qy = my + (CY - my) * 0.22;
  const p = (n: number) => Math.round(n * 10) / 10;
  return `M${p(ax)} ${p(ay)} Q${p(qx)} ${p(qy)} ${p(bx)} ${p(by)}`;
}

/**
 * The sky for one learner's syllabus. An empty syllabus gives an empty sky, which the surface
 * draws as an empty state rather than as a starless void with a legend under it.
 */
export function buildSky(topics: readonly ProgressTopic[]): Sky {
  const empty: Sky = {
    width: SKY_W,
    height: SKY_H,
    cx: CX,
    cy: CY,
    stars: [],
    edges: [],
    subjects: [],
  };
  if (topics.length === 0) return empty;

  // subjects and their chapters, in the order the board itself puts them in
  const order: string[] = [];
  const bySubject = new Map<string, { name: string; chapters: string[]; rows: ProgressTopic[] }>();
  for (const t of topics) {
    let entry = bySubject.get(t.subjectId);
    if (!entry) {
      entry = { name: t.subjectName, chapters: [], rows: [] };
      bySubject.set(t.subjectId, entry);
      order.push(t.subjectId);
    }
    if (!entry.chapters.includes(t.chapterId)) entry.chapters.push(t.chapterId);
    entry.rows.push(t);
  }

  const n = order.length;
  const wedge = TAU / n;
  // One subject owns the whole circle and needs no gap; several are parted so the wedges read apart.
  const closed = n === 1;
  const pad = closed ? 0 : wedge * 0.1;
  const start = -Math.PI / 2;

  const stars: SkyStar[] = [];
  const subjects: SkySubject[] = [];

  order.forEach((subjectId, s) => {
    const entry = bySubject.get(subjectId);
    if (!entry) return;
    const a0 = start + s * wedge;
    const rings = entry.chapters.length;
    // topics of this subject, grouped by chapter, keeping the board's order inside each
    const byChapter = new Map<string, ProgressTopic[]>();
    for (const t of entry.rows) {
      const list = byChapter.get(t.chapterId) ?? [];
      list.push(t);
      byChapter.set(t.chapterId, list);
    }
    entry.chapters.forEach((chapterId, ring) => {
      const list = byChapter.get(chapterId) ?? [];
      const t = rings === 1 ? 0.5 : ring / (rings - 1);
      const radius = R_IN + t * (R_OUT - R_IN);
      // Every other ring is turned half a step. Without it a subject whose chapters hold the same
      // number of topics lines every one of them up into spokes, which reads as a fence rather than
      // as a constellation — and, for a lone subject holding the whole circle, collapses the sky
      // onto two radial lines.
      const turn = (ring % 2) * 0.5;
      list.forEach((topic, i) => {
        const k = list.length;
        const angle = closed
          ? a0 + ((i + turn) / k) * wedge
          : a0 + pad + ((i + 1 + turn) / (k + 1)) * (wedge - 2 * pad);
        // a small, fixed radial stagger so a long chapter is a constellation and not a fence
        const r = radius + ((i % 3) - 1) * 9;
        stars.push({
          id: topic.id,
          name: topic.name,
          subjectId: topic.subjectId,
          subjectName: topic.subjectName,
          chapterName: topic.chapterName,
          chapterIndex: topic.chapterIndex,
          state: topic.state,
          x: Math.round((CX + Math.cos(angle) * r) * 10) / 10,
          y: Math.round((CY + Math.sin(angle) * r * SQUASH) * 10) / 10,
          r: CORE[topic.state],
        });
      });
    });
    subjects.push({
      id: subjectId,
      name: entry.name,
      topics: entry.rows.length,
      learnt: entry.rows.filter((t) => t.state === 'learnt').length,
      ...labelFor(a0 + wedge / 2),
    });
  });

  const byId = new Map(stars.map((star) => [star.id, star]));
  const behind = new Set(topics.filter((t) => t.state === 'learnt').map((t) => t.id));
  const edges: SkyEdge[] = [];
  for (const topic of topics) {
    const to = byId.get(topic.id);
    if (!to) continue;
    for (const prereqId of topic.prereqTopicIds) {
      const from = byId.get(prereqId);
      if (!from) continue; // an edge to a topic that is not on this board says nothing we can draw
      edges.push({
        id: `${prereqId}->${topic.id}`,
        fromId: prereqId,
        toId: topic.id,
        d: bow(from.x, from.y, to.x, to.y),
        lit: behind.has(prereqId) && behind.has(topic.id),
        subjectId: to.subjectId,
      });
    }
  }

  return { width: SKY_W, height: SKY_H, cx: CX, cy: CY, stars, edges, subjects };
}

// --- the ignite replay ---------------------------------------------------------------------------

const SEEN_KEY = 'wobo-sky-seen-v1';

/**
 * Which stars have already had their moment this session.
 *
 * A star earned since the last visit catches light once, and then never again on a reload: the set
 * lives in sessionStorage, so it survives a navigation inside the app and resets with the tab. It
 * is keyed to the learner (store/scope.ts `scopedSession`): the stars are theirs, and so is
 * having seen them. Storage being unavailable simply means the light plays again next time, which
 * is the harmless side of the failure.
 */
export function readSeen(): ReadonlySet<string> {
  try {
    const raw = scopedSession.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(ids: Iterable<string>): void {
  // A refused write means the replay simply fires again next visit.
  scopedSession.setItem(SEEN_KEY, JSON.stringify([...ids]));
}

/** The stars that became the learner's since this session last looked. */
export function newlyLit(learntIds: ReadonlySet<string>, seen: ReadonlySet<string>): string[] {
  return [...learntIds].filter((id) => !seen.has(id));
}
