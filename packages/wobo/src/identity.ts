/**
 * Wobo's identity is LOCKED (DESIGN.md §4). This module encodes it so the lock is a fact in code,
 * not a note in a doc. Choreography is free (the Wobo-cute license) — identity is not.
 *
 * Wobo is the ink-visor wobot: a round body in ink carrying a paper visor, two Wobo-blue eyes and a
 * pen tip in the same blue, rimmed by a half-pixel hairline in the opposite tone so the silhouette
 * stays crisp over any ground. On night the tones swap — a paper body carrying a night visor.
 *
 * You MAY NOT change: Wobo's form (one round ink body with a visor), the visor, the two eyes, the
 * pen tip, the hairline rim, or the tones below. The old vocabulary is retired with palette v4
 * (DESIGN.md §2): no jelly, no squircle, no molten body, no flame beneath, and none of the warm
 * hexes that family was drawn in. That retirement is enforced by `identity.test.ts`, which reads
 * every source file under `packages/wobo/src` with its comments stripped, so the ban binds the code
 * while this paragraph stays free to name what it banned. ("Orb" survives — but only as the name
 * for docked Wobo, never as a body: DESIGN.md §4.)
 *
 * Wobo has no gender (WOBO-PLAN.md §19). Nothing here — no tone, no name, no pronoun — is allowed
 * to signal a boy or a girl, and the test below reads this file back to make sure none does.
 *
 * Everything below is frozen and asserted by tests.
 */

/** The four tones the rig renders Wobo in, for one theme. */
export interface WoboTones {
  /** Wobo's body — deep navy ink on white paper, the page's own ink on night. */
  body: string;
  /** The visor Wobo carries their eyes in — always the opposite tone to the body. */
  visor: string;
  /** Wobo's eyes and Wobo's pen tip. The one hit of pigment on Wobo. */
  eye: string;
  /** The half-pixel rim, in the opposite tone, that keeps Wobo legible over any content. */
  hairline: string;
}

/**
 * LAW v5 (DESIGN.md §0), which supersedes palette v4 on colour "everywhere: site, app, email,
 * prototype". Wobo's own body was the last cream left in the product and it is on every page: the
 * visor was `#FAF7F0` and the night body `#F3F0E8`, both drawn for the warm ground v5 replaced, so
 * a character painted for cream paper was floating on white.
 *
 * The form is untouched — one round ink body, a visor, two eyes, a pen tip, a hairline rim — and
 * those are still locked. What moved is only the four tones, onto v5's own paper: ink `#14142B`
 * carrying a white `#FFFFFF` visor in light, and on night the ink of the page `#F4F4F7` carrying a
 * `#0E0E16` visor. The rim keeps its job, the opposite tone at the same alpha. The eyes are Wobo
 * blue `#2B45FF`, lifting to `#7C8CFF` on night for contrast, as they always were.
 */
export const WOBO_TONES = Object.freeze({
  light: Object.freeze({
    body: '#14142B',
    visor: '#FFFFFF',
    eye: '#2B45FF',
    hairline: 'rgba(255,255,255,0.55)',
  }) as Readonly<WoboTones>,
  dark: Object.freeze({
    body: '#F4F4F7',
    visor: '#0E0E16',
    eye: '#7C8CFF',
    hairline: 'rgba(14,14,22,0.40)',
  }) as Readonly<WoboTones>,
});

/** Wobo blue — Wobo's pen and eyes, and the brand's one pigment (DESIGN.md §2). */
export const WOBO_BLUE = WOBO_TONES.light.eye;
/** Wobo blue lifted for night, so the eyes hold contrast on the dark ground. */
export const WOBO_BLUE_NIGHT = WOBO_TONES.dark.eye;

export const WOBO_IDENTITY = Object.freeze({
  form: 'ink_visor_wobot',
  surface: 'matte',
  /** The visor is part of the character, never a state a page can turn off. */
  visor: 'always',
  eyes: 2,
  /** Wobo draws; the pen tip is inked in Wobo blue, the same pigment as the eyes. */
  pen: 'always',
  /** The half-pixel opposite-tone rim — the one hairline that survives (DESIGN.md §4). */
  hairline: 'always',
  colorFamily: 'ink_visor',
  /** Wobo's one pigment, on paper. */
  color: WOBO_BLUE,
  tones: WOBO_TONES,
} as const);

/**
 * Wobo's mood — the page chooses it, and it drives Wobo's body language. This is the license
 * surface: pages pick the mood that fits the moment; Wobo's identity never changes with it.
 */
export type WoboMood =
  | 'idle' // present, gently breathing
  | 'thinking' // leaning toward the learner's working, pen tapping
  | 'listening' // leaning in, attentive
  | 'correct' // a small squish of approval
  | 'celebrate' // a celebratory bob on a mastered node
  | 'waiting' // quietly dimmed, holding still
  | 'hint' // a nudge toward what matters as a hint escalates
  | 'explaining' // gesturing toward what Wobo annotates (DESIGN.md §4)
  | 'resting' // a slow calm breath — sanctioned rest, never guilt (DESIGN.md §4)
  | 'oops'; // a sympathetic wince on a wrong answer — with them, never at them
