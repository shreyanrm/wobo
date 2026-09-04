/**
 * @wobo/kgtopg-contract-seed — the platform interface this repo holds.
 *
 * KGtoPG is a separate plane (in this project, the platform/pii_vault/operational schemas). This
 * package carries the typed governed-view interface, the DTOs, the event->platform mapping, the atom
 * ontology seed, the outbox relay, and an in-repo reference implementation good enough to build and
 * prove the atom. The app calls these through the SDK; it never reads platform tables directly.
 */

export * from './atom-seed';
export * from './dto';
export * from './event-mapping';
export * from './interface';
export {
  bandRank,
  type ChoosableNode,
  type ChooseOptions,
  chooseNextNode,
  isAtFloor,
  MASTERY_BANDS,
  MASTERY_FLOOR,
} from './reference/chooser';
export {
  InMemoryKgtopg,
  type InMemoryKgtopgOptions,
  type MasteryBandChange,
  type MasteryEvidencePoint,
  type MasteryNodeRecord,
  type MasterySnapshot,
} from './reference/in-memory';
export * from './relay';
