/**
 * Wobo design tokens — the locked source of truth (DESIGN.md §2).
 *
 * Black and white carry the entire interface. Colour appears only where it means something:
 * ultramarine is the signature pigment, reserved for brand and mastery — "ignite" at rest.
 * The accent family (molten, magenta, acid) appears rarely and with intent. One hit of
 * pigment per view; if two things are shouting, one is wrong.
 *
 * Depth is never a drop shadow. It is 0.5px hairlines, tonal surface steps, and frost on
 * overlays only. Corners are sharp: 3px default.
 */

// --- Ink on paper --------------------------------------------------------------------------------
export const ink = {
  900: '#0D0D10',
  800: '#1A1A1F',
  700: '#2E2E35',
  500: '#6E6E76',
  // 300 is the "whisper" caption used for real informational text, so it must clear WCAG AA
  // (4.5:1) on paper — #72727C is 4.76:1 on #FFFFFF, the faintest value that still passes.
  300: '#72727C',
  100: '#ECECEF',
} as const;

export const paper = '#FFFFFF';
export const canvas = '#FFFFFF';

/** Dark surfaces step tonally (no shadows) as small lightness steps. */
export const surface = {
  1: '#1A1A1F',
  2: '#222228',
  3: '#2A2A31',
  4: '#33333B',
} as const;

/** Hairline borders — 0.5px of depth without shadow. */
export const hairline = {
  onPaper: 'rgba(13,13,16,0.10)',
  onPaperStrong: 'rgba(13,13,16,0.18)',
  onDark: 'rgba(255,255,255,0.12)',
} as const;

// --- The signature pigment -----------------------------------------------------------------------
/** Ultramarine — reserved for brand and mastery. This is "ignite" at rest. */
export const ultramarine = '#1F35E0';

/** Ultramarine interaction shades — brand-and-mastery moments only, never generic chrome. */
export const ultramarineShades = {
  base: ultramarine,
  hover: '#1A2DC4',
  active: '#1526A6',
  soft: 'rgba(31,53,224,0.07)',
  wash: 'rgba(31,53,224,0.12)',
  ring: 'rgba(31,53,224,0.35)',
} as const;

// --- The accent family: rare, earned, with intent -------------------------------------------------
export const accent = {
  molten: '#FF5A1F',
  magenta: '#CC1E7A',
  acid: '#66B300',
} as const;

export type AccentName = keyof typeof accent;

/** Molten is Wobo's warmth — Wobo's glow, Wobo's celebratory pop. Reserved for Wobo alone. */
export const woboMolten = accent.molten;

/** Accents assignable to earned moments (molten excluded — it is Wobo's). */
export const subjectAccents = (Object.keys(accent) as AccentName[]).filter(
  (name): name is Exclude<AccentName, 'molten'> => name !== 'molten',
);

/**
 * Wobo's pointing ink — one pigment, no exceptions (DESIGN.md §2).
 *
 * When Wobo points at a region of the screen it is a 1.5px hand-wobbled ultramarine ring on the
 * target's box (3px corners) with at most a 4% ultramarine frost inside — never a warm wash. The
 * warm token that used to lead this palette is gone on purpose: there is no salmon left in the
 * tree for a mark to reach for. On dark surfaces the same pigment lifts to the dark ink value at
 * the identical opacities.
 */
export const woboHighlight = {
  /** Light surfaces: the signature pigment itself. */
  ink: ultramarine,
  /** Dark surfaces: the same pigment lifted off graphite. */
  inkDark: '#7B8CFF',
  /** The frost inside the ring — a hint of the box, never a fill. */
  frost: 'rgba(31,53,224,0.04)',
  frostDark: 'rgba(123,140,255,0.04)',
  /** The ceiling on that frost; the ring carries the meaning, not the fill. */
  frostAlpha: 0.04,
  /** A pen nib, held at a constant width whatever the target's size. */
  ringWidth: 1.5,
  /** Sharp corners (radius.sm), stated here so the overlay never guesses. */
  radius: 3,
  /** The ring draws itself on over this window. */
  drawMs: 320,
  /** ...and leaves this long after the turn ends. */
  fadeMs: 600,
} as const;

/** Molten interaction shades — Wobo's warmth family; Wobo's, not generic chrome. */
export const molten = {
  base: accent.molten,
  hover: '#F04A0E',
  active: '#D63E07',
  soft: 'rgba(255,90,31,0.08)',
  ring: 'rgba(255,90,31,0.35)',
} as const;

