'use client';

/**
 * The lesson arrival card's art — one drawing, from one hand.
 *
 * A course used to open on a generative lattice: a faint constellation of nodes wired to their
 * neighbours behind a washed sigil. It was a texture, not a picture, and it broke the law twice
 * over — hairline strokes under a pigment wash, and a visual vocabulary that appears nowhere else
 * in the product.
 *
 * What arrives now is what Fable drew on the subjects page (design/prototypes/site-subjects.html):
 * one object per subject, in 4px outlines on a tonal tile, with exactly one accent pigment in it.
 * The 3-4-5 triangle and its squares. The benzene ring. The river running to its port. A paragraph
 * with one phrase marked. The markup below is those four tiles, mark for mark, with the source's
 * two washes (the pigment square at .9, the highlighter at .6) taken out — DESIGN.md allows a tonal
 * surface or solid ink, never a shape wearing a wash.
 *
 * The drawing is decorative: the card names the course beside it, so nothing here is announced.
 */

import { useReducedMotion } from '@wobo/motion';
import { glassLabel } from '@wobo/wobo';
import { motion } from 'framer-motion';
import { chapterById, topicById } from '../curriculum/registry';
import { subjectFamily } from '../curriculum/subjects';

// --- The library ------------------------------------------------------------------------------

/** The four drawings. A subject family resolves onto one of them; nothing else is drawn. */
export type SubjectArtKey = 'mathematics' | 'science' | 'social' | 'english';

/** Ink is the drawing; accent is the drawing's one pigment; paper is a marked surface under it. */
type MarkInk = 'ink' | 'thin' | 'accent' | 'accent-thin';

/** What a mark IS, named so the glass map can hand it to Wobo as a part: "the right angle". */
type Named = { part?: string };

export type Mark =
  | ({ el: 'path'; ink: MarkInk; d: string } & Named)
  | ({ el: 'circle'; ink: MarkInk; cx: number; cy: number; r: number } & Named)
  | ({ el: 'dot'; cx: number; cy: number; r: number } & Named)
  | ({ el: 'mark'; x: number; y: number; w: number; h: number; rx: number } & Named)
  | ({
      el: 'text';
      ink: 'ink' | 'accent';
      x: number;
      y: number;
      size: number;
      text: string;
    } & Named);

export interface SubjectArt {
  /**
   * The subject's own wash, kept because the site tiles name it and a caller may still want a
   * subject's tint for a pill or a tick. LAW v5 (DESIGN.md §0): it is NOT the ground the drawing
   * sits on any more — a wash never paints a panel — and `CourseIntroScene` below draws on
   * `paper-2` in both themes.
   */
  tint: string;
  /** The one pigment in the drawing. */
  accent: string;
  /** The highlighter's pigment, where the drawing marks its paper. */
  marker: string;
  marks: Mark[];
}

/** Ink weights, in screen px: DESIGN.md — 4px outlines, and nothing thinner than 2.5. */
export const ART_INK = 4;
export const ART_THIN = 2.5;

/** The drawing's own frame. The site tiles let a label sit outside it; so does the card. */
export const ART_VIEWBOX = '0 0 200 150';

