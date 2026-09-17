/**
 * A PARENT PAYING FOR A CHILD, held to the gateway's contract (billing/payments.py `for_learner`,
 * parent_api.py `/v1/parent/plan` and `/v1/parent/plan/cancel`).
 *
 * The rules this file keeps:
 *  · the checkout body names the child and never a code or an amount; the server decides the rest;
 *  · the child's plan is read from the parent's own route, and the server's learner-voiced lines
 *    never reach a parent;
 *  · a refusal is said in a parent's words, keyed on the server's CODE;
 *  · the total is drawn only while payments are on, which is when this card is the checkout;
 *  · every sentence keeps the register, and the screen carries exactly one money.md line.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forbiddenWordsIn, linesCarriedBy, MONEY_LINES } from '../money-voice';
import { PLAN_TIERS } from '../plans/prices';
import { PAY_COPY, REFER_COPY, who } from './pay-copy';
import {
  checkoutRows,
  endChildPlan,
  PAY_PATHS,
  parseChildPlan,
  payStage,
  readChildPlan,
  refusalLine,
  startChildCheckout,
} from './pay-flow';

/** Every sentence the three screens can say, with sample values filled in. */
function every(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (typeof value === 'function') {
      const fn = value as (...args: unknown[]) => unknown;
      for (const args of [
        ['Learner', 'Pro', '17 September 2027'],
        [null, 'Max', null],
      ]) {
        const said = fn(...args);
        if (typeof said === 'string') out.push(said);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(PAY_COPY);
  walk(REFER_COPY);
  return out;
}

const GW = 'http://gateway.test';

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const offline = (async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

/** A body the gateway really sends from `GET /v1/parent/plan` (parent_api._plan_body). */
const ACTIVE = {
  child: {
    learner_id: 'child-one',
    name: 'Learner',
    relationship: 'linked_parent',
    linked_at: null,
  },
  plan: {
    plan: 'pro',
    effective_plan: 'pro',
    status: 'active',
    source: 'web',
    period: 'yearly',
    payment_state: 'ok',
    cancel_at_period_end: false,
    period_end: '2027-09-17T00:00:00+00:00',
    cancelled_at: null,
    can_cancel: true,
    can_resume: false,
    renews: true,
  },
  paid_by_you: true,
  payments: 'on',
};

const FREE = {
  ...ACTIVE,
  plan: {
    ...ACTIVE.plan,
    plan: 'free',
    status: 'free',
    period_end: null,
    can_cancel: false,
    renews: false,
  },
  paid_by_you: false,
};

describe('the wire', () => {
  it('reads the child and the plan, and nothing in the learner’s voice', () => {
    const got = parseChildPlan({
      ...ACTIVE,
      plan: { ...ACTIVE.plan, line: 'Your plan is running.' },
    });
    expect(got?.child).toEqual({ learnerId: 'child-one', name: 'Learner', linkedAt: null });
    expect(got?.plan.state).toBe('active');
    expect(got?.plan.canCancel).toBe(true);
    expect(got?.plan.line).toBeNull();
    expect(got?.paidByYou).toBe(true);
    expect(got?.paymentsOn).toBe(true);
    expect(parseChildPlan({ plan: ACTIVE.plan })).toBeNull();
  });

  it('never offers the cancel on a plan somebody else paid for, whatever the flag says', () => {
    const got = parseChildPlan({ ...ACTIVE, paid_by_you: false });
    expect(got?.plan.canCancel).toBe(false);
  });

  it('reads the plan from the parent’s own route', async () => {
    const { fetcher, calls } = fake(200, ACTIVE);
    const got = await readChildPlan(GW, fetcher);
    expect(got.ok).toBe(true);
    expect(calls[0]?.url).toBe(`${GW}${PAY_PATHS.plan}`);
  });

  it('carries the server’s code on a refusal, and answers when nothing does', async () => {
    const { fetcher } = fake(403, {
      detail: { code: 'not_a_parent_account', message: 'This is not a parent account.' },
    });
    const got = await readChildPlan(GW, fetcher);
    expect(got).toEqual({
      ok: false,
      code: 'not_a_parent_account',
      message: 'This is not a parent account.',
    });
    expect((await readChildPlan(GW, offline)).ok).toBe(false);
    expect((await readChildPlan(undefined, offline)).ok).toBe(false);
  });

  it('ends the plan with a POST to the parent’s cancel, and claims nothing it was not told', async () => {
    const { fetcher, calls } = fake(200, {
      ...ACTIVE,
      plan: { ...ACTIVE.plan, status: 'cancelling', cancel_at_period_end: true, can_cancel: false },
      cancelled: true,
    });
    const got = await endChildPlan(GW, fetcher);
    expect(calls[0]?.url).toBe(`${GW}${PAY_PATHS.cancel}`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(got.ok && got.value.plan.state).toBe('cancelling');
    const garbled = fake(200, { cancelled: true });
    expect((await endChildPlan(GW, garbled.fetcher)).ok).toBe(false);
  });

  it('opens the checkout for the child, by id, and sends nothing else', async () => {
    const { fetcher, calls } = fake(200, { subscription_id: 'sub_1', key_id: 'rzp_test_x' });
    const got = await startChildCheckout('pro', 'yearly', 'child-one', GW, fetcher);
    expect(got).toEqual({ ok: true, session: { subscriptionId: 'sub_1', keyId: 'rzp_test_x' } });
    expect(calls[0]?.url).toBe(`${GW}/v1/billing/checkout`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      plan: 'pro',
      period: 'yearly',
      for_learner: 'child-one',
    });
  });

  it('says payments are off when the server does, and carries every other code', async () => {
    const off = fake(503, { detail: { code: 'payments_off', message: 'not on' } });
    expect(await startChildCheckout('max', 'monthly', 'c', GW, off.fetcher)).toEqual({
      ok: false,
      off: true,
      code: 'payments_off',
      message: 'not on',
    });
    const stale = fake(409, { detail: { code: 'no_child_selected', message: 'Choose.' } });
    const got = await startChildCheckout('pro', 'yearly', 'c', GW, stale.fetcher);
    expect(got.ok === false && got.code).toBe('no_child_selected');
    expect((await startChildCheckout('pro', 'yearly', 'c', undefined, offline)).ok).toBe(false);
  });
});

describe('what the screen shows', () => {
  it('offers the plans on a free or ended child, and the plan itself on a running one', () => {
    expect(payStage(parseChildPlan(FREE))).toBe('choose');
    expect(payStage(parseChildPlan(ACTIVE))).toBe('running');
    expect(
      payStage(parseChildPlan({ ...ACTIVE, plan: { ...ACTIVE.plan, status: 'cancelling' } })),
    ).toBe('ending');
    expect(payStage(parseChildPlan({ ...ACTIVE, plan: { ...ACTIVE.plan, status: 'ended' } }))).toBe(
      'choose',
    );
    expect(payStage(null)).toBe('unknown');
  });

  it('draws the total and the day it comes round ONLY while this card can take the money', () => {
    const pro = PLAN_TIERS.find((t) => t.id === 'pro');
    if (!pro) throw new Error('no pro tier');
    const now = new Date(2026, 8, 17);
    const off = checkoutRows({ tier: pro, market: 'IN', period: 'yearly', paymentsOn: false, now });
    expect(off.map((r) => r.key)).not.toContain('today');
    expect(off.map((r) => r.key)).not.toContain('renews');
    expect(JSON.stringify(off)).not.toContain('19,992');
    const on = checkoutRows({ tier: pro, market: 'IN', period: 'yearly', paymentsOn: true, now });
    const today = on.find((r) => r.key === 'today');
    expect(today?.value).toBe('₹19,992 for the year');
    expect(on.find((r) => r.key === 'renews')?.value).toBe('₹19,992 on 17 September 2027');
    const month = checkoutRows({
      tier: pro,
      market: 'IN',
      period: 'monthly',
      paymentsOn: true,
      now,
    });
    expect(month.find((r) => r.key === 'today')?.value).toBe('₹1,999 for the month');
  });

  it('speaks to a parent about their child, by name when it has one', () => {
    expect(who('Learner')).toBe('Learner');
    expect(who(null)).toBe('your child');
    expect(who(null, true)).toBe('Your child');
    expect(PAY_COPY.title(null)).toBe('A plan for your child');
  });

  it('says a refusal in a parent’s words, keyed on the code', () => {
    expect(refusalLine('not_the_payer', 'x', 'Learner')).toBe(PAY_COPY.refusals.not_the_payer);
    expect(
      refusalLine('already_subscribed', 'You are already on a paid plan.', 'Learner'),
    ).toContain('Learner');
    expect(
      refusalLine('already_subscribed', 'You are already on a paid plan.', 'Learner'),
    ).not.toMatch(/\byou are already\b/i);
    // A code this screen has no words for is the server's own sentence.
    expect(refusalLine('provider_unavailable', 'Nothing has been charged.', null)).toBe(
      'Nothing has been charged.',
    );
  });

  it('asks the parent to agree to the renewal in plain words', () => {
    expect(PAY_COPY.consent.renewal.yearly).toContain(
      'I understand this renews every year and the same amount is taken again',
    );
    expect(PAY_COPY.consent.renewal.monthly).toContain(
      'I understand this renews every month and the same amount is taken again',
    );
  });
});

describe('the register, over every sentence these screens can say', () => {
  const lines = every();

  it('has sentences to check', () => {
    expect(lines.length).toBeGreaterThan(20);
  });

  it('writes no em dash, no exclamation mark and no late hour', () => {
    for (const line of lines) {
      expect([line, line.includes('—')]).toEqual([line, false]);
      expect([line, line.includes('!')]).toEqual([line, false]);
      expect([line, /\btonight\b|\bmidnight\b|\d\s?pm\b/i.test(line)]).toEqual([line, false]);
    }
  });

  it('promises no money back and says nothing that sounds like a company', () => {
    for (const line of lines) {
      expect([line, /\brefund/i.test(line)]).toEqual([line, false]);
      expect([line, forbiddenWordsIn(line)]).toEqual([line, []]);
    }
  });

  it('invents nobody', () => {
    for (const line of lines) {
      expect([line, /\b(aanya|arjun|riya|meera|priya|asha)\b/i.test(line)]).toEqual([line, false]);
    }
  });
});

describe('one money line per screen, verbatim', () => {
  const HERE = import.meta.dir;
  const spoken = (file: string) =>
    readFileSync(join(HERE, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('the pay screen carries the parent’s pay line and no other', () => {
    expect(PAY_COPY.money).toBe(MONEY_LINES.parentPay);
    expect(linesCarriedBy(PAY_COPY.money)).toEqual(['parentPay']);
    expect(spoken('PayForChild.tsx')).toContain('PAY_COPY.money');
  });

  it('writes no second sentence about what money buys', () => {
    // The free state once added "a paid one gives more lessons each day": a sales line about money
    // that is not in docs/copy/money.md, on the screen whose one money line is parentPay.
    for (const name of ['Learner', null]) {
      expect(PAY_COPY.state.free(name)).not.toMatch(/paid|lesson|more/i);
    }
  });

  it('gives no screen of its own: the donate door is the public donate page', () => {
    expect(existsSync(join(HERE, 'GivePlace.tsx'))).toBe(false);
    expect(Object.keys(MONEY_LINES)).toContain('donate');
  });

  it('the refer screen talks about no money at all', () => {
    const said = Object.values(REFER_COPY)
      .filter((v) => typeof v === 'string')
      .join(' ');
    expect(linesCarriedBy(said)).toEqual([]);
    expect(said).not.toMatch(/[₹$]|\bpaid\b|\bpay\b|reward|credit|discount/i);
  });
});
