'use client';

/**
 * THE CLIMB — one chapter drawn as a map, from design/prototypes/app-climb.html.
 *
 * One spine, the chapter's topics alternating either side above 640px and on a single left rail
 * below it, each one in the state the teaching engine actually puts it in. The two things a
 * chapter list can never show are here and are the whole reason the map exists:
 *
 *   THE RETURN ARC   under a topic that was learnt and then slipped back below the mastery floor.
 *                    It is the promise "we do not move on until it is mastered", drawn. It is
 *                    rendered if and only if `mastery.ts` says a completed topic fell, and it is
 *                    never decoration (`climb-map.ts` `slipped`).
 *   THE BRIDGE       under a topic whose ground is not under the learner yet: what is missing and
 *                    what will be taught first, as chips that open those topics. Rendered only
 *                    where the real prerequisite state says so, and it says whether a placement
 *                    check actually ran or whether this is the syllabus's own order.
 *
 * Everything on it is derived in `climb-map.ts`, which reads the modules that own the truth: the
 * mastery bands, the chooser, the prerequisite graph, the placement seam and the re-teach ladder.
 * Nothing here holds a second opinion, and there is no fixture anywhere in this file.
 *
 * THE LIST IS A LIST. An `<ol>`, one `<li>` per node, each with one focusable control that carries
 * the node's position and its status IN WORDS. Colour never carries meaning on its own: mint,
 * pig, rose, lilac and marigold each repeat something the sentence beside them already says.
 *
 * THE VIBE. `ui/viewPref.ts` is the whole surface a look is allowed to act through: two labels and
 * a `data-vibe` stamp that `ui/vibe.css` reads. Same nodes, same order, same states, same gating,
 * same topic titles, both ways. This file passes the vibe nothing and asks it nothing else.
 *
 * TWO COMPONENTS, ON PURPOSE. `Climb` reads the stores and derives the map; `ClimbView` draws it
 * and touches nothing else. The split exists so the rule above can be tested against the thing
 * that actually ships: `ui/viewPref.test.tsx` renders `ClimbView` twice, from one real
 * `buildClimb` map, and a component that hid, reordered or relabelled a node per vibe would fail
 * there. A test that renders its own stand-in cannot see that, which is why this one does not.
 */

import { useRegisterTarget, WaitScene } from '@wobo/wobo';
import { type Ref, useMemo } from 'react';
import { useRegistryRevision } from '../../curriculum/hooks';
import type { Chapter } from '../../data/model';
import { routeToPath, useRouter } from '../../shell/router';
import { useMastery } from '../../store/mastery';
import { useProgress } from '../../store/progress';
import { ChapterTestMark, RewardMark, VibeSwitch } from '../../ui/vibe';
import { subjectForTopic } from '../../ui/hues';
import { useVibe, vibeWords } from '../../ui/viewPref';
import {
  bridgeLine,
  buildClimb,
  CLIMB_LOOP,
  type ClimbMap,
  type ClimbNode,
  type ClimbState,
  climbStats,
  nodeLine,
} from './climb-map';
import './Climb.css';

/** The state's own class. The words come from `climb-map.ts`; this is only what paints. */
const STATE_CLASS: Readonly<Record<ClimbState, string>> = {
  learnt: 'cl-done',
  now: 'cl-now',
  debt: 'cl-debt',
  ahead: 'cl-lock',
  unknown: 'cl-unsure',
};

/**
 * The mark inside a dot. Silent to a screen reader on purpose: every one of them repeats something
 * the node's own sentence already says, so a picture is never the only carrier.
 */
function Mark({ node }: { node: ClimbNode }) {
  if (node.kind === 'reward') return <RewardMark />;
  if (node.kind === 'gate') return <ChapterTestMark />;
  if (node.state === 'learnt') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12.5 9 17.5 20 6.5" />
      </svg>
    );
  }
  if (node.state === 'now') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    );
  }
  if (node.state === 'debt') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v6M12 16.5v.5" />
        <circle cx="12" cy="12" r="8.5" />
      </svg>
    );
  }
  return <b>{node.index}</b>;
}

/**
 * The arc back up to a topic that slipped. Decoration, and deliberately so: the node's own line
 * already says "Learnt once, then it slipped. It comes back around."
 */
function ReturnArc() {
  return (
    <div className="cl-loop" aria-hidden="true">
      <svg viewBox="0 0 56 64" aria-hidden="true">
        <path d="M28 60 C 8 48, 8 16, 28 4" />
        <path d="M22 10 L28 4 L34 10" />
      </svg>
      <span>{CLIMB_LOOP}</span>
    </div>
  );
}

export interface ClimbProps {
  /** The chapter in front of the learner. Its topics must have been loaded, or the map says so. */
  chapter: Chapter;
  /** Where a topic opens. The subject screen hands in its own door (learn, or practice). */
  onOpen?: (topicId: string) => void;
}

export interface ClimbViewProps {
  /** The chapter, already derived (`climb-map.ts`). The view holds no opinion about any of it. */
  map: ClimbMap;
  /** Opens a topic. The connected component below hands in the router's door. */
  open: (topicId: string) => void;
  /** Wobo's read of the list, when there is a bus to register with. */
  pathRef?: Ref<HTMLOListElement>;
}

