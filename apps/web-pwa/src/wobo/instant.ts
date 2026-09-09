/**
 * THE INSTANT MARK (docs/INK-FOUR.md, "the one thing we do not have").
 *
 * Live, the first stroke landed 8.6 to 19.3 seconds after the learner asked, because every mark
 * waited on a model that thinks for seconds. Timing can never score 4 that way. The advantage we
 * have over anything drawing on a screen from outside is that we already know what is on the page
 * AND WHAT IT MEANS: the glass map carries the concept, the part, the step and the misconception
 * for everything visible. So for the large class of questions that name something the content
 * model declared, the client resolves the target itself, in microseconds, and the pen starts while
 * the request is still in flight.
 *
 * This file is the pure half of that. It has no DOM, no clock, no network: it is given a question,
 * the glass map, the level's concept core and (when the learner tapped something) the focus, and it
 * says what to ring and what is true about it — or nothing at all.
 *
 * THREE RULES IT NEVER BREAKS.
 *
 * 1. **Only a declared thing is aimed at.** A part, a step, a misconception, a concept, a photo's
 *    line, a figure part, a heading, a chip, an input, a cell. A plain line of prose is read, not
 *    named; a figure is not its part ("a question that names a part gets the part, not its
 *    figure"); Wobo's own words are never on the glass and are refused here as well.
 * 2. **Ambiguity aims at nothing.** If two declared things answer the question equally well, there
 *    is no local mark and no ink starts. A wrong instant ring is worse than a late right one.
 * 3. **A drawing from scratch is not a mark.** "Draw a Punnett square", "graph y = x²": the plane
 *    builds those, and nothing on the glass is what the learner asked for. The resolver stands down.
 *
 * What the model does with it is in wobo/board-turn.ts: the plan REFINES the mark, it does not gate
 * it. If the plan names another target the ink moves once, visibly. If the plan never arrives, the
 * local mark stands and the turn still taught something.
 */

import { type GlassEntry, type GlassMap, questionWords } from '@wobo/wobo';

// --- What the resolver hands back ----------------------------------------------------------------

/** Which declaration on the glass named this thing — the reason the aim is allowed. */
export type InstantBy =
  | 'part'
  | 'step'
  | 'concept'
  | 'misconception'
  | 'photo-line'
  | 'figure-part'
  | 'heading'
  | 'focus'
  | 'precomputed';

export interface InstantAim {
  /** The glass id the pen aims at. */
  target: string;
  /** One mark. A thing gets a ring; a line of working gets an underline. */
  kind: 'ring' | 'underline';
  /** What the mark means, carried with it — from the core when the core holds a sentence. */
  words: string;
  by: InstantBy;
  /**
   * The true sentence the architect wrote for this thing, when the core holds one. Spoken only on
   * a precomputed hit (`fromCache`), so there is never a second voice beside the model's.
   */
  say?: string;
  /** True when the whole answer came from the level's own store rather than from the map. */
  fromCache?: boolean;
}

// --- The concept core, cached with the level ------------------------------------------------------

/**
 * What the level knows about itself, made once by the architect (create.core) and cached beside the
 * level. `sentences` is keyed by a glass meaning (`part:effect`, `concept:predict-then-check`) or by
 * a glass id; `asks` is the handful of questions the blueprint's misconceptions say a learner
 * actually asks on this card, answered in advance.
 */
export interface ConceptCore {
  sentences: Record<string, string>;
  asks: Record<string, PrecomputedAsk>;
}

/**
 * One precomputed answer. It names a MEANING rather than a glass id, because ids are content
 * hashes that change with the words on screen while a meaning is the level's own vocabulary: the
 * answer is made once and still finds its target on any width, in any theme, after any re-measure.
 */
export interface PrecomputedAsk {
  meaning: string;
  kind: 'ring' | 'underline';
  words: string;
  say: string;
}

export const EMPTY_CORE: ConceptCore = { sentences: {}, asks: {} };

// --- The question ---------------------------------------------------------------------------------

/** A question, or a request to be shown something. A statement is neither. */
const ASKS_OR_MARKS =
  /\?\s*$|^\s*(why|how|what|which|where|explain|tell\s+me|point\s+(at|to)|ring|circle|mark|highlight|underline|show\s+me)\b|\b(ring|circle|mark|highlight|underline)\b/i;

