/**
 * The eight moves (docs/EMAILS-AND-ANIMATIONS.md §2, widened by §8).
 *
 * This table is NOT a second drawing of the orb. Every move is a sentence in the rig's own
 * vocabulary — an expression from `expressions.ts`, a behaviour from `behaviours.ts`, a scene from
 * `scenes.ts` — and the renderer plays it by handing those names to the real component in a real
 * browser (tools/orb/render.mjs). Three moves carry a PROP the rig has no opinion about (the dot
 * that orbits, the line the pen draws, the page that turns); those are defined once, here, and both
 * the GIF and the stylesheet are made from this one definition. That is rule 1 of the library.
 *
 * Each move also carries what it SAYS and where it is USED, because rule 5 is that a move is never
 * decoration: a move nobody can name a use for does not belong in the library.
 */

import type { WoboBehaviour } from '../../packages/wobo/src/body/behaviours.ts';
import type { WoboExpression } from '../../packages/wobo/src/body/expressions.ts';
import type { WoboScene } from '../../packages/wobo/src/body/scenes.ts';
import type { WoboTones } from '../../packages/wobo/src/identity.ts';

/** The GIF's square, in px. The design's number. */
export const ORB_SIZE = 480;

/**
 * The orb inside that square. The pen, the spark and the z's overflow the rig's own box on purpose,
 * and the drawn line and the turned page sit outside it too, so the square is bigger than the orb.
 */
export const RIG_SIZE = 360;

/** The design's ceiling, per GIF. */
export const MAX_GIF_BYTES = 600 * 1024;

/** The rig's own view box, read off the rendered orb; the head sits at its centre. */
export const VIEW_BOX = { x: 26, y: 17, size: 98 } as const;

/**
 * The square the props are drawn in: the stage, in the rig's own units. The stage is wider than
 * the rig box in the same proportion as 480 is to 360, and centred on the same point, so a prop
 * drawn here lands exactly where it would beside the orb.
 */
export const STAGE_VIEW_BOX = (() => {
  const size = (VIEW_BOX.size * ORB_SIZE) / RIG_SIZE;
  const grow = (size - VIEW_BOX.size) / 2;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    x: round(VIEW_BOX.x - grow),
    y: round(VIEW_BOX.y - grow),
    size: round(size),
  };
})();

/** A point in rig units as a percentage of the stage — what a transform origin needs. */
export function stagePercent(point: { x: number; y: number }): string {
  const pc = (v: number, from: number) => Math.round(((v - from) / STAGE_VIEW_BOX.size) * 1e6) / 1e4;
  return `${pc(point.x, STAGE_VIEW_BOX.x)}% ${pc(point.y, STAGE_VIEW_BOX.y)}%`;
}

/** One frame of a CSS or Web Animations keyframe list. Camel-cased, as the browser wants it. */
export interface OrbKeyframe {
  offset: number;
  transform?: string;
  opacity?: string;
  clipPath?: string;
  transformOrigin?: string;
}

export interface OrbProp {
  /** A page goes under the orb; a dot and a drawn line go over it. */
  layer: 'under' | 'over';
  /** The prop, drawn in the rig's own units, in the tones of whichever theme is asked for. */
  svg: (tones: WoboTones) => string;
  /** What the layer turns about, in the rig's own units. Its middle, if this is left out. */
  origin?: { x: number; y: number };
  /** Empty for a prop that only has to be there, like the page the leaf turns off. */
  keyframes: readonly OrbKeyframe[];
}

export interface OrbMove {
  /** What the move says, in the library's own words (§8's table). */
  says: string;
  /** Where it is used. Empty is not allowed: that would make it decoration. */
  usedBy: readonly string[];
  /** The face the rig wears for the body of the move. */
  mood: WoboExpression;
  /** The prop layers, if the move has any. Most moves are the orb and nothing else. */
  props?: readonly OrbProp[];
  /** A scene, when the rig already owns this piece of acting. */
  scene?: WoboScene;
  /** A behaviour, when the move is one body track rather than a scene. */
  behaviour?: WoboBehaviour;
  /** Where the orb looks, if the move needs a direction (reading looks down at the page). */
  gaze?: { x: number; y: number };
  /**
   * How the idle clock is handed in. 'awake' keeps the learner's last input at now, so the idle
   * scheduler never wanders off mid-move; 'dozing' hands in a clock an hour old, which is how the
   * z's are earned rather than drawn.
   */
  idle: 'awake' | 'dozing';
  /** Frames, and the milliseconds each one is on screen. A GIF counts in centiseconds. */
  frames: number;
  frameMs: number;
  /**
   * The frame at which the rig is told to go back to idle, so the move ends where it started and
   * the loop has no seam. Omitted for the two moves that ARE a state rather than a gesture.
   */
  restAt?: number;
}

