/**
 * THE FOUR SUGGESTIONS (docs/SUGGESTIONS-AND-NOTICES.md §2).
 *
 * *"A learner opens Wobo because they want to. Every time the product speaks without being asked,
 * it spends a little of that."* So a suggestion is not a recommendation engine's output and it is
 * not a growth lever. It is the one thing a tutor sitting beside this learner would say next, and
 * everything in this file exists to keep it that.
 *
 * FOUR KINDS, AND WHAT EACH IS ALLOWED TO BE:
 *
 *   the next thing   the one thing that follows, named, and why it follows. Never a list to choose
 *                    from, never a ranking, never a nudge to keep going.
 *   the way back     a different way into the same idea, from the chapter's OWN pool, offered only
 *                    when one idea has held a learner up twice. Never says they are struggling.
 *   the side door    the arcade opened, and it is optional, with nothing lost by declining.
 *   the question     two or three questions THIS page can genuinely answer, drawn from the
 *                    concept's own misconceptions. A question the page cannot answer is a promise
 *                    broken on the tap, so it is never offered.
 *
 * THE ONE PROPERTY THAT MAKES ALL OF IT HONEST. Every builder below is a pure selection over data
 * that already exists for this learner: the chapter's module pool (docs/LEARNING-MODEL.md), the
 * group chosen for them, the glass in front of them. Nothing is generated, nothing is fetched, and
 * nothing reads what learners in general do. That is the difference between a tutor and a
 * recommendation engine, and it is structural here rather than a promise.
 */

import {
  type Blueprint,
  type BlueprintModule,
  type LearnerState,
  groupFor,
  insteadOf,
} from '../curriculum/blueprint';
import type { DoorOffer } from '../screens/course/side-door';

export type SuggestionKind = 'next' | 'way_back' | 'side_door' | 'ask';

/** Where the one action goes. One target, never a set of them: a suggestion is one thing. */
export type SuggestTarget =
  | { to: 'module'; moduleId: string }
  | { to: 'arcade'; topicId: string };

export interface Suggestion {
  kind: SuggestionKind;
  /**
   * Stable for the same offer in the same session, so a decline sticks to THIS suggestion rather
   * than to its whole kind. Built from the ids of the things it names, never from a counter.
   */
  id: string;
  /** The thing, named. One line. */
  title: string;
  /** Why it follows, in the pool's own words. One line. */
  why: string;
  /** What taking it says. */
  action: string;
  /** What declining it says. Always present: declining is as easy as taking it. */
  decline: string;
  /** A second quiet line where the kind needs one, and null where it does not. */
  note: string | null;
  /** The 'ask' kind's two or three questions. Empty for every other kind. */
  questions: readonly string[];
  /** What the action opens, or null when the questions are the action. */
  target: SuggestTarget | null;
}

/** What every suggestion says on the way out. No reason asked for, and no second prompt. */
const DECLINE = 'not now';

// --- the next thing -------------------------------------------------------------------------------

/**
 * Why this module is the one that follows, said in the pool's OWN declarations.
 *
 * The architect wrote what each module teaches, repairs and assumes so the planner could choose
 * without reading the content (docs/LEARNING-MODEL.md §5). The same declarations are what makes a
 * reason specific: "it is the way into pressure is the force spread over the area it presses on"
 * is this chapter's sentence, and a general one ("this comes next") would be no reason at all.
 */
function whyItFollows(bp: Blueprint, topicId: string, m: BlueprintModule): string {
  const topic = bp.topics.find((t) => t.id === topicId)?.name ?? bp.chapter;
  switch (m.role) {
    case 'prerequisite': {
      const a = bp.assumptions.find((x) => m.assumes.includes(x.id));
      return a
        ? `${topic} leans on ${a.what}, and this is where that gets laid.`
        : `${topic} leans on this one, so it comes first.`;
    }
    case 'way_in': {
      const idea = bp.ideas.find((i) => m.teaches.includes(i.id) && i.topics.includes(topicId));
      return idea ? `it is the way into ${idea.what}.` : `it is the way into ${topic}.`;
    }
    case 'repair': {
      const mis = bp.misconceptions.find((x) => x.id === m.repairs);
      return mis ? `it goes under the idea that ${mis.what}.` : `it goes back over ${topic}.`;
    }
    case 'check':
      return `it is where ${topic} shows itself, with the numbers changed.`;
    case 'stretch':
      return `${topic} is yours, so this one takes it further.`;
    default:
      return `it is what ${topic} goes to next.`;
  }
}

