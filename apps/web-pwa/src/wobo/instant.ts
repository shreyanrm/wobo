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
 *    figure"); a name is matched on its own head, so a thing standing ON the named thing is not
 *    the named thing (wave 58); Wobo's own words are never on the glass and are refused as well.
 *    One more declaration lives in the core rather than on the DOM: the architect's own sentence
 *    for a concept, which the card prints as its idea. A line that IS that sentence, word for
 *    word, is the idea declared, and a bare "why?" on that card is about it (`bareAsk`); by the
 *    same identity a line that IS the card's own name, word for word, is that concept on the
 *    glass, which is how a bare ask still has something the learner can SEE to point at once the
 *    card itself has scrolled away (`nameOnGlass`).
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
  /**
   * THE REST OF WHAT THE LEARNER'S OWN HAND CROSSED (the adversary, wave 47, finding 3).
   *
   * A lasso is one gesture and it can land on more than one thing: a drag across the outline on a
   * slow machine crossed two lines, and the learner is owed a mark on both of them, not on the one
   * that happened to score higher. Only ever from a gesture — or from ONE sentence the glass
   * wrapped over two lines (`bareAsk`): the WORDS aim at one thing or at nothing (rule 2), and
   * this is never a way around that.
   */
  also?: { target: string; kind: 'ring' | 'underline'; words: string }[];
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
 * One thing this entry is called.
 *
 * `named` is true for a NAME the content model gave (a part, a concept, a misconception, a figure
 * part's own label) and false for a line's own words (a step, a photo line, a heading, a chip): a
 * name has a head and may have a tail, a line of working is matched whole.
 */
interface Name {
  tokens: string[];
  named: boolean;
}

/**
 * The words this thing is CALLED, as the content model declares it. A part is called its slug, a
 * concept its slug, a step "step <n>", a photo line and a figure part their own words. This is the
 * only vocabulary a question is matched against: the resolver never scores against a paragraph.
 */
function declaredName(entry: GlassEntry): Name[] {
  const names: Name[] = [];
  for (const { key, value } of meaningsOf(entry)) {
    if (key === 'part' || key === 'concept' || key === 'misconception') {
      names.push({ tokens: tokensOf(value), named: true });
    } else if (key === 'step') names.push({ tokens: tokensOf(`step ${value}`), named: false });
  }
  if (NAMEABLE.has(entry.role)) {
    names.push({ tokens: tokensOf(entry.text), named: entry.role === 'figure-part' });
  }
  return names.filter((n) => n.tokens.length > 0);
}

/**
 * A NAME'S TAIL IS WHAT THE THING STANDS ON (the adversary, wave 58, finding 1).
 *
 * Live, "circle the hypotenuse" rang the SQUARE ON the hypotenuse, because the square's name carries
 * the word "hypotenuse" and the resolver read every word of a name as a name for the thing. But
 * "square on the hypotenuse" is a name for a square, and it says which square by what it stands on.
 * A name is matched on its own head only: the words before the first of these. The tail still
 * counts when the learner says the WHOLE name, see `saidWhole`.
 */
const STANDS_ON = new Set([
  'on',
  'of',
  'in',
  'at',
  'over',
  'under',
  'above',
  'below',
  'beside',
  'inside',
  'outside',
  'between',
  'through',
  'from',
  'to',
  'by',
  'with',
  'across',
  'along',
  'around',
  'behind',
  'near',
]);

/** The head of a name: "square on the hypotenuse" is called "square". A line's words are whole. */
function headOf(name: Name): string[] {
  if (!name.named) return name.tokens;
  const at = name.tokens.findIndex((t) => STANDS_ON.has(t));
  return at > 0 ? name.tokens.slice(0, at) : name.tokens;
}

/** The whole name, tail and all, said in the question word for word and in order. */
function saidWhole(name: Name, question: string[]): boolean {
  const n = name.tokens;
  if (n.length === 0 || n.length > question.length) return false;
  for (let start = 0; start + n.length <= question.length; start += 1) {
    let all = true;
    for (let i = 0; i < n.length; i += 1) {
      if (question[start + i] !== n[i]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
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
  /**
   * THE GLASS IDS THE LEARNER'S GESTURE LANDED ON (`FocusObject.targetIds`). It wins outright when
   * any of them is a thing at all.
   *
   * It is the targets and never the focus's own id: a focus is minted as "focus-1" and that is the
   * gesture's name, not a thing on the glass, so a caller that handed over `focus.id` aimed the
   * deixis branch at an id no map has ever held and every lasso fell through to the words.
   */
  focusTargets?: readonly string[] | null;
  /** A focus that IS a glass id (a tap straight on a declared thing). */
  focusId?: string | null;
}

interface Scored {
  entry: GlassEntry;
  score: number;
}

/**
 * Most marks one gesture puts down at once. A lasso across two lines of working is a learner
 * asking about both; a sweep down half the page names nothing in particular, and the pen waits for
 * the plan rather than striping the screen.
 */
const FOCUS_MARKS_MAX = 3;

/** The things the learner's gesture landed on, in the order the glass holds them. */
function touchedBy(input: ResolveInstant, map: GlassMap, question: string): GlassEntry[] {
  const under = new Set<string>(input.focusTargets ?? []);
  if (input.focusId) under.add(input.focusId);
  if (under.size === 0) return [];
  return map.entries.filter(
    (e) =>
      under.has(e.id) &&
      !(e.meaning && OWN_MEANING.test(e.meaning)) &&
      !echoes(e.text, question) &&
      (e.text.trim().length > 0 || Boolean(e.meaning)),
  );
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

  // THE THING UNDER THE LEARNER'S HAND. They tapped a chip, lit a line of their own photograph, or
  // circled two lines of the outline, and then said something about it: the deixis has an answer
  // and it is not a guess. It is read off the map itself rather than off `candidates`, because a
  // gesture does not need the content model to have declared a thing — the learner pointed at it —
  // and it marks EVERY thing it crossed.
  //
  // AND IT IS ASKED BEFORE THE GRAMMAR. A gesture is what makes the message an ask: "Is my step 2
  // right? I am not sure about the +5" is a question a child types and `ASKS_OR_MARKS` does not
  // recognise one word of it, so the doubt photo — the one turn of the 59 that fails timing, first
  // stroke at 8 193 ms — had no local aim even with the line lit under their finger. A request to
  // BUILD still stands down above: the plane makes those, and nothing on the glass is the answer.
  const touched = touchedBy(input, map, text);
  if (touched.length > 0 && touched.length <= FOCUS_MARKS_MAX) {
    const first = touched[0] as GlassEntry;
    const rest = touched.slice(1).map((e) => ({
      target: e.id,
      kind: kindFor(e),
      words: wordsFor(e, core),
    }));
    return { ...aimAt(first, core, 'focus'), ...(rest.length > 0 ? { also: rest } : {}) };
  }

  if (!ASKS_OR_MARKS.test(text)) return null;

  const candidates = map.entries.filter((e) => aimable(e, text));
  if (candidates.length === 0) return null;

  const { words, numbers } = questionWords(text);
  if (numbers.length === 0 && words.every((w) => ABOUT_IT.has(w))) return bareAsk(map, core, text);
  const findsTheError = FINDS_THE_ERROR.test(text);

  const asked = tokensOf(text);
  const scored: Scored[] = [];
  for (const entry of candidates) {
    const names = declaredName(entry);
    let score = 0;
    // A word of the question names a thing when it is in the thing's own head: "hypotenuse" names
    // the side, and never the square standing on it.
    for (const word of words) {
      if (names.some((name) => headOf(name).includes(word))) score += 2;
    }
    // THE WHOLE NAME, SAID WHOLE. "circle the square on the hypotenuse" says the square's full
    // name, and the full name outranks the bare side it stands on: the longer the name the learner
    // said in full, the surer the aim, so the bonus is the name's length.
    for (const name of names) {
      if (saidWhole(name, asked)) score += name.tokens.length;
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

/**
 * The words an ask uses to point at the thing in front of it without naming it. `questionWords`
 * already drops "why", "how", "show", "this", "it"; these are the verbs that ride with them and
 * still name nothing: "why does it work?" is the same ask as "why?".
 */
const ABOUT_IT = new Set([
  'explain',
  'tell',
  'work',
  'works',
  'happen',
  'happens',
  'true',
  'mean',
  'means',
  'matter',
]);

/**
 * THE ASK THAT NAMES NOTHING AT ALL (the adversary, wave 58, finding 3).
 *
 * "show me why", asked on the "make a move" card, drew nothing and said "Which part is the one
 * that isn't landing? Name it and we start there." — at 1440 and at 390, on a glass carrying
 * twenty registered targets including the very line the learner had just read. The words name
 * no thing, so rule 2 fell silent, and the sentence that followed named nothing Wobo could see.
 *
 * An ask with no content word in it is not about nothing: it is about THE THING THE LEARNER IS
 * LOOKING AT. The lesson puts one card in front of them and the card declares its concept; the
 * level's core holds the one true sentence the architect wrote for that concept (`buildCore`),
 * and the card prints that sentence as its idea (screens/course/Composing.tsx). So the answer is
 * a lookup twice over: the only concept on the glass, and the line on it that IS the core's
 * sentence, word for word. That line is underlined and the sentence is said — from the core, so
 * it is spoken at once and there is never a second voice beside the model's. When the glass does
 * not carry the sentence whole (a long idea wraps at 390 into two lines and neither is the
 * sentence), the card itself is ringed: the card is the concept.
 *
 * Nothing, as before, when two cards declare a concept (rule 2), when no card does, or when the
 * core holds no sentence for it: a ring with no true words is ink for the sake of ink.
 *
 * AND NEVER A MARK THE LEARNER CANNOT SEE (the adversary, wave 60, Builder 6). The premise above
 * — the ask is about the thing the learner is looking at — is only true while the card is on the
 * glass. Live at 390 the learner had scrolled 561 px down to the outline; the card sat 377 px
 * above the viewport with 13 of its 390 px showing and its idea off the glass entirely, and the
 * fallback rang it anyway: a ring at y = -390, a sliver of stroke at the top of the sheet, with
 * the core's sentence spoken about a mark nobody could see. An instant mark is a mark the learner
 * can see NOW, whole, or it is not that mark (`seen`): the idea's every line, or the card's whole
 * box, inside the viewport.
 *
 * BUT SEEING IS NOT PAID FOR WITH THE MARK ITSELF. Refusing there costs the two laws the ask was
 * answered by: the stroke inside a second (timing) and the core's own true sentence (experience),
 * on the one turn of the walk the level had an answer ready for. It does not have to be paid,
 * because the concept IS on that glass — the lesson outline prints the card's own name, whole, in
 * front of the learner, 353 px down. A line that IS the concept's name, word for word, is the
 * concept declared on the glass exactly as a line that IS the idea's sentence is the idea (rule
 * 1), so the pen underlines that and the core's sentence is said about it. One such line, seen
 * whole, or none: two lines carrying the same name is the tie rule 2 answers with silence, and a
 * glass with neither the card, its idea, nor its name takes the lawful path for a question that
 * names nothing on the glass — no ink and the model's sentence.
 */
function bareAsk(map: GlassMap, core: ConceptCore, question: string): InstantAim | null {
  const cards = map.entries.filter(
    (e) => aimable(e, question) && meaningsOf(e).some((m) => m.key === 'concept' && m.value),
  );
  if (cards.length !== 1) return null;
  const card = cards[0] as GlassEntry;
  const say = coreSentence(card, core);
  if (!say) return null;
  const run = sentenceRun(map.entries, say, question);
  const [idea, ...wrapped] = run.every((e) => seen(e, map.viewport)) ? run : [];
  if (idea) {
    return {
      target: idea.id,
      kind: 'underline',
      words: 'the idea',
      by: 'concept',
      say,
      fromCache: true,
      ...(wrapped.length > 0
        ? {
            also: wrapped.map((e) => ({
              target: e.id,
              kind: 'underline' as const,
              words: 'the idea',
            })),
          }
        : {}),
    };
  }
  if (seen(card, map.viewport)) {
    return {
      target: card.id,
      kind: 'ring',
      words: wordsFor(card, core),
      by: 'concept',
      say,
      fromCache: true,
    };
  }
  const named = nameOnGlass(map, card, question);
  if (!named) return null;
  return {
    target: named.id,
    kind: 'underline',
    words: wordsFor(card, core),
    by: 'concept',
    say,
    fromCache: true,
  };
}

/**
 * The one line on the glass that IS this card's name, word for word, whole in front of the
 * learner. The lesson outline prints the name of every card, so when the card itself has scrolled
 * away its name is still there to point at; a name printed twice on one glass is a tie, and a tie
 * is silence (rule 2).
 */
function nameOnGlass(map: GlassMap, card: GlassEntry, question: string): GlassEntry | null {
  const names = declaredName(card).map((n) => n.tokens);
  if (names.length === 0) return null;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);
  const hits = map.entries.filter(
    (e) =>
      e.id !== card.id &&
      (e.role === 'line' || e.role === 'heading') &&
      !echoes(e.text, question) &&
      names.some((name) => same(name, tokensOf(e.text))),
  );
  if (hits.length !== 1) return null;
  const only = hits[0] as GlassEntry;
  return seen(only, map.viewport) ? only : null;
}

/**
 * Whole on the glass: every edge of the box inside the viewport, so a ring around it or a line
 * under it lands where the learner is looking (INK-FOUR craft, "nothing off the viewport"). Boxes
 * are viewport px, so the test is against the viewport's own size and nothing else. A map with no
 * viewport to measure against (no window) cannot say, and does not refuse.
 */
function seen(entry: GlassEntry, vp: GlassMap['viewport']): boolean {
  if (!(vp.w > 0) || !(vp.h > 0)) return true;
  const [x, y, w, h] = entry.box;
  return x >= 0 && y >= 0 && x + w <= vp.w && y + h <= vp.h;
}

/**
 * The line that IS this sentence, word for word — or the run of consecutive lines it wrapped
 * into. Live at 390 the idea read "Undo one operation at a time to" / "expose what is hidden.",
 * two glass boxes for one sentence, and the pen owes the sentence an underline on each. Empty
 * when the glass does not carry the sentence whole.
 */
function sentenceRun(
  entries: readonly GlassEntry[],
  sentence: string,
  question: string,
): GlassEntry[] {
  const want = tokensOf(sentence);
  if (want.length === 0) return [];
  for (let i = 0; i < entries.length; i += 1) {
    const run: GlassEntry[] = [];
    let got: string[] = [];
    for (let j = i; j < entries.length && got.length < want.length; j += 1) {
      const e = entries[j] as GlassEntry;
      if (e.role !== 'line' || echoes(e.text, question)) break;
      run.push(e);
      got = got.concat(tokensOf(e.text));
    }
    if (got.length === want.length && got.every((w, k) => w === want[k])) return run;
  }
  return [];
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

// --- The instant mark on a photograph -------------------------------------------------------------

/** The same relation the gateway seats as the equation (`doubt.py`, `_RELATION_RE`). */
const RELATION = /[=<>≤≥≠]/;

/** A number as a whole number, decimal point and all (`doubt.py`, `_NUMBER_RE`). */
const NUMBER = /\d+(?:\.\d+)?/g;

/**
 * THE INSTANT MARK APPLIED TO A PHOTOGRAPH (docs/INK-FOUR.md, timing; the adversary, wave 57).
 *
 * The doubt turn is the one turn of the 59 that fails timing outright: live at 390 the first
 * stroke landed 8 193 ms after the learner confirmed the reading, against a one-second law, and
 * the first word at 16 185 ms. The reading itself is a vision call on a photograph and will never
 * be instant — so this does not pretend otherwise. It uses what is true by the time the learner
 * presses Explain: **their own confirmed lines are already on the glass, each one a registered
 * target under the id the ink anchors to.** Nothing has to be inferred and no model has to answer
 * for the pen to mark the line the learner is asking about.
 *
 * The order is the order of certainty, exactly as `resolveInstant`'s is:
 *
 * 1. **The line they tapped.** They lit it on the confirm step and then pressed Explain: the
 *    deixis has an answer and it is not a guess.
 * 2. **The line their own words name.** Scored on content words against the lines only — never
 *    against Wobo's own chrome — and a tie aims at nothing, because a wrong instant mark is worse
 *    than a late right one.
 * 3. **The equation.** With no tap and no words, the line the page is about is the first one that
 *    states a relation — the same seat `doubt.py` gives `canvas.equation`, so the local aim and
 *    the model's first mark are looking at the same line and the ink never has to move.
 *
 * A page with no relation and nothing pointed at gets NO instant mark: an exercise heading is not
 * what the learner is asking about, and underlining it would be ink for the sake of speed.
 */
export function resolveDoubtInstant(input: {
  lines: readonly { id: string; text: string }[];
  /** The line lit on the photo when Explain was pressed. */
  lit?: string | null;
  /** The learner's own words about the doubt, if they typed any. */
  words?: string;
}): InstantAim | null {
  const lines = input.lines.filter((l) => l.id && l.text.trim());
  if (lines.length === 0) return null;
  const aim = (line: { id: string; text: string }, by: InstantBy): InstantAim => ({
    target: line.id,
    kind: 'underline',
    words: line.text.trim(),
    by,
  });

  if (input.lit) {
    const lit = lines.find((l) => l.id === input.lit);
    if (lit) return aim(lit, 'focus');
  }

  const said = (input.words ?? '').trim();
  if (said) {
    const { words, numbers } = questionWords(said);
    const wanted = [...words, ...numbers];
    if (wanted.length > 0) {
      const scored = lines
        .map((line) => {
          // A number on a page is written whole: the 8.33 of "x = 8.33" is one number, not an 8
          // and a 33, and the 5 of "+5" is not the 5 of "25" (`doubt.py`, `_NUMBER_RE`).
          const have = new Set([...tokensOf(line.text), ...(line.text.match(NUMBER) ?? [])]);
          let score = 0;
          for (const word of wanted) if (have.has(word)) score += 1;
          return { line, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const runnerUp = scored[1];
      // ONE LINE, OR THE EQUATION. "I am not sure about the +5" names two lines of working
      // equally, and a token count cannot tell them apart. On a page that is not a reason to draw
      // nothing: the tie falls to rule 3 below, which is the line the page is about and the line
      // the model opens on — never an arbitrary pick between the two.
      if (best && (!runnerUp || runnerUp.score < best.score)) return aim(best.line, 'photo-line');
    }
  }

  const equation = lines.find((line) => RELATION.test(line.text));
  return equation ? aim(equation, 'photo-line') : null;
}
