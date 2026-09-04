import type { MasteryBand } from '@wobo/contracts';

/**
 * THE ORDERING LAW: one answer to "what do I do next", used everywhere.
 *
 * There used to be three heuristics: the reference implementation's forward scan, the learn board's
 * "first not-done chapter", and the subject screen's "now, else next, else the first row". They
 * disagreed, and none of them read a mastery band. This function is the only one left. It is
 * applied to two different node sets:
 *
 *   the platform's ontology   KGtoPG.mastery.getNextBestNode (real prerequisite edges)
 *   the learner's syllabus    the learn flow (sequence order; the client states no edges of its own)
 *
 * THE STATE MACHINE
 *
 *   bands       not_started < emerging < developing < secure < independent
 *   the floor   `secure`: the band at which a topic is counted as learnt, and the level a
 *               prerequisite has to reach before the node it feeds is a fair thing to move on to.
 *   below floor a node still owed work. It comes back around; it is never a wall.
 *
 * THE ORDER
 *
 *   1. a node below the floor whose every prerequisite is at or above the floor:
 *      the weakest one first (a topic already begun and struggling outranks an untouched one),
 *      ties broken by sequence, so the syllabus's own order decides between equals.
 *   2. failing that, any node below the floor at all: the debt is blocked by another debt
 *      (or by a cycle in the edges), so the weakest of them is still the honest next step.
 *   3. failing that, everything is at or above the floor: the first node not yet `independent`,
 *      by sequence: deepening, not advancing.
 *   4. failing that, null. There is nothing left to do here.
 *
 * Step 1 is why a learner who answered everything wrong does not advance: their emerging node
 * sorts ahead of every untouched node after it. Step 3 is why a learner who mastered everything is
 * still given somewhere to go.
 */

/** The bands, in order. The index IS the rank. */
export const MASTERY_BANDS: readonly MasteryBand[] = [
  'not_started',
  'emerging',
  'developing',
  'secure',
  'independent',
];

/** How far along a band is, 0..4. Unknown strings rank as `not_started`. */
export function bandRank(band: MasteryBand | undefined): number {
  const i = band ? MASTERY_BANDS.indexOf(band) : -1;
  return i < 0 ? 0 : i;
}

/**
 * The floor: the band a topic has to reach before the product counts it learnt and stops bringing
 * it back. One constant, read by the chooser, by the learn board's unit states, and by the ignite
 * moment: change it here and every one of them moves together.
 */
export const MASTERY_FLOOR: MasteryBand = 'secure';

/** At or above the floor: this node is learnt. */
export function isAtFloor(
  band: MasteryBand | undefined,
  floor: MasteryBand = MASTERY_FLOOR,
): boolean {
  return bandRank(band) >= bandRank(floor);
}

/** The shape the chooser needs. Both an OntologyNode and a projected syllabus topic satisfy it. */
export interface ChoosableNode {
  node_id: string;
  prerequisite_ids: string[];
  sequence?: number;
}

export interface ChooseOptions {
  /** The band a node must reach to be counted learnt. Defaults to `MASTERY_FLOOR`. */
  floor?: MasteryBand;
}

/**
 * The next node to work on, per the order documented above. `bandOf` answers for any node id,
 * including a prerequisite that is not itself in `nodes` (an unknown prerequisite bands as
 * `not_started`, which correctly blocks the node that depends on it from step 1 while leaving it
 * reachable at step 2: never a wall).
 */
export function chooseNextNode<T extends ChoosableNode>(
  nodes: readonly T[],
  bandOf: (nodeId: string) => MasteryBand | undefined,
  opts: ChooseOptions = {},
): T | null {
  const floor = opts.floor ?? MASTERY_FLOOR;
  const floorRank = bandRank(floor);
  const ordered = [...nodes]
    .map((node, index) => ({ node, index, seq: node.sequence ?? index }))
    .sort((a, b) => a.seq - b.seq || a.index - b.index);

  const below = ordered.filter((o) => bandRank(bandOf(o.node.node_id)) < floorRank);

  // Weakest first, but a node with evidence outranks an untouched one at the same distance from the
  // floor: "keep teaching them until they master it" beats "start something new".
  const weakestFirst = (list: typeof ordered) =>
    [...list].sort((a, b) => {
      const ra = bandRank(bandOf(a.node.node_id));
      const rb = bandRank(bandOf(b.node.node_id));
      const started = (r: number) => (r > 0 ? 0 : 1); // begun-and-owed before never-touched
      return started(ra) - started(rb) || ra - rb || a.seq - b.seq || a.index - b.index;
    })[0]?.node ?? null;

  // 1. below the floor, and every prerequisite is at or above it.
  const ready = below.filter((o) =>
    o.node.prerequisite_ids.every((id) => bandRank(bandOf(id)) >= floorRank),
  );
  const readyPick = weakestFirst(ready);
  if (readyPick) return readyPick;

  // 2. below the floor but blocked by another debt: still the honest next step.
  const blockedPick = weakestFirst(below);
  if (blockedPick) return blockedPick;

  // 3. everything is learnt: deepen the first node that is not yet independent.
  return ordered.find((o) => bandOf(o.node.node_id) !== 'independent')?.node ?? null;
}
