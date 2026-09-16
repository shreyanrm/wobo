'use client';

/**
 * The generated course player. Every non-atom topic is playable here with real generated
 * content: engine.compose writes the course (cards + a mini-workbook + a boss, answers
 * verified server-side), then each card hydrates through its own engine (engine.simulate
 * CAS-verified, engine.diagram sanitized) and renders on the guided-discovery shell —
 * act-to-reveal, Check/Continue, per-card XP, the boss, the greeting, the ignite.
 *
 * Generation states are honest: a skeleton shimmer while Wobo composes (notification-style,
 * never a fake spinner promise), and any refusal anywhere falls back to the structural seed
 * course — invisible to the learner, never an error (CONTEXT.md §6).
 */

import type { ImageSpec, Item as WireItem } from '@wobo/contracts/plexus';
import { glassLabel, meaningSlug, useRegisterTarget, WaitScene, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GroundReport, groundFor, subscribeGround } from '../../curriculum/placement';
import { chapterById, topicById } from '../../curriculum/registry';
import type { Topic } from '../../data/model';
import { AnatomyScene, parseAnatomyScene } from '../../engines/AnatomyScene';
import { ArcadeShell, type ArcadeSpec, parseArcade } from '../../engines/ArcadeShell';
import { BioScene, type BioSceneSpec, parseBioScene } from '../../engines/BioScene';
import { ChemScene, type ChemSceneSpec, parseChemScene } from '../../engines/ChemScene';
import {
  CompareInteractive,
  type CompareSpec,
  parseCompareSpec,
} from '../../engines/CompareInteractive';
import { Composer } from '../../engines/composition/Composer';
import { floorFor } from '../../engines/composition/floors';
import { type Design, parseDesign } from '../../engines/composition/parse';
import { ConceptMap, type ConceptMapSpec, parseConceptMapSpec } from '../../engines/ConceptMap';
import {
  DerivationCard,
  type DerivationSpec,
  parseDerivation,
} from '../../engines/DerivationDepth';
import { DiagramView, svgIsClean } from '../../engines/DiagramView';
import { Discovery, type DiscoverySpec, parseDiscoverySpec } from '../../engines/Discovery';
import { Flashcards, type FlashcardsSpec, parseFlashcards } from '../../engines/Flashcards';
import { MapScene, type MapSpec, parseMapScene } from '../../engines/MapScene';
import { MathScene, type MathSceneSpec, parseMathScene } from '../../engines/MathScene';
import { MiniWorkbook, type MiniWorkbookSpec, parseMiniWorkbook } from '../../engines/MiniWorkbook';
import { MotionPlayer, type MotionScene, parseMotionScene } from '../../engines/MotionPlayer';
import {
  PerturbationSandbox,
  type PerturbSpec,
  parsePerturbSpec,
} from '../../engines/PerturbationSandbox';
import { PhysicsScene, parsePhysicsScene } from '../../engines/PhysicsScene';
import { PodcastPlayer, type PodcastSpec, parsePodcast } from '../../engines/PodcastPlayer';
import {
  parseSimSpec,
  SimRunner,
  type SimScene,
  simSpecFromGateway,
} from '../../engines/SimRunner';
import { parseSocialScene, SocialScene, type SocialSceneSpec } from '../../engines/SocialScene';
import { parseWhatIfSpec, WhatIfNumerical, type WhatIfSpec } from '../../engines/WhatIfNumerical';
import {
  parseWordProblem,
  WordProblemBreakdown,
  type WordProblemSpec,
} from '../../engines/WordProblemBreakdown';
import { reconcilePlaceholder } from '../../store/downloads';
import { preferredAnalogy } from '../../store/mind';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { CourseIntroScene } from '../../ui/courseIntro';
import { hueForTopic, subjectForTopic } from '../../ui/hues';
import { cascade, rise } from '../../ui/kit';
import { type BridgeLesson, bridgeFor, bridgeFromReport } from '../../wobo/bridge';
import { useWoboChat } from '../../wobo/chat';
import { rememberCore } from '../../wobo/core-store';
import { openCompanion } from '../../wobo/drawer';
import type { CoreCard } from '../../wobo/instant';
import {
  noteConceptCorrect,
  type ReteachTurn,
  reteachNow,
  reteachOnMiss,
  seedFromEvidence,
} from '../../wobo/reteach';
import { topicNodeUuid } from '../learn/mastery';
import { BridgeStep } from './BridgeStep';
import { Greeting } from './Greeting';
import {
  keepCardArtifact,
  keepFilm,
  keepLesson,
  keptCardArtifact,
  keptFilm,
  keptLesson,
} from './kept';
import { composedCardFromLink } from './open-at';
import { SideDoor } from './SideDoor';
import type { BarState, LessonOutline } from './shared';
import {
  CardBody,
  ChoiceButton,
  cardTitle,
  Deck,
  lead,
  offersAnotherWay,
  readCoursePos,
  rgba,
  Stage,
  tryAgainRung,
  whisper,
  writeCoursePos,
} from './shared';
import { offerFor } from './side-door';
import { sideDoor as sideDoorSuggestion } from '../../suggest/kind';
import { Suggestions } from '../../suggest/Suggestions';

// --- The composed course (engine.compose output, validated before anything renders) ---------------

type CardKind = 'sim' | 'diagram' | 'text';
type ActKind = 'tap' | 'drag' | 'slide' | 'type';

/** A physics-of-understanding renderer a card can carry — each owns its own shell + action bar. */
type CardActivity =
  /**
   * The model's own interaction, designed for THIS concept as a composition of primitives
   * (docs/CONTENT-INTERACTION.md §3). It comes first below: a designed interaction beats a
   * template, and when the design is refused the concept's template floor takes its place, so the
   * quality never falls under the floor and the learner never sees the difference.
   */
  | { type: 'design'; spec: Design }
  | { type: 'perturb'; spec: PerturbSpec }
  | { type: 'whatif'; spec: WhatIfSpec }
  | { type: 'compare'; spec: CompareSpec }
  | { type: 'conceptMap'; spec: ConceptMapSpec }
  // type-batch B — practice & delight
  | { type: 'workbook'; spec: MiniWorkbookSpec }
  | { type: 'flashcards'; spec: FlashcardsSpec }
  | { type: 'derivation'; spec: DerivationSpec }
  | { type: 'wordProblem'; spec: WordProblemSpec }
  | { type: 'podcast'; spec: PodcastSpec }
  | { type: 'arcade'; spec: ArcadeSpec }
  // the substrate — subject-true scenes (math axes, exact physics, real chemistry)
  | { type: 'mathScene'; spec: MathSceneSpec }
  | { type: 'physics'; spec: PhysicsScene }
  | { type: 'chemScene'; spec: ChemSceneSpec }
  | { type: 'bioScene'; spec: BioSceneSpec }
  | { type: 'socialScene'; spec: SocialSceneSpec }
  | { type: 'map'; spec: MapSpec }
  | { type: 'anatomy'; spec: AnatomyScene };

/**
 * Which of a card's renderers is on stage. A card may carry BOTH a discovery and an activity: the
 * discovery plays first, and once it is done the activity follows on the same card. Returning
 * `discovery` ahead of the whole activity branch used to leave every derivation, flashcard set and
 * podcast that rode beside a discovery generated, paid for and never seen (SCORECARD.md 3.5 #18).
 */
export function cardBeat(
  card: Pick<GenCard, 'discovery' | 'activity'>,
  discoveryDone: boolean,
): 'discovery' | 'activity' | 'idea' {
  if (card.discovery && !discoveryDone) return 'discovery';
  if (card.activity) return 'activity';
  return 'idea';
}

/** Try each activity parser in turn; the first field that yields a valid spec wins (refusal → none). */
function parseActivity(c: Record<string, unknown>): CardActivity | undefined {
  // The designed interaction first. `design` is the field the gateway carries an InteractionDesign
  // on; a card that names its §2 row but whose design was refused falls to that row's floor, which
  // is written in the same vocabulary and rendered by the same composer.
  const design = parseDesign(c.design);
  if (design) return { type: 'design', spec: design };
  if (typeof c.interactionKind === 'string') {
    const floor = parseDesign(floorFor(c.interactionKind));
    if (floor) return { type: 'design', spec: floor };
  }
  const perturb = parsePerturbSpec(c.perturbation);
  if (perturb) return { type: 'perturb', spec: perturb };
  const whatif = parseWhatIfSpec(c.whatIf);
  if (whatif) return { type: 'whatif', spec: whatif };
  const compare = parseCompareSpec(c.compare);
  if (compare) return { type: 'compare', spec: compare };
  const conceptMap = parseConceptMapSpec(c.conceptMap);
  if (conceptMap) return { type: 'conceptMap', spec: conceptMap };
  const workbook = parseMiniWorkbook(c.workbook);
  if (workbook) return { type: 'workbook', spec: workbook };
  const flashcards = parseFlashcards(c.flashcards);
  if (flashcards) return { type: 'flashcards', spec: flashcards };
  const derivation = parseDerivation(c.derivation);
  if (derivation) return { type: 'derivation', spec: derivation };
  const wordProblem = parseWordProblem(c.wordProblem);
  if (wordProblem) return { type: 'wordProblem', spec: wordProblem };
  const podcast = parsePodcast(c.podcast);
  if (podcast) return { type: 'podcast', spec: podcast };
  const arcade = parseArcade(c.arcade);
  if (arcade) return { type: 'arcade', spec: arcade };
  const mathScene = parseMathScene(c.mathScene);
  if (mathScene) return { type: 'mathScene', spec: mathScene };
  const physics = parsePhysicsScene(c.physicsScene);
  if (physics) return { type: 'physics', spec: physics };
  const chemScene = parseChemScene(c.chemScene);
  if (chemScene) return { type: 'chemScene', spec: chemScene };
  const bioScene = parseBioScene(c.bioScene);
  if (bioScene) return { type: 'bioScene', spec: bioScene };
  const socialScene = parseSocialScene(c.socialScene);
  if (socialScene) return { type: 'socialScene', spec: socialScene };
  const map = parseMapScene(c.mapScene);
  if (map) return { type: 'map', spec: map };
  const anatomy = parseAnatomyScene(c.anatomyScene);
  if (anatomy) return { type: 'anatomy', spec: anatomy };
  return undefined;
}

