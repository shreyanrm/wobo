import { afterEach, describe, expect, it } from 'bun:test';
import {
  ERASABLE_TABLES,
  eraseSubjectRows,
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

  it('covers state, threads and the profile cache — nothing personal is left behind', () => {
    expect(ERASABLE_TABLES).toContain('learner_state');
    expect(ERASABLE_TABLES).toContain('learner_threads');
    expect(ERASABLE_TABLES).toContain('profiles_cache');
    // Mastery is the learner's record of what they answered; erasure has to reach it too.
    expect(ERASABLE_TABLES).toContain('mastery_cache');
  });

  it('keeps going when one table fails, and reports which did not go', async () => {
    const rest = {
      delete: async (table: string) => {
        if (table === 'learner_threads') throw new Error('offline');
      },
    };
    const result = await eraseSubjectRows(rest, 's-1');
    expect(result.failed).toEqual(['learner_threads']);
    expect(result.erased).toEqual(['learner_state', 'profiles_cache', 'mastery_cache']);
  });

  it('erases nothing — and claims nothing — without a subject', async () => {
    const { seen, rest } = spy();
    const result = await eraseSubjectRows(rest, '');
    expect(seen).toEqual([]);
    expect(result.erased).toEqual([]);
    expect(result.failed).toEqual([...ERASABLE_TABLES]);
  });
});
