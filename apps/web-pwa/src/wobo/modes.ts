'use client';

/**
 * Wobo's modes (docs/WOBO-PLAN.md §3, WOBO-TASKS §5.7) — the nine things a learner asks of a tutor,
 * each with its own prompt shape and its own board behaviour.
 *
 * A mode is not a menu item that lives in one place: it is offered in the composer, in the command
 * palette, and by voice, and all three end up here, in one table, so the phrasing Wobo is asked with
 * is identical however it was reached. Nothing here names a model, a provider or a limit — a mode is
 * a sentence, and the brain decides everything else.
 */

export type WoboModeId =
  | 'explain_this'
  | 'show_me'
  | 'do_it'
  | 'quiz_me'
  | 'check_my_work'
  | 'why_wrong'
  | 'my_world'
  | 'read_aloud'
  | 'teach_back';

export interface WoboMode {
  id: WoboModeId;
  /** The learner-facing name. Sentence case, no emoji, no exclamation marks. */
  label: string;
  /** The quiet line under it in the palette. */
  hint: string;
  /** Extra words the palette searches on. */
  search: string;
  /** True when the mode only means something with a focus in hand. */
  needsFocus: boolean;
  /** True when Wobo will draw for it — the board is the answer, not a paragraph. */
  draws: boolean;
}

export const MODES: readonly WoboMode[] = [
  {
    id: 'explain_this',
    label: 'Explain this',
    hint: 'Wobo takes what you pointed at and works it through',
    search: 'explain what is this understand meaning break down',
    needsFocus: true,
    draws: true,
  },
  {
    id: 'show_me',
    label: 'Show me',
    hint: 'Wobo moves to the control and uses it while you watch',
    search: 'show me where demonstrate point find the button',
    needsFocus: false,
    draws: false,
  },
  {
    id: 'do_it',
    label: 'Do it for me',
    hint: 'Wobo acts, and asks first for anything that cannot be undone',
    search: 'do it for me act run execute',
    needsFocus: false,
    draws: false,
  },
  {
    id: 'quiz_me',
    label: 'Quiz me',
    hint: 'Wobo asks on the board and grades the working',
    search: 'quiz test me question ask me practice',
    needsFocus: false,
    draws: true,
  },
  {
    id: 'check_my_work',
    label: 'Check my work',
    hint: 'Wobo reads what you wrote and marks the first thing that slipped',
    search: 'check my work mark grade is this right verify',
    needsFocus: true,
    draws: true,
  },
  {
    id: 'why_wrong',
    label: 'Why is this wrong',
    hint: 'Wobo finds the misconception, not just the mistake',
    search: 'why wrong mistake error what did i do',
    needsFocus: true,
    draws: true,
  },
  {
    id: 'my_world',
    label: 'Say it in my world',
    hint: 'The same idea, in something you already love',
    search: 'analogy my world in terms of cricket football relate',
    needsFocus: false,
    draws: false,
  },
  {
    id: 'read_aloud',
    label: 'Read it aloud',
    hint: 'Wobo reads what is on screen, at your pace',
    search: 'read aloud speak out loud say it voice',
    needsFocus: false,
    draws: false,
  },
  {
    id: 'teach_back',
    label: 'Teach it back to me',
    hint: 'Say it in your own words',
    search: 'teach back protege explain to Wobo i will teach',
    needsFocus: false,
    draws: false,
  },
];

export const MODE_BY_ID: Record<WoboModeId, WoboMode> = Object.fromEntries(
  MODES.map((m) => [m.id, m]),
) as Record<WoboModeId, WoboMode>;

/**
 * The phrase each mode sends. Wobo is asked in the learner's voice, not in a command language, so a
 * keyless build's deterministic classifier and a live model read the same sentence.
 */
