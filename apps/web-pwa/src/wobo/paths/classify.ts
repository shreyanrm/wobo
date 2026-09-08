/**
 * The client half of the five-path orchestrator: parse the gateway's classified turn, and — when
 * the turn arrives unclassified (mock mode, an older gateway, a model that skipped the field) —
 * classify it deterministically by keyword so the whole seam works keyless.
 *
 * Keep the keyword rules in sync with classify_intent in
 * services/gateway/src/wobo_gateway/wobo.py (the server twin).
 */

import { CAPABILITY_IDS } from '../capabilities';
import { seedDoodle, seedFormulaCard, seedMakerPlan } from '../create';
import type { ActionAttachment, ComponentKind, ConfidenceBand, TurnExtras, VizKind } from './types';

const PATHS = new Set(['inline', 'component', 'visualization', 'action', 'route']);
const COMPONENT_KINDS = new Set<string>([
  'sim',
  'quiz',
  'flashcards',
  'formula',
  'maker',
  'doodle',
]);
const VIZ_KINDS = new Set<string>(['diagram', 'chart', 'conceptmap']);
const ROUTE_NAMES = new Set(['home', 'chat', 'learn', 'practice', 'progress', 'you']);

/**
 * Offers minted this session — safe-automatic capabilities auto-run only for these, so a card
 * replayed from the archive never re-executes on its own.
 */
export const freshOffers = new Set<string>();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// --- deterministic keyword classification (the keyless brain) ------------------------------------

interface LocalClassification {
  path: TurnExtras['path'];
  componentKind?: ComponentKind;
  vizKind?: VizKind;
  capability?: string;
  params?: Record<string, unknown>;
  why?: string;
  confidence?: ConfidenceBand;
  routeTo?: string;
  routeWhy?: string;
  concept: string;
}

const ROUTE_WORDS: [string, string][] = [
  ['home', 'home'],
  ['chat', 'chat'],
  ['conversation', 'chat'],
  ['library', 'learn'],
  ['subjects', 'learn'],
  ['learn', 'learn'],
  ['practice', 'practice'],
  ['progress', 'progress'],
  ['profile', 'you'],
  ['settings', 'you'],
];

