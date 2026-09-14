/**
 * A promo code is claimed to have worked only when the server said it did.
 *
 * That is the whole of what these tests are about, because it is the one failure a learner cannot
 * recover from: a field that says "that code worked" over a request that never landed, or over a
 * body nobody could read, leaves somebody believing they have days of a plan they do not have, and
 * they find out at the worst moment. So every shape of not-working is walked here: no gateway, a
 * refusal with a code, a refusal with nothing, a 200 that refuses in its body, a body that is not
 * JSON, and a network that threw.
 *
 * And the copy law, on every line this file can produce: no money in either direction (docs/
 * ALLOWANCE.md §2), no em dash, no exclamation, sentence case (docs/copy/voice.md §10a).
 */

import { describe, expect, it } from 'bun:test';
import { GATEWAY_COPY } from '@wobo/sdk';
import {
  bodyCode,
  bodyLine,
  initialPromo,
  MAX_CODE,
  normaliseCode,
  PROMO_BUSY,
  PROMO_EMPTY,
  PROMO_FAILED,
  PROMO_LABEL,
  PROMO_NO,
  PROMO_OK,
  PROMO_PATH,
  PROMO_REFUSALS,
  PROMO_SUBMIT,
  promoReducer,
  redeemPromo,
} from './promo';

const GATEWAY = 'https://brain.test';

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fetcher that answers once with this status and body, and records what it was asked. */
function answering(status: number, body: unknown, text?: string) {
  const calls: Call[] = [];
  const fetcher = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const res =
      text === undefined
        ? Response.json(body, { status })
        : new Response(text, { status, headers: { 'content-type': 'text/html' } });
    return Promise.resolve(res);
  }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
  return { fetcher, calls };
}

describe('the code, as the gateway should see it', () => {
  it('is upper case, with no spaces anywhere', () => {
    expect(normaliseCode('  wobo hello  ')).toBe('WOBOHELLO');
    expect(normaliseCode('back-to-school')).toBe('BACK-TO-SCHOOL');
  });

  it('is bounded, so the field cannot be used to post a novel', () => {
    expect(normaliseCode('a'.repeat(500))).toHaveLength(MAX_CODE);
  });

  it('is empty when nothing was typed', () => {
    expect(normaliseCode('   ')).toBe('');
  });
});

describe('redeeming', () => {
  it('posts the normalised code to the redeem door and reads the answer', async () => {
    const { fetcher, calls } = answering(200, {
      applied: true,
      message: 'That code is on your account. It runs for a while.',
    });
    const out = await redeemPromo(' wobo50 ', GATEWAY, fetcher);
    expect(out).toEqual({ ok: true, line: 'That code is on your account. It runs for a while.' });
    expect(calls[0]?.url).toBe(`${GATEWAY}${PROMO_PATH}`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ code: 'WOBO50' });
  });

  it('falls back to its own sentence when the server sent none', async () => {
    const { fetcher } = answering(200, { applied: true });
    expect(await redeemPromo('WOBO50', GATEWAY, fetcher)).toEqual({ ok: true, line: PROMO_OK });
  });

  it("uses the server's own words for a refusal", async () => {
    const { fetcher } = answering(404, {
      detail: { code: 'promo_not_found', message: 'No such code.' },
    });
    expect(await redeemPromo('NOPE', GATEWAY, fetcher)).toEqual({ ok: false, line: 'No such code.' });
  });

  it('has its own words for the refusals a learner can act on', async () => {
    for (const [code, line] of Object.entries(PROMO_REFUSALS)) {
      const { fetcher } = answering(409, { detail: { code } });
      expect([code, await redeemPromo('X', GATEWAY, fetcher)]).toEqual([code, { ok: false, line }]);
    }
    expect(PROMO_REFUSALS.sign_in_required).toBe(GATEWAY_COPY.signIn);
  });

  it('falls back to one plain refusal for a code it has never heard of', async () => {
    const { fetcher } = answering(400, { detail: { code: 'something_new' } });
    expect(await redeemPromo('X', GATEWAY, fetcher)).toEqual({ ok: false, line: PROMO_NO });
  });

  /**
   * A 200 IS NOT A YES. The gateway looks a code up, decides it will not honour it for this
   * account, and says so in the body rather than with a status. A field that read the status alone
   * would tell a learner their code worked.
   */
  it('refuses a 200 whose body says the code was not applied', async () => {
    const { fetcher } = answering(200, { applied: false, code: 'promo_expired' });
    const expired = PROMO_REFUSALS.promo_expired ?? '';
    expect(expired).not.toBe('');
    expect(await redeemPromo('OLD', GATEWAY, fetcher)).toEqual({ ok: false, line: expired });
  });

  it('claims nothing where there is no gateway, no JSON, or no network', async () => {
    expect(await redeemPromo('X', '', answering(200, {}).fetcher)).toEqual({
      ok: false,
      line: PROMO_FAILED,
    });
    expect(await redeemPromo('X', undefined, answering(200, {}).fetcher)).toEqual({
      ok: false,
      line: PROMO_FAILED,
    });
    // a body that is not JSON at all: read as no body, and a 200 with no body is still a yes,
    // because the status is the server's own answer and nothing in it contradicts it
    const html = answering(500, null, '<html>bad gateway</html>');
    expect(await redeemPromo('X', GATEWAY, html.fetcher)).toEqual({ ok: false, line: PROMO_NO });
    const thrown = (() => Promise.reject(new Error('offline'))) as unknown as typeof import(
      '@wobo/sdk'
    ).gatewayFetch;
    expect(await redeemPromo('X', GATEWAY, thrown)).toEqual({ ok: false, line: PROMO_FAILED });
  });

  it('does not ask about an empty box', async () => {
    const { fetcher, calls } = answering(200, { applied: true });
    expect(await redeemPromo('   ', GATEWAY, fetcher)).toEqual({ ok: false, line: PROMO_EMPTY });
    expect(calls).toHaveLength(0);
  });
});