/**
 * The contract's ImageSpec with the optional caption narrowed off null — the client's shape.
 * `_verify_image_spec` in the gateway is the authoritative gate; this re-validates it anyway,
 * because a card is model output and the raster request is a spend.
 */
type RasterSpec = Omit<ImageSpec, 'caption'> & { caption?: string };

function parseImageSpec(raw: unknown): RasterSpec | undefined {
  if (!isRecord(raw)) return undefined;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (!subject) return undefined;
  const caption = typeof raw.caption === 'string' ? raw.caption.trim() : '';
  return caption ? { subject, caption } : { subject };
}

export interface GenCard {
  id: string;
  kind: CardKind;
  title: string;
  idea: string;
  interaction: { kind: ActKind; prompt: string };
  reveal: string;
  /** When present, this card renders on the guided-discovery shell instead of the act/check flow. */
  discovery?: DiscoverySpec;
  /** When present, this card renders a physics-of-understanding engine (its own shell). */
  activity?: CardActivity;
  /**
   * When present, this card's visual is organic or complex — a plant cell, the human body — and
   * SVG line art cannot express it. The diagram is hydrated through the gateway's raster seam
   * (`engine.diagram` with `raster: true` → Nano Banana, sanitized server-side and again here)
   * rather than the line-art SVG path. The gateway falls back to SVG if the image path refuses,
   * so the card renders either way.
   */
  imageSpec?: RasterSpec;
}

/**
 * The wire Item from the generated contract, with options narrowed to the client's parsed shape.
 * `explanation` is the teaching line a miss deserves (SCORECARD.md 3.5 #14); the gateway schema is
 * growing it, and this side renders it the moment it arrives. Absent, the answer alone is shown.
 */
type GenItem = Omit<WireItem, 'options'> & { options?: string[]; explanation?: string };

export interface GenCourse {
  courseId: string;
  title: string;
  cards: GenCard[];
  workbook: GenItem[];
  boss: GenItem[];
  seeded: boolean;
}

const CARD_KINDS: ReadonlySet<string> = new Set(['sim', 'diagram', 'text']);
const ACT_KINDS: ReadonlySet<string> = new Set(['tap', 'drag', 'slide', 'type']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseItems(raw: unknown): GenItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: GenItem[] = [];
  raw.forEach((it, i) => {
    if (!isRecord(it)) return;
    const prompt = typeof it.prompt === 'string' ? it.prompt.trim() : '';
    const answer = typeof it.answer === 'string' ? it.answer.trim() : '';
    if (!prompt || !answer) return;
    const id = typeof it.id === 'string' ? it.id : `i${i + 1}`;
    const explanation = typeof it.explanation === 'string' ? it.explanation.trim() : '';
    const teach = explanation ? { explanation } : {};
    if (it.type === 'mcq' && Array.isArray(it.options)) {
      const options = it.options.filter(
        (o): o is string => typeof o === 'string' && o.trim() !== '',
      );
      // the verifier's law, re-checked at the door: exactly one correct option present
      if (options.length < 2 || options.filter((o) => o === answer).length !== 1) return;
      items.push({ id, type: 'mcq', prompt, options, answer, ...teach });
    } else if (it.type === 'fill') {
      items.push({ id, type: 'fill', prompt, answer, ...teach });
    }
  });
  return items.length >= 3 ? items.slice(0, 3) : null;
}

/**
 * Is this engine envelope the honest floor rather than this topic's content? The gateway names it
 * three ways: `seeded: true` on the envelope, and `provenance.placeholder: true` /
 * `provenance.source: "seed"` (engines._public_provenance). Every hydration reads it here, once,
 * because a seed served under `verified: true, status: "canonical"` used to reach a learner as
 * the lesson (SCORECARD.md 3.2 #55): a balance-beam algebra scaffold in a biology cell.
 */
export function isPlaceholderEnvelope(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.seeded === true) return true;
  const prov = isRecord(raw.provenance) ? raw.provenance : null;
  return prov !== null && (prov.placeholder === true || prov.source === 'seed');
}

export function parseGenCourse(raw: unknown, fallbackTitle: string): GenCourse | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const rawCards = Array.isArray(src.cards) ? src.cards : [];
  const cards: GenCard[] = [];
  rawCards.forEach((c, i) => {
    if (!isRecord(c)) return;
    const interaction = isRecord(c.interaction) ? c.interaction : null;
    const actKind = interaction && typeof interaction.kind === 'string' ? interaction.kind : '';
    const prompt = interaction && typeof interaction.prompt === 'string' ? interaction.prompt : '';
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    const idea = typeof c.idea === 'string' ? c.idea.trim() : '';
    const reveal = typeof c.reveal === 'string' ? c.reveal.trim() : '';
    const kind =
      typeof c.kind === 'string' && CARD_KINDS.has(c.kind) ? (c.kind as CardKind) : 'text';
    if (!title || !idea || !reveal || !prompt || !ACT_KINDS.has(actKind)) return;
    cards.push({
      id: typeof c.id === 'string' ? c.id : `c${i + 1}`,
      kind,
      title,
      idea,
      interaction: { kind: actKind as ActKind, prompt },
      reveal,
      discovery: parseDiscoverySpec(c.discovery) ?? undefined,
      activity: parseActivity(c),
      imageSpec: parseImageSpec(c.imageSpec),
    });
  });
  if (cards.length < 3) return null;
  const workbook = parseItems(src.workbook);
  const boss = parseItems(src.boss);
  if (!workbook || !boss) return null;
  return {
    courseId: crypto.randomUUID(),
    title: typeof src.topic === 'string' ? src.topic : fallbackTitle,
    cards,
    workbook,
    boss,
    seeded: isPlaceholderEnvelope(raw),
  };
}

/**
 * The bridge across the ground under a topic, laid in front of the course's own first card.
 *
 * The learner experiences ONE lesson that starts a little lower down, never a detour they have to
 * find their way back from: the bridge is card one, the topic is card two, and the side column's
 * outline shows them as the same journey. Null means the learner already stands on everything this
 * topic needs, and the course begins exactly as it always did.
 *
 * The card inserted here is a PLACEHOLDER so the course's own counting (stops, the outline, the
 * resume index) is right. What the learner reads is `BridgeStep`, which is chosen by this card's
 * id at render time and owns its own words, its own bar and its own lack of a reward.
 */
function withBridge(course: GenCourse, lesson: BridgeLesson | null): GenCourse {
  if (!lesson) return course;
  return {
    ...course,
    cards: [
      {
        id: 'bridge',
        kind: 'text',
        title: `First, the ground under ${lesson.topic.name.toLowerCase()}`,
        idea: lesson.opening,
        interaction: { kind: 'tap', prompt: '' },
        reveal: lesson.arrival,
      },
      ...course.cards,
    ],
  };
}

/**
 * The client-side floor for mock mode or a network refusal — structural, never fabricated.
 *
 * WHERE IT IS ACTUALLY SEEN, said plainly because it decides how much this floor owes a learner.
 * It is built with `seeded: true`, and a seeded course is never started: the ink screen's bar reads
 * "Back for now" rather than "Start the course", a saved position is not restored into one and a
 * link that named a card is refused. So on a live build the cards below are read on the ink screen
 * and the workbook and boss below are not reached through that door. They are still held to rule 3
 * of "The tutor never leaves" (every item carries the reason its answer is the answer): a floor
 * that teaches nothing on the one path that does render it is a floor waiting to be a defect, and
 * the gateway's own floor was already fixed to the same bar.
 */
export function seedCourse(title: string): GenCourse {
  const n = title.toLowerCase();
  return {
    courseId: crypto.randomUUID(),
    title,
    seeded: true,
    cards: [
      {
        id: 'c1',
        kind: 'text',
        title: `Meet ${n}`,
        idea: `One place in the real world where ${n} quietly shows up.`,
        interaction: { kind: 'tap', prompt: 'Tap the part that looks unknown.' },
        reveal: 'The unknown is what we are hunting. Everything else is a clue.',
      },
      {
        id: 'c2',
        kind: 'sim',
        title: 'Feel the rule',
        idea: 'The idea behaves like a balance: change one side, the other follows.',
        interaction: { kind: 'drag', prompt: 'Drag a number until the relationship balances.' },
        reveal: 'Whatever you do to one side, you do to the other.',
      },
      {
        id: 'c3',
        kind: 'diagram',
        title: 'Predict, then check',
        idea: 'A claimed answer must survive the original problem.',
        interaction: { kind: 'type', prompt: 'Type your value and test it.' },
        reveal: 'Substitute it back. If both sides agree, the answer stands.',
      },
      {
        id: 'c4',
        kind: 'text',
        title: 'Where it bends',
        idea: `Every model of ${n} has an edge where it stops working.`,
        interaction: { kind: 'slide', prompt: 'Push the setting to its extreme.' },
        reveal: 'Knowing where the rule breaks is part of knowing the rule.',
      },
    ],
    /*
     * EVERY ITEM CARRIES THE REASON ITS ANSWER IS THE ANSWER (docs/LEARNING-MODEL.md, "The tutor
     * never leaves", rule 3: *"Every wrong answer gets the reason it is wrong ... Never 'incorrect,
     * try again'. Never a generic hint."*).
     *
     * The gateway's own floor (`plexus/engines.py`, `_level_from_core`) gives all six of its
     * workbook items and all six of its boss items an explanation drawn from the core's own
     * misconceptions. This floor had none at all on any of its six, so on the one path that
     * reaches it every miss fell back to the answer and nothing else. These reasons are about the
     * method each item actually asks about, which is what this floor genuinely teaches; nothing
     * here is invented about a topic, because this floor is structural and never claims to be one.
     *
     * No two of them say the same thing, for the reason the gateway's floor states in the same
     * place: three identical lines on one screen is one generic hint printed three times.
     */
    workbook: [
      {
        id: 'w1',
        type: 'mcq',
        prompt: 'What tells you a claimed answer is trustworthy?',
        options: [
          'It survives being tested against the original problem',
          'It looks like the worked example',
          'It was the first answer you found',
        ],
        answer: 'It survives being tested against the original problem',
        explanation:
          'Looking like the worked example only says it has the right shape, and finding it first only says it came quickly. Neither is evidence. Putting it back into the problem it came from is.',
      },
      {
        id: 'w2',
        type: 'mcq',
        prompt: 'Pushing a rule to its extreme shows you…',
        options: [
          'Where the ideal model stops matching reality',
          'That the rule was never true',
          'That extremes should be avoided',
        ],
        answer: 'Where the ideal model stops matching reality',
        explanation:
          'A rule that breaks at the extreme has not been shown to be false. It has been shown to have an edge, and knowing where that edge is, is part of knowing the rule.',
      },
      {
        id: 'w3',
        type: 'fill',
        prompt: 'Before trusting a result, test it against the ________ problem.',
        answer: 'original',
        explanation:
          'Every step you took could have carried a slip forward with it, so checking against your own working can agree with the slip. The problem you started from is the only thing that cannot.',
      },
    ],
    boss: [
      {
        id: 'b1',
        type: 'mcq',
        prompt: 'Which move is always legal while working a problem?',
        options: [
          'One that keeps the answer set exactly the same',
          'One that makes the numbers smaller',
          'One that removes the hardest part',
        ],
        answer: 'One that keeps the answer set exactly the same',
        explanation:
          'Smaller numbers and a dropped hard part are both about how the working looks to you. A move is legal when the set of things that satisfy the problem has not changed.',
      },
      {
        id: 'b2',
        type: 'mcq',
        prompt: 'You test your answer and the two sides disagree. What does that mean?',
        options: [
          'the answer does not survive the original problem',
          'the original problem must be wrong',
          'Checking only works on easy problems',
        ],
        answer: 'the answer does not survive the original problem',
        explanation:
          'The problem is the fixed thing here and the answer is the thing being claimed, so a disagreement is about the claim. That is the check doing exactly the job it is for.',
      },
      {
        id: 'b3',
        type: 'fill',
        prompt: 'Each legal move keeps the answer set exactly the ________.',
        answer: 'same',
        explanation:
          'This is the same rule b1 asks for, said from the other side: if a move changed which values satisfy the problem, the thing you end up solving is no longer the thing you were asked.',
      },
    ],
  };
}