export const SUBJECT_ART: Record<SubjectArtKey, SubjectArt> = {
  // THE 3-4-5 TRIANGLE AND THE SQUARE ON ITS HYPOTENUSE, drawn to scale and inside the frame.
  //
  // The adversary, 2026-09-09, finding 13: this is the figure "circle the hypotenuse" correctly
  // rings, and it was not a right triangle a child could read. The square on the hypotenuse was
  // an OPEN four-sided path (no Z) and not square at all — 113 long by 67 wide, because its two
  // side vectors were (40,-54) where the perpendicular of the hypotenuse is (68,-90) — and two of
  // its corners sat above the frame at y = -2 and y = -38, so the top of it was simply cut off.
  //
  // Now: the right angle is at A(46,124), the legs are 60 across and 45 up (a 3-4-5 triangle,
  // hypotenuse 75), and the square is the real square on that hypotenuse — B(106,124),
  // B'(151,64), C'(91,19), C(46,79), closed — every corner inside the 200x150 frame.
  mathematics: {
    tint: 'var(--pig-w)',
    accent: 'var(--pig)',
    marker: 'var(--marigold)',
    marks: [
      { el: 'path', ink: 'ink', d: 'M46 124 L106 124 L46 79 Z', part: 'triangle' },
      // the corner mark sits IN the right angle, on both legs
      { el: 'path', ink: 'thin', d: 'M46 112 h12 v12', part: 'right angle' },
      {
        el: 'path',
        ink: 'accent',
        d: 'M106 124 L151 64 L91 19 L46 79 Z',
        part: 'square on the hypotenuse',
      },
      // c² sits in the middle of the square it names, not floating beside it
      { el: 'text', ink: 'accent', x: 86, y: 80, size: 22, text: 'c²', part: 'c²' },
    ],
  },
  // the benzene ring: the hexagon, and the ring of shared electrons inside it
  science: {
    tint: 'var(--mint-w)',
    accent: 'var(--mint)',
    marker: 'var(--marigold)',
    marks: [
      {
        el: 'path',
        ink: 'ink',
        d: 'M100 20 L152 50 L152 110 L100 140 L48 110 L48 50 Z',
        part: 'hexagon',
      },
      { el: 'circle', ink: 'accent-thin', cx: 100, cy: 80, r: 30, part: 'shared electrons' },
      { el: 'text', ink: 'ink', x: 160, y: 44, size: 20, text: 'C₆H₆', part: 'C₆H₆' },
    ],
  },
  // the river, the plateau above it, and the route that ends at the port
  social: {
    tint: 'var(--marigold-w)',
    accent: 'var(--pig)',
    marker: 'var(--marigold)',
    marks: [
      { el: 'path', ink: 'thin', d: 'M20 110 c30 -30 50 -10 80 -30 s50 -40 90 -30' },
      { el: 'path', ink: 'thin', d: 'M20 130 c40 -20 70 0 110 -20 s40 -30 60 -20' },
      { el: 'path', ink: 'accent', d: 'M60 40 c20 30 50 40 80 20' },
      { el: 'dot', cx: 140, cy: 60, r: 6 },
      { el: 'text', ink: 'ink', x: 30, y: 40, size: 18, text: 'river · plateau · port' },
    ],
  },
  // the paragraph, one phrase highlighted, and the note on what it is doing
  english: {
    tint: 'var(--lilac-w)',
    accent: 'var(--pig)',
    marker: 'var(--marigold)',
    marks: [
      // the highlighter goes on the paper first, so the lines it marks stay readable over it
      { el: 'mark', x: 60, y: 52, w: 70, h: 18, rx: 6 },
      { el: 'path', ink: 'thin', d: 'M24 40 h150 M24 62 h130 M24 84 h150 M24 106 h100' },
      { el: 'path', ink: 'accent', d: 'M120 96 c10 -14 30 -14 40 0' },
      { el: 'text', ink: 'accent', x: 130, y: 128, size: 18, text: 'metaphor' },
    ],
  },
};

/** Anything a framework calls a language subject reads as the marked-up paragraph. */
const LANGUAGE = /\b(english|language|literature|hindi|sanskrit|tamil|telugu|marathi|urdu)\b/i;

/** The drawing a subject opens on. An unrecognised subject opens on mathematics, as the hues do. */
export function artForSubject(subject: string): SubjectArtKey {
  if (LANGUAGE.test(subject)) return 'english';
  switch (subjectFamily(subject)) {
    case 'math':
    case 'cs':
      return 'mathematics';
    case 'physics':
    case 'chemistry':
    case 'biology':
    case 'science':
      return 'science';
    case 'social':
      return 'social';
    default:
      return 'mathematics';
  }
}

/** The drawing a topic opens on, resolved through its chapter's subject — as `hueForTopic` is. */
export function artForTopic(topicId: string): SubjectArtKey {
  const topic = topicById(topicId);
  const chapter = topic ? chapterById(topic.chapterId) : chapterById(topicId);
  return artForSubject(chapter?.subjectId ?? 'math');
}

// --- The drawing ------------------------------------------------------------------------------

const STROKE = { ink: ART_INK, thin: ART_THIN, accent: ART_INK, 'accent-thin': ART_THIN } as const;