/**
 * A drawing built from scratch. The plane makes these (docs/BOARD.md), and nothing on the glass is
 * the answer — so the local resolver stands down and the pen waits for the plan, as it must.
 */
const FROM_SCRATCH =
  /^\s*(draw|sketch|graph|plot|derive|prove|build|make|construct|design|write|solve|compute|calculate|simulate)\b/i;

/** The board's own furniture words: not a question about the page at all. */
const BOARD_COMMAND =
  /^\s*(wipe|clear|erase|close|put\s+away|open|fresh|new)\b.*\bboard\b|^\s*fresh\s+board\s*$/i;

/** "Which step is wrong", "where did it go wrong", "spot the mistake": the ask a misconception answers. */
const FINDS_THE_ERROR = /\b(wrong|mistake|error|slipp?ed|went\s+wrong|incorrect|broke)\b/i;

/** The key a precomputed ask is stored under: the question with its punctuation and politeness gone. */
export function askKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9²³\s]+/g, ' ')
    .replace(/\b(please|hey|hi|wobo|can you|could you|would you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- What on the glass can be aimed at ------------------------------------------------------------

/** Roles a question can name outright, with no meaning needed. */
const NAMEABLE = new Set<GlassEntry['role']>([
  'figure-part',
  'photo-line',
  'heading',
  'step',
  'chip',
  'input',
  'cell',
]);

/** Wobo's own words, if any ever reached the map. Never a subject. */
const OWN_MEANING = /^wobo[:.]/i;

/** A step is a line of working: it gets an underline. Everything else gets a ring. */
const UNDERLINED = new Set<GlassEntry['role']>(['step', 'photo-line']);

const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9²³]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);

/** Every meaning an entry declares: `"step:2 misconception:moves-term"` is two declarations. */
export function meaningsOf(entry: GlassEntry): { key: string; value: string }[] {
  if (!entry.meaning) return [];
  return entry.meaning
    .split(/[\s;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(':');
      if (at <= 0) return { key: part, value: '' };
      return { key: part.slice(0, at), value: part.slice(at + 1) };
    });
}

/**
 * The words this thing is CALLED, as the content model declares it. A part is called its slug, a
 * concept its slug, a step "step <n>", a photo line and a figure part their own words. This is the
 * only vocabulary a question is matched against: the resolver never scores against a paragraph.
 */
function declaredName(entry: GlassEntry): string[] {
  const names: string[] = [];
  for (const { key, value } of meaningsOf(entry)) {
    if (key === 'part' || key === 'concept' || key === 'misconception') names.push(value);
    else if (key === 'step') names.push(`step ${value}`);
  }
  if (NAMEABLE.has(entry.role)) names.push(entry.text);
  return names.filter((n) => n.trim().length > 0);
}

/** The step number this entry declares, if it declares one. */
function stepNumber(entry: GlassEntry): string | null {
  for (const { key, value } of meaningsOf(entry)) {
    if (key === 'step' && /^\d+$/.test(value)) return value;
  }
  return null;
}

function declaresMisconception(entry: GlassEntry): boolean {
  return meaningsOf(entry).some((m) => m.key === 'misconception' && m.value.length > 0);
}

/**
 * The words on this entry ARE the question, read back word for word: a bubble in the conversation
 * or a hidden announcement, never a subject (wave 41's finding, and wobo/looking.ts's own guard).
 */
function echoes(text: string, question: string): boolean {
  const q = tokensOf(question);
  const t = tokensOf(text);
  const shared = Math.min(q.length, t.length);
  if (shared < 3) return false;
  for (let i = 0; i < shared; i += 1) if (q[i] !== t[i]) return false;
  return true;
}

/** Can the pen aim here at all? */
export function aimable(entry: GlassEntry, question: string): boolean {
  if (entry.meaning && OWN_MEANING.test(entry.meaning)) return false;
  if (echoes(entry.text, question)) return false;
  return declaredName(entry).length > 0;
}

const kindFor = (entry: GlassEntry): 'ring' | 'underline' =>
  UNDERLINED.has(entry.role) ? 'underline' : 'ring';

