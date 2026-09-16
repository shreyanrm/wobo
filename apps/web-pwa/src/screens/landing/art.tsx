'use client';

/**
 * Every drawn thing on the landing page, in one hand.
 *
 * These are PORTS. The geometry, the gradients, the stroke weights and the ids are
 * `design/prototypes/landing-v8.html`'s, unchanged — the engine finds `#d-leaf`, `#lasso`, `#proj`,
 * `#bars` and `#ring` by those exact names, so renaming one here silently deletes a piece of
 * motion. What the JSX adds is only what JSX requires: camel-cased attribute names, and a `<title>`
 * on every drawing that carries meaning (the decorative ones are `aria-hidden`).
 *
 * Wobo is the HEAD ONLY on this page (DESIGN.md §4): a round head, a pill visor, two eyes with
 * catchlights. Never a body, never a gender.
 */

import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from './wordmark';

/**
 * The document-level defs: the owner's wordmark, Wobo's head as a reusable symbol, and the two
 * gradients it is shaded with. Rendered once, at the top of the page, in a zero-sized SVG.
 */
export function LandingDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <radialGradient id="hg" cx="36%" cy="30%" r="78%">
          <stop offset="0" style={{ stopColor: 'var(--body-hi)' }} />
          <stop offset="1" style={{ stopColor: 'var(--body)' }} />
        </radialGradient>
        <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--visor)' }} />
          <stop offset="1" style={{ stopColor: 'var(--visor-lo)' }} />
        </linearGradient>
        <symbol id="head" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="url(#hg)" />
          <rect x="18" y="41" width="84" height="38" rx="19" fill="url(#vg)" />
          <g className="blink">
            <circle cx="43" cy="61" r="9" fill="var(--eye)" />
            <circle cx="77" cy="61" r="9" fill="var(--eye)" />
            <circle cx="40" cy="58" r="3" fill="var(--paper)" opacity=".9" />
            <circle cx="74" cy="58" r="3" fill="var(--paper)" opacity=".9" />
          </g>
        </symbol>
        <symbol id="wm" viewBox={WORDMARK_VIEWBOX}>
          {/* `currentColor`, so the header and the footer tint the mark with their own `color`
              rather than each hard-coding the ink. Keyed by position, not by outline: the mark has
              two o's whose outlines are the same path, and a content key would drop one of them. */}
          <g fill="currentColor">
            {WORDMARK_PATHS.map((glyph, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed glyphs, in a fixed order
              <path key={i} transform={glyph.transform} d={glyph.d} />
            ))}
          </g>
        </symbol>
      </defs>
    </svg>
  );
}

/** The owner's wordmark. The stylesheet gives it its ink tone. */
export function Wordmark() {
  return (
    <svg viewBox="0 0 1160 340" aria-hidden="true">
      <use href="#wm" />
    </svg>
  );
}

/** Wobo's head, at whatever size the surface asks for. */
export function WoboHead({ size, className }: { size: number | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Wobo"
    >
      <title>Wobo</title>
      <use href="#head" />
    </svg>
  );
}

// --- The hero card's four answers ---------------------------------------------------------------

/**
 * The drawn answer. Every id here is read by the hero timeline (`engine/motion.ts`): the leaf and
 * its vein draw themselves, the rays and the first label arrive, the mint arrow carries the sugar
 * out, and the caption lands last.
 */
export function HeroDrawn({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label={label}>
      <title>{label}</title>
      <path
        className="ink draw"
        id="d-leaf"
        d="M170 250 C170 170 240 120 320 118 C320 200 258 254 176 254 Z"
      />
      <path className="ink thin draw" id="d-vein" d="M176 252 C230 220 280 176 318 122" />
      <g id="d-rays" opacity="0">
        <path className="ink pig" d="M120 60 l34 44" />
        <path className="ink pig" d="M180 46 l20 52" />
        <path className="ink pig" d="M244 44 l4 54" />
      </g>
      <text className="hw pig" id="d-lbl1" x="330" y="90" fontSize="26" opacity="0">
        light in
      </text>
      <path className="ink mint draw" id="d-arrow" d="M300 250 C350 250 360 220 396 214" />
      <path className="ink mint" id="d-head" d="M386 206 l12 8 l-12 8" opacity="0" />
      <text className="hw" id="d-lbl2" x="330" y="300" fontSize="24" opacity="0">
        sugar out
      </text>
      <text className="hw dim" id="d-cap" x="60" y="340" fontSize="20" opacity="0">
        light + water + air → food the plant can use
      </text>
    </svg>
  );
}

