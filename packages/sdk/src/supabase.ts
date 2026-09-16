/**
 * A minimal PostgREST client for the `learner` schema. The SDK needs exactly three verbs — rpc,
 * select-one, upsert — against RLS-guarded tables, so plain fetch does it; the anon key is
 * client-safe and the access token (dev JWT today, the real session at Phase 4) carries auth.uid().
 * ponytail: no @supabase/supabase-js — auth landed on plain fetch too (identity.ts); add the SDK
 * when realtime lands.
 */

export interface SupabaseRestConfig {
  url: string;
  /** The publishable/anon key (client-safe, from env — never hardcoded). */
  anonKey: string;
  /**
   * JWT whose sub = subject_id; RLS keys every row to it. A getter keeps live-auth tokens fresh
   * across refreshes. Absent/undefined => anon role (reads only fail closed).
   */
  accessToken?: string | (() => string | undefined);
}

/**
 * A structured PostgREST filter. Callers name columns and values; the URL is assembled — and
 * encoded — in exactly one place, so no caller can interpolate a value carrying `&`, `#` or a
 * PostgREST operator into the query string. Every entry is an equality match (`col=eq.value`),
 * which is the only operator this client needs.
 */
export interface RestFilter {
  /** column → value, matched with `eq.`. */
  match: Record<string, string>;
  /** The `select=` list; `*` when omitted. */
  select?: string;
}

/** Turn a structured filter into an encoded query string. Exported for the encoding tests. */
export function restQuery(filter: RestFilter, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [column, value] of Object.entries(filter.match)) params.append(column, `eq.${value}`);
  if (filter.select !== undefined) params.set('select', filter.select);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  return params.toString();
}

/**
 * THE ERASURE REGISTER: every durable store that holds something about a learner, and for each one
 * either the erase that reaches it or the reason it cannot be reached from here.
 *
 * "Start over" reached 6 of 22 stores. The answers a child gave, their handwriting, their sessions,
 * their uploaded syllabus and the account itself all survived it, while the You screen and five
 * legal documents described something much closer to complete. This list is the answer to that,
 * and its shape is the point: nothing is omitted quietly. A store that this client cannot delete is
 * still named, with the exact grant or policy that stops it and who does reach it instead, so the
 * gap is a fact in the code rather than a discovery someone makes later.
 *
 * Checked against `docs/conformance/privacy-and-children.md` section I (the full store list) and
 * section J (the gap list). A new learner-owned table is erased by adding an entry here.
 */
export type ErasureReach =
  /** This client deletes it, by `subject_id`, under the table's own RLS policy. */
  | 'client'
  /** The gateway deletes it with the service role (`POST /v1/me/erase`); the client cannot. */
  | 'gateway'
  /** Nothing deletes it yet. Named so the gap is visible rather than absent. */
  | 'unreached'
  /** Deliberately kept, or holds nothing about a person. The reason is the entry. */
  | 'exempt';

export interface ErasureEntry {
  /** `schema.table`, a bucket, or the store's own name. Matches section I. */
  store: string;
  reach: ErasureReach;
  /** Why, in one line. Never empty: an entry with no reason is not an entry. */
  why: string;
  /**
   * What a family would call this, when a family would recognise it at all. Set only on stores an
   * erase does not reach, because that is the only place the words are shown: `erasureGapSentence`
   * builds the honesty line on the You screen out of them, so the screen cannot claim more than the
   * register does. A store with no `plain` is one nobody outside this repo has a word for.
   */
  plain?: string;
}

