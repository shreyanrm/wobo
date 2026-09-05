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
import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GroundReport, groundFor, subscribeGround } from '../../curriculum/placement';
import { topicById } from '../../curriculum/registry';
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
import { preferredAnalogy } from '../../store/mind';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { CourseIntroScene } from '../../ui/courseIntro';
import { hueForTopic } from '../../ui/hues';
import { cascade, rise } from '../../ui/kit';
import { type BridgeLesson, bridgeFor, bridgeFromReport } from '../../wobo/bridge';
import { useWoboChat } from '../../wobo/chat';
import { openCompanion } from '../../wobo/drawer';
import {
  noteConceptCorrect,
  type ReteachTurn,
  reteachOnMiss,
  seedFromEvidence,
} from '../../wobo/reteach';
import { topicNodeUuid } from '../learn/mastery';
import { BridgeStep } from './BridgeStep';
import { Greeting } from './Greeting';
import type { BarState, LessonOutline } from './shared';
import {
  CardBody,
  ChoiceButton,
  cardTitle,
  Deck,
  lead,
  readCoursePos,
  rgba,
  Stage,
  whisper,
  writeCoursePos,
} from './shared';

// --- The composed course (engine.compose output, validated before anything renders) ---------------

type CardKind = 'sim' | 'diagram' | 'text';
type ActKind = 'tap' | 'drag' | 'slide' | 'type';

/** A physics-of-understanding renderer a card can carry — each owns its own shell + action bar. */
type CardActivity =
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

/** Try each activity parser in turn; the first field that yields a valid spec wins (refusal → none). */
function parseActivity(c: Record<string, unknown>): CardActivity | undefined {
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

/** The wire Item from the generated contract, with options narrowed to the client's parsed shape. */
type GenItem = Omit<WireItem, 'options'> & { options?: string[] };

interface GenCourse {
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
    if (it.type === 'mcq' && Array.isArray(it.options)) {
      const options = it.options.filter(
        (o): o is string => typeof o === 'string' && o.trim() !== '',
      );
      // the verifier's law, re-checked at the door: exactly one correct option present
      if (options.length < 2 || options.filter((o) => o === answer).length !== 1) return;
      items.push({ id, type: 'mcq', prompt, options, answer });
    } else if (it.type === 'fill') {
      items.push({ id, type: 'fill', prompt, answer });
    }
  });
  return items.length >= 3 ? items.slice(0, 3) : null;
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
    seeded: raw.seeded === true,
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

