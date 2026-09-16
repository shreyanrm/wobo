/**
 * The curriculum client — the only way the app asks the brain what a learner studies.
 *
 * Every call is one authenticated capability post through the gateway (`POST /v1/capability/…`
 * with `{ payload }`), so identity is attached in one place and refusals come back in Wobo's voice.
 * The client holds no key, no model id and no syllabus: it asks, parses what came back, and hands
 * the screen either a real answer or an honest "still looking".
 *
 * `post` is injectable so the whole client is testable without a network or a token.
 */

import { BudgetExhaustedError, GATEWAY_COPY, gatewayFetch, SignInRequiredError } from '../gateway';
import {
  parseFrameworkView,
  parseOverlay,
  parseOwnFramework,
  parsePin,
  parseSearch,
  parseStatus,
  parseTopics,
  parseUnits,
  parseUpgrade,
} from './parse';
import type {
  CurriculumFrameworkView,
  CurriculumOverlayView,
  CurriculumPinView,
  CurriculumSearchResult,
  CurriculumStatusView,
  CurriculumTopicsView,
  CurriculumUnitsView,
  CurriculumUpgradeView,
  OverlayOp,
  OwnFrameworkView,
  OwnSource,
} from './types';

/** The capability names the brain routes on. One list, so a rename is one edit. */
export const CURRICULUM_CAPABILITIES = {
  search: 'curriculum.search',
  framework: 'curriculum.framework',
  units: 'curriculum.units',
  topics: 'curriculum.topics',
  pin: 'curriculum.pin',
  upgrade: 'curriculum.upgrade',
  overlayGet: 'curriculum.overlay.get',
  overlayApply: 'curriculum.overlay.apply',
  status: 'curriculum.status',
  blueprint: 'curriculum.blueprint',
  climb: 'curriculum.climb',
  ownRead: 'curriculum.own.read',
  ownConfirm: 'curriculum.own.confirm',
  ownPublish: 'curriculum.own.publish',
  ownOffer: 'curriculum.own.offer',
} as const;

/** Every refusal the curriculum capabilities can return, in the brain's own codes. */
export type CurriculumErrorCode =
  | 'needs_more'
  | 'overlay_rejected'
  | 'unknown_node'
  | 'unknown_framework'
  | 'unknown_version'
  | 'unknown_unit'
  | 'unknown_capability'
  | 'registry_unavailable'
  | 'unreadable';

/**
 * A refusal from the registry. The message is already Wobo's line; the code is for the screen,
 * which decides between "try again", "let me look for it" and "show me yours".
 */
export class CurriculumError extends Error {
  readonly code: CurriculumErrorCode;
  readonly status: number;
  constructor(code: CurriculumErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'CurriculumError';
    this.code = code;
    this.status = status;
  }
  /** True when the honest next move is the own-syllabus door rather than a retry. */
  get offersOwnSyllabus(): boolean {
    return this.code === 'unknown_framework' || this.code === 'needs_more';
  }
}

/** The seam every method goes through: capability name + payload -> the capability's output. */
export type CapabilityPost = (capability: string, payload: unknown) => Promise<unknown>;

const CODES = new Set<string>([
  'needs_more',
  'overlay_rejected',
  'unknown_node',
  'unknown_framework',
  'unknown_version',
  'unknown_unit',
  'unknown_capability',
  'registry_unavailable',
]);

