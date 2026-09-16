import { afterEach, describe, expect, it } from 'bun:test';
import {
  BudgetExhaustedError,
  configureGatewayAuth,
  fetchMe,
  GATEWAY_COPY,
  GatewayLLMProvider,
  GatewayTimeoutError,
  gatewayFetch,
  gatewayJson,
  gatewayTimeoutMs,
  type LLMProvider,
  mintVoiceToken,
  parseMe,
  SignInRequiredError,
  voiceSocketUrl,
} from '../src/index';

const realFetch = globalThis.fetch;

interface Seen {
  url: string;
  init?: RequestInit;
}

/** Record every request and answer it with `reply`. */
function capture(reply: (url: string) => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(reply(String(url)));
  }) as typeof fetch;
  return seen;
}

const headerOf = (seen: Seen, name: string): string | null =>
  new Headers(seen.init?.headers).get(name);

afterEach(() => {
  globalThis.fetch = realFetch;
  configureGatewayAuth({});
});

describe('every gateway call carries an identity', () => {
  it('attaches the learner’s bearer token', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/capability/wobo.turn', { method: 'POST' });
    expect(headerOf(seen[0] as Seen, 'authorization')).toBe('Bearer jwt-abc');
    expect(headerOf(seen[0] as Seen, 'x-wobo-dev-subject')).toBeNull();
  });

  it('awaits an async token source, so a near-expiry session refreshes first', async () => {
    configureGatewayAuth({ accessToken: async () => 'jwt-refreshed' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/me');
    expect(headerOf(seen[0] as Seen, 'authorization')).toBe('Bearer jwt-refreshed');
  });

  it('names the device’s time zone, so the learner’s day is their own', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/me/activity', { method: 'POST' });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(zone).toBeTruthy();
    expect(headerOf(seen[0] as Seen, 'x-wobo-timezone')).toBe(zone);
  });

  it('falls back to the dev subject header when the build is keyless', async () => {
    configureGatewayAuth({ devSubject: 'local-subject-1' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/me');
    expect(headerOf(seen[0] as Seen, 'x-wobo-dev-subject')).toBe('local-subject-1');
    expect(headerOf(seen[0] as Seen, 'authorization')).toBeNull();
  });

  it('never sends the dev header once a real token exists', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc', devSubject: 'local-subject-1' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/me');
    expect(headerOf(seen[0] as Seen, 'x-wobo-dev-subject')).toBeNull();
  });

  it('keeps the caller’s own headers', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    const seen = capture(() => Response.json({ ok: true }));
    await gatewayFetch('https://brain.test/v1/voice/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(headerOf(seen[0] as Seen, 'content-type')).toBe('application/json');
    expect(headerOf(seen[0] as Seen, 'authorization')).toBe('Bearer jwt-abc');
  });
});

describe("the brain’s refusals arrive in Wobo's voice", () => {
  it('401 becomes a sign-in prompt, never a status code', async () => {
    capture(() => Response.json({ code: 'sign_in_required' }, { status: 401 }));
    // Typed as the seam the app holds: it still passes a tier, and it still never ships.
    const llm: LLMProvider = new GatewayLLMProvider('https://brain.test');
    const err = await llm
      .invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInRequiredError);
    expect((err as SignInRequiredError).code).toBe('sign_in_required');
    expect((err as Error).message).toMatch(/sign in/i);
    expect((err as Error).message).not.toMatch(/401|gemini|openai|claude|litellm/i);
  });

  it('429 carries what is left and when it refills', async () => {
    capture(
      () =>
        new Response(
          JSON.stringify({ code: 'budget_exhausted', message: 'That is today’s lot.' }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'x-wobo-budget-remaining': '0',
              'x-wobo-budget-reset': '2026-09-03T00:00:00Z',
            },
          },
        ),
    );
    // Typed as the seam the app holds: it still passes a tier, and it still never ships.
    const llm: LLMProvider = new GatewayLLMProvider('https://brain.test');
    const err = (await llm
      .invoke('wobo.turn', { context: {} }, { consentTier: 'un_elevated' })
      .catch((e: unknown) => e)) as BudgetExhaustedError;
    expect(err).toBeInstanceOf(BudgetExhaustedError);
    expect(err.code).toBe('budget_exhausted');
    expect(err.resetAt).toBe('2026-09-03T00:00:00Z');
    expect(err.remaining).toBe(0);
    expect(err.message).toBe('That is today’s lot.');
  });

  it('unwraps a refusal FastAPI wrapped in `detail`', async () => {
    capture(() =>
      Response.json(
        { detail: { code: 'budget_exhausted', message: 'Enough for today.' } },
        {
          status: 429,
        },
      ),
    );
    const err = await fetchMe('https://brain.test').catch((e: unknown) => e);
    expect((err as Error).message).toBe('Enough for today.');
  });
});