// --- Events: a deterministic node id per topic (the contract wants UUIDs) --------------------------

/**
 * Moved to `screens/learn/mastery.ts`, where the bands derived from this evidence are read, so the
 * id a topic records under and the id its band is looked up by cannot drift apart. Re-exported here
 * because both the practice pools and the forge builder import it from this module.
 */
export { topicNodeUuid };

// --- Per-card artifacts (hydrated through the matching engine, refusal invisible) ------------------

type Artifact =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'ready'; kind: 'sim'; spec: SimScene }
  | { status: 'ready'; kind: 'diagram'; svg: string };

/**
 * The one place a card's engine request is built — every hydration routes through it.
 *
 * A card that declared an `imageSpec` wants the RASTER seam rather than line art: the gateway
 * routes `engine.diagram` + `raster: true` through Nano Banana and wraps the result as an inline
 * `<svg><image href="data:image/png;base64,…">`, which `sanitizeSvgElement` admits (raster data
 * URIs are on its allowlist; `data:image/svg+xml` is not). If the image path has no key or
 * refuses, the gateway falls through to the SVG path on its own, so the card renders either way.
 * The subject the model named is a better prompt than the card title, so it becomes the concept.
 */
export function engineRequest(
  card: GenCard,
  topic: string,
  courseId: string,
): { capability: 'engine.simulate' | 'engine.diagram'; payload: Record<string, unknown> } {
  const raster = card.kind === 'diagram' ? card.imageSpec : undefined;
  return {
    capability: card.kind === 'sim' ? 'engine.simulate' : 'engine.diagram',
    payload: {
      concept: raster ? `${topic}: ${raster.subject}` : `${topic}: ${card.title}`,
      topic,
      brief: card.idea,
      course_id: courseId,
      difficulty: 'core',
      ...(raster ? { raster: true } : {}),
    },
  };
}

