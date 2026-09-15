/**
 * The one boundary between the brain's wire shape and the client's types.
 *
 * Every reader here is lenient in exactly one direction: a field the brain has not sent yet reads
 * as absent, never as a value. Nothing in this file invents a name, a level, a unit or a topic —
 * a malformed list parses to an empty list, and the screen above it says "still looking" rather
 * than showing a syllabus nobody published.
 */

import type {
  CurriculumFramework,
  CurriculumFrameworkView,
  CurriculumKind,
  CurriculumNode,
  CurriculumNodeKind,
  CurriculumObjective,
  CurriculumOverlayView,
  CurriculumPinView,
  CurriculumSearchResult,
  CurriculumSourceRef,
  CurriculumStatus,
  CurriculumStatusView,
  CurriculumTextbook,
  CurriculumTopicsView,
  CurriculumUnitsView,
  CurriculumUpgradeView,
  CurriculumVersion,
  DiscoveryPlaceholder,
  DiscoveryState,
  NotListedDoor,
  OverlayOp,
  OwnFrameworkView,
  OwnUnit,
  SharedConcept,
  SharedPlan,
  UpgradeChange,
} from './types';

type Row = Record<string, unknown>;

const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() && Number.isFinite(Number(v))
      ? Number(v)
      : null;

const strings = (v: unknown): string[] =>
  list(v)
    .map((x) => str(x))
    .filter((x): x is string => x !== null);

/** Read either `snake_case` or `camelCase` — the brain owns the wire and may serialise either. */
const pick = (r: Row, ...keys: string[]): unknown => {
  for (const key of keys) if (r[key] !== undefined && r[key] !== null) return r[key];
  return undefined;
};

const KINDS: CurriculumKind[] = [
  'national',
  'state',
  'international',
  'open',
  'homeschool',
  'online',
  'personal',
];
const STATUSES: CurriculumStatus[] = ['verified', 'provisional', 'community', 'personal'];
const NODE_KINDS: CurriculumNodeKind[] = ['level', 'subject', 'unit', 'topic', 'objective'];
const TERMINAL = new Set(['stored', 'failed', 'refused', 'provisional']);

const STATES: DiscoveryState[] = [
  'queued',
  'searching',
  'fetching',
  'extracting',
  'checking',
  'provisional',
  'stored',
  'failed',
  'refused',
];

const oneOf = <T extends string>(v: unknown, allowed: T[], fallback: T): T => {
  const s = str(v);
  return s && (allowed as string[]).includes(s) ? (s as T) : fallback;
};

/** Wobo's line when the brain sent no words of its own for the always-open door. */
export const NOT_LISTED_FALLBACK = 'Not listed? Tell me its name and I will go and look.';

export function parseNotListed(raw: unknown, query = ''): NotListedDoor {
  if (typeof raw === 'string')
    return { message: str(raw) ?? NOT_LISTED_FALLBACK, query: query.trim() };
  const r = row(raw);
  return {
    message: str(pick(r, 'message', 'say', 'line', 'prompt')) ?? NOT_LISTED_FALLBACK,
    query: str(pick(r, 'query', 'q')) ?? query.trim(),
  };
}

export function parseSourceRef(raw: unknown): CurriculumSourceRef | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const url = str(raw);
    return url ? { url, page: null, section: null } : null;
  }
  const r = row(raw);
  const url = str(pick(r, 'url', 'source_url', 'document_url', 'sourceUrl'));
  const page = num(pick(r, 'page', 'page_number', 'source_page'));
  const section = str(pick(r, 'section', 'source_section', 'heading'));
  if (!url && page === null && !section) return null;
  return { url, page, section };
}

/**
 * One source note out of the two halves the brain sends, which are not the same thing.
 *
 * `source_ref` is the node's own `{document_id, page, section}` — where in the document it sits,
 * and no URL, because a document id is not a link. `source` is the provenance row the gateway
 * attaches beside it, and it is the only place `source_url`, `checks_passed`, `verified_at` and
 * `verified_by` live. Reading only the first is why a learner saw "From Course structure Class IX,
 * unit 1 of the syllabus" with nothing to click: §5's claim served but not falsifiable.
 */