export function Climb({ chapter, onOpen }: ClimbProps) {
  const router = useRouter();
  const { completed, topicProgress } = useProgress();
  // The bands and the platform's own next-best node: exactly what the chapter rows read, one level
  // down (screens/learn/mastery.ts owns the rule; this screen owns no opinion of its own).
  const { bandOf, nextNodeId } = useMastery();
  // A chapter's topics arrive AFTER its row does, and `ingestTopics` fills them in place: the
  // chapter object keeps its identity, so a memo keyed on it alone would hold the empty map
  // forever and the climb would sit on "I am fetching the topics" for the whole session. The
  // registry's revision is the identity that actually moves (curriculum/registry.ts).
  const revision = useRegistryRevision();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the chapter's contents, which are filled in place
  const map = useMemo(
    () =>
      buildClimb(chapter, {
        completed,
        bandOf,
        topicProgress,
        platformNodeId: nextNodeId,
      }),
    [chapter, completed, bandOf, topicProgress, nextNodeId, revision],
  );

  // Wobo reads the map at code level: every node, its state and its own sentence.
  const pathRef = useRegisterTarget<HTMLOListElement>('learn-climb', {
    kind: 'map',
    label: `the climb through ${chapter.name}, one node per topic with where the learner stands`,
    getSceneState: () => ({
      chapter: chapter.name,
      learnt: map.learnt,
      owed: map.debts,
      ground: map.ground,
      nodes: map.nodes.map((n) => ({ name: n.name, state: n.state, line: nodeLine(n) })),
    }),
  });

  const open = (topicId: string) => {
    if (onOpen) onOpen(topicId);
    else router.navigate({ name: 'course', topicId });
  };

  return <ClimbView map={map} open={open} pathRef={pathRef} />;
}

/**
 * THE CLIMB, DRAWN. Everything the map produced and nothing else: no store, no router, no bus. It
 * is exported so the one rule that cannot bend can be tested against THE SHIPPED COMPONENT rather
 * than against a stand-in — `ui/viewPref.test.tsx` renders this, twice, from a real `buildClimb`
 * map, and compares the two vibes node for node.
 */
export function ClimbView({ map, open, pathRef }: ClimbViewProps) {
  const words = vibeWords(useVibe());

  if (map.topics === 0) {
    return (
      <section className="cl-climb cl-head" aria-label="This chapter">
        <span className="cl-eyebrow">Chapter {map.chapterIndex}</span>
        <h2>{map.chapterName}</h2>
        {/* The topics are on their way. The orb does this subject's own thing while they come,
            and says nothing about it (docs/EMAILS-AND-ANIMATIONS.md §3). */}
        <WaitScene subject={subjectForTopic(map.chapterId)} width={220} />
      </section>
    );
  }

  const total = map.nodes.length;

  return (
    <section className="cl-climb" aria-label={`The climb through ${map.chapterName}`}>
      <div className="cl-bar">
        <span className="cl-eyebrow">Chapter {map.chapterIndex}</span>
        <VibeSwitch />
      </div>

      <div className="cl-head">
        <h2>{map.chapterName}</h2>
        <p>
          Every topic of this chapter, in the order Wobo teaches them. Nothing ahead is hidden from
          you, and nothing behind you is taken away.
        </p>
        <div className="cl-stats">
          {climbStats(map).map((s) => (
            <div className="cl-stat" key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <ol
        className="cl-path"
        ref={pathRef}
        style={{ ['--reached' as string]: `${Math.round(map.reached * 100)}%` }}
      >
        {map.nodes.map((node) => {
          const kind =
            node.kind === 'reward' ? ' cl-chest' : node.kind === 'gate' ? ' cl-boss' : '';
          const title =
            node.kind === 'reward'
              ? words.reward
              : node.kind === 'gate'
                ? words.chapterEnd
                : node.name;
          const line = nodeLine(node);
          // The whole node in one sentence: what it is, where it sits, and how it stands. This is
          // the accessible name of the control, so a screen reader never has to infer a colour.
          const label = `${title}. ${node.index} of ${total}. ${
            node.kind === 'reward' ? `${node.name}. ` : ''
          }${line}`;
          return (
            <li
              key={node.key}
              className={`cl-n cl-${node.side} ${STATE_CLASS[node.state]}${kind}`}
              aria-current={node.state === 'now' ? 'step' : undefined}
            >
              <span className="cl-dot" aria-hidden="true">
                <Mark node={node} />
              </span>

              {node.topicId ? (
                <a
                  className="cl-card"
                  href={routeToPath({ name: 'course', topicId: node.topicId })}
                  aria-label={label}
                  onClick={(e) => {
                    e.preventDefault();
                    if (node.topicId) open(node.topicId);
                  }}
                >
                  <b>{title}</b>
                  {node.kind === 'reward' && <span className="cl-meta">{node.name}</span>}
                  <span className="cl-meta">{line}</span>
                </a>
              ) : (
                // The node at the end opens nothing: this product runs no chapter test, so it is a
                // marker and never a door. Focusable so the list can be walked to its end, and it
                // states its own status rather than offering an action it cannot perform.
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the map is walkable end to end, and a marker that cannot be reached cannot be read
                <div className="cl-card" role="note" tabIndex={0} aria-label={label}>
                  <b>{title}</b>
                  <span className="cl-meta">{line}</span>
                </div>
              )}

              {node.slipped && <ReturnArc />}

              {node.bridge && (
                <div className="cl-bridge">
                  <b>Ground to lay first</b>
                  <p>{bridgeLine(node.bridge)}</p>
                  <div className="cl-ground">
                    {node.bridge.ground.map((g) => (
                      <button
                        key={g.topicId}
                        type="button"
                        onClick={() => open(g.topicId)}
                        aria-label={`Open ${g.name} first`}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="cl-note">
        the same {map.topics} {map.topics === 1 ? 'topic' : 'topics'} either way; only the look
        changes
      </p>
    </section>
  );
}