const PHRASES: Record<WoboModeId, string> = {
  explain_this: 'explain this',
  show_me: 'show me',
  do_it: 'do it',
  quiz_me: 'quiz me on this',
  check_my_work: 'check my work',
  why_wrong: 'why is this wrong',
  my_world: 'say it in my world',
  read_aloud: 'read it aloud',
  teach_back: 'let me teach it back to you',
};

/** What the turn is asked with. A focus in hand is named so the brain knows what "this" is. */
export function modePrompt(id: WoboModeId, focusText?: string): string {
  const base = PHRASES[id];
  const text = focusText?.trim();
  if (!text || !MODE_BY_ID[id].needsFocus) return base;
  const clipped = text.length > 160 ? `${text.slice(0, 160)}…` : text;
  return `${base}: “${clipped}”`;
}

// --- Reading a mode out of what the learner typed or said -----------------------------------------

const PATTERNS: [WoboModeId, RegExp][] = [
  [
    'why_wrong',
    /\bwhy\s+(is\s+)?(this|that|it|my\s+answer)?\s*(wrong|incorrect|a\s+mistake)\b|\bwhat\s+did\s+i\s+get\s+wrong\b/i,
  ],
  ['check_my_work', /\bcheck\s+(my|this)\s+(work|working|answer|steps?)\b|\bis\s+this\s+right\b/i],
  [
    'teach_back',
    /\bteach\s+(it\s+)?back\b|\blet\s+me\s+teach\b|\bi(\s+will|'ll)?\s+teach\s+you\b/i,
  ],
  ['my_world', /\bin\s+my\s+world\b|\bsay\s+it\s+in\s+(my|terms)\b|\bgive\s+me\s+an?\s+analogy\b/i],
  [
    'read_aloud',
    /\bread\s+(it|this|that|the\s+page)?\s*(out\s+)?(a)?loud\b|\bread\s+it\s+to\s+me\b/i,
  ],
  ['quiz_me', /\bquiz\s+me\b|\btest\s+me\b|\bask\s+me\s+(a\s+)?questions?\b/i],
  ['show_me', /\bshow\s+me\s+(where|how|the)\b|\bwhere\s+is\s+the\b|\bshow\s+me\b/i],
  ['do_it', /\bdo\s+it\s+for\s+me\b|\bjust\s+do\s+it\b|\bdo\s+it\b/i],
  [
    'explain_this',
    /\bexplain\s+(this|that|it)\b|\bwhat\s+(is|does)\s+this\b|\bbreak\s+this\s+down\b/i,
  ],
];

/**
 * Can this mode draw for THIS turn?
 *
 * A mode's `draws` says the answer is a drawing; `needsFocus` says the mode means nothing without
 * something in hand. Both have to hold for the board to open, and the surface chooser used to ask
 * only for a focus. That locked out `quiz_me` — the one drawing mode offered with an empty hand,
 * whose card reads "Wobo asks on the board and grades the working" — so the chip promised the board
 * on every press and never once opened it, while no other drawing mode could show the gap because
 * every one of them needs a focus anyway.
 */
export function modeDraws(id: WoboModeId | null | undefined, hasFocus: boolean): boolean {
  if (!id) return false;
  const mode = MODE_BY_ID[id];
  return mode.draws && (!mode.needsFocus || hasFocus);
}

/** The mode a line of text asks for, or null when it is an ordinary question. */
export function modeFromText(text: string): WoboModeId | null {
  const t = text.trim();
  if (!t) return null;
  for (const [id, pattern] of PATTERNS) {
    if (pattern.test(t)) return id;
  }
  return null;
}

/**
 * The modes worth offering right now. Modes that need something in hand stay hidden until there is
 * something in hand — an affordance that cannot work is worse than no affordance.
 */
export function availableModes(opts: { hasFocus: boolean; onLesson: boolean }): WoboMode[] {
  return MODES.filter((m) => {
    if (m.needsFocus && !opts.hasFocus) return false;
    if (m.id === 'teach_back' && !opts.onLesson) return false;
    return true;
  });
}