/** Feedback tints — quiet, structural, never shouting. */
export const feedback = {
  correct: '#2E7D32',
  correctSoft: 'rgba(46,125,50,0.08)',
  retry: '#B26A00',
  retrySoft: 'rgba(178,106,0,0.08)',
} as const;

// --- Chrome (second-cut neutrals) — the surface language most screens paint with -----------------
/**
 * The second-cut neutral palette (kit.tsx `surface`). Semantic roles, not raw greys, so a single
 * dark override (below) reskins the whole app. Light values are byte-identical to the old literals.
 */
export const chrome = {
  page: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#E9E9EE',
  cardHover: '#FCFCFE',
  tonal: '#F1F1F5',
  tonalHover: '#E8E8EE',
  ink: '#121316',
  /** Text/icon that sits ON an ink surface (inverts with it). */
  onInk: '#FFFFFF',
  inkHover: '#26272C',
  inkSoft: '#5C5E66',
  // inkFaint carries real informational text (captions, meta, hints), so it must clear WCAG AA
  // (4.5:1) on paper — it is the ink[300] whisper value, not a decorative grey.
  inkFaint: ink[300],
  faint: '#B9BBC6',
  /** Soft pointer spotlight on cards — a dark wash on paper, a light glow on graphite. */
  spotlight: 'rgba(18,19,22,0.05)',
  /** Wobo's light-beam beneath Wobo (grounding glow); dimmed on graphite so it never over-blooms. */
  woboBeam:
    'linear-gradient(to bottom, rgba(255,133,71,0.42), rgba(255,90,31,0.16) 55%, rgba(255,90,31,0) 88%)',
  woboBeamPool: 'radial-gradient(ellipse at center, rgba(255,90,31,0.3), rgba(255,90,31,0) 70%)',
} as const;

/**
 * Dark theme — subtle graphite, never black (Fable's spec). Keyed by the full `--wobo-*` var name;
 * `[data-theme="dark"]` on the document root swaps these in. Only theme-sensitive tokens appear:
 * neutrals flip, ultramarine lightens for contrast, feedback hues brighten, frost inverts.
 * Wobo's molten body and the decorative subject hues are deliberately absent — they glow on graphite.
 */
export const dark: Record<string, string> = {
  // chrome neutrals
  '--wobo-page': '#17181C',
  '--wobo-card': '#1F2026',
  '--wobo-card-border': '#2A2B32',
  '--wobo-card-hover': '#24252C',
  '--wobo-tonal': '#24252C',
  '--wobo-tonal-hover': '#2E2F37',
  '--wobo-ink': '#F2F2F5',
  '--wobo-on-ink': '#17181C',
  '--wobo-ink-hover': '#E4E5EA',
  '--wobo-ink-soft': '#B4B6BF',
  // AA on graphite — the same whisper value as --wobo-ink-300 below (4.97:1 on #17181C).
  '--wobo-ink-faint': '#868790',
  '--wobo-faint': '#585A63',
  // token ink scale (inverts: darkest → lightest)
  '--wobo-ink-900': '#F2F2F5',
  '--wobo-ink-800': '#E4E5EA',
  '--wobo-ink-700': '#C7C9D1',
  '--wobo-ink-500': '#9A9DA8',
  '--wobo-ink-300': '#868790', // AA on dark paper: 4.97:1 on #17181C (whisper caption; real text)
  '--wobo-ink-100': '#26272E',
  '--wobo-paper': '#17181C',
  '--wobo-canvas': '#17181C',
  // hairlines invert to light-on-dark
  '--wobo-hairline-on-paper': 'rgba(255,255,255,0.09)',
  '--wobo-hairline-on-paper-strong': 'rgba(255,255,255,0.16)',
  // ultramarine lightens for contrast on graphite
  '--wobo-ultramarine': '#4D63F2',
  '--wobo-ultramarine-base': '#4D63F2',
  '--wobo-ultramarine-hover': '#6579F5',
  '--wobo-ultramarine-active': '#3D52E0',
  '--wobo-ultramarine-soft': 'rgba(77,99,242,0.14)',
  '--wobo-ultramarine-wash': 'rgba(77,99,242,0.20)',
  '--wobo-ultramarine-ring': 'rgba(77,99,242,0.5)',
  // Wobo's pointing ink lifts to the dark-ink ultramarine at the identical opacities
  '--wobo-highlight-ink': woboHighlight.inkDark,
  '--wobo-highlight-frost': woboHighlight.frostDark,
  // feedback hues brighten just enough to pass contrast
  '--wobo-feedback-correct': '#4CAF50',
  '--wobo-feedback-correctSoft': 'rgba(76,175,80,0.16)',
  '--wobo-feedback-retry': '#E0982E',
  '--wobo-feedback-retrySoft': 'rgba(224,152,46,0.16)',
  // frost inverts to a dark graphite glass
  '--wobo-frost-on-paper': 'rgba(23,24,28,0.62)',
  '--wobo-spotlight': 'rgba(255,255,255,0.05)',
};