export function parseSourceNote(nodeRef: unknown, provenance: unknown): CurriculumSourceRef | null {
  const p = row(provenance);
  const ref = parseSourceRef(nodeRef);
  const url = str(pick(p, 'source_url', 'sourceUrl', 'url'));
  const where = str(pick(p, 'source', 'source_page_or_section'));
  if (!ref) return url || where ? { url, page: null, section: where } : null;
  return {
    url: ref.url ?? url,
    page: ref.page,
    section: ref.section ?? where,
  };
}

export function parseTextbook(raw: unknown): CurriculumTextbook | null {
  const r = row(raw);
  const title = str(r.title);
  if (!title) return null;
  const out: CurriculumTextbook = { title };
  const publisher = str(r.publisher);
  const url = str(r.url);
  const isbn = str(r.isbn);
  if (publisher) out.publisher = publisher;
  if (url) out.url = url;
  if (isbn) out.isbn = isbn;
  return out;
}

function parseObjectives(raw: unknown): CurriculumObjective[] {
  return list(raw)
    .map((o): CurriculumObjective | null => {
      if (typeof o === 'string') {
        const name = str(o);
        return name ? { id: null, name } : null;
      }
      const r = row(o);
      const name = str(pick(r, 'name', 'text', 'objective'));
      return name ? { id: str(pick(r, 'id', 'node_id')), name } : null;
    })
    .filter((o): o is CurriculumObjective => o !== null);
}

/** A node view. Returns null for anything without an id and a name — never a placeholder node. */
export function parseNode(
  raw: unknown,
  fallbackKind: CurriculumNodeKind = 'unit',
): CurriculumNode | null {
  const r = row(raw);
  const id = str(pick(r, 'id', 'node_id'));
  const name = str(r.name);
  if (!id || !name) return null;
  const provenance = r.source;
  return {
    id,
    kind: oneOf(r.kind, NODE_KINDS, fallbackKind),
    name,
    parentId: str(pick(r, 'parent_id', 'parentId')),
    order: num(r.order) ?? 0,
    aliases: strings(r.aliases),
    sourceRef: parseSourceNote(pick(r, 'source_ref', 'sourceRef'), provenance),
    conceptIds: strings(pick(r, 'concept_ids', 'conceptIds')),
    own: r.own === true,
    notInMySchool: pick(r, 'not_in_my_school', 'notInMySchool') === true,
    textbook: parseTextbook(r.textbook),
    renamedFrom: str(pick(r, 'renamed_from', 'renamedFrom')),
    // A one-line description of the source, whichever half carried it. `null` where the brain
    // says there is none, which is a node the learner added themselves.
    source: str(provenance) ?? str(pick(row(provenance), 'source', 'source_page_or_section')),
    checksPassed: strings(pick(row(provenance), 'checks_passed', 'checksPassed')),
    verifiedAt: str(pick(row(provenance), 'verified_at', 'verifiedAt')),
    objectives: parseObjectives(r.objectives),
  };
}

export function parseNodes(raw: unknown, kind: CurriculumNodeKind): CurriculumNode[] {
  return list(raw)
    .map((n) => parseNode(n, kind))
    .filter((n): n is CurriculumNode => n !== null)
    .sort((a, b) => a.order - b.order);
}

export function parseFramework(raw: unknown): CurriculumFramework | null {
  const r = row(raw);
  const id = str(pick(r, 'id', 'framework_id'));
  const name = str(r.name);
  if (!id || !name) return null;
  const kind = oneOf(r.kind, KINDS, 'national');
  return {
    id,
    name,
    kind,
    status: oneOf(r.status, STATUSES, kind === 'personal' ? 'personal' : 'provisional'),
    aliases: strings(r.aliases),
    country: str(r.country),
    region: str(r.region),
    languages: strings(r.languages),
    levels: strings(r.levels),
    officialSite: str(pick(r, 'official_site', 'officialSite')),
    personal: r.personal === true || kind === 'personal',
    label: str(r.label) ?? '',
  };
}