/** The hand: a 0.9s draw-on per mark, in the order the marks are listed. Still when asked to be. */
function drawn(index: number, reduced: boolean) {
  if (reduced) return { initial: false as const, animate: { opacity: 1, pathLength: 1 } };
  return {
    initial: { opacity: 0, pathLength: 0 },
    animate: { opacity: 1, pathLength: 1 },
    transition: {
      pathLength: { duration: 0.9, delay: 0.1 + index * 0.22, ease: [0.2, 0, 0, 1] as const },
      opacity: { duration: 0.2, delay: 0.1 + index * 0.22 },
    },
  };
}

function Drawing({ art, reduced }: { art: SubjectArt; reduced: boolean }) {
  return (
    <svg
      viewBox={ART_VIEWBOX}
      role="presentation"
      aria-hidden
      style={{ width: '100%', height: 'auto', overflow: 'visible', display: 'block' }}
    >
      {art.marks.map((mark, i) => {
        const key = `${mark.el}-${i}`;
        const part = mark.part ? { 'data-glass-part': mark.part } : {};
        if (mark.el === 'mark') {
          return (
            <motion.rect
              key={key}
              {...part}
              x={mark.x}
              y={mark.y}
              width={mark.w}
              height={mark.h}
              rx={mark.rx}
              fill={art.marker}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.22 }}
            />
          );
        }
        if (mark.el === 'dot') {
          return (
            <motion.circle
              key={key}
              {...part}
              cx={mark.cx}
              cy={mark.cy}
              r={mark.r}
              fill={art.accent}
              initial={reduced ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 + i * 0.22 }}
              style={{ transformOrigin: `${mark.cx}px ${mark.cy}px` }}
            />
          );
        }
        if (mark.el === 'text') {
          return (
            <motion.text
              key={key}
              {...part}
              x={mark.x}
              y={mark.y}
              fontSize={mark.size}
              fill={mark.ink === 'accent' ? art.accent : 'var(--ink)'}
              fontFamily="var(--hand)"
              fontWeight={600}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 + i * 0.22 }}
            >
              {mark.text}
            </motion.text>
          );
        }
        const stroke = mark.ink.startsWith('accent') ? art.accent : 'var(--ink)';
        const common = {
          fill: 'none' as const,
          stroke,
          strokeWidth: STROKE[mark.ink],
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          vectorEffect: 'non-scaling-stroke' as const,
        };
        if (mark.el === 'circle') {
          return (
            <motion.circle
              key={key}
              {...part}
              cx={mark.cx}
              cy={mark.cy}
              r={mark.r}
              {...common}
              {...drawn(i, reduced)}
            />
          );
        }
        return <motion.path key={key} {...part} d={mark.d} {...common} {...drawn(i, reduced)} />;
      })}
    </svg>
  );
}

export interface CourseIntroSceneProps {
  topicId: string;
  /**
   * The subject's earned hue. Kept for callers: the drawing takes its one pigment from the subject
   * tile it was drawn on, not from a passed colour, so two courses in a subject open the same way.
   */
  hue?: string;
  /** Override the drawing — the subject the course belongs to, when the caller already knows it. */
  subject?: SubjectArtKey;
  minHeight?: number;
  /** Kept for callers; the drawing sizes itself to the card. */
  sigilSize?: number;
  bold?: boolean;
}

/**
 * The card a course opens on: the subject's drawing on the subject's tile, drawing itself once.
 * No Wobo lives here — the arrival card carries its own head, and one Wobo on screen is the law.
 */
export function CourseIntroScene({ topicId, subject, minHeight = 300 }: CourseIntroSceneProps) {
  const reduced = useReducedMotion();
  const key = subject ?? artForTopic(topicId);
  const art = SUBJECT_ART[key];

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      style={{
        width: '100%',
        minHeight,
        borderRadius: 24,
        // LAW v5 (DESIGN.md §0): the arrival card is a tonal surface, not a subject-coloured slab.
        // The subject still speaks — in `art.accent`, which is the ink the drawing is made of.
        background: 'var(--paper-2)',
        padding: 'var(--s3, 24px)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {/* The drawing is a figure on the glass map, its parts by name (the triangle, the right
          angle, the square on the hypotenuse), so "circle the hypotenuse" has a box to land on. */}
      <div
        style={{ width: '100%', maxWidth: 420 }}
        {...glassLabel('figure', undefined, `course-intro-${key}`)}
        data-glass-text={`the ${key} drawing`}
      >
        <Drawing art={art} reduced={reduced} />
      </div>
    </motion.div>
  );
}