// --- Shape: sharp corners, 3px default ------------------------------------------------------------
export const radius = {
  sm: 3,
  md: 6,
  lg: 10,
  /** Wobo's round jelly. */
  jelly: 9999,
  /** Frosted overlays (Wobo's panel, sheets). */
  panel: 14,
} as const;

// --- Frost (backdrop blur) — overlays ONLY --------------------------------------------------------
export const frost = {
  blur: '20px',
  onPaper: 'rgba(255,255,255,0.78)',
  onDark: 'rgba(18,18,22,0.66)',
} as const;

// --- Spacing: generous, 8px base grid (4px half-step). The screen breathes. -----------------------
export const space = {
  0: 0,
  half: 4,
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  6: 48,
  8: 64,
  12: 96,
  16: 128,
} as const;

// --- Type: Google Sans Flex for all product UI. Caveat only as Wobo's sparse hand. ---------------
/**
 * The stacks. Google Sans Flex leads (DECISIONS.md: drop the licensed file into
 * `apps/web-pwa/public/fonts/` and it activates with no code change); until then the bundled
 * @fontsource-variable faces carry it — `… Variable` is the family name a variable @fontsource
 * package registers, with the static family kept after it so an already-installed system copy
 * still resolves. Every face is served from our own origin; nothing here reaches a font CDN.
 */
export const fontFamily = {
  display:
    "'Google Sans Flex', 'Google Sans Text', 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, sans-serif",
  system:
    "'Google Sans Flex', 'Google Sans Text', 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, sans-serif",
  handwritten: "'Caveat Variable', 'Caveat', cursive",
} as const;

/** Fluid type scale (clamp). Sentence case everywhere; generous line-height. */
export const typeScale = {
  display: { size: 'clamp(2.5rem, 1.8rem + 3.5vw, 4rem)', lineHeight: 1.05, weight: 600 },
  h1: { size: 'clamp(2rem, 1.5rem + 2.5vw, 3rem)', lineHeight: 1.1, weight: 600 },
  h2: { size: 'clamp(1.5rem, 1.2rem + 1.5vw, 2rem)', lineHeight: 1.15, weight: 600 },
  h3: { size: 'clamp(1.25rem, 1.1rem + 0.8vw, 1.5rem)', lineHeight: 1.2, weight: 500 },
  bodyLg: { size: 'clamp(1.05rem, 1rem + 0.3vw, 1.25rem)', lineHeight: 1.6, weight: 400 },
  body: { size: '1rem', lineHeight: 1.6, weight: 400 },
  caption: { size: '0.85rem', lineHeight: 1.4, weight: 400 },
} as const;

// --- Motion: GPU-friendly, always meaningful. Timing + easing tokens (full library in /motion) ----
export const duration = {
  micro: 160,
  standard: 300,
  signature: 750,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.2, 0, 0, 1.1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

// --- Z-index ------------------------------------------------------------------------------------
export const zIndex = {
  base: 0,
  canvas: 10,
  woboPresence: 800,
  panel: 900,
  /**
   * Wobo's ink on the screen: above the companion panel, so a ring on the page is never drawn
   * under the chat (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace), below a modal.
   */
  ink: 950,
  modal: 1000,
  toast: 1100,
} as const;

/** The complete token tree, for non-CSS consumers (React Native, tests). */
export const tokens = {
  ink,
  paper,
  canvas,
  chrome,
  dark,
  surface,
  hairline,
  ultramarine,
  ultramarineShades,
  accent,
  woboMolten,
  subjectAccents,
  woboHighlight,
  molten,
  feedback,
  radius,
  frost,
  space,
  fontFamily,
  typeScale,
  duration,
  easing,
  zIndex,
} as const;

export type Tokens = typeof tokens;