/**
 * THE NEXT THING: one module, named, and why it follows.
 *
 * It reads THIS learner's own group rather than the pool's printed order, which is the whole point
 * of docs/LEARNING-MODEL.md §2: two learners on the same chapter walk two different paths, and the
 * thing that follows is different for each of them. Nothing left in the group is the ordinary
 * answer at the end of a topic, and it is silence rather than a nudge.
 */
export function nextThing(args: {
  bp: Blueprint;
  topicId: string;
  done: ReadonlySet<string>;
  state?: LearnerState;
}): Suggestion | null {
  const { bp, topicId, done } = args;
  const group = groupFor(bp, topicId, args.state ?? {});
  const next = group.find((m) => !done.has(m.id));
  if (!next) return null;
  return {
    kind: 'next',
    id: `next:${topicId}:${next.id}`,
    title: next.aim,
    why: whyItFollows(bp, topicId, next),
    action: 'start it',
    decline: DECLINE,
    note: null,
    questions: [],
    target: { to: 'module', moduleId: next.id },
  };
}

// --- the way back ---------------------------------------------------------------------------------

/** A module's kind, said the way a learner would say it. The route is different, and named as such. */
const AS_WORDS: Record<BlueprintModule['kind'], string> = {
  reading: 'drawn out',
  worked: 'worked through a number at a time',
  simulation: 'as something to push around',
  film: 'filmed',
  items: 'as questions',
  game: 'as a game',
  boss: 'end to end',
};

/**
 * THE WAY BACK: the same idea from another side, and never a verdict.
 *
 * *"when a learner is stuck twice on one idea ... a different way into the same idea, from the
 * chapter's own pool"*, and it may never say *"that they are struggling, or anything that reads as
 * a verdict"*. Both halves are structural here:
 *
 *   TWICE, NOT ONCE.   One idea that does not land first time is ordinary and needs no help; a
 *                      route offered then would be the product telling a learner they are slow.
 *   THE POOL'S OWN.    The route is `flow.stuck` where the architect wrote one, and otherwise
 *                      another way into the same idea from the same chapter. Nothing outside the
 *                      pool is ever reached for, so the alternative is one somebody designed to
 *                      teach exactly this.
 *
 * The words say what the other route IS ("filmed", "worked through a number at a time") and name
 * the idea it goes into. They never mention the attempt that came before, which is what keeps a
 * suggestion from reading as a report card.
 */
export function wayBack(args: {
  bp: Blueprint;
  topicId: string;
  /** The module they are on. */
  moduleId: string;
  /** How many times this one idea has held them up. Fewer than two and nothing is offered. */
  held: number;
  /** What they have already met, so the way back is genuinely another way. */
  met: ReadonlySet<string>;
}): Suggestion | null {
  const { bp, topicId, moduleId, held, met } = args;
  if (held < 2) return null;
  const from = bp.modules.find((m) => m.id === moduleId);
  if (!from) return null;

  const byId = (id: string | null): BlueprintModule | undefined =>
    id ? bp.modules.find((m) => m.id === id) : undefined;
  const usable = (m: BlueprintModule | undefined): m is BlueprintModule =>
    !!m && m.id !== moduleId && !met.has(m.id);

  // The architect's own route first: they wrote it knowing what this module assumes.
  let alt = byId(insteadOf(bp, moduleId));
  if (!usable(alt)) {
    const order = bp.flow.order;
    alt = bp.modules
      .filter(
        (m) =>
          usable(m) &&
          m.role === 'way_in' &&
          m.serves.includes(topicId) &&
          m.teaches.some((i) => from.teaches.includes(i)),
      )
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
  }
  if (!usable(alt)) return null;

  const shared = from.teaches.find((i) => alt.teaches.includes(i));
  const idea = bp.ideas.find((i) => i.id === shared);
  const topic = bp.topics.find((t) => t.id === topicId)?.name ?? bp.chapter;
  return {
    kind: 'way_back',
    id: `way_back:${topicId}:${alt.id}`,
    title: alt.aim,
    why: `${idea?.what ?? topic}, ${AS_WORDS[alt.kind]}.`,
    action: 'open that one',
    decline: DECLINE,
    note: null,
    questions: [],
    target: { to: 'module', moduleId: alt.id },
  };
}