export function parseVersion(raw: unknown): CurriculumVersion | null {
  const r = row(raw);
  const id = str(pick(r, 'id', 'version_id'));
  if (!id) return null;
  return {
    id,
    name: str(r.name) ?? str(r.year) ?? id,
    status: oneOf(r.status, STATUSES, 'provisional'),
    year: str(r.year),
  };
}

export function parseSearch(raw: unknown, query: string): CurriculumSearchResult {
  const r = row(raw);
  return {
    query: str(r.query) ?? query.trim(),
    country: str(r.country),
    results: list(r.results)
      .map((f) => parseFramework(f))
      .filter((f): f is CurriculumFramework => f !== null),
    notListed: parseNotListed(pick(r, 'not_listed', 'notListed'), query),
  };
}

export function parseFrameworkView(raw: unknown): CurriculumFrameworkView | null {
  const r = row(raw);
  const framework = parseFramework(r.framework);
  if (!framework) return null;
  return {
    framework,
    version: parseVersion(r.version),
    label: str(r.label) ?? framework.label,
    levels: strings(r.levels).length ? strings(r.levels) : framework.levels,
    subjects: strings(r.subjects),
    level: str(r.level),
    pinnedVersionId: str(pick(r, 'pinned_version_id', 'pinnedVersionId')),
    notListed:
      pick(r, 'not_listed', 'notListed') !== undefined
        ? parseNotListed(pick(r, 'not_listed', 'notListed'))
        : null,
  };
}

export function parsePlaceholder(raw: unknown): DiscoveryPlaceholder | null {
  if (!raw) return null;
  const r = row(raw);
  const state = str(r.state);
  return {
    jobId: str(pick(r, 'job_id', 'jobId', 'id')),
    state: state && (STATES as string[]).includes(state) ? (state as DiscoveryState) : null,
    open: r.open !== false,
    message: str(r.message) ?? 'I am still looking for this one.',
  };
}

/**
 * The plan every board shares (docs/BOARD-COLD-START.md §3). Null unless the brain sent one, and
 * never synthesised here: a plan the client invented would be a syllabus with no source.
 */
export function parseSharedPlan(raw: unknown): SharedPlan | null {
  if (!raw) return null;
  const r = row(raw);
  if (str(r.source) !== 'shared') return null;
  const concepts: SharedConcept[] = [];
  const list = Array.isArray(r.concepts) ? r.concepts : [];
  for (const entry of list) {
    const c = row(entry);
    const conceptId = str(pick(c, 'concept_id', 'conceptId'));
    const name = str(c.name);
    if (!conceptId || !name) continue;
    concepts.push({
      conceptId,
      name,
      boards: num(c.boards) ?? 0,
      order: num(c.order) ?? concepts.length,
    });
  }
  if (concepts.length === 0) return null;
  return {
    source: 'shared',
    level: str(r.level) ?? '',
    subject: str(r.subject) ?? '',
    concepts,
  };
}

