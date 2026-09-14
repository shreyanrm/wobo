/**
 * Subject hue families (owner directive) — pigment for EARNED moments only: sigils, ticks,
 * ignites, and blooms take the owning subject's hue. Chrome never does.
 *
 * Every value here is a palette v4 token, never a hex. Palette v4 designs night on its own rather
 * than inverting light (DESIGN.md §2), so a JS colour constant is a light-theme colour shipped
 * into both themes — which is what these were. Handing the DOM `var(--pig)` lets the document's
 * own `data-theme` stamp resolve it, in a stylesheet, once, for both. The one place a variable
 * cannot go is a `<canvas>`, and `resolvedColor` below reads the live value for exactly that.
 */

import { chapterById, topicById } from '../curriculum/registry';
import { canonicalSubjectId } from '../curriculum/subjects';

export interface SubjectTone {
  hue: string;
  wash: string;
}

/**
 * The six families on the six pigments, each with its wash. Maths keeps Wobo blue; the rest sit
 * where their old hue sat on the wheel — violet for physics, mint for biology, coral for computing,
 * marigold for the social sciences — and chemistry takes the remaining pigment, lilac.
 */
export const SUBJECT_HUES: Record<string, SubjectTone> = {
  math: { hue: 'var(--pig)', wash: 'var(--pig-w)' },
  physics: { hue: 'var(--violet)', wash: 'var(--violet-w)' },
  chemistry: { hue: 'var(--lilac)', wash: 'var(--lilac-w)' },
  biology: { hue: 'var(--mint)', wash: 'var(--mint-w)' },
  cs: { hue: 'var(--rose)', wash: 'var(--rose-w)' },
  social: { hue: 'var(--marigold)', wash: 'var(--marigold-w)' },
  // ponytail: presentation alias — the clubbed "Science" door (and legacy ids) reads chemistry's
  science: { hue: 'var(--lilac)', wash: 'var(--lilac-w)' },
};

export function toneForSubject(subjectId: string): SubjectTone {
  // A board's own subject id (physical_science, computer, history_civics…) resolves to its canonical
  // family's hue — pigment stays consistent whatever the board calls the subject.
  return (
    SUBJECT_HUES[subjectId] ??
    SUBJECT_HUES[canonicalSubjectId(subjectId)] ??
    (SUBJECT_HUES.math as SubjectTone)
  );
}

/**
 * The family a topic belongs to — resolved through its chapter's subject, and canonical, so a
 * board's own name for a subject (`physical_science`, `history_civics`) lands on the same family
 * its pigment does. The waiting scenes are keyed off this (`@wobo/wobo`'s `waitSceneFor`): the orb
 * draws a number line for maths and a pendulum for physics because of what this returns.
 */
export function subjectForTopic(topicId: string): string {
  const chapter = topicById(topicId)
    ? chapterById(topicById(topicId)?.chapterId ?? '')
    : chapterById(topicId);
  return canonicalSubjectId(chapter?.subjectId ?? 'math');
}

/** The earned hue for a topic — resolved through its chapter's subject. */
export function hueForTopic(topicId: string): string {
  return toneForSubject(subjectForTopic(topicId)).hue;
}

/**
 * A concrete colour for the one consumer that cannot take a CSS variable: a `<canvas>`, which
 * takes a colour STRING and silently keeps the last one it understood when handed `var(--pig)`.
 * Everything else — the DOM, SVG presentation attributes, gradients — takes the variable itself
 * and resolves per theme for free, so this is deliberately narrow.
 */
export function resolvedColor(value: string, fallback = '#2B45FF'): string {
  const name = /^var\(\s*(--[\w-]+)/.exec(value.trim())?.[1];
  if (!name) return value;
  if (typeof document === 'undefined') return fallback;
  const live = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return live || fallback;
}