export function HeroFilmed({ label, caption }: { label: string; caption: string }) {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="60" y="50" width="400" height="230" rx="14" fill="var(--paper)" />
      <circle cx="150" cy="150" r="40" fill="var(--mint)" opacity=".18" />
      <circle cx="150" cy="150" r="26" fill="var(--mint)" opacity=".35" />
      <path className="ink" d="M300 200 C300 150 340 120 390 120" />
      <circle cx="390" cy="120" r="16" fill="var(--marigold)" />
      <path className="ink thin" d="M120 250 h280" />
      <rect x="60" y="296" width="400" height="8" rx="4" fill="var(--paper-3)" />
      <rect x="60" y="296" width="180" height="8" rx="4" fill="var(--marigold)" />
      <text className="hw dim" x="60" y="340" fontSize="20">
        {caption}
      </text>
    </svg>
  );
}

export function HeroTried({
  label,
  copy,
}: {
  label: string;
  copy: { question: string; right: string; wrong: string; verdict: string; caption: string };
}) {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="110" y="60" width="300" height="180" rx="16" fill="var(--paper)" />
      <text className="hw" x="140" y="110" fontSize="24">
        {copy.question}
      </text>
      <rect x="140" y="130" width="110" height="44" rx="12" fill="var(--pig)" />
      <text x="195" y="158" textAnchor="middle" fontFamily="Poppins" fontSize="15" fill="#fff">
        {copy.right}
      </text>
      <rect x="266" y="130" width="110" height="44" rx="12" fill="var(--paper-3)" />
      <text
        x="321"
        y="158"
        textAnchor="middle"
        fontFamily="Poppins"
        fontSize="15"
        fill="var(--ink-2)"
      >
        {copy.wrong}
      </text>
      <path className="ink mint" d="M150 200 l14 14 l26 -30" />
      <text className="hw" x="200" y="214" fontSize="22" fill="var(--mint)">
        {copy.verdict}
      </text>
      <text className="hw dim" x="110" y="300" fontSize="20">
        {copy.caption}
      </text>
    </svg>
  );
}

export function HeroSpoken({ label, line }: { label: string; line: string }) {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label={label}>
      <title>{label}</title>
      <g transform="translate(150 80)">
        <use href="#head" width="120" height="120" />
      </g>
      <g id="wave" transform="translate(120 240)">
        {[
          [0, -18, 36],
          [16, -28, 56],
          [32, -12, 24],
          [48, -34, 68],
          [64, -20, 40],
          [80, -10, 20],
          [96, -26, 52],
          [112, -14, 28],
        ].map(([x, y, h]) => (
          <rect key={x} x={x} y={y} width="7" height={h} rx="3.5" fill="var(--pig)" />
        ))}
      </g>
      <text className="hw" x="80" y="330" fontSize="24">
        {line}
      </text>
    </svg>
  );
}