// --- the side door --------------------------------------------------------------------------------

/**
 * THE SIDE DOOR, as a suggestion.
 *
 * The door itself is already decided in `screens/course/side-door.ts` — where it may sit, what it
 * is worth, and the line it says about itself. This adapts it so the arbiter can hold it against
 * the other three and honour "at most one on screen at a time". It adds nothing: the words are the
 * door's own, and the line that says the climb goes on without it rides along as the note, because
 * "nothing lost by declining" has to be on the screen rather than in a document.
 */
export function sideDoor(offer: DoorOffer): Suggestion {
  return {
    kind: 'side_door',
    id: `side_door:${offer.chapterId}:${offer.spec.id}`,
    title: offer.spec.title,
    why: offer.why,
    action: 'open it',
    decline: DECLINE,
    note: offer.line,
    questions: [],
    target: { to: 'arcade', topicId: offer.topicId },
  };
}

// --- the question to ask --------------------------------------------------------------------------

/**
 * One question the level was built already knowing the answer to.
 *
 * `meaning` is the glass declaration that answers it (`wobo/instant.ts`): `misconception:<id>` for
 * the asks a concept's own misconceptions produce. A candidate whose meaning is not on the glass in
 * front of the learner is one this page cannot answer, and is never offered.
 */
export interface AskCandidate {
  text: string;
  meaning: string;
}

/** The most a page ever puts up. Two or three, per the law; three is the ceiling. */
export const MOST_QUESTIONS = 3;
/** And the floor. One question is not a set to choose from, it is an instruction. */
export const FEWEST_QUESTIONS = 2;

/**
 * THE QUESTION TO ASK: two or three this page can genuinely answer.
 *
 * Three gates, and a candidate passes all three or it is dropped:
 *   1. its meaning names a misconception,
 *   2. that misconception belongs to THIS topic in the chapter's own pool,
 *   3. and the glass in front of the learner carries the thing that answers it.
 *
 * Gate 3 is the one the law cares most about: *"a question the page cannot answer, which is a
 * promise broken on the tap"*. Fewer than two survivors is silence, never a single question
 * dressed up as a choice.
 */
export function questionsToAsk(args: {
  bp: Blueprint;
  topicId: string;
  asks: readonly AskCandidate[];
  /** The meanings this page's glass actually declares. */
  onGlass: ReadonlySet<string>;
}): Suggestion | null {
  const { bp, topicId, asks, onGlass } = args;
  const here = new Set(
    bp.misconceptions.filter((m) => m.topics.includes(topicId)).map((m) => m.id),
  );
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const ask of asks) {
    if (!ask.text.trim()) continue;
    if (!onGlass.has(ask.meaning)) continue;
    const [key, id] = ask.meaning.split(':');
    if (key !== 'misconception' || !id || !here.has(id)) continue;
    if (seen.has(ask.text)) continue;
    seen.add(ask.text);
    kept.push(ask.text);
    if (kept.length === MOST_QUESTIONS) break;
  }
  if (kept.length < FEWEST_QUESTIONS) return null;
  return {
    kind: 'ask',
    id: `ask:${topicId}:${kept.length}`,
    title: 'worth asking here',
    why: 'each of these is answered on this page.',
    action: 'ask it',
    decline: DECLINE,
    note: null,
    questions: kept,
    target: null,
  };
}