function conceptFrom(text: string, fallback: string): string {
  const m = text.split(/\b(?:on|about|of|for)\b/i);
  if (m.length >= 2) {
    const concept = (m.slice(1).join(' ') ?? '').trim().replace(/^["']|["'.?!,]+$/g, '');
    if (concept) return concept.slice(0, 120);
  }
  return fallback;
}

export function classifyLocal(text: string, nodeName?: string): LocalClassification {
  const t = text.toLowerCase().trim();
  // No placeholder concept: with nothing to name, the concept is empty and nothing prints it.
  const fallback = nodeName || '';
  const concept = conceptFrom(t, fallback);

  // route — the learner just wants to go somewhere
  if (/\b(take me|go to|go back|open the)\b/.test(t)) {
    for (const [word, to] of ROUTE_WORDS) {
      if (t.includes(word)) {
        return { path: 'route', routeTo: to, routeWhy: `you asked to go to ${word}`, concept };
      }
    }
  }

  // action — Wobo does something in the product, through the governed registry
  if (t.includes('parent') && /\b(note|update|digest|tell|message)\b/.test(t)) {
    return {
      path: 'action',
      capability: 'prepare_parent_note',
      params: {},
      why: 'You asked me to prepare a note for your parent',
      confidence: 'high',
      concept,
    };
  }
  if (t.includes('boss')) {
    return {
      path: 'action',
      capability: 'start_boss',
      params: { query: concept === fallback ? '' : concept },
      why: 'You asked for the boss. It is how a topic is truly closed',
      confidence: 'medium',
      concept,
    };
  }
  if (t.includes('twin') || t.includes('weakest') || t.includes('weak at')) {
    return {
      path: 'action',
      capability: 'go_to_twin',
      params: {},
      why: 'Your knowledge twin is the honest map of what you asked about',
      confidence: 'high',
      concept,
    };
  }
  if (t.includes('practice') || t.includes('practise')) {
    return {
      path: 'action',
      capability: 'start_practice',
      params: {},
      why: 'A short unaided run is the fastest way to make this stick',
      confidence: 'medium',
      concept,
    };
  }
  if (/\b(open|start|begin)\b/.test(t) && /\b(course|topic|lesson)\b/.test(t)) {
    return {
      path: 'action',
      capability: 'open_course',
      params: { query: concept === fallback ? '' : concept },
      why: 'You asked to open this course',
      confidence: 'medium',
      concept,
    };
  }
  // learn intent — "teach me X", "I want to learn X", "make a course on X" compose a course,
  // even out-of-syllabus (the atom only ever a fallback when no concept is named)
  const learn = t.match(
    /\b(?:teach me(?: about)?|teach us|i want to learn|want to learn|help me learn|learn about|(?:make|create)(?: me)? an? course (?:on|about)|course (?:on|about))\s+(.+)/,
  );
  if (learn?.[1]) {
    const c = learn[1]
      .trim()
      .replace(/^["']|["'.?!,]+$/g, '')
      .slice(0, 120);
    if (c) {
      return {
        path: 'action',
        capability: 'open_course',
        params: { query: c },
        why: `You asked to learn ${c}`,
        confidence: 'medium',
        concept: c,
      };
    }
  }

  // create — real artifacts Wobo MAKES in the thread (family C). These sit on the component path.
  // Each grabs its own subject from the tail after the trigger, since it may not use on/of/for/about.
  const grab = (re: RegExp): string => {
    const m = t.match(re);
    const c = (m?.[1] ?? '')
      .trim()
      .replace(/^(a|an|the|me|of|for|about|on)\s+/, '')
      .replace(/^["']|["'.?!,]+$/g, '')
      .slice(0, 120);
    return c || concept;
  };
  if (
    /\bformula (sheet|card)\b|\bcheat ?sheet\b|\brevision (card|sheet)\b|\bformula sheet\b/.test(t)
  ) {
    const c = grab(
      /(?:formula (?:sheet|card)|cheat ?sheet|revision (?:card|sheet))\s*(?:for|on|of|about)?\s*(.*)/,
    );
    return { path: 'component', componentKind: 'formula', concept: c };
  }
  if (
    /\b(maker project|project plan|science project|let'?s build)\b/.test(t) ||
    /\bhelp me (build|make)\b/.test(t) ||
    /\bhow (do i|to) (build|make)\b/.test(t) ||
    /\bbuild (a|an|me)\b/.test(t)
  ) {
    const c = grab(/(?:build|make|project(?: plan)?)\s+(?:a|an|the|me)?\s*(.*)/);
    return { path: 'component', componentKind: 'maker', concept: c };
  }
  if (
    /\b(doodle|draw me|sketch me|make me a drawing)\b/.test(t) &&
    !/\b(diagram|chart|graph|plot|concept map|mind map)\b/.test(t)
  ) {
    const c = grab(/(?:doodle|draw me|sketch me|make me a drawing)\s*(?:of|a|an|the|me)?\s*(.*)/);
    return { path: 'component', componentKind: 'doodle', concept: c };
  }

  // component — an interactive surface summoned into the thread
  if (/\b(sim|simulate|simulation|play with|interactive)\b/.test(t)) {
    return { path: 'component', componentKind: 'sim', concept };
  }
  if (/\b(quiz|test me|mcq)\b/.test(t)) {
    return { path: 'component', componentKind: 'quiz', concept };
  }
  if (t.includes('flashcard') || t.includes('flash card') || t.includes('drill me')) {
    return { path: 'component', componentKind: 'flashcards', concept };
  }

  // visualization — a drawing answers better than words
  if (t.includes('concept map') || t.includes('mind map')) {
    return { path: 'visualization', vizKind: 'conceptmap', concept };
  }
  if (/\b(chart|graph|plot)\b/.test(t)) {
    return { path: 'visualization', vizKind: 'chart', concept };
  }
  if (/\b(diagram|draw)\b/.test(t)) {
    return { path: 'visualization', vizKind: 'diagram', concept };
  }

  return { path: 'inline', concept };
}

// --- deterministic seed specs (keyless floors — same honest register as the gateway seeds) --------

/** A SimSpec-shaped seed: the straight line, the one law every learner can bend. */
export function seedSimSpec(concept: string): Record<string, unknown> {
  return {
    id: 'seed-line',
    title: concept,
    law: 'y = m·x + c',
    caption: 'Drag m, x and c — the line answers instantly',
    params: [
      { id: 'm', label: 'm', min: -5, max: 5, initial: 2 },
      { id: 'x', label: 'x', min: -10, max: 10, initial: 3 },
      { id: 'c', label: 'c', min: -10, max: 10, initial: 1 },
    ],
    outputs: [{ id: 'y', label: 'y', expr: 'm*x + c' }],
    breakpoints: [
      {
        param: 'm',
        op: '==',
        value: 0,
        note: 'At m = 0 the line goes flat — x stops mattering. That is what slope means.',
      },
    ],
  };
}

/** The honest floor: structural questions about the method itself, never fabricated facts. */
export function seedQuizItems(): Record<string, unknown> {
  return {
    items: [
      {
        id: 'q1',
        type: 'mcq',
        prompt: 'What tells you a claimed answer is trustworthy?',
        options: [
          'it survives being tested against the original problem',
          'it looks like the worked example',
          'it was the first answer you found',
        ],
        answer: 'it survives being tested against the original problem',
      },
      {
        id: 'q2',
        type: 'mcq',
        prompt: 'Pushing a rule to its extreme shows you…',
        options: [
          'where the ideal model stops matching reality',
          'that the rule was never true',
          'that extremes should be avoided',
        ],
        answer: 'where the ideal model stops matching reality',
      },
      {
        id: 'q3',
        type: 'fill',
        prompt: 'Before trusting a result, test it against the ________ problem.',
        answer: 'original',
      },
    ],
  };
}

export function seedFlashcards(concept: string): Record<string, unknown> {
  return {
    cards: [
      {
        front: `Meet ${concept}`,
        hint: 'Where it quietly shows up',
        back: 'The unknown is what we are hunting. Everything else is a clue.',
      },
      {
        front: 'Feel the rule',
        hint: 'It behaves like a balance',
        back: 'Whatever you do to one side, you do to the other.',
      },
      {
        front: 'Predict, then check',
        hint: 'A claimed answer must survive',
        back: 'Substitute it back. If both sides agree, the answer stands.',
      },
      {
        front: 'Where it bends',
        hint: 'Every model has an edge',
        back: 'Knowing where the rule breaks is part of knowing the rule.',
      },
    ],
  };
}

/** Pick the honest client-side floor spec for a component kind — used when the gateway sent none. */
function seedComponentSpec(kind: ComponentKind, concept: string): Record<string, unknown> {
  switch (kind) {
    case 'sim':
      return seedSimSpec(concept);
    case 'quiz':
      return seedQuizItems();
    case 'flashcards':
      return seedFlashcards(concept);
    case 'formula':
      return seedFormulaCard(concept) as unknown as Record<string, unknown>;
    case 'maker':
      return seedMakerPlan(concept) as unknown as Record<string, unknown>;
    case 'doodle':
      return seedDoodle(concept) as unknown as Record<string, unknown>;
  }
}

/**
 * The honest client-side drawing when the gateway sent no SVG. It is ink on paper, so it is drawn
 * in the theme's own colours: `currentColor` for every stroke and label (the card sets `color` from
 * the ink token) and `var(--wobo-paper)` for the fills that must knock out the background. Hard
 * `#111` on `#fff` disappeared into a dark page.
 */
// --- resolving a turn into extras -----------------------------------------------------------------

function newAction(
  capability: string,
  params: Record<string, unknown>,
  why: string,
  confidence: ConfidenceBand,
  evidence: string[],
): ActionAttachment {
  const offerId = crypto.randomUUID();
  freshOffers.add(offerId);
  return { capability, params, why, evidence, confidence, offerId, status: 'offered' };
}

function buildEvidence(text: string, nodeName?: string): string[] {
  const asked = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  const evidence = [`you asked: "${asked}"`];
  if (nodeName) evidence.push(`we are on ${nodeName} right now`);
  return evidence;
}

/**
 * Turn a wobo.turn output into thread extras. The gateway's classification wins when present and
 * valid; otherwise the local keyword classifier decides, and seed specs keep it working keyless.
 * Inline turns return { path: 'inline' } — the caller attaches nothing.
 */
/**
 * A board-stream `card` frame is the bare payload (`output.viz` or `output.component` on its
 * own), not the `{ path, viz }` an ordinary turn returns. Read as an ordinary turn it had no svg
 * under `.viz`, so every drawing that arrived over the wire degraded to prose while Wobo's line
 * still read the drawing aloud (DESIGN.md §0.x). The bare card is lifted back into a turn.
 */
export function liftBoardCard(output: Record<string, unknown>): Record<string, unknown> {
  if (typeof output.path === 'string' || typeof output.kind !== 'string') return output;
  if (VIZ_KINDS.has(output.kind)) return { path: 'visualization', viz: output };
  if (COMPONENT_KINDS.has(output.kind)) return { path: 'component', component: output };
  return output;
}

export function resolveTurnExtras(
  output: Record<string, unknown>,
  text: string,
  nodeName?: string,
): TurnExtras {
  const evidence = buildEvidence(text, nodeName);
  const local = classifyLocal(text, nodeName);
  output = liftBoardCard(output);
  const path = typeof output.path === 'string' && PATHS.has(output.path) ? output.path : local.path;

  if (path === 'component') {
    const gw = isRecord(output.component) ? output.component : {};
    const kind = (
      typeof gw.kind === 'string' && COMPONENT_KINDS.has(gw.kind) ? gw.kind : local.componentKind
    ) as ComponentKind | undefined;
    if (!kind) return { path: 'inline' };
    const concept = (typeof gw.concept === 'string' && gw.concept) || local.concept || '';
    const spec = gw.spec ?? seedComponentSpec(kind, concept);
    return { path: 'component', component: { kind, concept, spec } };
  }

  if (path === 'visualization') {
    const gw = isRecord(output.viz) ? output.viz : {};
    const kind = (
      typeof gw.kind === 'string' && VIZ_KINDS.has(gw.kind) ? gw.kind : local.vizKind
    ) as VizKind | undefined;
    if (!kind) return { path: 'inline' };
    const gwSpec = isRecord(gw.spec) ? gw.spec : {};
    const caption =
      (typeof gwSpec.caption === 'string' && gwSpec.caption) || local.concept || undefined;
    // A drawing that did not arrive is not stubbed: the turn stays prose (DESIGN.md §0.x, never a
    // caption for an absence). The words are the answer until the ink is real.
    if (typeof gwSpec.svg !== 'string' || !gwSpec.svg.includes('<svg')) return { path: 'inline' };
    return { path: 'visualization', viz: { kind, spec: { svg: gwSpec.svg, caption } } };
  }

  if (path === 'action') {
    const gw = isRecord(output.action) ? output.action : {};
    const capability =
      typeof gw.capability === 'string' && CAPABILITY_IDS.has(gw.capability)
        ? gw.capability
        : local.capability;
    if (!capability) return { path: 'inline' };
    const params = isRecord(gw.params) ? gw.params : (local.params ?? {});
    const why =
      (typeof gw.why === 'string' && gw.why) || local.why || 'this looked like the right next move';
    const confidence = (
      gw.confidence === 'high' || gw.confidence === 'medium' || gw.confidence === 'low'
        ? gw.confidence
        : (local.confidence ?? 'medium')
    ) as ConfidenceBand;
    return { path: 'action', action: newAction(capability, params, why, confidence, evidence) };
  }

  if (path === 'route') {
    const gw = isRecord(output.route) ? output.route : {};
    const to = typeof gw.to === 'string' && ROUTE_NAMES.has(gw.to) ? gw.to : local.routeTo;
    if (!to) return { path: 'inline' };
    const why = (typeof gw.why === 'string' && gw.why) || local.routeWhy;
    return { path: 'route', route: { to, why } };
  }

  return { path: 'inline' };
}