export const ERASURE_REGISTER: readonly ErasureEntry[] = [
  // --- learner schema: what this client deletes -------------------------------------------------
  {
    store: 'learner.learner_state',
    reach: 'client',
    why: 'XP, streak, completions and the mind dossier. `learner_state_own` is FOR ALL, so a delete reaches it (0005:42).',
  },
  {
    store: 'learner.learner_threads',
    reach: 'client',
    why: 'The whole conversation with Wobo, unbounded. `learner_threads_own` is FOR ALL (0005:44).',
  },
  {
    store: 'learner.profiles_cache',
    reach: 'client',
    why: 'Name, class, board. `profiles_cache_own` is FOR ALL (0002:147).',
  },
  {
    store: 'learner.mastery_cache',
    reach: 'client',
    why: 'What the child understands and the evidence behind it. A band left behind rebuilds the picture the erasure was for.',
  },
  {
    store: 'learner.attempts',
    reach: 'client',
    why: 'Every answer the child ever gave (register J2). `attempts_own` is FOR ALL (0002:151), so this was always reachable and simply was not on the list.',
  },
  {
    store: 'learner.canvas_state',
    reach: 'client',
    why: "The child's handwriting and working, stroke by stroke (register J3). `canvas_state_own` is FOR ALL (0002:153).",
  },
  {
    store: 'learner.sessions',
    reach: 'client',
    why: 'When they were here and on what (register J4). Written by the gateway since 0034; `sessions_own_erase` is FOR DELETE to the owner, so this client still reaches it, and so does `POST /v1/me/erase`.',
  },
  {
    store: 'learner.meter_state',
    reach: 'client',
    why: 'One row per day they came, dated on their clock (register J5, and the activity record since 0034). `meter_state_own_erase` is FOR DELETE to the owner; `POST /v1/me/erase` reaches it too.',
  },
  {
    store: 'learner.notifications',
    reach: 'client',
    why: 'What was scheduled to be sent to them and when (register J6). `notifications_own` is FOR ALL (0002:159).',
  },

  {
    store: 'learner.wobo_mind',
    reach: 'client',
    why: "What Wobo remembers about them: the facts they told it, what they are into, and what it noticed (docs/MEMORY-LAW.md, 0020). `wobo_mind_own_erase` is FOR DELETE to the owner (0020:176), so this client's own erase reaches it; the gateway's erase also leaves the `erased_at` marker, a date and nothing about the learner, which is what stops a stale device re-creating the row.",
  },

  // --- learner schema: reached by the brain, not by this client ---------------------------------
  {
    store: 'learner.mail_preferences',
    reach: 'gateway',
    why: 'Festival calendar and region, which is sensitive data. RLS grants select/insert/update only, no delete (0010:60-69), so `POST /v1/me/erase` does it with the service role.',
  },
  {
    store: 'learner.activity',
    reach: 'gateway',
    why: 'The activity record (0034): when they first and last came, their streak, the hour they usually start, the chapter they are in and the latest moments. Read-only to its learner (`activity_own_read`), so `POST /v1/me/erase` deletes it with the service role.',
  },
  {
    store: 'learner.parent_links',
    reach: 'gateway',
    why: "A parent's email address, typed by a child. Same shape: no delete policy for `authenticated` (0011:109-118); the brain deletes the row.",
  },

  // --- learner schema: the gap that is still a gap ----------------------------------------------
  {
    store: 'learner.outbox',
    reach: 'unreached',
    plain: 'the record of what you did in the app',
    why: 'A full copy of every domain event payload, never purged (register J7, I15). `outbox_own_read` is SELECT ONLY (0002:162), so no client delete is possible and the gateway does not try. Needs a service-role purge; until then this line is the honest record that it survives an erase.',
  },
  {
    store: 'learner.content_cache',
    reach: 'exempt',
    why: 'Shared verified content keyed by node, no subject column, nothing about a person (register I27).',
  },

  // --- parent schema: service-role only, by design (0019) ---------------------------------------
  // The whole schema is closed to `authenticated`, so nothing here is reachable from a browser;
  // `POST /v1/me/erase` reaches the five that hold anything about a child (docs/MIND-SYNC-CONTRACT.md §7).
  {
    store: 'parent.accounts',
    reach: 'gateway',
    why: 'The parent account itself, keyed by a digest of their address (0019). Service-role only; the gateway erase reaches it.',
  },
  {
    store: 'parent.child_links',
    reach: 'gateway',
    why: 'Which parent is linked to which child. Service-role only; the gateway erase reaches it.',
  },
  {
    store: 'parent.selections',
    reach: 'gateway',
    why: 'Which child a parent was last looking at. Service-role only; the gateway erase reaches it.',
  },
  {
    store: 'parent.mind_facts',
    reach: 'gateway',
    why: "The parent's own mind of their child: what they told Wobo (docs/TWO-MINDS.md). Service-role only; the gateway erase reaches it.",
  },
  {
    store: 'parent.threads',
    reach: 'gateway',
    why: "The parent's own conversation with Wobo about their child. Service-role only; the gateway erase reaches it.",
  },
  {
    store: 'parent.offers',
    reach: 'exempt',
    why: 'A removed offer deliberately keeps its `fact_key` and nothing else, which is what stops a parent re-adding what a child removed (docs/TWO-MINDS.md). Keeping it is the promise, not a gap.',
  },
  {
    store: 'parent.access_audit',
    reach: 'exempt',
    why: 'Append-only by trigger and by grant: the trail of what a parent read about a child, which is the record that protects the child.',
  },

  // --- curriculum schema: select-only to a learner ----------------------------------------------
  {
    store: 'curriculum.frameworks',
    reach: 'unreached',
    plain: 'a syllabus you uploaded',
    why: 'That this child uploaded this syllabus (register I28, J8). The whole schema grants `authenticated` SELECT only (0008:395-397): no client delete exists to write. Needs the gateway with the service role.',
  },
  {
    store: 'curriculum.versions',
    reach: 'unreached',
    why: 'Their own syllabus document, versioned (register I29, J8). Same select-only grant.',
  },
  {
    store: 'curriculum.nodes',
    reach: 'unreached',
    why: 'The contents of their own syllabus (register I29, J8). Same select-only grant.',
  },
  {
    store: 'curriculum.provenance',
    reach: 'unreached',
    why: 'Where their syllabus came from (register I29, J8). Same select-only grant.',
  },
  {
    store: 'curriculum.overlays',
    reach: 'unreached',
    why: "The child's own edits to a syllabus (register I30, J8). Same select-only grant.",
  },
  {
    store: 'curriculum.pins',
    reach: 'unreached',
    why: 'What the child is studying (register I31, J8). Same select-only grant.',
  },
  {
    store: 'curriculum.discovery_jobs',
    reach: 'unreached',
    plain: 'what you typed when searching for a board',
    why: 'What the child typed into the search, tied to their id (register I32, J9). Same select-only grant.',
  },
  {
    store: 'curriculum.review_queue',
    reach: 'unreached',
    why: 'A keyed digest of whoever offered a framework, plus their note (register I33/I34, J10). Same select-only grant.',
  },
  {
    store: 'curriculum.concept_map',
    reach: 'exempt',
    why: 'Concept to node mapping. No subject column and nothing about a person.',
  },

  // --- outside the two schemas -------------------------------------------------------------------
  {
    store: 'auth.users',
    reach: 'unreached',
    plain: 'your account itself',
    why: 'The account itself: email, phone, provider identity (register I35, J14). Deleting one needs the admin API and a service-role key, which must never be in a browser bundle. `privacy-policy.md` and the Security page both offer account deletion; until the gateway does it, that promise is not kept.',
  },
  {
    store: 'storage: media-nuggets / generated-assets / remotion-renders',
    reach: 'unreached',
    plain: 'pictures and audio made for your lessons',
    why: 'May hold learner-associated media (register I36, J11). No bucket sweep exists on either path.',
  },
  {
    store: 'learner.doubts + storage: doubt-photos (device wobo-doubts-v1)',
    reach: 'gateway',
    why: 'A photo of a page the learner took, screened and stripped of its metadata, with what Wobo read on it (migration 0021, doubt.py). The memory page removes one with DELETE /v1/doubt/{id}, which takes the row AND the object in the bucket; POST /v1/me/erase sweeps both (memory.py). The device keeps only the listing (wobo-doubts-v1, account-scoped, swept with every wobo- key), never the bytes.',
  },
  {
    store: 'gateway mail log (MAIL_LOG_PATH)',
    reach: 'unreached',
    plain: 'our record of mail we sent you',
    why: 'Hashed recipient and send history, file-backed on the server (register I37, J13). Not reachable from a client at all.',
  },
  {
    store: 'gateway board turn cache',
    reach: 'gateway',
    why: 'The child words and Wobo replies held in process for 180s (register I38). `POST /v1/me/erase` drops them.',
  },
  {
    store: 'gateway voice grants',
    reach: 'gateway',
    why: 'A short-lived token bound to the subject (register I39). `POST /v1/me/erase` drops them.',
  },
  {
    store: 'gateway budget and rate-limit counters',
    reach: 'exempt',
    why: 'In-process, per window, and expire on their own (register I40). Erasing them would hand out a fresh allowance rather than protect anybody.',
  },
  {
    store: 'gateway structured logs',
    reach: 'unreached',
    plain: 'our server logs',
    why: 'Salted IP fingerprint, subject id, capability, latency (register I41). Retention belongs to the platform and is not configured in this repo.',
  },
  {
    store: 'device localStorage (wobo-* keys)',
    reach: 'client',
    why: 'Every `wobo-` key is removed by the You screen before it reloads (register I42), which is the one store an offline erase still reaches.',
  },
] as const;