describe('the client declares nothing the brain decides', () => {
  it('posts only the payload — no consent tier, no model, no limit', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    const seen = capture(() =>
      Response.json({ capability: 'wobo.turn', output: {}, track: 'track_2', cache_hit: false }),
    );
    const llm: LLMProvider = new GatewayLLMProvider('https://brain.test');
    await llm.invoke('wobo.turn', { context: { route: 'home' } }, { consentTier: 'elevated' });
    const body = JSON.parse(String(seen[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ payload: { context: { route: 'home' } } });
    expect(body.consent_tier).toBeUndefined();
  });
});

describe('the voice seam', () => {
  it('mints a token over authenticated HTTP and hands it to the socket', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    const seen = capture(() => Response.json({ mode: 'relay', token: 'tok 1' }));
    const minted = await mintVoiceToken('https://brain.test');
    expect(seen[0]?.url).toBe('https://brain.test/v1/voice/session');
    expect(headerOf(seen[0] as Seen, 'authorization')).toBe('Bearer jwt-abc');
    expect(minted?.token).toBe('tok 1');
    expect(voiceSocketUrl('https://brain.test', '/v1/voice/tts/stream', 'tok 1')).toBe(
      'wss://brain.test/v1/voice/tts/stream?token=tok%201',
    );
  });

  it('degrades silently when the mint is refused — voice is grace, never the help', async () => {
    capture(() => Response.json({ code: 'sign_in_required' }, { status: 401 }));
    expect(await mintVoiceToken('https://brain.test')).toBeNull();
  });
});

describe('what is left of today', () => {
  it('reads the budget the brain reports', async () => {
    configureGatewayAuth({ accessToken: () => 'jwt-abc' });
    capture(() =>
      Response.json({
        subject: 'sub-1',
        anonymous: true,
        plan: 'free',
        consent_tier: 'basic',
        budget: {
          turns: { used: 4, limit: 6, remaining: 2 },
          generations: { used: 1, limit: 1, remaining: 0 },
          reset_at: '2026-09-03T00:00:00Z',
        },
      }),
    );
    const me = await fetchMe('https://brain.test');
    expect(me.anonymous).toBe(true);
    expect(me.plan).toBe('free');
    expect(me.consentTier).toBe('basic');
    expect(me.budget.turns.remaining).toBe(2);
    expect(me.budget.generations.remaining).toBe(0);
    expect(me.budget.resetAt).toBe('2026-09-03T00:00:00Z');
  });

  it('survives a shape it has not seen — a counter is never worth a crash', async () => {
    capture(() => Response.json({ subject: 'sub-1' }));
    const me = await fetchMe('https://brain.test');
    expect(me.plan).toBe('free');
    expect(me.anonymous).toBe(false);
    expect(me.budget.turns.remaining).toBeNull();
  });
});

/**
 * NO CLIENT TIMEOUT ANYWHERE. Every call was a bare `fetch`, which has no deadline of its own, and
 * a gateway that stops answering left a child watching a busy orb past 45 seconds with no sentence
 * and no way out.
 *
 * The deadline sits just ABOVE the brain's own ceilings (`services/gateway/.../providers.py`:
 * 60s for a turn, 180s for a generation), so it can never fire before the server would have
 * answered, and it guards the wait for the RESPONSE HEADERS rather than the body — a streaming
 * board turn holds its connection open long past any of these numbers on purpose.
 */