/** The default post: authenticated fetch at the gateway, typed refusals, `output` unwrapped. */
export function gatewayCapabilityPost(gatewayUrl: string): CapabilityPost {
  return async (capability, payload) => {
    const res = await gatewayFetch(`${gatewayUrl}/v1/capability/${capability}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      let code: string | undefined;
      let message: string | undefined;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        const detail = body.detail;
        const shape = (detail && typeof detail === 'object' ? detail : body) as Record<
          string,
          unknown
        >;
        code = typeof shape.code === 'string' ? shape.code : undefined;
        message = typeof shape.message === 'string' ? shape.message : undefined;
      } catch {
        // no body, or not JSON — the status alone decides below
      }
      if (res.status === 401 || code === 'sign_in_required')
        throw new SignInRequiredError(message || GATEWAY_COPY.signIn);
      if (res.status === 429 || code === 'budget_exhausted')
        throw new BudgetExhaustedError(
          message || GATEWAY_COPY.budget,
          res.headers.get('x-wobo-budget-reset'),
          null,
        );
      if (code && CODES.has(code))
        throw new CurriculumError(
          code as CurriculumErrorCode,
          message || GATEWAY_COPY.trouble,
          res.status,
        );
      throw new CurriculumError(
        'registry_unavailable',
        message || GATEWAY_COPY.trouble,
        res.status,
      );
    }
    const data = (await res.json()) as { output?: unknown };
    return data?.output ?? data;
  };
}

/** Which version a call is about: a framework's pin, or one named version. */
export interface VersionRef {
  frameworkId?: string;
  versionId?: string;
}

export interface CurriculumClient {
  /** Type-ahead over names and aliases. `country` is a hint, never a filter (§3). */
  search(
    q: string,
    opts?: { country?: string | null; limit?: number },
  ): Promise<CurriculumSearchResult>;
  framework(
    frameworkId: string,
    opts?: { level?: string; versionId?: string },
  ): Promise<CurriculumFrameworkView>;
  units(
    frameworkId: string,
    level: string,
    subject: string,
    opts?: { versionId?: string },
  ): Promise<CurriculumUnitsView>;
  topics(
    frameworkId: string,
    unitId: string,
    opts?: { versionId?: string },
  ): Promise<CurriculumTopicsView>;
  pin(frameworkId: string, versionId?: string): Promise<CurriculumPinView>;
  upgrade(frameworkId: string, apply?: boolean): Promise<CurriculumUpgradeView>;
  overlayGet(ref: VersionRef): Promise<CurriculumOverlayView>;
  overlayApply(ref: VersionRef, ops: OverlayOp[]): Promise<CurriculumOverlayView>;
  /** Ask after a discovery job — by job id, or by what the learner was looking at. */
  status(query: {
    jobId?: string;
    frameworkId?: string;
    q?: string;
    level?: string;
    subject?: string;
  }): Promise<CurriculumStatusView>;
  /**
   * The chapter's POOL of modules (docs/LEARNING-MODEL.md), or null when the architect has not
   * built one for this cell.
   *
   * Deliberately `unknown`: the document's schema lives with the code that walks it
   * (`curriculum/blueprint.ts` in the app, `isBlueprint`), so there is one parser and not two, and
   * a pool the app cannot read is refused there rather than half-typed here. This never builds a
   * pool — the architect is a platform-paid job — so a cell without one simply answers null.
   */
  blueprint(cell: BlueprintCell): Promise<{ blueprint: unknown | null; held: number }>;
  /**
   * WHAT THIS LEARNER MEETS NEXT, re-chosen out of what just happened
   * (docs/LEARNING-MODEL.md, "The tutor never leaves", rule 1).
   *
   * Called after EVERY module and never once at the start: hand it the module just answered and
   * the evidence the previous call gave back, and it returns the next module, the reason in the
   * pool's own words, and the group as it stands NOW. It builds nothing, so a chapter the
   * architect has not designed a pool for answers `pool: false` and the screen teaches it exactly
   * as it does today.
   *
   * The evidence travels both ways on purpose: the brain stores no per-learner climb state, so
   * what comes back is what to send next time.
   */
  climb(
    cell: BlueprintCell,
    topic: string,
    state?: { evidence?: ClimbEvidence; answered?: ClimbAnswer | null },
  ): Promise<ClimbStep>;
  own: {
    /** Paste, photo or PDF in; a personal syllabus waiting for confirmation out (§6). */
    read(
      source: OwnSource,
      about: { name: string; level: string; subject?: string; language?: string },
    ): Promise<OwnFrameworkView>;
    confirmUnit(frameworkId: string, unitId: string, confirmed: boolean): Promise<OwnFrameworkView>;
    publish(frameworkId: string): Promise<OwnFrameworkView>;
    /** Offer it to the registry as community-contributed. Always the learner's choice. */
    offer(frameworkId: string, note?: string): Promise<OwnFrameworkView>;
  };
}

/** The syllabus cell a pool belongs to: one chapter, at one board, class and version. */
export interface BlueprintCell {
  node: string;
  chapter: string;
  board: string;
  grade: string;
  subject: string;
  contentVersion: string;
  topics: readonly { id: string; name: string }[];
  minutesBudget?: number | null;
}

/** What this learner has shown on this chapter so far: ids off the pool, and their own words. */
export interface ClimbEvidence {
  done?: readonly string[];
  wrong?: readonly string[];
  heldIdeas?: readonly string[];
  misconceptions?: readonly string[];
  unmetAssumptions?: readonly string[];
  style?: readonly string[];
  slow?: readonly string[];
  quick?: readonly string[];
  said?: readonly string[];
  lastModule?: string;
  lastRight?: boolean;
}

/** One module, answered. The four things the re-choice after it reads. */
export interface ClimbAnswer {
  module: string;
  right: boolean;
  /** Misconception ids the answer itself showed, classified where the content lives. */
  showed?: readonly string[];
  /** How long they took, against the module's own minutes. */
  seconds?: number | null;
  /** What they said in their own words, read only against the chapter's own declarations. */
  said?: string;
}

/** The module a learner meets next, and why, in the pool's own words. */
export interface ClimbStep {
  /** False when the architect has built no pool for this cell. Never an error. */
  pool: boolean;
  step: {
    module: { id: string; aim: string; kind: string; role: string; minutes: number } | null;
    why: string;
    kind: string;
  } | null;
  /** The group that teaches this topic AS IT STANDS, re-chosen on every call. */
  group: string[];
  mastered: boolean;
  evidence: ClimbEvidence;
}

const clean = <T extends Record<string, unknown>>(payload: T): T =>
  Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null)) as T;

function versionPayload(ref: VersionRef): Record<string, unknown> {
  return clean({ framework_id: ref.frameworkId, version_id: ref.versionId });
}

/** Nothing came back in a shape we can read. Refuse rather than render half a syllabus. */
function unreadable(what: string): CurriculumError {
  return new CurriculumError(
    'unreadable',
    `I could not read ${what} just now. Give me a moment, then ask me again.`,
    502,
  );
}

export function createCurriculumClient(
  gatewayUrl: string,
  options: { post?: CapabilityPost } = {},
): CurriculumClient {
  const post = options.post ?? gatewayCapabilityPost(gatewayUrl);
  const C = CURRICULUM_CAPABILITIES;

  return {
    async search(q, opts = {}) {
      const raw = await post(
        C.search,
        clean({ q, country: opts.country ?? undefined, limit: opts.limit }),
      );
      return parseSearch(raw, q);
    },

    async framework(frameworkId, opts = {}) {
      const raw = await post(
        C.framework,
        clean({ framework_id: frameworkId, level: opts.level, version_id: opts.versionId }),
      );
      const view = parseFrameworkView(raw);
      if (!view) throw unreadable('that curriculum');
      return view;
    },

    async units(frameworkId, level, subject, opts = {}) {
      const raw = await post(
        C.units,
        clean({
          framework_id: frameworkId,
          level,
          subject,
          version_id: opts.versionId,
        }),
      );
      return parseUnits(raw, { frameworkId, level, subject });
    },

    async topics(frameworkId, unitId, opts = {}) {
      const raw = await post(
        C.topics,
        clean({ framework_id: frameworkId, unit_id: unitId, version_id: opts.versionId }),
      );
      const view = parseTopics(raw, frameworkId);
      if (!view) throw unreadable('that chapter');
      return view;
    },

    async blueprint(cell) {
      const raw = (await post(C.blueprint, {
        node: cell.node,
        chapter: cell.chapter,
        board: cell.board,
        grade: cell.grade,
        subject: cell.subject,
        contentVersion: cell.contentVersion,
        topics: cell.topics.map((t) => ({ id: t.id, name: t.name })),
        ...(cell.minutesBudget ? { minutesBudget: cell.minutesBudget } : {}),
      })) as { blueprint?: unknown; held?: number } | null;
      return { blueprint: raw?.blueprint ?? null, held: Number(raw?.held ?? 0) };
    },

    async climb(cell, topic, state = {}) {
      const raw = (await post(C.climb, {
        node: cell.node,
        chapter: cell.chapter,
        board: cell.board,
        grade: cell.grade,
        subject: cell.subject,
        contentVersion: cell.contentVersion,
        topics: cell.topics.map((t) => ({ id: t.id, name: t.name })),
        ...(cell.minutesBudget ? { minutesBudget: cell.minutesBudget } : {}),
        topic,
        evidence: state.evidence ?? {},
        ...(state.answered ? { answered: state.answered } : {}),
      })) as Partial<ClimbStep> | null;
      return {
        pool: Boolean(raw?.pool),
        step: raw?.step ?? null,
        group: raw && Array.isArray(raw.group) ? raw.group : [],
        mastered: Boolean(raw?.mastered),
        evidence: raw?.evidence ?? {},
      };
    },

    async pin(frameworkId, versionId) {
      const raw = await post(C.pin, clean({ framework_id: frameworkId, version_id: versionId }));
      const view = parsePin(raw);
      if (!view) throw unreadable('that curriculum');
      return view;
    },

    async upgrade(frameworkId, apply = false) {
      return parseUpgrade(
        await post(C.upgrade, clean({ framework_id: frameworkId, apply: apply || undefined })),
      );
    },

    async overlayGet(ref) {
      return parseOverlay(await post(C.overlayGet, versionPayload(ref)));
    },

    async overlayApply(ref, ops) {
      return parseOverlay(await post(C.overlayApply, { ...versionPayload(ref), ops }));
    },

    async status(query) {
      return parseStatus(
        await post(
          C.status,
          clean({
            job_id: query.jobId,
            framework_id: query.frameworkId,
            q: query.q,
            level: query.level,
            subject: query.subject,
          }),
        ),
      );
    },

    own: {
      async read(source, about) {
        const body =
          source.kind === 'paste'
            ? { kind: 'paste', text: source.text }
            : source.kind === 'photo'
              ? { kind: 'photo', image: source.data, media_type: source.mediaType }
              : { kind: 'pdf', data: source.data };
        const raw = await post(
          C.ownRead,
          clean({
            ...body,
            title: source.title,
            framework_name: about.name,
            level: about.level,
            subject: about.subject,
            language: about.language,
          }),
        );
        const view = parseOwnFramework(raw);
        if (!view) throw unreadable('that syllabus');
        return view;
      },
      async confirmUnit(frameworkId, unitId, confirmed) {
        const view = parseOwnFramework(
          await post(C.ownConfirm, { framework_id: frameworkId, unit_id: unitId, confirmed }),
        );
        if (!view) throw unreadable('that syllabus');
        return view;
      },
      async publish(frameworkId) {
        const view = parseOwnFramework(await post(C.ownPublish, { framework_id: frameworkId }));
        if (!view) throw unreadable('that syllabus');
        return view;
      },
      async offer(frameworkId, note) {
        const view = parseOwnFramework(
          await post(C.ownOffer, clean({ framework_id: frameworkId, note })),
        );
        if (!view) throw unreadable('that syllabus');
        return view;
      },
    },
  };
}