const ink = (tones: WoboTones) => tones.body;
const pigment = (tones: WoboTones) => tones.eye;
const paper = (tones: WoboTones) => tones.visor;

/**
 * The dot that orbits while Wobo thinks. One dot, one circle, no caption: the never-narrate law
 * applies to motion as much as to words.
 */
const THINKING_DOT: OrbProp = {
  layer: 'over',
  svg: (tones) => `<circle cx="75" cy="18" r="4.2" fill="${pigment(tones)}"/>`,
  // The head's centre is the middle of the box, so the orbit needs no origin of its own. The dot
  // arrives and goes rather than appearing: the first frame of every move is the bare resting orb.
  keyframes: [
    { offset: 0, transform: 'rotate(0deg)', opacity: '0' },
    { offset: 0.08, opacity: '1' },
    { offset: 0.9, opacity: '1' },
    { offset: 1, transform: 'rotate(360deg)', opacity: '0' },
  ],
};

/** The line the pen draws. It grows from the tip, holds, and goes, so the move can loop. */
const DRAWN_LINE: OrbProp = {
  layer: 'over',
  svg: (tones) =>
    `<path d="M124 70 L139 44" fill="none" stroke="${pigment(tones)}" stroke-width="3.4" stroke-linecap="round"/>`,
  keyframes: [
    { offset: 0, clipPath: 'inset(0 100% 0 0)', opacity: '0' },
    { offset: 0.05, opacity: '1' },
    { offset: 0.62, clipPath: 'inset(0 0 0 0)' },
    { offset: 0.85, opacity: '1' },
    { offset: 1, clipPath: 'inset(0 0 0 0)', opacity: '0' },
  ],
};

/**
 * The page that turns under a doubt being read: the page itself, which only has to be there, and
 * the leaf, which turns off the spine and lies down on the other side. Two layers because a
 * background image cannot animate one group inside itself, and because that is what a page is.
 */
const PAGE: OrbProp = {
  layer: 'under',
  svg: (tones) =>
    `<rect x="50" y="113" width="50" height="17" rx="1.5" fill="${paper(tones)}" stroke="${ink(tones)}" stroke-width="0.6" stroke-opacity="0.5"/>` +
    `<line x1="55" y1="118" x2="70" y2="118" stroke="${ink(tones)}" stroke-width="0.8" stroke-opacity="0.3"/>` +
    `<line x1="55" y1="122" x2="67" y2="122" stroke="${ink(tones)}" stroke-width="0.8" stroke-opacity="0.3"/>`,
  keyframes: [
    { offset: 0, opacity: '0' },
    { offset: 0.08, opacity: '1' },
    { offset: 0.9, opacity: '1' },
    { offset: 1, opacity: '0' },
  ],
};

/** The leaf. It turns about the spine, which is the middle of the box and a little below it. */
const TURNING_LEAF: OrbProp = {
  layer: 'under',
  svg: (tones) =>
    `<rect x="75" y="113" width="25" height="17" rx="1.5" fill="${paper(tones)}" stroke="${ink(tones)}" stroke-width="0.6" stroke-opacity="0.5"/>` +
    `<line x1="80" y1="118" x2="95" y2="118" stroke="${ink(tones)}" stroke-width="0.8" stroke-opacity="0.35"/>` +
    `<line x1="80" y1="122" x2="92" y2="122" stroke="${ink(tones)}" stroke-width="0.8" stroke-opacity="0.35"/>`,
  // The spine: the middle of the page, where the leaf is hinged.
  origin: { x: 75, y: 121.5 },
  keyframes: [
    { offset: 0, transform: 'scaleX(1)', opacity: '0' },
    { offset: 0.08, transform: 'scaleX(1)', opacity: '1' },
    { offset: 0.55, transform: 'scaleX(-1)' },
    { offset: 0.8, transform: 'scaleX(-1)', opacity: '1' },
    // It goes while it is lying on the far side, so no leaf is ever seen sliding backwards.
    { offset: 1, transform: 'scaleX(-1)', opacity: '0' },
  ],
};

