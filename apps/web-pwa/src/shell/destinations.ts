/**
 * Fuzzy destination resolution — the one place free text becomes a Route.
 *
 * Wobo navigates on command (WOBO.md §10): "take me to practice", "show my progress", "open
 * chemistry" all resolve to a real surface here, and App.ask navigates directly — no approval card,
 * a spoken + inked confirmation, and never silence on a clear miss. This runs on the raw text, so
 * it works identically from the chat page and the docked drawer (both call the one App-level ask),
 * and it does not depend on the classifier reaching a `route` first.
 *
 * Reuses findTopic (id → name substring) for named courses and the canonical subject list for
 * named subjects, so a course or subject by name navigates too.
 */

import { subjectById, topicById } from '../curriculum/registry';
import { findTopic } from '../wobo/capabilities';
import type { Route } from './router';

/** Wobo resolved a place and will go there; or the intent was clearly navigational but unknown. */
export type NavResolve = { route: Route; say: string } | { unknown: string } | null;

/** The atom — the one fully proven course; owner shorthand for it (see capabilities.ts). */
const ATOM_TOPIC_ID = 'm2-1';

// A pure "go there" verb. STRONG = unambiguously locomotive (a miss is worth saying aloud);
// SOFT = navigational but overlaps with doing-verbs ("open", "show me"), so a miss falls through
// to the normal classifier instead of a "not found" line.
const STRONG_NAV =
  /^(?:take me (?:back )?to|bring me (?:back )?to|navigate (?:me )?to|go (?:back )?to|jump to|head (?:over )?to)\s+/;
const SOFT_NAV =
  /^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+|i want to\s+|i'd like to\s+|i wanna\s+|take me\s+|bring me\s+|let'?s\s+(?:go\s+(?:to\s+)?)?|open(?:\s+up|\s+the)?\s+|show\s+(?:me|my)\s+|see\s+|visit\s+|switch to\s+|pull up\s+|bring up\s+|go\s+)/;

const EXACT: Record<string, Route> = {
  home: { name: 'home' },
  chat: { name: 'chat' },
  conversation: { name: 'chat' },
  messages: { name: 'chat' },
  progress: { name: 'progress' },
  mastery: { name: 'progress' },
  twin: { name: 'progress' },
  practice: { name: 'practice' },
  practise: { name: 'practice' },
  sandbox: { name: 'practice' },
  'parent view': { name: 'parent' },
  parent: { name: 'parent' },
  profile: { name: 'you' },
  settings: { name: 'you' },
  account: { name: 'you' },
  you: { name: 'you' },
  learn: { name: 'learn' },
  library: { name: 'learn' },
  subject: { name: 'learn' },
  subjects: { name: 'learn' },
  course: { name: 'learn' },
  courses: { name: 'learn' },
  catalog: { name: 'learn' },
  atom: { name: 'course', topicId: ATOM_TOPIC_ID },
  // The doubt solver: a photo of the page, read back, explained on the photo (screens/doubt).
  doubt: { name: 'doubt' },
  'doubt solver': { name: 'doubt' },
  'my doubts': { name: 'doubt' },
  camera: { name: 'doubt' },
};

/** Canonical subject ids by the names a learner actually types (displaySubjectById resolves them). */
const SUBJECT_ALIAS: Record<string, string> = {
  math: 'math',
  maths: 'math',
  mathematics: 'math',
  physics: 'physics',
  chemistry: 'chemistry',
  biology: 'biology',
  cs: 'cs',
  'computer science': 'cs',
  'comp sci': 'cs',
  social: 'social',
  'social science': 'social',
  'social studies': 'social',
  science: 'science',
};

function subjectRoute(subjectId: string): Route {
  return { name: 'subject', subjectId, intent: 'learn' };
}

/** Bare messages must BE a destination — so "explain chemistry bonding" never navigates. */
function matchExact(s: string): Route | null {
  if (EXACT[s]) return EXACT[s];
  if (SUBJECT_ALIAS[s]) return subjectRoute(SUBJECT_ALIAS[s]);
  const topic = topicById(s); // an exact topic id, e.g. "m2-1"
  if (topic) return { name: 'course', topicId: topic.id };
  return null;
}