/** The two drawn objects that drift beside the hero card. */
export function HeroFloats() {
  return (
    <>
      <div className="float f1" style={{ left: '-4%', top: '-6%', width: 66 }} aria-hidden="true">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="28" fill="var(--marigold)" />
          <path
            d="M32 18 v14 l10 6"
            fill="none"
            stroke="#14142B"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="float f2" style={{ right: '-3%', top: '-8%', width: 58 }} aria-hidden="true">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="8" y="8" width="48" height="48" rx="14" fill="var(--pig)" />
          <path
            d="M20 32 l8 9 l16 -18"
            fill="none"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
}

// --- The loop -------------------------------------------------------------------------------------

/**
 * The icon tables are arrays of FUNCTIONS, not of elements, and that is not a style choice: an array
 * of JSX reads to a linter as a list about to be rendered, and a list needs keys. Only one mark is
 * ever on screen, so a key would be a lie about what this is. A thunk says what it means.
 */

/** The five step marks, in the order the loop runs. */
const LOOP_ICONS: readonly (() => React.ReactNode)[] = [
  () => (
    <>
      <rect className="acc" x="15" y="5" width="10" height="18" rx="5" />
      <path d="M10 19 a10 10 0 0 0 20 0 M20 29 v6" />
    </>
  ),
  () => (
    <>
      <path d="M6 10 h28 v20 h-28 z" />
      <path className="acc" d="M11 17 h14 M11 23 h9" />
    </>
  ),
  () => (
    <>
      <path d="M7 33 l4 -1 l19 -19 l-3 -3 l-19 19 z" />
      <path className="acc" d="M27 10 l3 3" />
      <path d="M7 6 h10 M12 1 v10" opacity=".5" />
    </>
  ),
  () => (
    <>
      <circle cx="20" cy="20" r="14" />
      <path className="acc" d="M13 20 l5 5 l9 -11" />
    </>
  ),
  () => (
    <>
      <rect x="6" y="10" width="28" height="20" rx="4" />
      <path className="acc" d="M6 13 l14 10 l14 -10" />
    </>
  ),
];

export function LoopIcon({ step }: { step: number }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      {LOOP_ICONS[step]?.()}
    </svg>
  );
}

// --- The four answer forms --------------------------------------------------------------------

export function FormProof({
  label,
  marks,
}: {
  label: string;
  marks: { square: string; added: string };
}) {
  return (
    <svg viewBox="0 0 620 380" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="ink" d="M150 280 L330 280 L150 150 Z" />
      <path className="ink thin" d="M150 258 h22 v22" />
      <path className="ink pig" d="M330 280 L440 148 L308 40 L150 150" />
      <text className="hw pig" x="352" y="140" fontSize="26">
        {marks.square}
      </text>
      <text className="hw" x="200" y="316" fontSize="24">
        {marks.added}
      </text>
    </svg>
  );
}

export function FormFilm({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 620 380" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="90" y="50" width="440" height="250" rx="16" fill="var(--paper)" />
      <circle cx="220" cy="175" r="52" fill="var(--rose)" opacity=".16" />
      <circle cx="220" cy="175" r="30" fill="var(--rose)" opacity=".3" />
      <path className="ink pig" d="M300 240 C340 150 420 130 470 130" />
      <circle cx="470" cy="130" r="14" fill="var(--marigold)" />
      <rect x="90" y="316" width="440" height="8" rx="4" fill="var(--paper-3)" />
      <rect x="90" y="316" width="250" height="8" rx="4" fill="var(--marigold)" />
    </svg>
  );
}

export function FormDrag({
  label,
  marks,
}: {
  label: string;
  marks: { drag: string; dragUnder: string };
}) {
  return (
    <svg viewBox="0 0 620 380" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="ink thin" d="M110 300 h420 M140 330 v-260" />
      <path className="ink pig" d="M140 280 C230 260 310 150 520 96" />
      <circle cx="330" cy="182" r="13" fill="var(--rose)" />
      <path className="ink rose" d="M330 182 v118" strokeDasharray="6 8" />
      <text className="hw" x="352" y="176" fontSize="24">
        {marks.drag}
      </text>
      <text className="hw dim" x="352" y="212" fontSize="20">
        {marks.dragUnder}
      </text>
    </svg>
  );
}

// --- It teaches you, not a class -----------------------------------------------------------------

/**
 * Beat 01: the chapter, the three ideas it stands on, and the shaky one found and patched.
 *
 * The ids are the prototype's, because `engine/motion.ts` reaches for `#pre-weak`, `#pre-a` and
 * `#pre-tick` by name. `#pre-tick` carries its own `--len` because a mint tick drawn in 60 units
 * of path is shorter than the sheet's 900-unit default and would otherwise appear complete.
 */
