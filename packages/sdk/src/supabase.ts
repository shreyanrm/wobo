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
 * Every table that holds a learner's own rows, keyed by `subject_id`. Erasure walks this list, so
 * a new learner-owned table is erased by adding it here and nowhere else.
 */
export const ERASABLE_TABLES = [
  'learner_state',
  'learner_threads',
  'profiles_cache',
  // Mastery is a record of what a learner answered and how well. It is theirs, and "erase and start
  // over" has to reach it — a band left behind would rebuild the picture the erasure was for.
  'mastery_cache',
] as const;

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
    if (!res.ok) throw new Error(`remote store rpc ${fn} failed: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  async selectOne(table: string, filter: RestFilter): Promise<Record<string, unknown> | null> {
    const query = restQuery({ select: '*', ...filter }, { limit: '1' });
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      headers: this.headers('accept-profile'),
    });
    if (!res.ok) throw new Error(`remote store select ${table} failed: ${res.status}`);
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
    if (!res.ok) throw new Error(`remote store select ${table} failed: ${res.status}`);
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
    if (!res.ok) throw new Error(`remote store delete ${table} failed: ${res.status}`);
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
    if (!res.ok) throw new Error(`remote store upsert ${table} failed: ${res.status}`);
  }
}