function matchSubjectLoose(s: string): string | null {
  if (/\b(?:maths?|mathematics)\b/.test(s)) return 'math';
  if (/\bphysics\b/.test(s)) return 'physics';
  if (/\bchemistry\b/.test(s)) return 'chemistry';
  if (/\bbiology\b/.test(s)) return 'biology';
  if (/(?:\bcomputer science\b|\bcomp sci\b|\bcs\b)/.test(s)) return 'cs';
  if (
    /(?:\bsocial science\b|\bsocial studies\b|\bsocial\b|\bcivics\b|\bgeography\b|\bhistory\b)/.test(
      s,
    )
  )
    return 'social';
  if (/\bscience\b/.test(s)) return 'science';
  return null;
}

/** After a nav verb, a place named anywhere in the phrase wins ("to the practice screen"). */
function matchLoose(s: string): Route | null {
  if (!s) return null;
  if (/\bhome\b/.test(s)) return { name: 'home' };
  if (/\b(?:chat|conversation|messages?)\b/.test(s)) return { name: 'chat' };
  if (/\b(?:progress|mastery|knowledge twin|twin)\b/.test(s)) return { name: 'progress' };
  if (/\bparent(?:'s)? view\b/.test(s)) return { name: 'parent' };
  if (/\b(?:practice|practise|sandbox)\b/.test(s)) return { name: 'practice' };
  if (/\b(?:profile|settings|account)\b/.test(s)) return { name: 'you' };
  // "open the camera", "show me my doubts": the doubt solver, only ever behind a go-there verb.
  if (/\b(?:doubts?|doubt solver|camera)\b/.test(s)) return { name: 'doubt' };
  if (/\b(?:library|subjects?|courses?|catalogue?|catalog|learn)\b/.test(s))
    return { name: 'learn' };
  if (/\batom\b/.test(s)) return { name: 'course', topicId: ATOM_TOPIC_ID };
  const subj = matchSubjectLoose(s);
  if (subj) return subjectRoute(subj);
  const topic = findTopic(s); // a course by name, e.g. "variables on both sides"
  if (topic) return { name: 'course', topicId: topic.id };
  return null;
}

function subjectName(id: string): string {
  return subjectById(id)?.name ?? (id === 'science' ? 'Science' : id);
}

/** Wobo's one-line confirmation as Wobo goes — sentence case, no exclamation (WOBO.md §1). */
function destSay(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'Taking you home.';
    case 'chat':
      return 'Opening the conversation.';
    case 'learn':
      return 'Opening your library.';
    case 'practice':
      return 'Taking you to practice.';
    case 'progress':
      return 'Here is your progress.';
    case 'you':
      return 'Opening your profile.';
    case 'parent':
      return "Opening the parent's view.";
    case 'doubt':
      return 'Opening the camera. Point it at the page.';
    case 'subject':
      return `Taking you to ${subjectName(route.subjectId)}.`;
    case 'course':
      return `Opening ${topicById(route.topicId)?.name ?? 'that course'}.`;
    default:
      return 'Taking you there.';
  }
}

/**
 * Resolve free text to a navigation. Returns a route (with Wobo's confirmation), an unknown-place
 * miss (Wobo says so), or null when the text is not navigational at all (let the classifier decide).
 */
export function resolveDestination(text: string): NavResolve {
  const raw = text
    .trim()
    .toLowerCase()
    .replace(/[?!.\s]+$/, '');
  if (!raw) return null;

  let rest = raw;
  let strong = false;
  let verb = false;
  const sm = rest.match(STRONG_NAV);
  if (sm) {
    strong = true;
    verb = true;
    rest = rest.slice(sm[0].length);
  } else {
    const soft = rest.match(SOFT_NAV);
    if (soft) {
      verb = true;
      rest = rest.slice(soft[0].length);
    }
  }
  rest = rest
    .replace(/^(?:the|my|a|an)\s+/, '')
    .replace(/\s+(?:screen|page|view|section|tab|chapter)$/, '')
    .trim();

  const route = verb ? matchLoose(rest) : matchExact(rest);
  if (route) return { route, say: destSay(route) };

  if (strong && rest) {
    return {
      unknown: `I could not find "${rest}" — tell me a subject, practice, or your progress.`,
    };
  }
  return null;
}