/**
 * Every table this client can actually delete, keyed by `subject_id`. Derived from the register
 * above so the two can never disagree: adding an entry with `reach: 'client'` is the whole change.
 *
 * `device localStorage` is a `client` entry too but is not a table — the You screen walks the key
 * space itself — so it is filtered out by the `schema.table` shape.
 */
export const ERASABLE_TABLES: readonly string[] = ERASURE_REGISTER.filter(
  (entry) => entry.reach === 'client' && entry.store.startsWith('learner.'),
).map((entry) => entry.store.slice('learner.'.length));

/**
 * What is still standing after a complete, fully successful erase. The You screen reads this so the
 * sentence it shows a family is generated from the register rather than typed next to it and left
 * to rot: a store that becomes reachable disappears from the screen the moment its entry changes.
 */
export const ERASURE_GAPS: readonly ErasureEntry[] = ERASURE_REGISTER.filter(
  (entry) => entry.reach === 'unreached',
);

/** What an erasure did — reported, never swallowed, so the learner can be told the truth. */
export interface ErasureResult {
  erased: string[];
  failed: string[];
}

/**
 * Server-side erasure of one subject's data (DPDP: a minor's record must be deletable, not merely
 * hidden by clearing localStorage). Every table is attempted even when one fails, so a single
 * offline table cannot leave the rest behind.
 */