export function GapArt({
  label,
  words,
}: {
  label: string;
  words: { prerequisites: readonly string[]; chapter: string; weak: string };
}) {
  const boxes = [
    { id: 'pre-a', x: 70, text: 86 },
    { id: 'pre-b', x: 186, text: 202 },
    { id: 'pre-c', x: 302, text: 316 },
  ];
  return (
    <svg viewBox="0 0 460 280" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="ink thin" d="M60 214 h340" />
      {boxes.map((box, i) => (
        <g id={box.id} key={box.id}>
          <rect x={box.x} y="168" width="86" height="44" rx="12" fill="var(--paper-2)" />
          <text className="hw" x={box.text} y="196" fontSize="18">
            {words.prerequisites[i]}
          </text>
        </g>
      ))}
      <rect x="186" y="66" width="120" height="52" rx="14" fill="var(--pig)" />
      <text x="246" y="98" textAnchor="middle" fontFamily="Poppins" fontSize="16" fill="#fff">
        {words.chapter}
      </text>
      <path className="ink thin" d="M113 168 C113 140 200 140 226 118" />
      <path className="ink thin" d="M229 168 v-50" />
      <path className="ink thin" d="M345 168 C345 140 280 140 266 118" />
      <g id="pre-weak" opacity="0">
        <rect
          x="66"
          y="164"
          width="94"
          height="52"
          rx="14"
          fill="none"
          stroke="var(--rose)"
          strokeWidth="3"
        />
        <text className="hw rose" x="60" y="248" fontSize="19">
          {words.weak}
        </text>
      </g>
      <path
        id="pre-tick"
        className="ink mint draw"
        d="M96 190 l10 10 l18 -22"
        style={{ '--len': 60 } as React.CSSProperties}
        opacity="0"
      />
    </svg>
  );
}

/** Beat 02: one idea, three different routes into it. Still — nothing here animates. */
export function RoutesArt({
  label,
  words,
}: {
  label: string;
  words: { idea: string; ways: readonly string[] };
}) {
  return (
    <svg viewBox="0 0 460 280" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="230" cy="46" r="26" fill="var(--pig)" />
      <text x="230" y="52" textAnchor="middle" fontFamily="Poppins" fontSize="15" fill="#fff">
        {words.idea}
      </text>
      <path className="ink thin" d="M212 68 C160 100 120 120 96 146" />
      <path className="ink thin" d="M230 74 v70" />
      <path className="ink thin" d="M248 68 C300 100 340 120 364 146" />
      <g>
        <rect x="34" y="146" width="124" height="96" rx="16" fill="var(--paper-2)" />
        <path className="ink pig" d="M60 214 L96 168 L132 214 Z" />
        <text className="hw dim" x="52" y="238" fontSize="16">
          {words.ways[0]}
        </text>
      </g>
      <g>
        <rect x="168" y="146" width="124" height="96" rx="16" fill="var(--paper-2)" />
        <path className="ink thin" d="M188 176 h84 M188 196 h60 M188 216 h72" />
        <text className="hw dim" x="186" y="238" fontSize="16">
          {words.ways[1]}
        </text>
      </g>
      <g>
        <rect x="302" y="146" width="124" height="96" rx="16" fill="var(--paper-2)" />
        <circle cx="344" cy="192" r="18" fill="var(--marigold)" />
        <path className="ink" d="M368 192 h34" />
        <text className="hw dim" x="316" y="238" fontSize="16">
          {words.ways[2]}
        </text>
      </g>
    </svg>
  );
}

/** Beat 03: the curve dips where it slipped, settles, and only then says the topic is yours. */
export function MasteryArt({
  label,
  words,
}: {
  label: string;
  words: { days: readonly string[]; slipped: string; done: string };
}) {
  const dayX = [46, 150, 252, 352];
  return (
    <svg viewBox="0 0 460 280" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="ink thin" d="M50 220 h370" />
      <g className="hw dim" fontSize="15">
        {words.days.map((day, i) => (
          <text key={day} x={dayX[i]} y="246">
            {day}
          </text>
        ))}
      </g>
      <circle cx="60" cy="220" r="7" fill="var(--pig)" />
      <circle cx="168" cy="220" r="7" fill="var(--pig)" />
      <circle cx="272" cy="220" r="7" fill="var(--pig)" />
      <circle cx="372" cy="220" r="7" fill="var(--paper-3)" />
      <path
        id="mast-curve"
        className="ink pig draw"
        d="M60 190 C120 176 150 150 168 140 C210 128 240 108 272 96 C320 84 350 76 372 72"
        style={{ '--len': 360 } as React.CSSProperties}
      />
      <g id="mast-dip" opacity="0">
        <path className="ink rose" d="M168 140 C186 158 200 166 214 158" strokeDasharray="5 7" />
        <text className="hw rose" x="182" y="184" fontSize="17">
          {words.slipped}
        </text>
      </g>
      <g id="mast-done" opacity="0">
        <rect x="326" y="40" width="104" height="34" rx="12" fill="var(--mint)" opacity=".16" />
        <text className="hw" x="340" y="63" fontSize="18" fill="var(--mint)">
          {words.done}
        </text>
      </g>
    </svg>
  );
}

