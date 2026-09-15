/**
 * The curriculum wire, typed for the client.
 *
 * Law: docs/CURRICULUM.md. The client holds no syllabus of its own — every framework, level,
 * subject, unit and topic comes from the brain's registry, on demand, with its provenance and its
 * honest label attached. Nothing here can fabricate a chapter: the views are read-only projections
 * of what the brain sent, and a missing syllabus is a `looking` status, never a filled-in list.
 *
 * Wire is snake_case; these types are camelCase. `parse.ts` is the single boundary between them, so
 * a field the brain grows never crashes a screen and a field it renames fails in one place.
 */

/** What kind of framework this is (CURRICULUM.md §2). `personal` never leaves its owner. */
export type CurriculumKind =
  | 'national'
  | 'state'
  | 'international'
  | 'open'
  | 'homeschool'
  | 'online'
  | 'personal';

/** How much we actually know about a syllabus. Drives the label the learner reads (§5). */
export type CurriculumStatus = 'verified' | 'provisional' | 'community' | 'personal';

/** The ontology's node kinds, below subject (§2). */
export type CurriculumNodeKind = 'level' | 'subject' | 'unit' | 'topic' | 'objective';

/** Where a node came from: the document, and the page or section inside it. */
export interface CurriculumSourceRef {
  url: string | null;
  /** A page number or a section heading — whichever the source document gave. */
  page: number | null;
  section: string | null;
}

/** A textbook the learner attached to a node themselves. */
export interface CurriculumTextbook {
  title: string;
  publisher?: string;
  url?: string;
  isbn?: string;
}

/** One learning objective, in the framework's own words where the source had them. */
export interface CurriculumObjective {
  id: string | null;
  name: string;
}

/** A node of the learner's syllabus, already merged with their overlay by the brain. */
export interface CurriculumNode {
  id: string;
  kind: CurriculumNodeKind;
  name: string;
  parentId: string | null;
  order: number;
  aliases: string[];
  sourceRef: CurriculumSourceRef | null;
  conceptIds: string[];
  /** True when the learner added this node themselves (an `own:<uuid>` id). */
  own: boolean;
  /** The learner said their school does not teach this. Shown, dimmed, never deleted. */
  notInMySchool: boolean;
  textbook: CurriculumTextbook | null;
  /** The canonical name, when the learner renamed it. */
  renamedFrom: string | null;
  /** One line naming where this node came from, or null when nothing on file says. */
  source: string | null;
  /** The checks that actually ran on this node's extraction (CURRICULUM.md §5). */
  checksPassed: string[];
  verifiedAt: string | null;
  /** Topics carry their objectives; other kinds carry none. */
  objectives: CurriculumObjective[];
}

/** A framework as the registry search returns it. */
export interface CurriculumFramework {
  id: string;
  name: string;
  kind: CurriculumKind;
  status: CurriculumStatus;
  aliases: string[];
  country: string | null;
  region: string | null;
  languages: string[];
  /** The levels this framework actually has, grades 4 to 13 only (§11). */
  levels: string[];
  officialSite: string | null;
  /** True for the learner's own syllabus — theirs alone unless they offer it. */
  personal: boolean;
  /** The brain's plain-language label. Never a badge with a number. */
  label: string;
}

/** One published edition of a framework. Immutable (§2). */
export interface CurriculumVersion {
  id: string;
  name: string;
  status: CurriculumStatus;
  /** The academic year or edition, when the brain named one. */
  year: string | null;
}

/** The door that is always open: "not listed? tell me" (§3). Present on every search response. */
export interface NotListedDoor {
  /** Wobo's line, as the brain wrote it. */
  message: string;
  /** What the learner typed, so the door can carry it straight into discovery. */
  query: string;
}

export interface CurriculumSearchResult {
  query: string;
  country: string | null;
  results: CurriculumFramework[];
  notListed: NotListedDoor;
}

export interface CurriculumFrameworkView {
  framework: CurriculumFramework;
  version: CurriculumVersion | null;
  label: string;
  levels: string[];
  /** Only populated when a level was named — a framework alone has no subjects. */
  subjects: string[];
  level: string | null;
  pinnedVersionId: string | null;
  /** The always-open door, when the brain sent one — a level with no subjects is a dead end too. */
  notListed: NotListedDoor | null;
}

/**
 * The state machine a discovery job walks, in the registry's vocabulary (`curriculum.discovery_jobs`,
 * migration 0008): a job ends at `stored`, `failed` or `refused`. `fetching` and `provisional` are
 * the run's own stage names and are kept so an older brain is still read. Whether a job is over is
 * `open`, never a comparison against this list.
 */
export type DiscoveryState =
  | 'queued'
  | 'searching'
  | 'fetching'
  | 'extracting'
  | 'checking'
  | 'provisional'
  | 'stored'
  | 'failed'
  | 'refused';