function useArtifact(card: GenCard, topic: string, courseId: string): Artifact {
  const sdk = useSdk();
  const [artifact, setArtifact] = useState<Artifact>({ status: 'pending' });

  useEffect(() => {
    if (card.kind === 'text') return;
    let cancelled = false;
    setArtifact({ status: 'pending' });
    // The picture this card already drew, kept beside its lesson (screens/course/kept.ts). It is
    // what makes a kept lesson play IN FULL with no signal rather than as words with a gap where
    // the diagram was, and online it spares the engine a second rendering of a card the learner
    // has already been shown.
    const held = keptCardArtifact(courseId, card.id);
    if (held) {
      setArtifact({ status: 'ready', ...held } as Artifact);
      return;
    }
    const { capability, payload } = engineRequest(card, topic, courseId);
    sdk.llm
      .invoke(capability, payload, { consentTier: 'un_elevated' })
      .then((res) => {
        if (cancelled) return;
        const body =
          isRecord(res.output) && 'artifact' in res.output ? res.output.artifact : res.output;
        // A placeholder (the live generation refused) is a generic scaffold with the topic's name
        // in it. Rather than risk a wrong-subject sandbox or picture on this card, degrade to the
        // idea + act, the honest floor. Read for BOTH kinds: the diagram path used to skip it.
        if (isPlaceholderEnvelope(res.output)) {
          setArtifact({ status: 'failed' });
          return;
        }
        if (card.kind === 'sim') {
          const spec = simSpecFromGateway(res.output, card.title) ?? parseSimSpec(body);
          if (spec) keepCardArtifact(courseId, card.id, { kind: 'sim', spec });
          setArtifact(spec ? { status: 'ready', kind: 'sim', spec } : { status: 'failed' });
        } else {
          const svg =
            typeof body === 'string'
              ? body
              : isRecord(body) && typeof body.svg === 'string'
                ? body.svg
                : null;
          // A raster card's picture is a base64 image inside its svg and is bigger than the whole
          // budget for a lesson: `keepCardArtifact` refuses it, the card keeps working, and the
          // refusal is why a picture like that is redrawn rather than kept (kept.ts, the header).
          if (svg && svgIsClean(svg)) keepCardArtifact(courseId, card.id, { kind: 'diagram', svg });
          setArtifact(
            svg && svgIsClean(svg)
              ? { status: 'ready', kind: 'diagram', svg }
              : { status: 'failed' },
          );
        }
      })
      .catch(() => {
        if (!cancelled) setArtifact({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [sdk, card, topic, courseId]);

  return artifact;
}

// --- Small chrome ----------------------------------------------------------------------------------

/*
 * The skeleton shimmer that used to stand here is gone. A shimmer is a spinner with better manners:
 * it says a thing is coming and nothing about the thing. Every wait in this file now shows the orb
 * doing the subject's own thing instead (`WaitScene`, docs/EMAILS-AND-ANIMATIONS.md §3).
 */

const inputStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '1rem',
  fontFamily: 'inherit',
  border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
  borderRadius: 3,
  // no inline `outline: none` — the global :focus-visible ultramarine ring (main.tsx) must show
  background: 'var(--wobo-paper)',
  color: 'var(--wobo-ink-900)',
};

const itemBlockStyle = (state: 'idle' | 'correct' | 'retry'): CSSProperties => ({
  border:
    state === 'correct'
      ? '1px solid var(--wobo-feedback-correct)'
      : state === 'retry'
        ? '1px solid var(--wobo-feedback-retry)'
        : '0.5px solid var(--wobo-hairline-on-paper-strong)',
  background:
    state === 'correct'
      ? 'var(--wobo-feedback-correctSoft)'
      : state === 'retry'
        ? 'var(--wobo-feedback-retrySoft)'
        : 'var(--wobo-paper)',
  borderRadius: 3,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});

// --- Item answering (shared by the workbook and the boss) ------------------------------------------

/**
 * How many of the three must be right to carry on. The workbook's bar was 0, so a learner who
 * missed all three read "0 of 3, that is a pass, earned." and was advanced to the boss
 * (SCORECARD.md 3.2 #43). Two of three, for both: the boss has always asked for two.
 */
export const WORKBOOK_PASS_NEEDED = 2;
export const BOSS_PASS_NEEDED = 2;

/**
 * WHAT CLEARING THE BOSS IS WORTH, AND HOW MUCH OF THE MOMENT THIS LEARNER EARNED.
 *
 * docs/REWARDS.md §3 calls a boss cleared *"the largest"* moment in the product, and §3 again:
 * *"Intensity is earned, not uniform ... a concept they came back to three times gets a slower,
 * warmer, longer one, because that is the harder thing and it deserves more."*
 *
 * `bloomHold(tries)` in `store/progress.tsx` was built for exactly that and the workbook threads
 * its round count into it. The boss did not: it awarded with no `tries` at all, so the one moment
 * the law calls the largest was the only one held for a flat length, and the learner who finally
 * cleared it on the fourth round got the same breath as the one who cleared it first time. That is
 * rule 4 of "The tutor never leaves" (docs/LEARNING-MODEL.md) firing on being right rather than on
 * effort, in the place where effort is most of what happened.
 *
 * `tries` is the number of checked rounds the set cost, never a score and never a penalty: nothing
 * is deducted, ever (docs/LEVELS.md §4), so it only ever lengthens the moment.
 */
export function bossAward(
  topicId: string,
  hue: string,
  tries: number,
): { onceKey: string; hue: string; tries: number } {
  return { onceKey: `gen-boss-${topicId}`, hue, tries: Math.max(1, Math.floor(tries)) };
}

/**
 * What a checked round means, said once. Below the bar the round never advances and the line
 * points at the teaching already on screen: every missed item shows its answer (and the
 * explanation, when the gateway sent one), so "one more look" is a look at something.
 */
export interface RoundVerdict {
  advance: boolean;
  line: string;
  /**
   * True once the same items behind one button have stopped being a next thing to do, and another
   * way into the idea belongs on the screen beside them (docs/REWARDS.md §4, the third rung; rule
   * 5 of "The tutor never leaves", docs/LEARNING-MODEL.md).
   */
  anotherWay: boolean;
}

export function roundVerdict(
  correct: number,
  total: number,
  passNeeded: number,
  /**
   * How many rounds this learner has already had checked on this set. The try-again ladder in
   * `shared.tsx` climbs with it, so the words change as the attempt changes rather than repeating.
   * Defaults to the first round, which is what every caller that does not count them wants.
   */
  round = 0,
): RoundVerdict {
  if (correct >= total) return { advance: true, line: 'All of them. Clean.', anotherWay: false };
  // A full miss is never a pass, whatever bar a caller set.
  if (correct >= Math.max(1, passNeeded)) {
    return {
      advance: true,
      line: `${correct} of ${total}. That is a pass, earned.`,
      anotherWay: false,
    };
  }
  return {
    advance: false,
    line: tryAgainRung(correct, total, round),
    anotherWay: offersAnotherWay(round),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Is what the learner typed or chose this item's answer? Exact for a choice, tolerant for a number. */
export function answerIsCorrect(item: GenItem, entry: string): boolean {
  if (item.type === 'mcq') return entry === item.answer;
  const a = norm(entry);
  const b = norm(item.answer);
  if (!a) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  return a === b;
}

/**
 * THE ANSWER CLAUSE, WHICH IS NOT THE SAME SENTENCE THREE TIMES.
 *
 * docs/REWARDS.md §4: *"It never says they were wrong. It shows what is true and lets them see the
 * difference."* And rule 4 of "The tutor never leaves" (docs/LEARNING-MODEL.md): the ladder never
 * repeats the same line.
 *
 * Every missed item on this screen used to open with one fixed sentence, so a learner who missed
 * all three read those same six words three times over on one screen, each time with a different
 * tail hung off it. The lead clause was a form's sentence, and a form's sentence repeated is what
 * rule 4 forbids. There is one clause per position instead, so the three blocks a learner reads
 * down the workbook never open alike, whatever the items are.
 *
 * They are indexed, never random (REWARDS.md §4: *"It varies by attempt, not by randomness"*), so
 * the same item in the same place says the same thing on every round, and re-reading is re-reading
 * rather than a fresh line each look.
 */
export const MISS_ANSWER_CLAUSES: readonly ((answer: string) => string)[] = [
  (a) => `The one that holds is “${a}”.`,
  (a) => `Here the answer lands on “${a}”.`,
  (a) => `“${a}” is where this one ends up.`,
];

/**
 * What a learner reads under an item they missed: the reason first, in this item's own words, then
 * what the answer actually is.
 *
 * THE REASON LEADS, and that ordering is the point of it. The answer alone is the thing a learner
 * can already see; why it is the answer is the thing they came for, and it is the half that is
 * different for every item on the screen. An item whose reason never arrived (a course composed
 * before the schema grew one, read back off this device) still gets its own clause rather than the
 * clause its neighbours got, so even the oldest cached course cannot print one line three times.
 */
export function missLine(item: GenItem, index: number): string {
  const clause = MISS_ANSWER_CLAUSES[index % MISS_ANSWER_CLAUSES.length];
  const answer = clause ? clause(item.answer) : `The one that holds is “${item.answer}”.`;
  const reason = item.explanation?.trim();
  if (!reason) return answer;
  // A reason the model wrote may or may not close itself; two sentences need the stop between them.
  return `${/[.?”"]$/.test(reason) ? reason : `${reason}.`} ${answer}`;
}

function ItemBlock({
  item,
  index,
  entry,
  state,
  disabled,
  onEntry,
}: {
  item: GenItem;
  index: number;
  entry: string;
  state: 'idle' | 'correct' | 'retry';
  disabled: boolean;
  onEntry: (v: string) => void;
}) {
  const ordinals = ['one', 'two', 'three'];
  return (
    <motion.div variants={rise} style={itemBlockStyle(state)}>
      <div style={whisper}>
        {ordinals[index]} · {item.type === 'mcq' ? 'Choose one' : 'Fill the gap'}
      </div>
      <div
        style={{
          fontSize: '1.02rem',
          lineHeight: 1.5,
          color: 'var(--wobo-ink-900)',
          fontWeight: 520,
        }}
      >
        {item.prompt}
      </div>
      {item.type === 'mcq' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(item.options ?? []).map((choice) => (
            <ChoiceButton
              key={choice}
              chosen={entry === choice}
              evaluated={state !== 'idle'}
              isAnswer={choice === item.answer}
              blockWrong={state === 'retry'}
              disabled={disabled}
              onClick={() => onEntry(choice)}
            >
              {choice}
            </ChoiceButton>
          ))}
        </div>
      ) : (
        <input
          value={entry}
          disabled={disabled}
          onChange={(e) => onEntry(e.target.value)}
          aria-label={item.prompt}
          placeholder="Type your answer…"
          style={{ ...inputStyle, maxWidth: 300 }}
        />
      )}
      {state === 'retry' && (
        <div style={{ fontSize: '0.88rem', color: 'var(--wobo-ink-700)', lineHeight: 1.55 }}>
          {missLine(item, index)}
        </div>
      )}
    </motion.div>
  );
}

/** A three-item set answered together and checked together — the workbook and the boss share it. */
function ItemSet({
  items,
  nodeId,
  topicName,
  courseId,
  heading,
  eyebrow,
  hue,
  passNeeded,
  setBar,
  onDone,
  onAttempt,
  awardCorrect,
}: {
  items: GenItem[];
  nodeId: string;
  /** What is being learned, in the learner's words. Wobo re-teaches by name, never by node id. */
  topicName: string;
  courseId: string;
  heading: string;
  eyebrow: string;
  hue: string;
  /** Minimum correct to continue; below it the set re-opens for one more look. */
  passNeeded: number;
  setBar: (b: BarState | null) => void;
  /**
   * `tries` is how many checked rounds this set cost. It rides out with the result so whatever
   * follows the set can be sized by what it took (docs/REWARDS.md §3), which is the half the boss
   * was missing: its award is the largest moment in the product and it was held flat.
   */
  onDone: (correctCount: number, tries: number) => void;
  onAttempt: () => void;
  /** `tries` is how many rounds this answer cost, so the moment is sized by effort (REWARDS.md §3). */
  awardCorrect: (item: GenItem, index: number, tries: number) => void;
}) {
  const sdk = useSdk();
  const bus = useWoboBus();
  // Held in a ref, not read straight into the callback below: the conversation's context value is a
  // fresh object on every runtime render, and `reteach` is a dependency of the action-bar effect.
  // A callback that changed identity with it would re-run that effect on every runtime render,
  // which is the setBar -> parent setState -> render loop this file already warns about.
  const chat = useWoboChat();
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [entries, setEntries] = useState<string[]>(() => items.map(() => ''));
  const [results, setResults] = useState<boolean[] | null>(null);
  const round = useRef(0);
  const startedAt = useRef(Date.now());

  /**
   * What Wobo does with a round that came back wrong. Two misses on this concept is a pattern
   * rather than a slip, and the answer is never the same set shown again: the ladder in
   * wobo/reteach.ts picks an approach on a different axis and the ask rides the routing every mode
   * already uses. Nothing announces the switch (DESIGN.md §0.x): the next explanation arrives in
   * the drawer and its words are about the idea. Offline the ask waits, because a queued bubble
   * the learner never typed is noise rather than teaching.
   */
  const reteach = useCallback(
    (marks: boolean[]) => {
      const missed = marks.filter((ok) => !ok).length;
      if (missed === 0) {
        // Only a clean round clears the tally: one right answer must not erase two wrong ones.
        noteConceptCorrect(nodeId);
        return;
      }
      let turn: ReteachTurn | null = null;
      for (let i = 0; i < missed; i++) {
        turn =
          reteachOnMiss(sdk, {
            nodeId,
            // One node teaches one concept, so the node is what the tally is kept against.
            conceptId: nodeId,
            from: 'worksheet',
            context: { topic: topicName, world: preferredAnalogy() },
          }) ?? turn;
      }
      if (!turn) return;
      bus.dispatch([{ type: 'setMood', mood: 'hint' }]);
      const { ask, offline } = chatRef.current;
      if (offline) return;
      // The new explanation lands in Wobo's drawer, so the drawer opens (wobo/drawer.ts) and the
      // learner sees the different way. Silent, because Wobo asked it: the archive holds the
      // learner's own words and nobody else's.
      openCompanion({ reason: 'reteach', ask: turn.ask });
      void ask(turn.ask, { silent: true }).catch(() => undefined);
    },
    [sdk, nodeId, topicName, bus],
  );

  /**
   * THE SECOND DOOR, opened by the learner rather than waited for (rule 5 of "The tutor never
   * leaves", docs/LEARNING-MODEL.md).
   *
   * A round that did not pass used to leave exactly ONE control on the screen, and that control
   * put the same items straight back in front of the learner. On the third round that is not a
   * next thing to do, it is a loop with no way out of it, which is the dead end rule 5 forbids.
   *
   * `reteachNow` is the same ladder the automatic switch climbs, so it can never hand back the
   * approach that just failed, and what it has already tried survives a reload. Offline it changes
   * nothing on the screen rather than opening an empty drawer: the rung's own line still stands
   * and the primary is still there, so there is still something to do either way.
   */
  const anotherWayIn = useCallback(() => {
    const turn = reteachNow(sdk, {
      nodeId,
      conceptId: nodeId,
      from: 'worksheet',
      context: { topic: topicName, world: preferredAnalogy() },
    });
    if (!turn) return;
    bus.dispatch([{ type: 'setMood', mood: 'hint' }]);
    const { ask, offline } = chatRef.current;
    if (offline) return;
    openCompanion({ reason: 'reteach', ask: turn.ask });
    void ask(turn.ask, { silent: true }).catch(() => undefined);
  }, [sdk, nodeId, topicName, bus]);

  // Mastery already persists this node's answers, so a session that ended on two misses resumes
  // with the ladder knowing to teach it another way. Ignored when this session is already counting.
  useEffect(() => {
    seedFromEvidence(nodeId, sdk.mastery.loadCache().nodes[nodeId]?.evidence ?? []);
  }, [sdk, nodeId]);

  const answered = entries.filter((e) => e.trim() !== '').length;
  const evaluated = results !== null;

  useEffect(() => {
    bus.publishCanvas({
      nodeId,
      steps: [
        `${eyebrow}: ${answered} of ${items.length} answered`,
        evaluated
          ? `Checked: ${results?.filter(Boolean).length ?? 0} of ${items.length} correct`
          : 'Not yet checked',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, nodeId, eyebrow, answered, evaluated, results, items.length]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  useEffect(() => {
    if (!evaluated) {
      setBar({
        primary: {
          label: 'Check',
          disabled: answered < items.length,
          onClick: () => {
            const r = items.map((item, i) => answerIsCorrect(item, entries[i] ?? ''));
            const latency = Math.max(0, Date.now() - startedAt.current);
            items.forEach((item, i) => {
              onAttempt();
              sdk.events.record(
                'learn.attempt.submitted.v1',
                {
                  node_id: nodeId,
                  response:
                    item.type === 'mcq'
                      ? { kind: 'choice', selected: [entries[i] ?? ''] }
                      : { kind: 'text', text: entries[i] ?? '' },
                  correct: r[i] ?? false,
                  aided: false,
                  independence_signal: 0.85,
                  latency_ms: latency,
                  attempt_index: round.current,
                },
                { ontologyNodeId: nodeId, courseId },
              );
              // `round.current` is still this round's own 0-based index here; it is bumped below.
              if (r[i]) awardCorrect(item, i, round.current + 1);
            });
            round.current += 1;
            reteach(r);
            setResults(r);
          },
        },
      });
    } else {
      const correct = results?.filter(Boolean).length ?? 0;
      // The check that produced these results has already bumped the counter, so the rung the
      // learner is standing on is the one before it.
      const verdict = roundVerdict(correct, items.length, passNeeded, round.current - 1);
      setBar({
        primary: verdict.advance
          ? // `round.current` is the number of rounds the learner actually had checked, which is
            // what the moment after this set is sized by.
            { label: 'Continue', onClick: () => onDone(correct, Math.max(1, round.current)) }
          : {
              label: 'One more look',
              onClick: () => {
                setResults(null);
                startedAt.current = Date.now();
              },
            },
        // Nothing announces the switch (DESIGN.md §0.x): the label names what it opens, and the
        // explanation itself is what arrives.
        ...(verdict.anotherWay
          ? { secondary: { label: 'Another way in', onClick: anotherWayIn } }
          : {}),
      });
    }
  }, [
    setBar,
    evaluated,
    answered,
    entries,
    items,
    results,
    passNeeded,
    onDone,
    onAttempt,
    awardCorrect,
    sdk,
    nodeId,
    courseId,
    reteach,
    anotherWayIn,
  ]);

  const state = (i: number): 'idle' | 'correct' | 'retry' =>
    !results ? 'idle' : results[i] ? 'correct' : 'retry';
  const correct = results?.filter(Boolean).length ?? 0;

  return (
    <CardBody maxWidth={620} center={false}>
      <motion.div
        variants={cascade}
        initial="hidden"
        animate="show"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <motion.div
          variants={rise}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div>
            <div style={whisper}>{eyebrow}</div>
            <div style={{ ...cardTitle, marginTop: 8 }}>{heading}</div>
          </div>
        </motion.div>
        {items.map((item, i) => (
          <ItemBlock
            key={item.id}
            item={item}
            index={i}
            entry={entries[i] ?? ''}
            state={state(i)}
            disabled={evaluated}
            onEntry={(v) => setEntries((prev) => prev.map((e, j) => (j === i ? v : e)))}
          />
        ))}
        <AnimatePresence>
          {evaluated && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
              style={{ textAlign: 'center', color: 'var(--wobo-ink-700)', fontSize: '0.95rem' }}
            >
              {roundVerdict(correct, items.length, passNeeded, round.current - 1).line}
            </motion.div>
          )}
        </AnimatePresence>
        <div aria-hidden style={{ height: 2, background: rgba(hue, 0.12), borderRadius: 3 }} />
      </motion.div>
    </CardBody>
  );
}

// --- A generated content card (act first, Check reveals) --------------------------------------------

function GenCardView({
  card,
  course,
  hue,
  subject,
  revealed,
}: {
  card: GenCard;
  course: GenCourse;
  hue: string;
  /** The subject family, so the wait for this card's picture is this subject's own scene. */
  subject: string;
  revealed: boolean;
}) {
  const artifact = useArtifact(card, course.title, course.courseId);

  let surface: React.ReactNode = null;
  if (card.kind !== 'text') {
    if (artifact.status === 'ready') {
      surface =
        artifact.kind === 'sim' ? (
          <SimRunner spec={artifact.spec} />
        ) : svgIsClean(artifact.svg) ? (
          // the frame only when the drawing passes: a refused svg left a blank tinted box
          <Stage
            hue={hue}
            tint={0.05}
            minHeight={200}
            style={{ padding: 'clamp(14px, 3vw, 24px)' }}
          >
            <DiagramView id={card.id} svg={artifact.svg} label={`diagram: ${card.title}`} />
          </Stage>
        ) : null;
    } else if (artifact.status === 'pending') {
      // The picture is coming, and the orb draws this subject's own thing in its place: a number
      // line for maths, a pendulum for physics. No words caption its absence (DESIGN.md §0.x), and
      // the real drawing replaces this mid-loop without a jump.
      surface = (
        <Stage hue={hue} tint={0.05} minHeight={200} style={{ padding: 'clamp(14px, 3vw, 24px)' }}>
          <WaitScene subject={subject} pigment={hue} width={220} />
        </Stage>
      );
    }
    // failed: the idea and the act stand alone — refusal invisible
  }

  return (
    <CardBody maxWidth={620}>
      <motion.div
        variants={cascade}
        initial="hidden"
        animate="show"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        // The card on the glass map, with its concept from the level (docs/INK-FREEZE-PLAN-TRACE.md
        // §3): a label the reader keeps, never a registration the brain waits on.
        {...glassLabel('card', `concept:${meaningSlug(card.title)}`, `card-${card.id}`)}
        data-glass-text={card.title.toLowerCase()}
      >
        <motion.div variants={rise} style={whisper}>
          {card.kind === 'sim'
            ? 'Drag it and feel the law move'
            : card.kind === 'diagram'
              ? 'the picture'
              : 'the idea'}
        </motion.div>
        <motion.div variants={rise} style={cardTitle} data-glass="heading">
          {card.title.toLowerCase()}
        </motion.div>
        <motion.div variants={rise} style={lead}>
          {card.idea}
        </motion.div>
        {surface && <motion.div variants={rise}>{surface}</motion.div>}
        <motion.div
          variants={rise}
          style={{
            ...lead,
            borderLeft: `2px solid ${hue}`,
            paddingLeft: 14,
            color: 'var(--wobo-ink-900)',
          }}
        >
          {card.interaction.prompt}
        </motion.div>
        <AnimatePresence>
          {revealed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                border: '1px solid var(--wobo-feedback-correct)',
                background: 'var(--wobo-feedback-correctSoft)',
                borderRadius: 3,
                padding: '14px 16px',
                fontSize: '1rem',
                lineHeight: 1.6,
                color: 'var(--wobo-ink-900)',
              }}
            >
              {card.reveal}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </CardBody>
  );
}

// --- The composing ink screen (skeleton first, the real outline the moment it lands) ---------------

/**
 * THE LEVEL'S OWN CORE (docs/INK-FOUR.md, steps 3 and 4), read straight off the cards.
 *
 * Nothing here is composed and nothing is invented: a card's concept sentence is its own `idea`,
 * a part's sentence is the caption of the discovery stage that draws it, and the parts are the
 * named marks that stage puts on the canvas. What the learner sees on the glass is what the core
 * has a true sentence about, because both come from the same card.
 */
export function coreCardsOf(cards: readonly GenCard[]): CoreCard[] {
  return cards.map((card) => {
    const parts: NonNullable<CoreCard['parts']> = [];
    const seen = new Set<string>();
    for (const stage of card.discovery?.stages ?? []) {
      // The stage's caption is the one true sentence the architect wrote about what it shows.
      const sentence = stage.caption?.trim() || stage.reveal?.trim() || '';
      for (const mark of stage.visual.marks) {
        const name = mark.text?.trim();
        if (!name) continue;
        const slug = meaningSlug(name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        parts.push({ slug, name, sentence });
      }
    }
    return {
      id: card.id,
      title: card.title,
      idea: card.idea,
      reveal: card.reveal,
      ...(parts.length > 0 ? { parts } : {}),
    };
  });
}

/**
 * The side column's steps. A placeholder course has none: its cards are the scaffold, and a
 * column that lists "meet a new course, feel the rule" beside a screen saying "still being made"
 * is the lesson this is not, said twice.
 */
export function outlineSteps(course: Pick<GenCourse, 'cards' | 'seeded'>): string[] {
  if (course.seeded) return [];
  return [...course.cards.map((c) => c.title.toLowerCase()), 'the workbook', 'the boss'];
}

/**
 * What a learner reads when the brain could only offer its floor. Plain, and nothing pretends:
 * the scaffold behind it is not this topic's lesson and is never started as one.
 */
export const PLACEHOLDER_COURSE_LINE = 'Not written yet. Come back in a little while.';

/**
 * WHY THE FLOOR IS ON SCREEN, which is a different question from whether it is a floor.
 *
 *  · `answered` — engine.compose returned, and what came back was not this topic's course: the
 *    seed envelope, or a course that could not be read. The queue's `ready` is stale.
 *  · `unreachable` — nothing came back at all. The call threw, or the 75 seconds ran out. That is
 *    a statement about the network and about nothing else.
 *
 * A course that was never floored has no reason at all, and neither has one still composing.
 */
export type FloorReason = 'answered' | 'unreachable';

/**
 * Does this floor mean the download record is wrong? Only when the brain answered.
 *
 * The guard here used to be `!isOffline()`, which is `navigator.onLine === false`. Aeroplane mode
 * sets that flag; the phone this product is built for does not. On a village connection the radio
 * is up and the requests time out, so `onLine` stayed true, the floor was read as the brain's
 * answer, and the chain `screens/course/kept.ts` measured ran in full for any topic not already
 * kept: the download flipped `ready` to `failed`, the gate in `screens/Course.tsx` enqueued the
 * topic again, and `router.back()` sent the learner home. Going offline once cost them a course
 * they already owned; going patchy cost them the same, and only the first was ever guarded.
 *
 * So the question is asked of the compose call rather than of the browser. Both phones are covered
 * by the one rule, and it never has to trust what the radio believes about itself.
 */
export function reconcilesDownload(seeded: boolean, reason: FloorReason | null): boolean {
  return seeded && reason === 'answered';
}

function InkScreen({
  topicId,
  title,
  course,
  settled,
  reason,
}: {
  topicId: string;
  title: string;
  course: GenCourse | null;
  settled: boolean;
  /** Why the floor is on screen, when it is. Null while the course is still being decided. */
  reason: FloorReason | null;
}) {
  // A placeholder course has no outline worth reading: its cards are a scaffold with the topic's
  // name in it, and listing them would be listing the lesson this is not (SCORECARD.md 3.5 #9).
  const outline = course && !course.seeded ? outlineSteps(course) : null;
  // A course that opens as a placeholder was never ready, whatever an older build's queue said:
  // the "Your course is ready" toast and this page's "Still being made" cannot both stand.
  // ...but ONLY when the brain actually answered with that placeholder. When nothing came back,
  // the floor is what every un-kept topic shows on a bad connection, and flipping the queue on the
  // strength of it throws away the record of a download the learner had already been given: the
  // course they owned comes back as "That one slipped away" (`reconcilesDownload`).
  useEffect(() => {
    if (reconcilesDownload(course?.seeded === true, reason)) reconcilePlaceholder(topicId);
  }, [course?.seeded, reason, topicId]);
  return (
    <CardBody maxWidth={560}>
      <CourseIntroScene
        topicId={topicId}
        hue={hueForTopic(topicId)}
        minHeight={252}
        sigilSize={112}
      />
      {course ? (
        <div style={whisper}>{course.seeded ? 'Not written yet' : 'Written and verified'}</div>
      ) : null}
      <div style={cardTitle}>{title.toLowerCase()}</div>
      {course?.seeded && (
        <div style={{ ...lead, marginTop: 2 }} role="status">
          {PLACEHOLDER_COURSE_LINE}
        </div>
      )}
      {/* The wait for the course itself: the orb does this subject's own thing, and says nothing
          about what is being made (docs/EMAILS-AND-ANIMATIONS.md §3). The outline replaces it the
          moment the first real line lands, mid-loop, with nothing to unwind first. */}
      {!outline && !course?.seeded && (
        <WaitScene
          subject={subjectForTopic(topicId)}
          pigment={hueForTopic(topicId)}
          width={260}
          style={{ alignSelf: 'center', marginTop: 8 }}
        />
      )}
      {outline && (
        <motion.div
          variants={cascade}
          initial="hidden"
          animate="show"
          style={{ display: 'flex', flexDirection: 'column', gap: 13 }}
        >
          {outline.map((line, i) => (
            <OutlineLine key={line} index={i} line={line} />
          ))}
          <div style={{ ...lead, marginTop: 4 }}>
            {settled ? 'Composed and checked, line by line. It starts on the next card.' : ''}
          </div>
        </motion.div>
      )}
    </CardBody>
  );
}

/**
 * One line of the course outline, registered so Wobo can answer "which step is the boss?" with a
 * ring on that line rather than a paragraph about it. The board payload captured from /course on
 * 2026-09-05 carried two page targets, the download toast and the advance button, so the lesson's
 * own outline was not a thing Wobo could point at.
 */
function OutlineLine({ index, line }: { index: number; line: string }) {
  const ref = useRegisterTarget<HTMLDivElement>(`course-outline-${index + 1}`, {
    kind: 'step',
    label: `step ${index + 1} of the course: ${line}`,
  });
  return (
    <motion.div
      ref={ref}
      variants={rise}
      style={{ fontSize: '1.02rem', color: 'var(--wobo-ink-900)', lineHeight: 1.45 }}
    >
      <span style={{ ...whisper, marginRight: 10 }}>{index + 1}</span>
      {line}
    </motion.div>
  );
}

// --- The topic's motion video (engine.video, one per course, placed after discovery) --------------

const VIDEO_TIMEOUT_MS = 150_000;

type VideoState =
  | { status: 'pending' }
  | { status: 'ready'; scene: MotionScene }
  | { status: 'failed' };

/** Bridge engine.video's {scenes:[{visual:{kind,payload},audio:{mime,b64,durationMs}}]} into a
 * MotionScene. Per-scene audio drives timing (MOTION.md §5); authored durationMs is the muted
 * fallback for scenes that never got audio (keyless synthesis, or an older cached artifact). */
function motionSceneFromVideo(raw: unknown, title: string): MotionScene | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.artifact) ? raw.artifact : raw;
  if (raw.verified === false || src.verified === false) return null;
  const scenes = Array.isArray(src.scenes) ? src.scenes : [];
  const steps = scenes
    .map((s, i) => {
      if (!isRecord(s)) return null;
      const v = isRecord(s.visual) ? s.visual : null;
      const payload = v?.payload;
      // svg/diagram payloads are watchable SVG strings; a sim payload is interactive, not video
      if (!v || (v.kind !== 'svg' && v.kind !== 'diagram') || typeof payload !== 'string') {
        return null;
      }
      const a = isRecord(s.audio) ? s.audio : null;
      const audioSrc =
        a && typeof a.b64 === 'string' && typeof a.mime === 'string'
          ? `data:${a.mime};base64,${a.b64}`
          : undefined;
      // measured audio length is the authoritative beat; authored durationMs only when muted
      const measured = a && typeof a.durationMs === 'number' ? a.durationMs : null;
      const fallback = typeof s.durationMs === 'number' ? s.durationMs : 6000;
      const caption =
        typeof s.title === 'string' && s.title
          ? s.title
          : typeof s.narration === 'string'
            ? s.narration
            : undefined;
      return {
        id: typeof s.id === 'string' ? s.id : `s${i + 1}`,
        durationMs: measured ?? fallback,
        caption,
        audioSrc,
        visual: { svg: payload },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (steps.length === 0) return null;
  // renderedUrl (optional): the gateway attaches it when an MP4 render exists beside the artifact,
  // so MotionPlayer plays the baked film instead of the live scenes. parseMotionScene safety-checks it.
  const renderedUrl = typeof src.renderedUrl === 'string' ? src.renderedUrl : undefined;
  return parseMotionScene({ id: 'video', title, steps, renderedUrl });
}

function useVideoScene(title: string, courseId: string): VideoState {
  const sdk = useSdk();
  const [state, setState] = useState<VideoState>({ status: 'pending' });
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setState({ status: 'pending' });
    // The film this course already played, when it was small enough to keep (screens/course/kept.ts).
    const held = keptFilm(courseId);
    if (held) {
      setState({ status: 'ready', scene: held });
      return;
    }
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('video timeout')), VIDEO_TIMEOUT_MS);
    });
    Promise.race([
      sdk.llm.invoke(
        'engine.video',
        { topic: title, concept: title, course_id: courseId, difficulty: 'core' },
        { consentTier: 'un_elevated' },
      ),
      timeout,
    ])
      .then((res) => {
        if (cancelled) return;
        // A placeholder film narrates "watch how one thing reaches the next" over any topic. It
        // is not this topic's film, so it is not shown as one.
        const scene = isPlaceholderEnvelope(res.output)
          ? null
          : motionSceneFromVideo(res.output, title);
        if (scene) keepFilm(courseId, scene);
        setState(scene ? { status: 'ready', scene } : { status: 'failed' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sdk, title, courseId]);
  return state;
}

/** One motion video per course — an honest placeholder while Wobo animates, the player when ready. */
function VideoBeat({
  title,
  courseId,
  subject,
  hue,
  setBar,
  onDone,
}: {
  title: string;
  courseId: string;
  /** The subject family, so the wait for the film is this subject's own scene. */
  subject: string;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const video = useVideoScene(title, courseId);
  useEffect(() => {
    setBar({
      primary: { label: 'Continue', disabled: video.status === 'pending', onClick: onDone },
    });
  }, [setBar, video.status, onDone]);
  return (
    <CardBody maxWidth={620}>
      <motion.div
        variants={cascade}
        initial="hidden"
        animate="show"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <motion.div variants={rise} style={whisper}>
          watch it move
        </motion.div>
        <motion.div variants={rise} style={cardTitle}>
          {title.toLowerCase()}
        </motion.div>
        {video.status === 'ready' && (
          <motion.div variants={rise}>
            <MotionPlayer scene={video.scene} />
          </motion.div>
        )}
        {video.status === 'pending' && (
          <motion.div variants={rise} style={{ alignSelf: 'center' }}>
            <WaitScene subject={subject} pigment={hue} width={240} />
          </motion.div>
        )}
        {video.status === 'failed' && (
          <motion.div variants={rise} style={lead}>
            Carry on; it will be here when you come back.
          </motion.div>
        )}
      </motion.div>
    </CardBody>
  );
}

// --- The player ------------------------------------------------------------------------------------

const COMPOSE_TIMEOUT_MS = 75_000;

export function Composing({
  topicId,
  title,
  openAt,
  setBar,
  setProgress,
  onExit,
  onResume,
  onOutline,
}: {
  topicId: string;
  title: string;
  /**
   * The card a link asked to open on (docs/EMAILS-AND-ANIMATIONS.md §4). It BEATS the saved
   * position, because the learner pressed a button that named this card; an index this course
   * does not have is not a card, and the course opens as it always did (`open-at.ts`).
   */
  openAt?: string | undefined;
  setBar: (b: BarState | null) => void;
  setProgress: (p: { f: number; segments: number }) => void;
  onExit: () => void;
  /** Fired once when the player restores a saved mid-course position. */
  onResume?: () => void;
  /** The steps and the one on stage, for the lesson's side column. */
  onOutline?: (outline: LessonOutline) => void;
}) {
  const sdk = useSdk();
  const { setMood } = useWoboChat();
  const { award, completed, setReplay } = useProgress();

  // Owner replay law: a completed course replays freely but earns no xp. Captured once at mount —
  // completeTopic flips `completed` at the greeting, so a live read would mislabel a first run.
  const replay = useRef(completed.has(topicId)).current;
  // The ground the learner stands on, read once at the door. A bridge that appeared halfway
  // through would be a detour; this one is the run-up, so it is decided before the lesson starts.
  const groundAtEntry = useRef(completed).current;

  // The bridge itself, so card one can be rendered by its own component rather than squeezed into
  // the generic idea card. Null whenever the learner already stands on everything this topic needs.
  const [bridge, setBridge] = useState<BridgeLesson | null>(null);
  // A ground report that settles after this course started composing (curriculum/placement.ts).
  const lateGround = useRef<GroundReport | null>(null);
  useEffect(
    () =>
      subscribeGround((report) => {
        if (report.topicId === topicId) lateGround.current = report;
      }),
    [topicId],
  );

  const nodeUuid = useMemo(() => topicNodeUuid(topicId), [topicId]);
  const hue = hueForTopic(topicId);
  const topic: Topic = useMemo(
    () =>
      topicById(topicId) ?? {
        id: topicId,
        chapterId: '',
        name: title,
        blurb: '',
        prereqTopicIds: [],
        kind: 'syllabus',
        xp: 150,
      },
    [topicId, title],
  );

  const [course, setCourse] = useState<GenCourse | null>(null);
  // Why the course below is the floor, when it is. Read by the ink screen, which corrects this
  // topic's download record only for a floor the brain actually handed back.
  const [floorReason, setFloorReason] = useState<FloorReason | null>(null);
  const [settled, setSettled] = useState(false);
  const [entered, setEntered] = useState(false);
  // idx walks: cards… then workbook, boss, greeting
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // The discovery on the card at `idx` has completed, so the same card's activity follows it.
  // Reset when the index moves; the advance callback below does both.
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const attempts = useRef(0);
  const enteredAt = useRef(Date.now());
  const arrivalRecorded = useRef(false);

  // arrival is an event — the contract is law
  useEffect(() => {
    if (arrivalRecorded.current) return;
    arrivalRecorded.current = true;
    enteredAt.current = Date.now();
    sdk.events.record(
      'learn.node.entered.v1',
      { node_id: nodeUuid, entry: 'map', initial_band: 'not_started' },
      { ontologyNodeId: nodeUuid },
    );
  }, [sdk, nodeUuid]);

  // hold the store's replay guard open while a completed course is on screen — every award and
  // completion inside no-ops (no xp, no bloom, no level math); events + evidence still record.
  useEffect(() => {
    setReplay(replay);
    return () => setReplay(false);
  }, [setReplay, replay]);

  // ask the engines for the real course; refusal anywhere floors to the seed, never an error
  // biome-ignore lint/correctness/useExhaustiveDependencies: compose runs once on mount; onResume is a stable callback
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setMood('thinking');
    (async () => {
      let parsed: GenCourse | null = null;
      // Set only by the compose call below, and only by what it actually did. A kept lesson never
      // touches it: a kept course is real, so there is no floor to explain.
      let reason: FloorReason | null = null;
      // Asked for ALONGSIDE the course, never after it, so crossing the ground under a topic never
      // costs the learner a second wait. `bridgeFor` floors to an honest outline when the engine has
      // nothing verified to offer, so this is a lesson or it is nothing, never an error.
      // The placement check's own report wins when it has settled one for this topic: it knows what
      // the learner actually answered, where the static graph only knows what they finished. With no
      // report (skipped, or a topic with nothing under it) the graph is the honest fallback.
      const settled = groundFor(topicId);
      const bridging = (
        settled
          ? // The check's answers correct the learner's history; they do not replace it. Without
            // `groundAtEntry` a learner with twenty finished topics had all twenty thrown away.
            bridgeFromReport(sdk, topic, settled, topicById, groundAtEntry)
          : bridgeFor(sdk, { topic, completed: groundAtEntry, lookup: topicById })
      ).catch(() => null);
      /**
       * THE LESSON THIS LEARNER HAS ALREADY OPENED COMES OFF THE DEVICE, and it comes off first.
       *
       * `engine.compose` used to be the only place a course's cards existed, so with no signal the
       * player floored to the generic scaffold and a learner could not reopen a lesson they had
       * played an hour earlier (`screens/course/kept.ts` carries the measurement in full). A kept
       * course is this learner's own copy of the one their allowance already bought: it opens with
       * the network off, and with the network on it also saves the SECOND compose this screen
       * bought every time a course was opened after the download queue had just bought the first.
       */
      const kept = keptLesson(topicId);
      if (kept) parsed = kept;
      else {
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error('compose timeout')),
              COMPOSE_TIMEOUT_MS,
            );
          });
          const res = await Promise.race([
            sdk.llm.invoke(
              'engine.compose',
              { topic: title, topic_id: topicId, difficulty: 'core' },
              { consentTier: 'un_elevated' },
            ),
            timeout,
          ]);
          // THE BRAIN ANSWERED. Whatever it said, a floor from here is a statement about this
          // topic's content rather than about the network, so the download record may be trusted
          // to be wrong. The catch below is the other half, and it is the one the village phone
          // reaches: a timeout and a dead fetch both land there.
          reason = 'answered';
          parsed = parseGenCourse(res.output, title);
          if (parsed && !cancelled) {
            sdk.events.record(
              'create.course.compiled.v1',
              {
                request_id: crypto.randomUUID(),
                course_id: parsed.courseId,
                node_count: parsed.cards.length,
                reused_node_count: res.cached ? parsed.cards.length : 0,
                new_node_count: res.cached ? 0 : parsed.cards.length,
                all_verified: true,
              },
              { courseId: parsed.courseId },
            );
          }
        } catch {
          // the floor below is the fallback — never an error state, and never a verdict on a
          // course the learner may already own: nothing came back, so nothing is concluded.
          reason = 'unreachable';
        }
      }
      window.clearTimeout(timer);
      if (cancelled) return;
      let lesson = await bridging;
      if (cancelled) return;
      // A check can settle for this topic WHILE the course is composing: the gate and the player are
      // different screens and the compose starts the moment this one mounts. `subscribeGround` is
      // the seam the placement module publishes for exactly this, and a report that lands late wins,
      // because it knows what the learner just answered where the static graph only knows what they
      // finished. The common case never reaches this branch.
      const late = lateGround.current;
      if (late && late !== settled) {
        lesson = await bridgeFromReport(sdk, topic, late, topicById, groundAtEntry).catch(
          () => lesson,
        );
        if (cancelled) return;
      }
      setBridge(lesson);
      const built = withBridge(parsed ?? seedCourse(title), lesson);
      // WHY this course is what it is, handed over WITH it. Set even when it is null, so a course
      // that composed cleanly carries no leftover reason, and so the screen never has to guess.
      setFloorReason(reason);
      setCourse(built);
      // Kept for the next opening, with a network or without one. The COMPOSED course is what is
      // kept, never `built`: the bridge in front of it is laid from the ground the learner stands
      // on at the moment they open it, so it is re-decided each time rather than frozen. A seeded
      // floor is refused inside `keepLesson`, so a placeholder can never become a topic's lesson.
      if (parsed) keepLesson(topicId, parsed);
      // THE CONCEPT CORE, MADE ONCE WITH THE LEVEL (docs/INK-FOUR.md, steps 3 and 4). The cards
      // already hold the true sentence about every concept and every part they declare; the store
      // keeps them beside the level so Wobo can say the true thing about the hypotenuse before any
      // model answers, and can answer the obvious asks with no model at all.
      rememberCore(`${topicId}:${built.courseId}`, coreCardsOf(built.cards));
      setSettled(true);
      setMood('idle');
      // resume where they left off — a course never restarts (mission 1). The stored value is a
      // card index; restore only into content/workbook/boss, never the finished greeting. A
      // completed course never resumes a stale end state: a replay always begins at card 0.
      // A link that named a card wins over the saved place and over a replay's fresh start: the
      // learner pressed a button that said this card. It is not a resume, so the quiet "picking
      // up where you left off" beat is not fired for it — nothing was picked up.
      const asked = built.seeded ? null : composedCardFromLink(openAt, built.cards.length);
      if (asked !== null) {
        setIdx(asked);
        setEntered(true);
        return;
      }
      const saved = readCoursePos(topicId);
      if (
        !replay &&
        !built.seeded &&
        typeof saved === 'number' &&
        saved >= 1 &&
        saved <= built.cards.length + 1
      ) {
        setIdx(saved);
        setEntered(true);
        onResume?.();
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setMood('idle');
    };
  }, [sdk, topicId, title, setMood]);

  // stable identities — ItemSet's action-bar effect depends on these; fresh lambdas
  // every render would loop setBar -> parent setState -> render -> setBar forever
  const bumpAttempts = useCallback(() => {
    attempts.current += 1;
  }, []);
  const advance = useCallback(() => {
    setRevealed(false);
    setDiscoveryDone(false);
    setIdx((i) => i + 1);
  }, []);
  // A discovery finishing on a card that also carries an activity stays on the card: the
  // activity is the second half of it. A card with nothing after the discovery moves on.
  const afterDiscovery = useCallback(() => setDiscoveryDone(true), []);
  const awardWorkbookItem = useCallback(
    (item: GenItem, _index: number, tries: number) =>
      award('item', { onceKey: `gen-wb-${topicId}-${item.id}`, hue, tries }),
    [award, topicId, hue],
  );
  const awardNothing = useCallback(() => {}, []);
  const bossDone = useCallback(
    (_correct: number, tries: number) => {
      // The largest moment in the product, sized by what it cost to get here (docs/REWARDS.md §3).
      award('boss', bossAward(topicId, hue, tries));
      setIdx((i) => i + 1);
    },
    [award, topicId, hue],
  );

  const segments = (course?.cards.length ?? 4) + 4; // + video, workbook, boss, greeting
  const stops = course ? course.cards.length : 0;

  /*
   * THE SIDE DOOR, DECIDED (docs/CONTENT-INTERACTION.md §7).
   *
   * Everything the placement rule needs is already in hand at the end of a course: which chapter
   * this topic belongs to, where it sits in that chapter, and whether the course carried a bonus
   * level on one of its cards. `offerFor` says no to almost all of it — a door sits after every
   * second or third topic and never after the last, because the boss is the summit — and a `null`
   * here is the ordinary answer, not a failure.
   *
   * Nothing is fetched and nothing is generated: the level rode in with the course, which was paid
   * for once and cached, so a play costs nobody anything.
   */
  const door = useMemo(() => {
    const chapter = topic.chapterId ? chapterById(topic.chapterId) : undefined;
    const list = chapter?.topics ?? [];
    const position = list.findIndex((x) => x.id === topicId) + 1;
    if (!chapter || position === 0) return null;
    const spec =
      course?.cards.map((c) => c.activity).find((a) => a?.type === 'arcade')?.spec ?? null;
    return offerFor({
      chapterId: chapter.id,
      chapterName: chapter.name,
      topicId,
      position,
      topics: list.length,
      spec: spec && 'game' in spec ? spec : null,
    });
  }, [course, topic.chapterId, topicId]);
  const stage: 'cards' | 'video' | 'workbook' | 'boss' | 'greeting' = !course
    ? 'cards'
    : idx < stops
      ? 'cards'
      : idx === stops
        ? 'video'
        : idx === stops + 1
          ? 'workbook'
          : idx === stops + 2
            ? 'boss'
            : 'greeting';

  // endowed progress — never empty, eased forward as the learner travels
  useEffect(() => {
    setProgress({ f: entered ? (idx + 0.6) / segments : 0.07, segments });
  }, [entered, idx, segments, setProgress]);

  // the side column's steps: the ink screen's own outline, with the one on stage marked
  useEffect(() => {
    if (!course) return;
    const steps = outlineSteps(course);
    const at = !entered
      ? -1
      : stage === 'cards'
        ? idx
        : stage === 'workbook'
          ? stops
          : stage === 'boss'
            ? stops + 1
            : stage === 'greeting'
              ? steps.length
              : -1;
    onOutline?.({ steps, at });
  }, [course, entered, idx, stage, stops, onOutline]);

  // persist the card index as the learner travels — resume reads it on the next entry
  useEffect(() => {
    if (entered && course) writeCoursePos(topicId, idx);
  }, [entered, course, idx, topicId]);

  // the ink card's action bar
  useEffect(() => {
    if (entered) return;
    setBar({
      primary: course?.seeded
        ? // A placeholder is not started. The one honest move is back to where they came from.
          { label: 'Back for now', onClick: onExit }
        : { label: 'Start the course', disabled: !settled, onClick: () => setEntered(true) },
    });
  }, [entered, settled, course, setBar, onExit]);

  // content cards: act → check (reveal + XP) → continue
  const card = course && idx < stops ? course.cards[idx] : null;
  useEffect(() => {
    // a discovery card, an activity engine or the bridge owns its own action bar — skip the
    // act/check flow. The bridge in particular must never reach the `award('bonus')` below: the
    // ground under a topic is not an achievement, and paying a child 15 XP for tapping past it
    // teaches them that the tap was the point.
    if (!entered || !card || card.discovery || card.activity || card.id === 'bridge') return;
    // (a card that is still on its discovery, or now on its activity, owns its own bar either way)
    if (!revealed) {
      setBar({
        primary: {
          label: 'Check',
          onClick: () => {
            setRevealed(true);
            award('bonus', { amount: 15, onceKey: `gen-${topicId}-${card.id}`, hue });
            setMood('correct');
            window.setTimeout(() => setMood('idle'), 1200);
          },
        },
      });
    } else {
      setBar({
        primary: {
          label: 'Continue',
          onClick: () => {
            setRevealed(false);
            setIdx((i) => i + 1);
          },
        },
      });
    }
  }, [entered, card, revealed, setBar, award, topicId, hue, setMood]);

  if (!entered || !course) {
    return (
      <Deck id="compose-ink">
        <InkScreen
          topicId={topicId}
          title={title}
          course={course}
          settled={settled}
          reason={floorReason}
        />
      </Deck>
    );
  }

  if (stage === 'greeting') {
    return (
      <Deck id="gen-greeting">
        <Greeting
          topic={topic}
          nodeId={nodeUuid}
          attemptsTotal={attempts.current}
          enteredAt={enteredAt.current}
          setBar={setBar}
          onContinue={onExit}
          replay={replay}
        />
        {/*
          THE SIDE DOOR (docs/CONTENT-INTERACTION.md §7). It hangs off the END of a topic that sits
          in the middle of its chapter, never off the last one, because the boss is the summit. It
          is rendered AFTER the greeting and outside its flow: the greeting keeps the action bar, so
          "continue" is still the one primary thing on the screen and a bonus level is never in the
          learner's path. A topic with no door, or a course that carried no level, renders nothing
          and the ending is exactly what it was.
        */}
        {/*
          AND IT GOES THROUGH THE ONE GATE (docs/SUGGESTIONS-AND-NOTICES.md §2). A side door is one
          of the four kinds Wobo may offer, so it is chosen by the arbiter rather than rendered on
          sight: at most one suggestion is on screen at a time, and a door waved away is not offered
          again this session. The card itself is still the arcade's own, because it carries what the
          level is worth and whether today has already paid; the host lends it the no.
        */}
        {door ? (
          <Suggestions
            candidates={[sideDoorSuggestion(door)]}
            hue={hueForTopic(topicId)}
            slotFor={() => <SideDoor offer={door} hue={hueForTopic(topicId)} />}
          />
        ) : null}
      </Deck>
    );
  }

  if (stage === 'video') {
    return (
      <Deck id="gen-video">
        <VideoBeat
          title={course.title}
          courseId={course.courseId}
          subject={subjectForTopic(topicId)}
          hue={hue}
          setBar={setBar}
          onDone={advance}
        />
      </Deck>
    );
  }

  if (stage === 'workbook') {
    return (
      <Deck id="gen-workbook">
        <ItemSet
          items={course.workbook}
          nodeId={nodeUuid}
          topicName={title}
          courseId={course.courseId}
          eyebrow="The workbook · three quick ones"
          heading="Hold what you just built"
          hue={hue}
          passNeeded={WORKBOOK_PASS_NEEDED}
          setBar={setBar}
          onAttempt={bumpAttempts}
          awardCorrect={awardWorkbookItem}
          onDone={advance}
        />
      </Deck>
    );
  }

  if (stage === 'boss') {
    return (
      <Deck id="gen-boss">
        <ItemSet
          items={course.boss}
          nodeId={nodeUuid}
          topicName={title}
          courseId={course.courseId}
          eyebrow="The boss · answered together, checked together"
          heading="Prove it is yours"
          hue={hue}
          passNeeded={BOSS_PASS_NEEDED}
          setBar={setBar}
          onAttempt={bumpAttempts}
          awardCorrect={awardNothing}
          onDone={bossDone}
        />
      </Deck>
    );
  }

  const beat = card ? cardBeat(card, discoveryDone) : 'idea';

  if (card?.discovery && beat === 'discovery') {
    return (
      <Deck id={`gen-discovery-${idx}`}>
        <Discovery
          spec={card.discovery}
          hue={hue}
          setBar={setBar}
          onDone={card.activity ? afterDiscovery : advance}
        />
      </Deck>
    );
  }

  if (card?.activity && beat === 'activity') {
    const a = card.activity;
    return (
      <Deck id={`gen-activity-${idx}`}>
        {a.type === 'design' && (
          <Composer design={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'perturb' && (
          <PerturbationSandbox spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'whatif' && (
          <WhatIfNumerical spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'compare' && (
          <CompareInteractive spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'conceptMap' && (
          <ConceptMap spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'workbook' && (
          <MiniWorkbook
            spec={a.spec}
            hue={hue}
            nodeId={nodeUuid}
            courseId={course.courseId}
            setBar={setBar}
            onDone={advance}
          />
        )}
        {a.type === 'flashcards' && (
          <Flashcards spec={a.spec} hue={hue} nodeId={nodeUuid} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'derivation' && (
          <DerivationCard spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'wordProblem' && (
          <WordProblemBreakdown spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'podcast' && (
          <PodcastPlayer spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'arcade' && (
          <ArcadeShell
            spec={a.spec}
            hue={hue}
            nodeId={nodeUuid}
            courseId={course.courseId}
            setBar={setBar}
            onDone={advance}
          />
        )}
        {a.type === 'mathScene' && (
          <MathScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'physics' && (
          <PhysicsScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'chemScene' && (
          <ChemScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'bioScene' && (
          <BioScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'socialScene' && (
          <SocialScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
        {a.type === 'map' && <MapScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />}
        {a.type === 'anatomy' && (
          <AnatomyScene spec={a.spec} hue={hue} setBar={setBar} onDone={advance} />
        )}
      </Deck>
    );
  }

  // Card one, when the ground under this topic needed crossing. Its own renderer, because a bridge
  // is not an idea card: the steps are steps, the prompt asks for the tap that exists, and reading
  // the ground earns nothing (screens/course/BridgeStep.tsx).
  if (card?.id === 'bridge' && bridge) {
    return (
      <Deck id="gen-bridge">
        <BridgeStep lesson={bridge} hue={hue} setBar={setBar} onDone={() => setIdx((i) => i + 1)} />
      </Deck>
    );
  }

  return (
    <Deck id={`gen-card-${idx}`}>
      {card && (
        <GenCardView
          card={card}
          course={course}
          hue={hue}
          subject={subjectForTopic(topicId)}
          revealed={revealed}
        />
      )}
    </Deck>
  );
}