/** The client-side floor for mock mode or a network refusal — structural, never fabricated. */
function seedCourse(title: string): GenCourse {
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
      },
      {
        id: 'w3',
        type: 'fill',
        prompt: 'Before trusting a result, test it against the ________ problem.',
        answer: 'original',
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
      },
      {
        id: 'b3',
        type: 'fill',
        prompt: 'Each legal move keeps the answer set exactly the ________.',
        answer: 'same',
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
    const { capability, payload } = engineRequest(card, topic, courseId);
    sdk.llm
      .invoke(capability, payload, { consentTier: 'un_elevated' })
      .then((res) => {
        if (cancelled) return;
        const body =
          isRecord(res.output) && 'artifact' in res.output ? res.output.artifact : res.output;
        if (card.kind === 'sim') {
          // A seeded sim is a generic fallback (the live generation refused). Rather than risk a
          // wrong-subject sandbox on this card, degrade to the idea + act — the honest floor.
          const seeded = isRecord(res.output) && res.output.seeded === true;
          const spec = seeded
            ? null
            : (simSpecFromGateway(res.output, card.title) ?? parseSimSpec(body));
          setArtifact(spec ? { status: 'ready', kind: 'sim', spec } : { status: 'failed' });
        } else {
          const svg =
            typeof body === 'string'
              ? body
              : isRecord(body) && typeof body.svg === 'string'
                ? body.svg
                : null;
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

/** Honest skeleton shimmer — Wobo is composing this piece; it lands on its own. */
function Shimmer({ lines = 3, note }: { lines?: number; note?: string }) {
  const widths = ['82%', '64%', '74%', '58%'];
  return (
    <div
      style={{
        border: '0.5px solid var(--wobo-hairline-on-paper)',
        borderRadius: 3,
        padding: '26px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <motion.div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton lines are positional
          key={i}
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{
            duration: 1.8,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
            delay: i * 0.18,
          }}
          style={{
            height: 12,
            width: widths[i % widths.length],
            background: 'var(--wobo-tonal)',
            borderRadius: 3,
          }}
        />
      ))}
      {note && <div style={{ ...whisper, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

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

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function answerIsCorrect(item: GenItem, entry: string): boolean {
  if (item.type === 'mcq') return entry === item.answer;
  const a = norm(entry);
  const b = norm(item.answer);
  if (!a) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  return a === b;
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
          not this one — the answer worth keeping is “{item.answer}”.
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
  onDone: (correctCount: number) => void;
  onAttempt: () => void;
  awardCorrect: (item: GenItem, index: number) => void;
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
  const [reteachLine, setReteachLine] = useState<string | null>(null);
  const round = useRef(0);
  const startedAt = useRef(Date.now());

  /**
   * What Wobo does with a round that came back wrong. Two misses on this concept is a pattern
   * rather than a slip, and the answer is never the same set shown again: the ladder in
   * wobo/reteach.ts picks an approach on a different axis, Wobo says so in one warm line, and the
   * ask rides the routing every mode already uses. Offline the line still lands and the ask waits,
   * because a queued bubble the learner never typed is noise rather than teaching.
   */
  const reteach = useCallback(
    (marks: boolean[]) => {
      const missed = marks.filter((ok) => !ok).length;
      if (missed === 0) {
        // Only a clean round clears the tally: one right answer must not erase two wrong ones.
        noteConceptCorrect(nodeId);
        setReteachLine(null);
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
      setReteachLine(turn.line);
      bus.dispatch([{ type: 'setMood', mood: 'hint' }]);
      const { ask, offline } = chatRef.current;
      if (offline) return;
      // The new explanation lands in Wobo's drawer, so the drawer opens (wobo/drawer.ts): the
      // learner reads "let me show this a different way" and then actually sees the different way.
      // Silent, because Wobo asked it: the archive holds the learner's own words and nobody else's.
      openCompanion({ reason: 'reteach', ask: turn.ask });
      void ask(turn.ask, { silent: true }).catch(() => undefined);
    },
    [sdk, nodeId, topicName, bus],
  );

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
          ? `Checked — ${results?.filter(Boolean).length ?? 0} of ${items.length} correct`
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
              if (r[i]) awardCorrect(item, i);
            });
            round.current += 1;
            reteach(r);
            setResults(r);
          },
        },
      });
    } else {
      const correct = results?.filter(Boolean).length ?? 0;
      setBar({
        primary:
          correct >= passNeeded
            ? { label: 'Continue', onClick: () => onDone(correct) }
            : {
                label: 'One more look',
                onClick: () => {
                  setResults(null);
                  startedAt.current = Date.now();
                },
              },
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
        {/* Wobo changing approach, said out loud before the next way of teaching it arrives. */}
        {reteachLine && (
          <motion.div
            variants={rise}
            style={{ ...lead, color: 'var(--wobo-ink-700)' }}
            role="status"
          >
            {reteachLine}
          </motion.div>
        )}
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
              {correct === items.length
                ? 'All of them. Clean.'
                : correct >= passNeeded
                  ? `${correct} of ${items.length} — that is a pass, earned.`
                  : 'Close. Take one more look — the answers are still yours to find.'}
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
  revealed,
}: {
  card: GenCard;
  course: GenCourse;
  hue: string;
  revealed: boolean;
}) {
  const artifact = useArtifact(card, course.title, course.courseId);

  let surface: React.ReactNode = null;
  if (card.kind !== 'text') {
    if (artifact.status === 'ready') {
      surface =
        artifact.kind === 'sim' ? (
          <SimRunner spec={artifact.spec} />
        ) : (
          <Stage
            hue={hue}
            tint={0.05}
            minHeight={200}
            style={{ padding: 'clamp(14px, 3vw, 24px)' }}
          >
            <DiagramView id={card.id} svg={artifact.svg} label={`diagram: ${card.title}`} />
          </Stage>
        );
    } else if (artifact.status === 'pending') {
      surface = (
        <Shimmer
          lines={3}
          note="Wobo is composing this piece just for you — it will land here on its own"
        />
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
      >
        <motion.div variants={rise} style={whisper}>
          {card.kind === 'sim'
            ? 'Drag it — feel the law move'
            : card.kind === 'diagram'
              ? 'the picture'
              : 'the idea'}
        </motion.div>
        <motion.div variants={rise} style={cardTitle}>
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

function InkScreen({
  topicId,
  title,
  course,
  settled,
}: {
  topicId: string;
  title: string;
  course: GenCourse | null;
  settled: boolean;
}) {
  const outline = course
    ? [...course.cards.map((c) => c.title.toLowerCase()), 'the workbook', 'the boss']
    : null;
  return (
    <CardBody maxWidth={560}>
      <CourseIntroScene
        topicId={topicId}
        hue={hueForTopic(topicId)}
        minHeight={252}
        sigilSize={112}
      />
      <div style={whisper}>
        {course
          ? course.seeded
            ? 'a working course, honestly floored'
            : 'Written and verified'
          : 'Wobo is composing your course'}
      </div>
      <div style={cardTitle}>{title.toLowerCase()}</div>
      {!outline && (
        <>
          <Shimmer lines={4} />
          <div style={{ ...lead, marginTop: 2 }}>
            Every card is generated, then checked, before it reaches you — it will land here on its
            own; no need to hold your breath.
          </div>
        </>
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
            {course?.seeded
              ? 'The fully generated course is still in verification — this working path is live now and follows the same grammar.'
              : settled
                ? 'Composed and checked, line by line. It starts on the next card.'
                : ''}
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
        const scene = motionSceneFromVideo(res.output, title);
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
  setBar,
  onDone,
}: {
  title: string;
  courseId: string;
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
          <Shimmer
            lines={4}
            note="Wobo is animating this one by hand — it will land here on its own"
          />
        )}
        {video.status === 'failed' && (
          <motion.div variants={rise} style={lead}>
            the animation is still rendering — carry on; it will be here when you come back.
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
  setBar,
  setProgress,
  onExit,
  onResume,
  onOutline,
}: {
  topicId: string;
  title: string;
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
  const [settled, setSettled] = useState(false);
  const [entered, setEntered] = useState(false);
  // idx walks: cards… then workbook, boss, greeting
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
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
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('compose timeout')), COMPOSE_TIMEOUT_MS);
        });
        const res = await Promise.race([
          sdk.llm.invoke(
            'engine.compose',
            { topic: title, topic_id: topicId, difficulty: 'core' },
            { consentTier: 'un_elevated' },
          ),
          timeout,
        ]);
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
        // the floor below is the fallback — never an error state
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
      setCourse(built);
      setSettled(true);
      setMood('idle');
      // resume where they left off — a course never restarts (mission 1). The stored value is a
      // card index; restore only into content/workbook/boss, never the finished greeting. A
      // completed course never resumes a stale end state: a replay always begins at card 0.
      const saved = readCoursePos(topicId);
      if (!replay && typeof saved === 'number' && saved >= 1 && saved <= built.cards.length + 1) {
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
    setIdx((i) => i + 1);
  }, []);
  const awardWorkbookItem = useCallback(
    (item: GenItem) => award('item', { onceKey: `gen-wb-${topicId}-${item.id}`, hue }),
    [award, topicId, hue],
  );
  const awardNothing = useCallback(() => {}, []);
  const bossDone = useCallback(() => {
    award('boss', { onceKey: `gen-boss-${topicId}`, hue });
    setIdx((i) => i + 1);
  }, [award, topicId, hue]);

  const segments = (course?.cards.length ?? 4) + 4; // + video, workbook, boss, greeting
  const stops = course ? course.cards.length : 0;
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
    const steps = [...course.cards.map((c) => c.title.toLowerCase()), 'the workbook', 'the boss'];
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
      primary: {
        label: course?.seeded ? 'Start the working course' : 'Start the course',
        disabled: !settled,
        onClick: () => setEntered(true),
      },
    });
  }, [entered, settled, course, setBar]);

  // content cards: act → check (reveal + XP) → continue
  const card = course && idx < stops ? course.cards[idx] : null;
  useEffect(() => {
    // a discovery card, an activity engine or the bridge owns its own action bar — skip the
    // act/check flow. The bridge in particular must never reach the `award('bonus')` below: the
    // ground under a topic is not an achievement, and paying a child 15 XP for tapping past it
    // teaches them that the tap was the point.
    if (!entered || !card || card.discovery || card.activity || card.id === 'bridge') return;
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
        <InkScreen topicId={topicId} title={title} course={course} settled={settled} />
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
      </Deck>
    );
  }

  if (stage === 'video') {
    return (
      <Deck id="gen-video">
        <VideoBeat
          title={course.title}
          courseId={course.courseId}
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
          passNeeded={0}
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
          passNeeded={2}
          setBar={setBar}
          onAttempt={bumpAttempts}
          awardCorrect={awardNothing}
          onDone={bossDone}
        />
      </Deck>
    );
  }

  if (card?.discovery) {
    return (
      <Deck id={`gen-discovery-${idx}`}>
        <Discovery spec={card.discovery} hue={hue} setBar={setBar} onDone={advance} />
      </Deck>
    );
  }

  if (card?.activity) {
    const a = card.activity;
    return (
      <Deck id={`gen-activity-${idx}`}>
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
      {card && <GenCardView card={card} course={course} hue={hue} revealed={revealed} />}
    </Deck>
  );
}