export function parseUnits(
  raw: unknown,
  fallback: { frameworkId: string; level: string; subject: string },
): CurriculumUnitsView {
  const r = row(raw);
  const units = parseNodes(r.units, 'unit');
  const plan = parseSharedPlan(r.plan);
  const sent = str(r.status);
  // The brain's own status wins; with no status word, units decide — an empty list is never an
  // empty syllabus presented as fact. `shared` only stands when a plan actually came with it,
  // because a cold start with nothing to start on is the empty shelf under a new name.
  const status: CurriculumUnitsView['status'] =
    sent === 'ready' || units.length > 0
      ? 'ready'
      : sent === 'shared' && plan
        ? 'shared'
        : 'looking';
  return {
    frameworkId: str(pick(r, 'framework_id', 'frameworkId')) ?? fallback.frameworkId,
    level: str(r.level) ?? fallback.level,
    subject: str(r.subject) ?? fallback.subject,
    status,
    subjectId: str(pick(r, 'subject_id', 'subjectId')),
    units,
    placeholder: parsePlaceholder(r.placeholder),
    plan,
    jobId: str(pick(r, 'job_id', 'jobId')) ?? null,
    waitMs: Math.max(0, num(pick(r, 'wait_ms', 'waitMs')) ?? 0),
    label: str(r.label) ?? '',
    notListed:
      pick(r, 'not_listed', 'notListed') !== undefined
        ? parseNotListed(pick(r, 'not_listed', 'notListed'), fallback.subject)
        : null,
  };
}

export function parseTopics(raw: unknown, frameworkId: string): CurriculumTopicsView | null {
  const r = row(raw);
  const unit = row(r.unit);
  const unitId = str(pick(unit, 'id', 'node_id'));
  if (!unitId) return null;
  return {
    frameworkId: str(pick(r, 'framework_id', 'frameworkId')) ?? frameworkId,
    unit: { id: unitId, name: str(unit.name) ?? '', order: num(unit.order) ?? 0 },
    topics: parseNodes(r.topics, 'topic'),
  };
}

export function parsePin(raw: unknown): CurriculumPinView | null {
  const r = row(raw);
  const framework = parseFramework(r.framework);
  if (!framework) return null;
  return {
    framework,
    version: parseVersion(r.version),
    label: str(r.label) ?? framework.label,
    pinned: r.pinned !== false,
  };
}

function parseChange(raw: unknown): UpgradeChange | null {
  const r = row(raw);
  const line = str(r.line);
  if (!line) return null;
  return {
    kind: str(r.kind) ?? 'changed',
    line,
    nodeId: str(pick(r, 'node_id', 'nodeId')),
    wasNodeId: str(pick(r, 'was_node_id', 'wasNodeId')),
  };
}

export function parseUpgrade(raw: unknown): CurriculumUpgradeView {
  const r = row(raw);
  return {
    upgradeAvailable: pick(r, 'upgrade_available', 'upgradeAvailable') === true,
    latest: parseVersion(r.latest),
    latestLabel: str(pick(r, 'latest_label', 'latestLabel')) ?? '',
    changes: list(r.changes)
      .map((c) => parseChange(c))
      .filter((c): c is UpgradeChange => c !== null),
    summary: str(r.summary) ?? '',
    upgraded: r.upgraded === true,
    overlayKept: num(pick(r, 'overlay_kept', 'overlayKept')),
    overlayDropped: num(pick(r, 'overlay_dropped', 'overlayDropped')),
    overlayReport: strings(pick(r, 'overlay_report', 'overlayReport')),
  };
}

/** An overlay op straight off the wire. Unknown tags are dropped, never guessed at. */
export function parseOverlayOp(raw: unknown): OverlayOp | null {
  const r = row(raw);
  const op = str(pick(r, 'op', 'kind', 'type'));
  switch (op) {
    case 'add': {
      const parent = str(pick(r, 'parent_id', 'parentId'));
      const name = str(r.name);
      if (!parent || !name) return null;
      const after = str(r.after);
      const nodeKind = oneOf(pick(r, 'node_kind', 'kind'), NODE_KINDS, 'topic');
      return { op: 'add', parent_id: parent, kind: nodeKind, name, after };
    }
    case 'remove': {
      const id = str(pick(r, 'node_id', 'nodeId'));
      return id ? { op: 'remove', node_id: id } : null;
    }
    case 'rename': {
      const id = str(pick(r, 'node_id', 'nodeId'));
      const name = str(r.name);
      return id && name ? { op: 'rename', node_id: id, name } : null;
    }
    case 'reorder': {
      const parent = str(pick(r, 'parent_id', 'parentId'));
      const order = strings(r.order);
      return parent && order.length ? { op: 'reorder', parent_id: parent, order } : null;
    }
    case 'not_in_my_school': {
      const id = str(pick(r, 'node_id', 'nodeId'));
      return id ? { op: 'not_in_my_school', node_id: id, value: r.value !== false } : null;
    }
    case 'attach_textbook': {
      const id = str(pick(r, 'node_id', 'nodeId'));
      const textbook = parseTextbook(r.textbook);
      return id && textbook ? { op: 'attach_textbook', node_id: id, textbook } : null;
    }
    default:
      return null;
  }
}