export async function eraseSubjectRows(
  rest: Pick<SupabaseRest, 'delete'>,
  subjectId: string,
  tables: readonly string[] = ERASABLE_TABLES,
): Promise<ErasureResult> {
  const result: ErasureResult = { erased: [], failed: [] };
  if (!subjectId) return { erased: [], failed: [...tables] };
  for (const table of tables) {
    try {
      await rest.delete(table, { match: { subject_id: subjectId } });
      result.erased.push(table);
    } catch {
      result.failed.push(table);
    }
  }
  return result;
}

/**
 * WHAT THE DATABASE ACTUALLY SAID, folded into the Error.
 *
 * Every refusal used to read `remote store upsert mastery_cache failed: 400` and nothing else, and
 * that single omission is why `mastery_cache` holds zero rows in production. PostgREST had answered
 * `{"code":"PGRST204","message":"Could not find the 'evidence' column ..."}` — migration 0013 has
 * never been applied — but the body went in the bin, so the writer that watches for exactly that
 * refusal (`isMissingEvidenceColumn`, mastery.ts) could never match it, the band-only fallback never
 * ran, and the throw died inside a `catch {}`. A caller cannot degrade gracefully from a refusal it
 * is not allowed to read.
 *
 * Body-reading is best-effort and bounded: a non-JSON body (an HTML 502 from a proxy) leaves the
 * status line standing rather than pasting a page into an error message. Nothing here is shown to a
 * learner; these strings are for the code that has to tell one refusal from another.
 */