describe('a call that never comes back still ends', () => {
  /** A server that accepts the connection and then says nothing. Aborts exactly as real fetch does. */
  const hang = (): void => {
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason));
      })) as typeof fetch;
  };

  it('gives up on a hung call and says one plain line, never a status code', async () => {
    hang();
    let caught: unknown;
    try {
      await gatewayFetch('https://brain.test/v1/me', {}, 20);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GatewayTimeoutError);
    expect((caught as Error).message).toBe(GATEWAY_COPY.slow);
    expect((caught as Error).message).not.toMatch(/\d{3}|abort|timeout/i);
  });

  it('waits longer for a generation than for a turn, and longer than the brain does', () => {
    expect(gatewayTimeoutMs('https://brain.test/v1/capability/wobo.turn')).toBeGreaterThan(60_000);
    expect(gatewayTimeoutMs('https://brain.test/v1/capability/generate.course')).toBeGreaterThan(
      180_000,
    );
    expect(gatewayTimeoutMs('https://brain.test/v1/capability/curriculum.discovery')).toBe(
      gatewayTimeoutMs('https://brain.test/v1/capability/generate.course'),
    );
    // Anything else is a turn, which is what the brain does with a name it does not know.
    expect(gatewayTimeoutMs('https://brain.test/v1/me')).toBe(
      gatewayTimeoutMs('https://brain.test/v1/capability/wobo.turn'),
    );
  });

  it('keeps the caller’s own cancel working alongside the deadline', async () => {
    hang();
    const ctrl = new AbortController();
    const inFlight = gatewayFetch('https://brain.test/v1/me', { signal: ctrl.signal }, 60_000);
    ctrl.abort(new Error('the learner walked away'));
    let caught: unknown;
    try {
      await inFlight;
    } catch (err) {
      caught = err;
    }
    // The learner's own cancel, not ours: a deliberate stop must never read as a fault.
    expect(caught).not.toBeInstanceOf(GatewayTimeoutError);
  });

  it('never fires once the response has started, so a streaming turn is not cut off', async () => {
    globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response('ok', { status: 200 }))) as typeof fetch;
    const res = await gatewayFetch('https://brain.test/v1/capability/wobo.turn', {}, 5);
    await new Promise((r) => setTimeout(r, 25));
    expect(await res.text()).toBe('ok'); // the body outlived the deadline, which is the point
  });

  it('does not leave a timer running behind a call that answered', async () => {
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(new Response('{}', { status: 200 })).then((r) => {
        expect(init?.signal?.aborted).toBe(false);
        return r;
      })) as typeof fetch;
    await gatewayJson('https://brain.test/v1/me', {}, 50);
    await new Promise((r) => setTimeout(r, 80));
  });
});

// --- the day's allowance -------------------------------------------------------------------------

/**
 * MONEY IS INTERNAL (docs/ALLOWANCE.md §2, the owner, 2026-09-08: *"it's not money based at the
 * users' end; that is only for internal purposes"*). `GET /v1/me` is the one route that could put
 * an amount in a browser, so the shape the browser holds cannot carry one: `parseMe` keeps a share
 * between 0 and 1 and drops every figure the wire used to work it out. A gateway that sends paise
 * is read correctly and still leaks nothing.
 */
describe("the day's allowance crosses the wire as a share, never as money", () => {
  it('reads a fraction as it stands', () => {
    expect(parseMe({ plan: 'pro', allowance: { used: 0.42 } }).allowance).toEqual({
      used: 0.42,
      resetsAt: null,
      spent: false,
    });
  });

  it('reads a pair of figures as the same share, and keeps neither figure', () => {
    const me = parseMe({ allowance: { used: 400, limit: 1600, resets_at: '2026-09-12T00:00:00Z' } });
    expect(me.allowance).toEqual({
      used: 0.25,
      resetsAt: '2026-09-12T00:00:00Z',
      spent: false,
    });
    // there is nowhere on the type for an amount to hide
    expect(Object.keys(me.allowance ?? {}).sort()).toEqual(['resetsAt', 'spent', 'used']);
  });

  it('is spent when the brain says so, and when the share reaches the end', () => {
    expect(parseMe({ allowance: { spent: true } }).allowance?.spent).toBe(true);
    expect(parseMe({ allowance: { used: 1 } }).allowance?.spent).toBe(true);
    expect(parseMe({ allowance: { used: 900, limit: 400 } }).allowance).toEqual({
      used: 1,
      resetsAt: null,
      spent: true,
    });
  });

  it('says nothing at all where the brain sent no allowance', () => {
    expect(parseMe({ plan: 'free' }).allowance).toEqual({
      used: null,
      resetsAt: null,
      spent: false,
    });
    expect(parseMe(null).allowance?.used).toBeNull();
  });
});