/** What the mark means, said with it: the core's sentence subject, else the thing's own name. */
function wordsFor(entry: GlassEntry, core: ConceptCore): string {
  for (const { key, value } of meaningsOf(entry)) {
    if (key === 'step' && value) return `step ${value}`;
    if ((key === 'part' || key === 'concept') && value) {
      const own = core.sentences[`${key}:${value}`];
      if (own) return entry.text || value.replace(/-/g, ' ');
      return entry.text || value.replace(/-/g, ' ');
    }
  }
  return entry.text;
}

/** The core's true sentence about this thing, by its meaning first and then by its id. */
export function coreSentence(entry: GlassEntry, core: ConceptCore): string | undefined {
  for (const { key, value } of meaningsOf(entry)) {
    const hit = core.sentences[`${key}:${value}`];
    if (hit) return hit;
  }
  return core.sentences[entry.id];
}

// --- The resolve ----------------------------------------------------------------------------------

export interface ResolveInstant {
  question: string;
  map: GlassMap | null;
  /** The level's own core, cached beside it. Absent, the mark still lands with the thing's name. */
  core?: ConceptCore;
  /** The thing the learner tapped or circled. It wins outright when it is a thing at all. */
  focusId?: string | null;
}

interface Scored {
  entry: GlassEntry;
  score: number;
}

/**
 * Resolve the question against the glass, with no model call.
 *
 * Returns the one mark to start now, or null when the words name nothing declared — and null means
 * NO INK, not a guess. The order is the order of certainty: the level's precomputed answer, then
 * the thing the learner is touching, then the declaration the words name.
 */
export function resolveInstant(input: ResolveInstant): InstantAim | null {
  const { question, map } = input;
  const core = input.core ?? EMPTY_CORE;
  const text = question.trim();
  if (!text || !map || map.entries.length === 0) return null;
  if (BOARD_COMMAND.test(text)) return null;

  // 4. THE OBVIOUS ASKS, PRECOMPUTED. The blueprint's misconceptions say what a learner asks on
  // each card; those answers were made once with the level and are served in microseconds here.
  const cached = core.asks[askKey(text)];
  if (cached) {
    const found = map.entries.find((e) =>
      meaningsOf(e).some((m) => `${m.key}:${m.value}` === cached.meaning),
    );
    if (found && !echoes(found.text, text)) {
      return {
        target: found.id,
        kind: cached.kind,
        words: cached.words,
        by: 'precomputed',
        say: cached.say,
        fromCache: true,
      };
    }
    // The card that answer was made for is not on this glass. Fall through: the map decides.
  }

  if (FROM_SCRATCH.test(text)) return null;
  if (!ASKS_OR_MARKS.test(text)) return null;

  const candidates = map.entries.filter((e) => aimable(e, text));
  if (candidates.length === 0) return null;

  // THE THING UNDER THE LEARNER'S HAND. They tapped a chip, or circled a part, and then said
  // "explain this": the deixis has an answer and it is not a guess.
  if (input.focusId) {
    const focused = candidates.find((e) => e.id === input.focusId);
    if (focused) return aimAt(focused, core, 'focus');
  }

  const { words, numbers } = questionWords(text);
  if (words.length === 0 && numbers.length === 0) return null;
  const findsTheError = FINDS_THE_ERROR.test(text);

  const scored: Scored[] = [];
  for (const entry of candidates) {
    const names = declaredName(entry).map(tokensOf);
    let score = 0;
    for (const word of words) {
      if (names.some((name) => name.includes(word))) score += 2;
    }
    const step = stepNumber(entry);
    if (step && numbers.includes(step)) score += 3;
    // "Which step is wrong here?" names every step equally, and would tie into silence. But the
    // blueprint declared WHICH step is wrong, on the step itself, and that declaration is the
    // answer to exactly this ask. One step carries it, or the tie stands and nothing is drawn.
    if (findsTheError && declaresMisconception(entry)) score += 4;
    if (score === 0) continue;
    // The content model's own vocabulary beats a role that merely allows being named.
    if (entry.meaning) score += 1;
    scored.push({ entry, score });
  }
  if (scored.length === 0) {
    // "Which step is wrong here?" names no step in particular — but exactly one step on this glass
    // declares the misconception the blueprint wrote for it, and that IS the answer. One, or none.
    if (FINDS_THE_ERROR.test(text)) {
      const flagged = candidates.filter(declaresMisconception);
      if (flagged.length === 1) return aimAt(flagged[0] as GlassEntry, core, 'misconception');
    }
    return null;
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] as Scored;
  const runnerUp = scored[1];
  // AMBIGUITY AIMS AT NOTHING. Two things answer the words equally: the model can tell them apart
  // and the map cannot, so no ink starts and the turn is the model's as it was before.
  if (runnerUp && runnerUp.score === best.score) return null;
  const by =
    findsTheError && declaresMisconception(best.entry) ? 'misconception' : byOf(best.entry);
  return aimAt(best.entry, core, by);
}

