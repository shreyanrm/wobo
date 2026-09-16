import { afterEach, describe, expect, it } from 'bun:test';
import {
  ERASABLE_TABLES,
  ERASURE_GAPS,
  ERASURE_REGISTER,
  eraseSubjectRows,
  erasureGapSentence,
  type RestFilter,
  restQuery,
  SupabaseRest,
} from '../src/supabase';

const realFetch = globalThis.fetch;

interface Call {
  url: string;
  method: string;
}

function capture(status = 200, body: unknown = []): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return calls;
}

const rest = () =>
  new SupabaseRest({ url: 'https://p.supabase.co', anonKey: 'anon', accessToken: 'jwt' });

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Filters are structured, and the URL is assembled in exactly one place. Before this, callers
 * pasted `subject_id=eq.${id}` into a string: a value carrying `&`, `#` or a PostgREST operator
 * escaped its own filter and changed which rows the request reached.
 */
describe('PostgREST filter values are encoded where the URL is assembled', () => {
  it('encodes a value that would otherwise open a second filter', () => {
    const q = restQuery({ match: { subject_id: 'abc&role=eq.admin' }, select: '*' });
    expect(q).not.toContain('role=eq.admin');
    expect(q).toContain('subject_id=eq.abc%26role%3Deq.admin');
    expect(new URLSearchParams(q).get('subject_id')).toBe('eq.abc&role=eq.admin');
  });

  it('encodes the fragment, space and plus characters that break a hand-built query', () => {
    for (const value of ['a#b', 'a b', 'a+b', 'a,b', 'a/b?c']) {
      const parsed = new URLSearchParams(restQuery({ match: { thread: value } }));
      expect(parsed.get('thread')).toBe(`eq.${value}`);
    }
  });

  it('keeps every named column as its own filter', () => {
    const parsed = new URLSearchParams(
      restQuery({ match: { subject_id: 's-1', thread: 'wobo' }, select: 'a,b' }),
    );
    expect(parsed.get('subject_id')).toBe('eq.s-1');
    expect(parsed.get('thread')).toBe('eq.wobo');
    expect(parsed.get('select')).toBe('a,b');
  });

  it('selectOne sends the encoded filter, select and limit', async () => {
    const calls = capture(200, [{ xp: 1 }]);
    const row = await rest().selectOne('learner_state', {
      match: { subject_id: 'sub&x' },
      select: 'xp',
    });
    expect(row).toEqual({ xp: 1 });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/rest/v1/learner_state');
    expect(url.searchParams.get('subject_id')).toBe('eq.sub&x');
    expect(url.searchParams.get('select')).toBe('xp');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('selectOne defaults to select=* when the caller names no columns', async () => {
    const calls = capture(200, []);
    await rest().selectOne('learner_state', { match: { subject_id: 's' } });
    expect(new URL(calls[0]?.url ?? '').searchParams.get('select')).toBe('*');
  });

  it('encodes the upsert conflict target too', async () => {
    const calls = capture(201, {});
    await rest().upsert('learner_state', { xp: 1 }, 'subject_id,thread');
    expect(new URL(calls[0]?.url ?? '').searchParams.get('on_conflict')).toBe('subject_id,thread');
  });
});

/** Erasure: a minor's rows must be reachable for deletion, and only ever theirs. */
describe('the delete verb', () => {
  it('issues a DELETE with the encoded filter and no select', async () => {
    const calls = capture(204, {});
    await rest().delete('learner_threads', { match: { subject_id: 's-1', thread: 'wobo' } });
    expect(calls[0]?.method).toBe('DELETE');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/rest/v1/learner_threads');
    expect(url.searchParams.get('subject_id')).toBe('eq.s-1');
    expect(url.searchParams.get('thread')).toBe('eq.wobo');
    expect(url.searchParams.has('select')).toBe(false);
  });

  it('refuses an unfiltered delete rather than sending a whole-table wipe', async () => {
    const calls = capture(204, {});
    await expect(rest().delete('learner_state', { match: {} })).rejects.toThrow(
      /must name a filter/,
    );
    expect(calls).toHaveLength(0);
  });

  it('surfaces a failed delete instead of reporting success', async () => {
    capture(403, {});
    await expect(rest().delete('learner_state', { match: { subject_id: 's' } })).rejects.toThrow(
      /failed: 403/,
    );
  });
});

/**
 * DPDP: a minor's record must be deletable at the source. Clearing localStorage only hides it from
 * one device — every learner-owned table has to be reached.
 */
describe('server-side erasure of one subject', () => {
  const spy = () => {
    const seen: { table: string; subject: unknown }[] = [];
    return {
      seen,
      rest: {
        delete: async (table: string, filter: RestFilter) => {
          seen.push({ table, subject: filter.match.subject_id });
        },
      },
    };
  };

  it('deletes every learner-owned table for exactly that subject', async () => {
    const { seen, rest } = spy();
    const result = await eraseSubjectRows(rest, 's-1');
    expect(result.failed).toEqual([]);
    expect(result.erased).toEqual([...ERASABLE_TABLES]);
    expect(seen.map((c) => c.table)).toEqual([...ERASABLE_TABLES]);
    expect(seen.every((c) => c.subject === 's-1')).toBe(true);
  });

  /**
   * "Start over" reached 6 of 22 stores. Everything below was reachable the whole time — every one
   * of these tables carries `subject_id` and a FOR ALL policy keyed to `auth.uid()` — and was
   * simply not on the list, while the You screen told a family their answers and their board ink
   * were gone.
   */
  it('reaches the answers, the handwriting, the sessions and the rest, not just four tables', () => {
    for (const table of [
      'learner_state',
      'learner_threads',
      'profiles_cache',
      'mastery_cache',
      'attempts',
      'canvas_state',
      'sessions',
      'meter_state',
      'notifications',
    ]) {
      expect(ERASABLE_TABLES).toContain(table);
    }
  });

  it('keeps going when one table fails, and reports which did not go', async () => {
    const rest = {
      delete: async (table: string) => {
        if (table === 'learner_threads') throw new Error('offline');
      },
    };
    const result = await eraseSubjectRows(rest, 's-1');
    expect(result.failed).toEqual(['learner_threads']);
    expect(result.erased).toEqual(ERASABLE_TABLES.filter((t) => t !== 'learner_threads'));
  });

  it('erases nothing — and claims nothing — without a subject', async () => {
    const { seen, rest } = spy();
    const result = await eraseSubjectRows(rest, '');
    expect(seen).toEqual([]);
    expect(result.erased).toEqual([]);
    expect(result.failed).toEqual([...ERASABLE_TABLES]);
  });
});

/**
 * WHY MASTERY NEVER SYNCED. `mastery_cache` holds 0 rows in production while `learner_state` holds
 * real ones, and this is the whole reason: every failure was reported as `... failed: 400` and
 * nothing else. PostgREST had said `PGRST204` and named the missing `evidence` column (migration
 * 0013 has never been applied), but the body was thrown away — so `isMissingEvidenceColumn` could
 * never match, the band-only fallback never ran, and the throw died in a `catch {}`.
 */
describe('a refusal says what the database actually said', () => {
  const refusal = (status: number, body: unknown) => {
    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
  };

  it('carries the PostgREST code and message through an upsert', async () => {
    refusal(400, {
      code: 'PGRST204',
      message: "Could not find the 'evidence' column of 'mastery_cache' in the schema cache",
    });
    let caught: unknown;
    try {
      await rest().upsert('mastery_cache', { subject_id: 's' }, 'subject_id');
    } catch (err) {
      caught = err;
    }
    const message = (caught as Error).message;
    expect(message).toContain('PGRST204');
    expect(message).toContain('evidence');
    expect(message).toContain('400');
  });

  it('carries it through a select, an rpc and a delete too', async () => {
    refusal(403, { code: '42501', message: 'permission denied for table outbox' });
    for (const attempt of [
      () => rest().select('outbox', { match: { subject_id: 's' } }),
      () => rest().selectOne('outbox', { match: { subject_id: 's' } }),
      () => rest().rpc('outbox_append_batch', { p_events: [] }),
      () => rest().delete('outbox', { match: { subject_id: 's' } }),
    ]) {
      let caught: unknown;
      try {
        await attempt();
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message).toContain('permission denied');
    }
  });

  it('still says something useful when the body is not JSON at all', async () => {
    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response('<html>502</html>', { status: 502 }))) as typeof fetch;
    let caught: unknown;
    try {
      await rest().upsert('learner_state', { subject_id: 's' }, 'subject_id');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toContain('502');
  });
});

/**
 * The register itself. Its whole value is that it is complete: a store this client cannot delete
 * is still named, with the grant or policy that stops it, so the gap is a fact in the code rather
 * than something a family finds out afterwards.
 */
describe('the erasure register accounts for every store', () => {
  const stores = ERASURE_REGISTER.map((entry) => entry.store);

  it('names every learner table, including the ones nothing reaches', () => {
    for (const table of [
      'learner_state',
      'learner_threads',
      'profiles_cache',
      'mastery_cache',
      'attempts',
      'canvas_state',
      'sessions',
      'meter_state',
      'notifications',
      'mail_preferences',
      'parent_links',
      'outbox',
      'content_cache',
      'wobo_mind',
      'activity',
    ]) {
      expect(stores).toContain(`learner.${table}`);
    }
  });

  it('names the activity record, which only the brain can delete (0034)', () => {
    // A learner's token may read learner.activity and may not write or delete it, so the client
    // erase cannot reach it and POST /v1/me/erase must. The day rows and the sessions beside it
    // keep a delete policy for the owner, so the client's own erase still reaches those.
    expect(ERASURE_REGISTER.find((e) => e.store === 'learner.activity')?.reach).toBe('gateway');
    expect(ERASABLE_TABLES).not.toContain('activity');
    expect(ERASABLE_TABLES).toContain('sessions');
    expect(ERASABLE_TABLES).toContain('meter_state');
  });

  it('reaches the mind, the most personal table there is, and names the parent plane', () => {
    // docs/MIND-SYNC-CONTRACT.md §7: `wobo_mind_own_erase` is FOR DELETE to the owner (0020:176),
    // so the client's own erase, the one that runs when the gateway is unreachable, must issue it.
    expect(ERASABLE_TABLES).toContain('wobo_mind');
    for (const table of ['accounts', 'child_links', 'selections', 'mind_facts', 'threads']) {
      const entry = ERASURE_REGISTER.find((e) => e.store === `parent.${table}`);
      expect(entry?.reach).toBe('gateway');
    }
    expect(ERASURE_REGISTER.find((e) => e.store === 'parent.offers')?.reach).toBe('exempt');
    expect(ERASURE_REGISTER.find((e) => e.store === 'parent.access_audit')?.reach).toBe('exempt');
  });

  it('names every curriculum table', () => {
    for (const table of [
      'frameworks',
      'versions',
      'nodes',
      'provenance',
      'concept_map',
      'overlays',
      'pins',
      'discovery_jobs',
      'review_queue',
    ]) {
      expect(stores).toContain(`curriculum.${table}`);
    }
  });

  it('names the account and the buckets, which are the promises the documents make', () => {
    expect(stores).toContain('auth.users');
    expect(stores.some((s) => s.startsWith('storage:'))).toBe(true);
  });

  it('gives every store a reason, because an entry with no reason is not an entry', () => {
    for (const entry of ERASURE_REGISTER) {
      expect(entry.why.trim().length).toBeGreaterThan(20);
      expect(entry.store.trim()).not.toBe('');
    }
  });

  it('lists each store exactly once', () => {
    expect(new Set(stores).size).toBe(stores.length);
  });

  it('derives what is deleted from the register, so the two can never disagree', () => {
    const fromRegister = ERASURE_REGISTER.filter(
      (e) => e.reach === 'client' && e.store.startsWith('learner.'),
    ).map((e) => e.store.slice('learner.'.length));
    expect([...ERASABLE_TABLES]).toEqual(fromRegister);
  });

  it('still says out loud what an erase does NOT reach', () => {
    const gaps = ERASURE_GAPS.map((e) => e.store);
    expect(gaps).toContain('learner.outbox');
    expect(gaps).toContain('auth.users');
    expect(gaps).toContain('curriculum.frameworks');
    // If this ever empties, the honesty line on the You screen empties with it, which is the point.
    expect(ERASURE_GAPS.length).toBeGreaterThan(0);
  });
});

/**
 * The honesty line the You screen shows a family. It used to be typed next to the erase button and
 * had already drifted from what the code does: it named the practice answers and the board ink,
 * both of which the erase now takes. Generated from the register, it cannot.
 */
describe('the line a family reads about what an erase misses', () => {
  it('names only what is genuinely left behind, in words a family would use', () => {
    const line = erasureGapSentence();
    expect(line).toContain('your account itself');
    expect(line).toContain('a syllabus you uploaded');
    // The things the erase NOW reaches must not be in it.
    expect(line).not.toContain('practice');
    expect(line).not.toContain('ink on the board');
    expect(line).toContain('support@heywobo.com');
  });

  it('never leaks a table name, a schema or a policy at a family', () => {
    const line = erasureGapSentence();
    expect(line).not.toMatch(/learner\.|curriculum\.|auth\.users|RLS|subject_id/);
  });

  it('disappears entirely on the day nothing is left behind', () => {
    expect(erasureGapSentence([])).toBe('');
  });

  it('reads as one sentence however many stores it has to name', () => {
    const one = erasureGapSentence([
      { store: 'x', reach: 'unreached', why: 'because', plain: 'your account itself' },
    ]);
    expect(one).toContain('reach your account itself.');
    expect(one).not.toContain(' and ');
  });
});