/** What the brain shows while it is still looking. Never a syllabus, always a status. */
export interface DiscoveryPlaceholder {
  jobId: string | null;
  state: DiscoveryState | null;
  /** True while the job can still succeed. */
  open: boolean;
  /** One line, in Wobo's voice. */
  message: string;
}

/**
 * One thing to learn on the plan every board shares (docs/BOARD-COLD-START.md §3).
 *
 * It is a CONCEPT, never a chapter: chapters and topics come from the board and we never invent
 * one (docs/LEARNING-MODEL.md §1). This is what a learner climbs while their own board's syllabus
 * is being read, and what the board's chapters quietly replace when it lands.
 */
export interface SharedConcept {
  conceptId: string;
  name: string;
  /** How many boards teach it in this class. Machine-side; never a number a learner reads. */
  boards: number;
  order: number;
}

/** The class-and-subject plan every board shares. `source` is always `shared`, and says so. */
export interface SharedPlan {
  source: 'shared';
  level: string;
  subject: string;
  concepts: SharedConcept[];
}

export interface CurriculumUnitsView {
  frameworkId: string;
  level: string;
  subject: string;
  /**
   * `ready` carries the board's units. `shared` is the cold start: no chapters yet, the plan
   * every board shares instead, and a designed wait of `waitMs` before it is shown. `looking` is
   * the older shape, still served while a stored version is being re-checked.
   */
  status: 'ready' | 'looking' | 'shared';
  subjectId: string | null;
  units: CurriculumNode[];
  placeholder: DiscoveryPlaceholder | null;
  /** The shared plan, on a cold board. Null the moment the board's own chapters exist. */
  plan: SharedPlan | null;
  /** The discovery job started for this board, for the quiet poll. Never shown. */
  jobId: string | null;
  /**
   * How long the designed wait may run before the learner starts on the shared plan, in
   * milliseconds — the brain's number, so there is one ceiling and not two. Zero means there is
   * nothing to wait for.
   */
  waitMs: number;
  label: string;
  notListed: NotListedDoor | null;
}

export interface CurriculumTopicsView {
  frameworkId: string;
  unit: { id: string; name: string; order: number };
  topics: CurriculumNode[];
}

export interface CurriculumPinView {
  framework: CurriculumFramework;
  version: CurriculumVersion | null;
  label: string;
  pinned: boolean;
}

/** One line of the diff a version upgrade offers (§6). */
export interface UpgradeChange {
  kind: string;
  /** The sentence the learner reads. */
  line: string;
  nodeId: string | null;
  wasNodeId: string | null;
}

export interface CurriculumUpgradeView {
  upgradeAvailable: boolean;
  latest: CurriculumVersion | null;
  latestLabel: string;
  changes: UpgradeChange[];
  summary: string;
  /** Present only on an applied upgrade. */
  upgraded: boolean;
  overlayKept: number | null;
  overlayDropped: number | null;
  /** One line per edit that no longer matches — the honest half of "your edits survived". */
  overlayReport: string[];
}

/** An overlay operation. Serialised to the wire exactly as written (snake_case, `op` tag). */
export type OverlayOp =
  | { op: 'add'; parent_id: string; kind: CurriculumNodeKind; name: string; after?: string | null }
  | { op: 'remove'; node_id: string }
  | { op: 'rename'; node_id: string; name: string }
  | { op: 'reorder'; parent_id: string; order: string[] }
  | { op: 'not_in_my_school'; node_id: string; value: boolean }
  | { op: 'attach_textbook'; node_id: string; textbook: CurriculumTextbook };

export interface CurriculumOverlayView {
  versionId: string | null;
  ops: OverlayOp[];
  /** What the last upgrade could not re-apply, one line each. */
  lastReport: string[];
  updatedAt: string | null;
}

export interface CurriculumStatusView {
  jobId: string | null;
  state: DiscoveryState | null;
  message: string;
  open: boolean;
  notListed: NotListedDoor | null;
}

// --- the learner's own syllabus (§6) --------------------------------------------------------------

/** What the learner handed Wobo: typed or pasted text, a photo of a page, or a PDF. */
export type OwnSource =
  | { kind: 'paste'; text: string; title?: string }
  | { kind: 'photo'; data: string; mediaType: string; title?: string }
  | { kind: 'pdf'; data: string; title?: string };

/**
 * A unit of a personal syllabus, waiting for the learner's one-tap confirmation. It is a node like
 * any other — `own` is true on every one of them, because the learner is the source.
 */
export interface OwnUnit extends CurriculumNode {
  confirmed: boolean;
  /** The words from their own document this unit was read from. */
  quote: string | null;
}

export interface OwnFrameworkView {
  /** The personal framework itself: `kind: personal`, `status: personal`, theirs alone. */
  framework: CurriculumFramework;
  label: string;
  level: string;
  subject: string | null;
  status: CurriculumStatus;
  units: OwnUnit[];
  /** Ids of the units still awaiting a tap. */
  unconfirmed: string[];
  published: boolean;
}