// --- The climb --------------------------------------------------------------------------------------

/** The path as a climb: two checkpoints held, a chest, where you are, and the chapter test. */
export function ClimbQuest({
  label,
  on,
  marks,
}: {
  label: string;
  on: boolean;
  marks: { reward: string; here: string; test: string };
}) {
  return (
    <svg
      className={on ? 'on' : undefined}
      data-vibe="quest"
      viewBox="0 0 900 340"
      role="img"
      aria-label={label}
      // the faded-out dressing is off the accessibility tree, not just the screen (site-7)
      aria-hidden={on ? undefined : true}
    >
      <title>{label}</title>
      <path
        className="ink thin"
        d="M40 258 C170 200 210 296 340 236 C470 178 520 268 650 206 C740 164 790 132 862 104"
        strokeWidth="14"
        stroke="var(--paper-3)"
        strokeLinecap="round"
      />
      <path
        className="ink pig"
        d="M40 258 C170 200 210 296 340 236 C470 178 520 268 650 206"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g>
        <circle cx="40" cy="258" r="20" fill="var(--mint)" />
        <path
          d="M32 258 l6 7 l12 -14"
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g>
        <circle cx="207" cy="248" r="20" fill="var(--mint)" />
        <path
          d="M199 248 l6 7 l12 -14"
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g>
        <rect x="316" y="212" width="48" height="40" rx="8" fill="var(--marigold)" />
        <rect x="316" y="226" width="48" height="10" fill="#14142B" opacity=".18" />
        <path d="M340 212 v40" stroke="#14142B" strokeWidth="3" opacity=".25" />
        <text className="hw" x="306" y="200" fontSize="18">
          {marks.reward}
        </text>
      </g>
      <g>
        <circle cx="500" cy="238" r="22" fill="var(--pig)" />
        <circle
          cx="500"
          cy="238"
          r="30"
          fill="none"
          stroke="var(--pig)"
          strokeWidth="3"
          opacity=".35"
        />
        <text className="hw pig" x="466" y="196" fontSize="18">
          {marks.here}
        </text>
      </g>
      <g opacity=".55">
        <circle cx="650" cy="206" r="18" fill="var(--paper-3)" />
      </g>
      <g>
        <rect x="800" y="70" width="72" height="66" rx="16" fill="var(--ink)" />
        <path
          d="M818 104 l12 12 l24 -28"
          fill="none"
          stroke="var(--marigold)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text className="hw" x="782" y="56" fontSize="19">
          {marks.test}
        </text>
      </g>
    </svg>
  );
}

/** The same four chapters, dressed as a plain progress list. Same content, different clothes. */
export function ClimbFocus({
  label,
  on,
  rows,
  gate,
}: {
  label: string;
  on: boolean;
  rows: readonly { title: string; state: string }[];
  gate: string;
}) {
  const tone: Record<string, string> = {
    held: 'var(--mint)',
    'in progress': 'var(--pig)',
    next: 'var(--ink-3)',
  };
  return (
    <svg
      className={on ? 'on' : undefined}
      data-vibe="focus"
      viewBox="0 0 900 340"
      role="img"
      aria-label={label}
      aria-hidden={on ? undefined : true}
    >
      <title>{label}</title>
      <g fontFamily="Poppins" fontSize="16" fill="var(--ink)">
        {rows.map((row, i) => {
          const y = 40 + i * 64;
          const current = row.state === 'in progress';
          return (
            <g key={row.title}>
              <rect
                x="40"
                y={y}
                width="820"
                height="52"
                rx="14"
                fill={current ? 'var(--pig-soft)' : 'var(--paper-2)'}
              />
              <text x="66" y={y + 32} fill={row.state === 'next' ? 'var(--ink-3)' : undefined}>
                {row.title}
              </text>
              <text x="800" y={y + 32} textAnchor="end" fontSize="14" fill={tone[row.state]}>
                {row.state}
              </text>
            </g>
          );
        })}
        <rect x="40" y="296" width="820" height="34" rx="12" fill="var(--paper-3)" />
        <text x="66" y="319" fontSize="14" fill="var(--ink-2)">
          {gate}
        </text>
      </g>
    </svg>
  );
}

