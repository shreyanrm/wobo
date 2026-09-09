import { z } from 'zod';
import type { WoboMood } from './identity';

const MOODS = ['idle', 'thinking', 'listening', 'correct', 'celebrate', 'waiting', 'hint'] as const;

/**
 * Wobo's action vocabulary — the things Wobo can DO beside what Wobo says. Wobo's reasoning
 * returns a list of these; the executor runs the in-context ones at once and OFFERS the
 * consequential ones (the calm principle: power is available, never imposed).
 *
 * No mark lives here. Anything drawn on the page is a PLAN (docs/INK-FREEZE-PLAN-TRACE.md §3):
 * sentences with marks by glass id, streamed and traced by the one pen (board/). The overlay
 * grammar that used to sit beside it (highlight, annotate, write, point, a sentence beat per
 * action) went with the overlay pipeline (§4).
 */
export const WoboActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), text: z.string() }),
  z.object({ type: z.literal('setMood'), mood: z.enum(MOODS) }),
  // Demonstrate by doing — drive an interactive's own state through its applyTutorAction seam
  // (WOBO.md §4 setState). Only targets that expose scene state accept it.
  z.object({
    type: z.literal('setState'),
    targetId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  // Voice-locked speech (WOBO.md §4 speak): plays through the voice path when live, otherwise
  // rendered as Wobo's handwritten line.
  z.object({ type: z.literal('speak'), text: z.string() }),
  // Learn a durable fact the learner just shared — a preferred name, a goal, an exam date. Persisted
  // to the mind and rendered into every future dossier (WOBO.md §7). Never for transient chatter.
  z.object({ type: z.literal('remember'), text: z.string() }),
  // The data-rights twin of remember (WOBO-CAPABILITIES.md family E, the forget verb): show, correct,
  // or delete what Wobo remembers. scope 'show' reads the real dossier back; 'fact' drops what they name
  // (target); 'all' wipes the mind. Deleting is confirm-before-execute (capability ladder) — the app
  // purges from the real on-device mind and Wobo reports exactly what was removed. Never a guess.
  z.object({
    type: z.literal('forget'),
    scope: z.enum(['show', 'fact', 'all']),
    target: z.string().optional(),
  }),
  z.object({ type: z.literal('revealHint'), level: z.number().int().nonnegative() }),
  z.object({ type: z.literal('escalateHint') }),
  // Consequential — offered, never forced.
  z.object({ type: z.literal('navigate'), route: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal('startPractice'), nodeId: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal('switchModality'), to: z.string(), reason: z.string().optional() }),
]);

export type WoboAction = z.infer<typeof WoboActionSchema>;
export type ConsequentialAction = Extract<
  WoboAction,
  { type: 'navigate' | 'startPractice' | 'switchModality' }
>;

const CONSEQUENTIAL = new Set(['navigate', 'startPractice', 'switchModality']);

export function isConsequential(action: WoboAction): action is ConsequentialAction {
  return CONSEQUENTIAL.has(action.type);
}

/** Validate a raw action list from Wobo's reasoning; silently drop anything malformed. */
export function parseActions(raw: unknown): WoboAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: WoboAction[] = [];
  for (const item of raw) {
    const result = WoboActionSchema.safeParse(item);
    if (result.success) actions.push(result.data);
  }
  return actions;
}

// --- The pure reducer (so dispatch is testable without a DOM) -----------------------------------

/** A tutor-driven state patch aimed at a registered scene's applyTutorAction seam. */
export interface TutorStatePatch {
  targetId: string;
  patch: Record<string, unknown>;
}

/** A data-rights request (the forget action): show the dossier, or purge a fact / the whole mind. */
export interface ForgetEffect {
  scope: 'show' | 'fact' | 'all';
  target?: string;
}

export interface ActionEffects {
  mood: WoboMood | null;
  offer: ConsequentialAction | null;
  says: string[];
  /** Voice-locked lines: spoken when voice is live, otherwise Wobo's handwritten line. */
  speaks: string[];
  /** Durable facts Wobo learned this turn — persisted to the mind, fed into future dossiers. */
  remembers: string[];
  /** Data-rights requests this turn — the app renders the dossier or purges the mind, grounded. */
  forgets: ForgetEffect[];
  /** setState demonstrations, routed to each target's applyTutorAction seam. */
  setStates: TutorStatePatch[];
  revealHints: number[];
  escalateHints: number;
}

/** Fold a list of actions into the marks/mood/offer to apply and the side-effects to fire. Pure. */
export function reduceActions(actions: WoboAction[]): ActionEffects {
  const effects: ActionEffects = {
    mood: null,
    offer: null,
    says: [],
    speaks: [],
    remembers: [],
    forgets: [],
    setStates: [],
    revealHints: [],
    escalateHints: 0,
  };
  for (const action of actions) {
    switch (action.type) {
      case 'say':
        effects.says.push(action.text);
        break;
      case 'setMood':
        effects.mood = action.mood;
        break;
      case 'speak':
        effects.speaks.push(action.text);
        break;
      case 'remember':
        effects.remembers.push(action.text);
        break;
      case 'forget':
        effects.forgets.push({
          scope: action.scope,
          ...(action.target ? { target: action.target } : {}),
        });
        break;
      case 'setState':
        effects.setStates.push({ targetId: action.targetId, patch: action.patch });
        break;
      case 'revealHint':
        effects.revealHints.push(action.level);
        break;
      case 'escalateHint':
        effects.escalateHints += 1;
        break;
      default:
        if (isConsequential(action)) effects.offer = action;
    }
  }
  return effects;
}

/**
 * A compact description of the action vocabulary, for Wobo's reasoning prompt. Marks are not
 * actions: what Wobo draws is planned by glass id and traced by the one pen.
 */
export function describeActionVocabulary(): string {
  return [
    'You may return actions beside what you say. Available actions:',
    '- say: {"type":"say","text":"..."} — speak to the learner (a nudge, never the final answer).',
    '- setState: {"type":"setState","targetId":"<id>","patch":{...}} — demonstrate by doing: drive an interactive by patching its own state. Only for targets whose scene state is listed; the patch keys must match that state.',
    '- speak: {"type":"speak","text":"..."} — say it in your voice when voice is live; otherwise it appears as your handwritten line. Short, warm, never the final answer.',
    '- remember: {"type":"remember","text":"<a durable fact the learner just shared — a preferred name, a goal, a fear, an exam date>"} — save something worth carrying across sessions; use sparingly, never for transient chatter.',
    '- forget: {"type":"forget","scope":"show|fact|all","target":"<the fact to drop, for scope \'fact\'>"} — data rights: "show" reads back everything you remember about them, "fact" deletes the one they name, "all" wipes it. Deleting is confirm-before-execute — ask "want me to forget that?" and only emit a delete after they say yes. When they ask what you remember, offer that you can forget any of it.',
    '- setMood: {"type":"setMood","mood":"thinking|hint|correct|celebrate|waiting|idle"}.',
    '- revealHint: {"type":"revealHint","level":<n>} / escalateHint: {"type":"escalateHint"}.',
    '- navigate/startPractice/switchModality — consequential; these are OFFERED to the learner, not forced.',
    'Only reference targetId values that appear in the provided scene list. Walk a multi-step problem one step per turn; never dump the whole solution.',
  ].join('\n');
}