export const MOVES = {
  /**
   * The resting breath. Not the rig's `hover` scene (that is the cursor arriving) — the design's
   * name for Wobo simply being there, which the rig draws as a breath on `sin(t / 1200)`. The loop
   * is one whole breath, so there is no seam.
   */
  hover: {
    says: 'resting, present',
    usedBy: ['the docked orb', 'an idle screen', 'the quick one', 'the welcome mail'],
    mood: 'idle',
    idle: 'awake',
    frames: 94,
    frameMs: 80,
  },
  wave: {
    says: 'hello',
    usedBy: ['the welcome', 'the first sign-in', 'the welcome mail', 'the mid-chapter mail'],
    mood: 'idle',
    scene: 'wave',
    idle: 'awake',
    frames: 30,
    frameMs: 80,
  },
  bounce: {
    says: 'a small yes',
    usedBy: ['a streak', 'a card completed', 'a correct answer', 'the streak mail'],
    mood: 'happy',
    behaviour: 'bounce',
    idle: 'awake',
    frames: 15,
    frameMs: 80,
    restAt: 8,
  },
  /** The one spark, earned. The rig's own `gotIt`: the aha, a bounce, then the puff of pride. */
  spark: {
    says: 'earned',
    usedBy: ['a boss cleared', 'a badge', 'a level finished', 'the win mail', 'a bonus level'],
    mood: 'idle',
    scene: 'gotIt',
    idle: 'awake',
    frames: 30,
    frameMs: 80,
  },
  thinking: {
    says: 'working, not stuck',
    usedBy: ['any wait under about eight seconds', 'the board cold start'],
    mood: 'thinking',
    idle: 'awake',
    frames: 30,
    frameMs: 80,
    restAt: 26,
    props: [THINKING_DOT],
  },
  drawing: {
    says: 'making something',
    usedBy: ['a lesson composing', 'a film rendering', 'the doubt mail'],
    mood: 'drawing',
    idle: 'awake',
    frames: 30,
    frameMs: 80,
    restAt: 26,
    props: [DRAWN_LINE],
  },
  reading: {
    says: 'taking something in',
    usedBy: ['a photographed doubt being read', "the doubt's reading"],
    mood: 'focused',
    gaze: { x: 0, y: 1 },
    idle: 'awake',
    frames: 30,
    frameMs: 80,
    restAt: 26,
    props: [PAGE, TURNING_LEAF],
  },
  /**
   * In-app only, never in mail (§2). A slow breath on `sin(t / 1900)`, and the z's, which the rig
   * only floats once the idle clock says Wobo is properly dozing.
   */
  sleeping: {
    says: 'nothing here yet',
    usedBy: ['an empty trophy room', 'an empty archive', 'a quiet day'],
    mood: 'sleepy',
    idle: 'dozing',
    frames: 75,
    frameMs: 160,
  },
} as const satisfies Record<string, OrbMove>;

export type OrbMoveName = keyof typeof MOVES;

/** The design's order, which is the order the table is written in. */
export const MOVE_NAMES = Object.keys(MOVES) as OrbMoveName[];

/** The move, widened from the const table back to the interface. */
export function move(name: OrbMoveName): OrbMove {
  return MOVES[name];
}

export function moveDurationMs(name: OrbMoveName): number {
  return MOVES[name].frames * MOVES[name].frameMs;
}

/** The prop, wrapped in the stage's view box, as an SVG document ready to be a data URI. */
export function propSvg(prop: OrbProp, tones: WoboTones): string {
  const { x, y, size } = STAGE_VIEW_BOX;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}">` +
    `${prop.svg(tones)}</svg>`
  );
}

/** A data URI a stylesheet can carry. Only the characters that must be escaped are escaped. */
export function svgDataUri(svg: string): string {
  const escaped = svg
    .replace(/%/g, '%25')
    .replace(/"/g, "'")
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\n/g, '');
  return `data:image/svg+xml,${escaped}`;
}