function byOf(entry: GlassEntry): InstantBy {
  for (const { key } of meaningsOf(entry)) {
    if (key === 'part') return 'part';
    if (key === 'step') return 'step';
    if (key === 'concept') return 'concept';
    if (key === 'misconception') return 'misconception';
  }
  if (entry.role === 'photo-line') return 'photo-line';
  if (entry.role === 'heading') return 'heading';
  return 'figure-part';
}

function aimAt(entry: GlassEntry, core: ConceptCore, by: InstantBy): InstantAim {
  const say = coreSentence(entry, core);
  return {
    target: entry.id,
    kind: kindFor(entry),
    words: wordsFor(entry, core),
    by,
    ...(say ? { say } : {}),
  };
}

// --- Building the core from the level -------------------------------------------------------------

/** One card of the level, as much of it as the core needs. */
export interface CoreCard {
  id: string;
  title: string;
  /** The one true sentence about this card's concept, written by the architect. */
  idea: string;
  /** What the card reveals once the learner has acted. */
  reveal?: string;
  /** The parts this card's drawing declares, each with the true sentence about it. */
  parts?: { slug: string; name: string; sentence: string }[];
  /** The misconception the blueprint declared for this card, if it declared one. */
  misconception?: { slug: string; ask: string; sentence: string };
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9²³]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * The concept core for a level: a sentence for every concept and every part it declares, and the
 * handful of questions a learner actually asks on each card, answered in advance.
 *
 * Made ONCE, when the level is composed, and cached beside it. Nothing here is invented: every
 * sentence is the architect's own, and every ask is built from the card's own vocabulary.
 */
export function buildCore(cards: readonly CoreCard[]): ConceptCore {
  const sentences: Record<string, string> = {};
  const asks: Record<string, PrecomputedAsk> = {};
  const put = (question: string, ask: PrecomputedAsk): void => {
    const key = askKey(question);
    if (key && !asks[key]) asks[key] = ask;
  };
  for (const card of cards) {
    const concept = `concept:${slug(card.title)}`;
    if (card.idea) sentences[concept] = card.idea;
    if (card.idea) {
      const conceptAsk: PrecomputedAsk = {
        meaning: concept,
        kind: 'ring',
        words: card.title,
        say: card.idea,
      };
      put(`what is ${card.title}`, conceptAsk);
      put(`explain ${card.title}`, conceptAsk);
      put(`why does ${card.title} work`, conceptAsk);
      put(`what does ${card.title} mean`, conceptAsk);
    }
    for (const part of card.parts ?? []) {
      const meaning = `part:${part.slug}`;
      if (part.sentence) sentences[meaning] = part.sentence;
      const partAsk: PrecomputedAsk = {
        meaning,
        kind: 'ring',
        words: part.name,
        say: part.sentence || `This is the ${part.name}.`,
      };
      put(`circle the ${part.name}`, partAsk);
      put(`what is the ${part.name}`, partAsk);
      put(`show me the ${part.name}`, partAsk);
      put(`where is the ${part.name}`, partAsk);
      put(`point at the ${part.name}`, partAsk);
    }
    const wrong = card.misconception;
    if (wrong) {
      const meaning = `misconception:${wrong.slug}`;
      if (wrong.sentence) sentences[meaning] = wrong.sentence;
      const wrongAsk: PrecomputedAsk = {
        meaning,
        kind: 'underline',
        words: wrong.ask,
        say: wrong.sentence,
      };
      put(wrong.ask, wrongAsk);
      put('which step is wrong here', wrongAsk);
      put('where did i go wrong', wrongAsk);
      put('what did i do wrong', wrongAsk);
    }
  }
  return { sentences, asks };
}