// --- The film ------------------------------------------------------------------------------------

export function FilmFrame({
  label,
  slate,
  bars,
}: {
  label: string;
  slate: string;
  bars: readonly string[];
}) {
  return (
    <svg viewBox="0 0 520 330" role="img" aria-label={label}>
      <title>{label}</title>
      <text className="hw dim" x="40" y="46" fontSize="22">
        {slate}
      </text>
      <path className="ink thin" d="M60 270 h400 M90 290 v-200" />
      <rect x="150" y="150" width="52" height="120" rx="6" fill="var(--pig)" />
      <rect x="230" y="196" width="52" height="74" rx="6" fill="var(--mint)" />
      <rect x="310" y="120" width="52" height="150" rx="6" fill="var(--marigold)" />
      <text className="hw dim" x="150" y="296" fontSize="18">
        {bars[0]}
      </text>
      <text className="hw dim" x="232" y="296" fontSize="18">
        {bars[1]}
      </text>
      <text className="hw dim" x="310" y="296" fontSize="18">
        {bars[2]}
      </text>
      <path
        className="ink pig"
        id="lasso"
        d="M126 132 c-30 40 -14 118 62 126 s112 -12 108 -68 s-40 -84 -104 -80 s-58 12 -66 22"
      />
    </svg>
  );
}

/** The paused-transport glyph in the player's bar. */
export function PauseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="1" width="3" height="10" rx="1" />
      <rect x="7" y="1" width="3" height="10" rx="1" />
    </svg>
  );
}

// --- The parent's report ---------------------------------------------------------------------

/** The seven bars, the dashed projection, and the day letters. */
export function ReportChart({
  label,
  days,
  projection,
}: {
  label: string;
  days: readonly string[];
  projection: readonly string[];
}) {
  const bars = [
    { x: 16, h: 52, done: true },
    { x: 66, h: 74, done: true },
    { x: 116, h: 40, done: true },
    { x: 166, h: 96, done: true },
    { x: 216, h: 66, done: true },
    { x: 266, h: 18, done: false },
    { x: 316, h: 18, done: false },
  ];
  return (
    <svg viewBox="0 0 460 150" role="img" aria-label={label}>
      <title>{label}</title>
      <g id="bars">
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y="150"
            width="34"
            height="0"
            rx="6"
            fill={bar.done ? 'var(--pig)' : 'var(--paper-3)'}
            data-h={bar.h}
          />
        ))}
      </g>
      <path
        id="proj"
        className="ink mint draw"
        d="M370 120 C400 96 420 70 452 34"
        style={{ '--len': 200 } as React.CSSProperties}
        strokeDasharray="6 7"
      />
      <text className="hw" x="352" y="24" fontSize="20" fill="var(--mint)">
        {projection[0]}
      </text>
      <text className="hw" x="352" y="46" fontSize="20" fill="var(--mint)">
        {projection[1]}
      </text>
      <g className="hw dim" fontSize="14">
        {days.map((day, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two of the seven letters repeat
          <text key={i} x={24 + i * 50} y="146">
            {day}
          </text>
        ))}
      </g>
    </svg>
  );
}

const BADGE_ICONS: readonly (() => React.ReactNode)[] = [
  () => <path d="M2 8 l4 4 l8 -10" />,
  () => <path d="M8 1 l2 5 l5 .4 l-4 3.4 l1.3 5 l-4.3 -3 l-4.3 3 l1.3 -5 l-4 -3.4 l5 -.4 z" />,
  () => (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4 v4 l3 2" />
    </>
  ),
];

