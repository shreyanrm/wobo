import { describe, expect, it } from 'bun:test';
import {
  ARRIVAL_KEY,
  arrivalFrom,
  LAND_PATH,
  LINK_PARAM,
  redeemMailLink,
  rememberArrival,
  takeArrival,
  withoutToken,
} from './arrival';

/** A storage double that behaves like the real one, including a throwing quota. */
function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const ORIGIN = 'https://heywobo.com';

describe('the link that lands — reading it', () => {
  it('reads the destination and the token out of a mail link', () => {
    expect(arrivalFrom(`${ORIGIN}/course/m2-1/card/scale?${LINK_PARAM}=abc.def`)).toEqual({
      destination: '/course/m2-1/card/scale',
      token: 'abc.def',
    });
  });

  it('reads a link with no token at all — a bookmark of the same address still lands', () => {
    expect(arrivalFrom(`${ORIGIN}/course/m2-1/card/scale`)).toEqual({
      destination: '/course/m2-1/card/scale',
      token: null,
    });
  });

  it('is nothing at the front door and nothing on an address we do not answer', () => {
    expect(arrivalFrom(`${ORIGIN}/`)).toBeNull();
    expect(arrivalFrom(`${ORIGIN}/nonsense-that-is-not-a-route`)).toBeNull();
    // A card link cut short is not a destination either — the 404 is the honest answer.
    expect(arrivalFrom(`${ORIGIN}/course/m2-1/card`)).toBeNull();
  });

  it('never carries a destination off our own origin, whatever the link says', () => {
    // The two shapes that turn a remembered destination into an open redirect.
    expect(arrivalFrom('https://evil.example/course/m2-1/card/scale')?.destination).toBe(
      '/course/m2-1/card/scale',
    );
    // `//host/path` is a protocol-relative URL, not a path of ours — and the router reads its
    // segments as though the host were one, so `//learn` parses as a real route unless this is
    // refused HERE. A remembered destination is handed to `location`, so that is an open redirect.
    for (const raw of ['//learn', '//evil.example/learn', 'https://evil.example']) {
      expect(rememberArrival(raw, store())).toBe(false);
    }
  });
});

describe('the link that lands — the token never stays in the bar', () => {
  it('strips only the token, and keeps the rest of the address intact', () => {
    expect(withoutToken(`${ORIGIN}/course/m2-1/card/scale?${LINK_PARAM}=abc#top`)).toBe(
      '/course/m2-1/card/scale#top',
    );
    expect(withoutToken(`${ORIGIN}/course/m2-1/card/scale?ref=note&${LINK_PARAM}=abc`)).toBe(
      '/course/m2-1/card/scale?ref=note',
    );
  });

  it('leaves an address with no token exactly as it was', () => {
    expect(withoutToken(`${ORIGIN}/course/m2-1/card/scale`)).toBe('/course/m2-1/card/scale');
    expect(withoutToken(`${ORIGIN}/learn?ref=note`)).toBe('/learn?ref=note');
  });
});

describe('the link that lands — holding it across the door', () => {
  it('remembers a destination and hands it back exactly once', () => {
    const s = store();
    expect(rememberArrival('/course/m2-1/card/scale', s)).toBe(true);
    expect(s.data.get(ARRIVAL_KEY)).toBe('/course/m2-1/card/scale');
    expect(takeArrival(s)).toBe('/course/m2-1/card/scale');
    // Once taken it is gone: a second boot must not drag the learner back into the same card.
    expect(takeArrival(s)).toBeNull();
    expect(s.data.has(ARRIVAL_KEY)).toBe(false);
  });

  it('never remembers an address the router does not answer', () => {
    const s = store();
    for (const bad of ['', '/nonsense-that-is-not-a-route', 'course/m2-1', '/course/m2-1/card']) {
      expect(rememberArrival(bad, s)).toBe(false);
    }
    expect(s.data.size).toBe(0);
  });

  it('never holds anything but a path — no token is ever written down', () => {
    const s = store();
    rememberArrival('/course/m2-1/card/scale', s);
    expect([...s.data.values()].join('')).not.toContain(`${LINK_PARAM}=`);
  });

  it('says no rather than throwing when storage is unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rememberArrival('/course/m2-1/card/scale', throwing)).toBe(false);
    expect(takeArrival(throwing)).toBeNull();
    expect(rememberArrival('/course/m2-1/card/scale', null)).toBe(false);
    expect(takeArrival(null)).toBeNull();
  });
});

describe('the link that lands — telling the gateway it was pressed', () => {
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('hands the token over and reads back where to land', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return new Response(
        JSON.stringify({ destination: '/course/m2-1/card/scale', sign_in: true }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const landing = await redeemMailLink('abc.def', {
      gatewayUrl: 'https://brain.example/',
      fetcher,
    });
    expect(landing).toEqual({ destination: '/course/m2-1/card/scale', signIn: true });
    expect(calls[0]?.url).toBe(`https://brain.example${LAND_PATH}`);
    expect(calls[0]?.body).toBe(JSON.stringify({ token: 'abc.def' }));
  });

  it('takes a second press as a landing with no sign-in on it', async () => {
    const landing = await redeemMailLink('abc.def', {
      gatewayUrl: 'https://brain.example',
      fetcher: ok({ destination: '/course/m2-1/card/scale', sign_in: false }),
    });
    expect(landing).toEqual({ destination: '/course/m2-1/card/scale', signIn: false });
  });

  it('never takes a destination off our own origin, whatever comes back over the wire', async () => {
    for (const destination of ['https://evil.example/x', '//evil.example/learn', '/nope', 7]) {
      expect(
        await redeemMailLink('abc.def', {
          gatewayUrl: 'https://brain.example',
          fetcher: ok({ destination, sign_in: true }),
        }),
      ).toBeNull();
    }
  });

  it('says nothing rather than guessing: no gateway, no token, a refusal, a thrown call', async () => {
    expect(await redeemMailLink('abc.def', { gatewayUrl: '' })).toBeNull();
    expect(await redeemMailLink(null, { gatewayUrl: 'https://brain.example' })).toBeNull();
    expect(
      await redeemMailLink('abc.def', {
        gatewayUrl: 'https://brain.example',
        fetcher: (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch,
      }),
    ).toBeNull();
    expect(
      await redeemMailLink('abc.def', {
        gatewayUrl: 'https://brain.example',
        fetcher: (async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      }),
    ).toBeNull();
  });
});