async function restError(verb: string, table: string, res: Response): Promise<Error> {
  const head = `remote store ${verb} ${table} failed: ${res.status}`;
  try {
    const body = (await res.json()) as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const text = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const said = [text(body?.code), text(body?.message), text(body?.details), text(body?.hint)]
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);
    return new Error(said ? `${head} ${said}` : head);
  } catch {
    return new Error(head); // no body, or not JSON — the status line is what we have
  }
}

export class SupabaseRest {
  constructor(private readonly cfg: SupabaseRestConfig) {}

  private token(): string | undefined {
    const t = this.cfg.accessToken;
    return typeof t === 'function' ? t() : t;
  }

  private headers(profileHeader: 'accept-profile' | 'content-profile'): Record<string, string> {
    return {
      apikey: this.cfg.anonKey,
      authorization: `Bearer ${this.token() ?? this.cfg.anonKey}`,
      [profileHeader]: 'learner',
    };
  }

  async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...this.headers('content-profile'), 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw await restError('rpc', fn, res);
    return res.status === 204 ? null : res.json();
  }

  async selectOne(table: string, filter: RestFilter): Promise<Record<string, unknown> | null> {
    const query = restQuery({ select: '*', ...filter }, { limit: '1' });
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      headers: this.headers('accept-profile'),
    });
    if (!res.ok) throw await restError('select', table, res);
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows[0] ?? null;
  }

  /**
   * Every matching row. `selectOne` covers the one-row-per-subject tables; this covers the ones
   * that hold a row per node (mastery_cache). RLS still keys every row to auth.uid().
   */
  async select(table: string, filter: RestFilter): Promise<Record<string, unknown>[]> {
    const query = restQuery({ select: '*', ...filter });
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      headers: this.headers('accept-profile'),
    });
    if (!res.ok) throw await restError('select', table, res);
    return (await res.json()) as Record<string, unknown>[];
  }

  /**
   * Erasure. RLS keys every row to auth.uid(), so a DELETE can only ever reach the caller's own
   * rows — but the filter is still named explicitly, and a filter-less delete is refused outright
   * rather than being sent as a whole-table wipe.
   */
  async delete(table: string, filter: RestFilter): Promise<void> {
    if (Object.keys(filter.match).length === 0) {
      throw new Error(`remote store delete ${table} refused: a delete must name a filter`);
    }
    const query = restQuery({ match: filter.match });
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: { ...this.headers('content-profile'), prefer: 'return=minimal' },
    });
    if (!res.ok) throw await restError('delete', table, res);
  }

  /** One row, or a batch of them (PostgREST takes an array under the same conflict target). */
  async upsert(
    table: string,
    row: Record<string, unknown> | Record<string, unknown>[],
    onConflict: string,
  ): Promise<void> {
    if (Array.isArray(row) && row.length === 0) return;
    const conflict = new URLSearchParams({ on_conflict: onConflict }).toString();
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${conflict}`, {
      method: 'POST',
      headers: {
        ...this.headers('content-profile'),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw await restError('upsert', table, res);
  }
}

/**
 * THE HONESTY LINE, generated rather than typed.
 *
 * The You screen used to carry a hand-written sentence naming what an erase misses, next to a
 * comment reminding whoever read it to keep the two in step. It had already drifted: the sentence
 * named the practice answers and the board ink, both of which an erase now takes. Built from the
 * register instead, the screen cannot say less than the truth or more than it, and the day a gap
 * closes the words for it disappear on their own. Empty string when nothing is left behind, which
 * is the day the paragraph should vanish from the screen entirely.
 */
export function erasureGapSentence(gaps: readonly ErasureEntry[] = ERASURE_GAPS): string {
  const named = [...new Set(gaps.map((entry) => entry.plain).filter((p): p is string => !!p))];
  if (named.length === 0) return '';
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  // Lower case on purpose: this is read on the You screen, whose whole data panel speaks in Wobo's
  // quiet lower-case voice, and a capitalised sentence dropped into it reads as a warning notice.
  return `it does not yet reach ${list}. write to support@heywobo.com to have those removed too.`;
}