describe('reading a body', () => {
  it('finds the sentence wherever the gateway put it', () => {
    expect(bodyLine({ message: 'a' })).toBe('a');
    expect(bodyLine({ line: 'b' })).toBe('b');
    expect(bodyLine({ detail: { message: 'c' } })).toBe('c');
    expect(bodyLine({ detail: 'd' })).toBe('d');
    expect(bodyLine(null)).toBeNull();
    expect(bodyLine({ detail: {} })).toBeNull();
  });

  it('finds the refusal code wherever the gateway put it', () => {
    expect(bodyCode({ code: 'promo_used' })).toBe('promo_used');
    expect(bodyCode({ detail: { code: 'promo_used' } })).toBe('promo_used');
    expect(bodyCode({ detail: 'no' })).toBeNull();
    expect(bodyCode(null)).toBeNull();
  });
});

describe('the field, as a state machine', () => {
  it('starts empty and says nothing', () => {
    expect(initialPromo).toEqual({ code: '', step: 'idle', ok: null, line: null });
  });

  it('clears the last result the moment the code changes', () => {
    const said = promoReducer(
      { code: 'OLD', step: 'idle', ok: false, line: PROMO_NO },
      { type: 'type', value: 'OLDER' },
    );
    expect(said).toEqual({ code: 'OLDER', step: 'idle', ok: null, line: null });
  });

  it('refuses an empty box without asking the gateway', () => {
    const out = promoReducer({ ...initialPromo, code: '  ' }, { type: 'check' });
    expect(out).toEqual({ code: '  ', step: 'idle', ok: false, line: PROMO_EMPTY });
  });

  it('goes busy on a real code and cannot be pressed twice', () => {
    const busy = promoReducer({ ...initialPromo, code: 'WOBO' }, { type: 'check' });
    expect(busy).toEqual({ code: 'WOBO', step: 'checking', ok: null, line: null });
    expect(promoReducer(busy, { type: 'check' })).toBe(busy);
    // and a keystroke while it is in flight does not change the code being asked about
    expect(promoReducer(busy, { type: 'type', value: 'OTHER' })).toBe(busy);
  });

  it('settles with what the server answered, and nothing else', () => {
    const busy = promoReducer({ ...initialPromo, code: 'WOBO' }, { type: 'check' });
    expect(promoReducer(busy, { type: 'settled', outcome: { ok: true, line: PROMO_OK } })).toEqual({
      code: 'WOBO',
      step: 'idle',
      ok: true,
      line: PROMO_OK,
    });
    expect(
      promoReducer(busy, { type: 'settled', outcome: { ok: false, line: PROMO_FAILED } }),
    ).toEqual({ code: 'WOBO', step: 'idle', ok: false, line: PROMO_FAILED });
  });
});

// --- the copy law ---------------------------------------------------------------------------------

const EVERY_LINE: readonly string[] = [
  PROMO_LABEL,
  PROMO_SUBMIT,
  PROMO_BUSY,
  PROMO_EMPTY,
  PROMO_OK,
  PROMO_NO,
  PROMO_FAILED,
  ...Object.values(PROMO_REFUSALS),
];

describe('every line the field can say', () => {
  it('names no money and prints no figure (docs/ALLOWANCE.md §2)', () => {
    for (const line of EVERY_LINE) {
      for (const forbidden of ['₹', '$', '%', 'INR', 'USD', 'rupee', 'paise', 'budget']) {
        expect([line, forbidden, line.toLowerCase().includes(forbidden.toLowerCase())]).toEqual([
          line,
          forbidden,
          false,
        ]);
      }
      expect([line, /\d/.test(line)]).toEqual([line, false]);
    }
  });

  it('writes no em dash and no exclamation (docs/copy/voice.md §10a)', () => {
    for (const line of EVERY_LINE) {
      expect([line, line.includes('—')]).toEqual([line, false]);
      expect([line, line.includes('!')]).toEqual([line, false]);
    }
  });

  it('is sentence case, and each sentence is finished', () => {
    for (const line of EVERY_LINE) {
      expect([line, /^[A-Z]/.test(line)]).toEqual([line, true]);
    }
    // the label is a question, the button is a word, everything else is a sentence with a stop
    for (const line of EVERY_LINE) {
      if (line === PROMO_SUBMIT || line === PROMO_BUSY) continue;
      expect([line, /[.?]$/.test(line)]).toEqual([line, true]);
    }
  });

  it('asks the question the brief asks it to ask', () => {
    expect(PROMO_LABEL).toBe('Have a code?');
  });
});