export function parseOverlay(raw: unknown): CurriculumOverlayView {
  const r = row(raw);
  const overlay = row(pick(r, 'overlay') ?? r);
  return {
    versionId: str(pick(overlay, 'version_id', 'versionId')),
    ops: list(overlay.ops)
      .map((o) => parseOverlayOp(o))
      .filter((o): o is OverlayOp => o !== null),
    lastReport: strings(pick(overlay, 'last_report', 'lastReport')),
    updatedAt: str(pick(overlay, 'updated_at', 'updatedAt')),
  };
}

export function parseStatus(raw: unknown): CurriculumStatusView {
  const r = row(raw);
  const job = row(r.job);
  const state = str(pick(r, 'state') ?? job.state);
  return {
    jobId: str(pick(job, 'id', 'job_id') ?? pick(r, 'job_id', 'jobId')),
    state: state && (STATES as string[]).includes(state) ? (state as DiscoveryState) : null,
    message: str(r.message) ?? '',
    // The brain says whether the job is still working; a state name is a stage, not a verdict.
    open: job.open !== undefined ? job.open !== false : !TERMINAL.has(state ?? ''),
    notListed:
      pick(r, 'not_listed', 'notListed') !== undefined
        ? parseNotListed(pick(r, 'not_listed', 'notListed'))
        : null,
  };
}

function parseOwnUnit(raw: unknown): OwnUnit | null {
  const node = parseNode(raw, 'unit');
  if (!node) return null;
  const r = row(raw);
  return {
    ...node,
    // A unit of the learner's own syllabus is theirs by definition, whatever the wire said.
    own: true,
    confirmed: r.confirmed === true,
    quote: str(pick(r, 'quote', 'source_quote', 'evidence')),
  };
}

/**
 * The learner's own syllabus. The framework block may arrive nested (`{ framework: {...} }`) or
 * flat; either way it must carry an id and a name, and it is always marked personal — a personal
 * framework that lost its `personal` flag would be one offered for sharing by accident.
 */
export function parseOwnFramework(raw: unknown): OwnFrameworkView | null {
  const r = row(raw);
  const block = row(pick(r, 'framework') ?? r);
  const framework = parseFramework({
    kind: 'personal',
    status: 'personal',
    personal: true,
    ...block,
    id: pick(block, 'id', 'framework_id') ?? pick(r, 'framework_id'),
    label: pick(block, 'label') ?? pick(r, 'label'),
  });
  if (!framework) return null;
  const units = list(pick(r, 'units') ?? block.units)
    .map((u) => parseOwnUnit(u))
    .filter((u): u is OwnUnit => u !== null)
    .sort((a, b) => a.order - b.order);
  const unconfirmed = strings(pick(r, 'unconfirmed') ?? block.unconfirmed);
  const published =
    r.published === true || block.published === true || str(r.state) === 'published';
  return {
    framework: { ...framework, kind: 'personal', status: 'personal', personal: true },
    label: str(pick(r, 'label') ?? block.label) ?? 'Drafted from your syllabus, check it',
    level: str(pick(r, 'level') ?? block.level) ?? framework.levels[0] ?? '',
    subject: str(pick(r, 'subject') ?? block.subject),
    status: 'personal',
    units,
    unconfirmed: unconfirmed.length
      ? unconfirmed
      : units.filter((u) => !u.confirmed).map((u) => u.id),
    published,
  };
}