const BADGE_STROKES = ['var(--mint)', 'var(--marigold)', 'var(--pig)'] as const;

export function BadgeIcon({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 16 16" stroke={BADGE_STROKES[index]} aria-hidden="true">
      {BADGE_ICONS[index]?.()}
    </svg>
  );
}

// --- Safe by design ------------------------------------------------------------------------------

const SAFE_ICONS: readonly (() => React.ReactNode)[] = [
  () => (
    <>
      <rect x="9" y="22" width="34" height="23" rx="6" />
      <path className="acc" d="M16 22 v-6 a10 10 0 0 1 20 0 v6" />
    </>
  ),
  () => (
    <>
      <circle cx="26" cy="26" r="17" />
      <path className="acc" d="M12 26 h28 M26 9 c-8 9 -8 25 0 34 c8 -9 8 -25 0 -34" />
    </>
  ),
  () => (
    <>
      <path d="M8 40 c6 -12 32 -12 38 0" />
      <circle className="acc" cx="27" cy="18" r="9" />
      <path d="M40 12 l6 6" />
    </>
  ),
  () => (
    <>
      <path d="M26 6 L42 12 C42 30 35 40 26 46 C17 40 10 30 10 12 Z" />
      <path className="acc" d="M19 25 l5 5 l10 -12" />
    </>
  ),
  () => (
    <>
      <path d="M12 14 h28 v28 h-28 z" />
      <path className="acc" d="M20 26 l5 5 l9 -11" />
      <path d="M12 14 l-4 -4 M40 14 l4 -4" />
    </>
  ),
  () => (
    <>
      <path d="M10 14 h32 v24 h-32 z" />
      <path className="acc" d="M17 24 h18 M17 30 h11" />
      <path d="M26 38 v6" />
    </>
  ),
];

export function SafeIcon({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 52 52" aria-hidden="true">
      {SAFE_ICONS[index]?.()}
    </svg>
  );
}

// --- Everywhere you study --------------------------------------------------------------------

export function DevicesArt({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 560 360" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="40" y="60" width="300" height="190" rx="14" fill="var(--paper)" />
      <rect x="24" y="250" width="332" height="12" rx="6" fill="var(--paper-3)" />
      <path className="ink thin" d="M70 210 h240 M96 226 v-130" />
      <path className="ink pig" d="M96 196 C160 176 210 120 316 96" />
      <rect x="368" y="96" width="120" height="164" rx="14" fill="var(--paper)" />
      <path className="ink thin" d="M386 232 h84 M398 244 v-110" />
      <path className="ink pig" d="M398 224 C424 210 442 176 476 152" />
      <rect x="504" y="150" width="44" height="86" rx="10" fill="var(--paper)" />
      <path className="ink pig" d="M512 222 C520 214 528 200 540 186" />
      <g transform="translate(300 268)">
        <use href="#head" width="56" height="56" />
      </g>
    </svg>
  );
}

// --- The assistants row ---------------------------------------------------------------------

/**
 * A mark per assistant, in the order `assistants()` lists them, drawn in the same hand as
 * everything else on the page rather than lifted from anyone's brand kit: one stroke weight,
 * `currentColor`, on the 18px grid. Indexed rather than named, so this file holds no company's
 * name — the row's labels live with the rest of the copy.
 */
const ASSISTANT_MARKS: readonly (() => React.ReactNode)[] = [
  () => (
    <>
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6 9.5 l2.2 2 L12.4 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  () => (
    <>
      <path
        d="M4 13 L9 4 l5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M6.4 10.6 h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  () => (
    <path
      d="M9 1.5 C9.6 5.6 12.4 8.4 16.5 9 C12.4 9.6 9.6 12.4 9 16.5 C8.4 12.4 5.6 9.6 1.5 9 C5.6 8.4 8.4 5.6 9 1.5 Z"
      fill="currentColor"
    />
  ),
  () => (
    <>
      <circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 2.6 v12.8 M3.2 6 h11.6 M3.2 12 h11.6" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  () => (
    <path
      d="M3.5 14.5 L14.5 3.5 M8 14.5 L14.5 8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
];

export function AssistantMark({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      {ASSISTANT_MARKS[index]?.() ?? null}
    </svg>
  );
}
