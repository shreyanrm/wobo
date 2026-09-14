/**
 * "Your plan", held to the sentence the plans page prints:
 *
 *   "You → Your plan → Cancel. Two taps, no call, no 'are you sure' maze. You keep the plan
 *    until the month you paid for ends."
 *
 * Every clause of it is a test here, and the two the brief named are the first two: TWO TAPS reach
 * the confirmation and finish the cancel, and A FAILED REQUEST LEAVES THE PLAN ACTIVE. Both walk
 * the same model the component renders — `planControls` is the whole set of controls on whatever
 * surface the learner is looking at, and the component maps over it and draws nothing else — so
 * counting taps here is counting taps on the screen.
 *
 * Every one of these fails without the panel: before it, `plan.ts` and `billing.ts` did not exist,
 * there was no subscription, no period end, no cancel and no endpoint.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BILLING_PATHS,
  type BillingOutcome,
  cancelSubscription,
  parseSubscription,
  readSubscription,
  resumeSubscription,
  type Subscription,
  type SubscriptionRead,
} from './billing';
import {
  allowanceLine,
  CANCEL_FAILED,
  CONFIRM_TITLE,
  CONTROL_IDS,
  type ControlId,
  confirmationLines,
  confirmControls,
  dayLabel,
  initialModel,
  isConfirming,
  NO_RESUME,
  type PlanModel,
  panelControls,
  panelLines,
  panelTitle,
  panelView,
  planControls,
  planName,
  planReducer,
  STOP_ANY_TIME,
  STORE_LINES,
  stateWord,
  UNREADABLE,
  WORK_STAYS,
} from './plan';

const NOW = new Date('2026-09-04T10:00:00Z');

/**
 * The gateway's own body, from `services/gateway/src/wobo_gateway/billing/__init__.py`
 * (`plan_view`) — it was `billing.py` until commit 692affc deleted it. The
 * fixtures below are parsed from bodies of this shape rather than hand-built, so the panel is
 * tested against the contract the brain actually answers with.
 */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan: 'pro',
    effective_plan: 'pro',
    status: 'active',
    source: 'web',
    cancel_at_period_end: false,
    period_end: '2026-10-04T00:00:00Z',
    cancelled_at: null,
    can_cancel: true,
    can_resume: false,
    renews: false,
    line: 'Your plan is running, and it runs to the end of the period you have already paid for. You can end it any time, in two taps.',
    ...over,
  };
}

function subscription(over: Record<string, unknown> = {}): Subscription {
  const parsed = parseSubscription(body(over));
  if (!parsed) throw new Error('the fixture is not a subscription');
  return parsed;
}

const PRO = subscription();
const CANCELLING = subscription({ status: 'cancelling', can_cancel: false, can_resume: true });

/** The model as the panel holds it once the first read has settled and the server answered. */
function settled(sub: Subscription | null, planId: string | null = 'pro'): PlanModel {
  const result: SubscriptionRead = sub
    ? { ok: true, subscription: sub }
    : { ok: false, message: null };
  return planReducer(initialModel(planId), { type: 'read', result });
}

/** The model after a read that NEVER LANDED — a refusal, an outage, a body we cannot parse. */
function unread(planId: string | null = 'pro'): PlanModel {
  return planReducer(initialModel(planId), {
    type: 'read',
    result: { ok: false, message: null },
  });
}

const ok = (sub: Subscription): BillingOutcome => ({ ok: true, subscription: sub });
const failed: BillingOutcome = { ok: false, message: null };

/** Walk the surface the way a finger does: only a control that is actually drawn can be tapped. */
function tap(model: PlanModel, id: ControlId): PlanModel {
  const drawn = planControls(model, NOW).some((c) => c.id === id && !c.busy);
  expect([id, drawn]).toEqual([id, true]);
  return planReducer(model, { type: 'tap', id });
}

// --- the two the brief named ---------------------------------------------------------------------

describe('two taps', () => {
  it('reaches the confirmation in one tap, and finishes the cancel in two', () => {
    let model = settled(PRO);
    let taps = 0;

    // The Cancel control is on the panel itself: nothing to open, nothing to expand, no submenu.
    expect(panelControls(model, NOW).map((c) => c.id)).toEqual(['cancel']);

    model = tap(model, 'cancel');
    taps += 1;
    expect([taps, isConfirming(model)]).toEqual([1, true]);

    model = tap(model, 'confirm');
    taps += 1;
    expect(taps).toBe(2);
    // The second tap is the one that asks the server; nothing else stands between them.
    expect(model.step).toBe('cancelling');

    model = planReducer(model, {
      type: 'settled',
      outcome: ok(CANCELLING),
    });
    expect(panelView(model, NOW)).toBe('cancelled');
  });

  it('has no step between the panel and the confirmation that could cost a third tap', () => {
    const model = settled(PRO);
    // Exactly one control on the panel, and tapping it lands in the confirmation. If a wave ever
    // adds a "manage", a disclosure or an "are you sure" ahead of it, this list grows and fails.
    expect(panelControls(model, NOW)).toHaveLength(1);
    expect(isConfirming(planReducer(model, { type: 'tap', id: 'cancel' }))).toBe(true);
  });

  it('offers exactly two choices in the confirmation, and neither is an offer', () => {
    const confirming = tap(settled(PRO), 'cancel');
    expect(confirmControls(confirming).map((c) => c.id)).toEqual(['confirm', 'back']);
    // No discount, no pause, no survey, no reason picker — the list of controls is closed.
    expect([...CONTROL_IDS]).toEqual(['cancel', 'confirm', 'back', 'resume', 'plans', 'retry']);
  });

  it('says the four things it owes before it takes the money back', () => {
    const lines = confirmationLines(PRO);
    expect(lines).toHaveLength(4);
    // the date they keep it until
    expect(lines[0]).toContain('4 October 2026');
    // that nothing is charged after the date they keep it until
    expect(lines[1]).toContain('Nothing is charged after that');
    // that their work stays
    expect(lines[2]).toBe(WORK_STAYS);
    // and that there is no way back, which is the one fact the tap turns on
    expect(lines[3]).toBe(NO_RESUME);
  });

  /**
   * The confirmation used to stop after three reassuring sentences. The gateway sends the fourth
   * one with every plan it says can be cancelled, and the plans FAQ prints it to somebody who has
   * not even paid yet, so the one screen where the decision is made was the only surface that
   * left it out. These two hold it there, and hold it to the server's own words.
   */
  it("says the tap is final, in the gateway's own words", () => {
    const gateway = readFileSync(
      new URL(
        '../../../../../services/gateway/src/wobo_gateway/billing/__init__.py',
        import.meta.url,
      ).pathname,
      'utf8',
    );
    // The gateway wraps the sentence over two source lines, so it is matched with the wrapping
    // taken out — the words are the contract, not the column they break at.
    const oneLine = gateway.replace(/"\s*\n\s*"/g, '');
    expect(oneLine).toContain(
      'Once it is cancelled it cannot be switched back on, so this is the one tap that counts.',
    );
    expect(NO_RESUME).toBe(
      'Once it is cancelled it cannot be switched back on, so this is the one tap that counts.',
    );
    expect(confirmationLines(PRO)).toContain(NO_RESUME);
  });

  it('says why there is no way back on the cancelled card, where the button is not', () => {
    // A provider-backed cancel cannot be undone (the gateway refuses a resume, 409
    // `cannot_resume`), so `panelControls` draws nothing here. The panel went silent about it:
    // a cancelled plan, no Resume, and no reason given. Now the absence has a sentence.
    const gone = settled(
      subscription({ status: 'cancelling', can_cancel: false, can_resume: false }),
    );
    expect(panelControls(gone, NOW)).toEqual([]);
    expect(panelLines(gone, NOW)).toContain(NO_RESUME);
    // Where a resume IS possible the sentence would be a lie, so it is not said.
    const resumable = settled(CANCELLING);
    expect(panelLines(resumable, NOW)).not.toContain(NO_RESUME);
  });
});

describe('a failed request leaves the plan active', () => {
  it('keeps the subscription, says so plainly, and never draws a cancelled plan', () => {
    const before = settled(PRO);
    const asked = tap(tap(before, 'cancel'), 'confirm');
    const after = planReducer(asked, { type: 'settled', outcome: failed });

    // THE PLAN IS UNCHANGED — the same subscription object, and the same view.
    expect(after.sub).toEqual(PRO);
    expect(panelView(after, NOW)).toBe('active');
    expect(stateWord(after, NOW)).toBe('active');
    expect(panelControls(after, NOW).map((c) => c.id)).toEqual(['cancel']);

    // The learner is told, in words, that nothing changed.
    expect(after.error).toBe(CANCEL_FAILED);
    expect(after.error).toContain('has not changed');

    // And nothing is left spinning: the confirmation is standing, its control is pressable again.
    expect(after.step).toBe('confirming');
    expect(confirmControls(after).every((c) => !c.busy)).toBe(true);
  });

  it('carries the server’s own words when it sent any, rather than overwriting them', () => {
    const asked = tap(tap(settled(PRO), 'cancel'), 'confirm');
    const after = planReducer(asked, {
      type: 'settled',
      outcome: { ok: false, message: 'The card issuer is not answering. Nothing has changed.' },
    });
    expect(after.error).toBe('The card issuer is not answering. Nothing has changed.');
    expect(after.sub).toEqual(PRO);
  });

  it('retrying after a failure is one tap, and it works', () => {
    const asked = tap(tap(settled(PRO), 'cancel'), 'confirm');
    const beaten = planReducer(asked, { type: 'settled', outcome: failed });
    const again = tap(beaten, 'confirm');
    expect(again.step).toBe('cancelling');
    expect(again.error).toBeNull();
  });

  it('a write that answers 200 with a body we cannot read is a failure, not a cancel', async () => {
    const outcome = await cancelSubscription('https://brain.test', async () =>
      Response.json({ ok: true }),
    );
    expect(outcome.ok).toBe(false);
  });

  it('a refused write is a failure, and carries the refusal’s line', async () => {
    const outcome = await cancelSubscription('https://brain.test', async () =>
      Response.json({ detail: { message: 'Not now.' } }, { status: 409 }),
    );
    expect(outcome).toEqual({ ok: false, message: 'Not now.' });
  });

  it('a network that never answers is a failure, never a silent success', async () => {
    const outcome = await cancelSubscription('https://brain.test', async () => {
      throw new Error('offline');
    });
    expect(outcome).toEqual({ ok: false, message: null });
  });
});

// --- the three states ----------------------------------------------------------------------------

describe('the panel in three states', () => {
  it('active: which plan, how long it runs, and one plain Cancel', () => {
    const model = settled(PRO);
    expect(panelView(model, NOW)).toBe('active');
    expect(panelLines(model, NOW)).toEqual([
      'Five times the free allowance, every day.',
      'Your plan runs until 4 October 2026.',
    ]);
    const [cancel] = panelControls(model, NOW);
    expect(cancel?.label).toBe('Cancel plan');
    expect(cancel?.busy).toBeUndefined();
    // Not smaller than the other controls on the You screen, every one of which is `sm`.
    expect(cancel?.size).toBe('md');
  });

  it('cancelled: when it ends, that nothing is charged again, that the work stays, and Resume', () => {
    const model = settled(CANCELLING);
    expect(panelView(model, NOW)).toBe('cancelled');
    expect(panelLines(model, NOW)).toEqual([
      'Pro until 4 October 2026, then free.',
      'Nothing will be charged again.',
      WORK_STAYS,
    ]);
    expect(panelControls(model, NOW).map((c) => c.id)).toEqual(['resume']);
  });

  it('cancelled reads as free once the end date has passed', () => {
    const model = settled(CANCELLING);
    const later = new Date('2026-10-05T00:00:00Z');
    expect(panelView(model, later)).toBe('free');
    expect(stateWord(model, later)).toBe('free');
  });

  it('resume is one tap, and it is the only one', () => {
    const model = settled(CANCELLING);
    const resuming = tap(model, 'resume');
    expect(resuming.step).toBe('resuming');
    const back = planReducer(resuming, { type: 'settled', outcome: ok(PRO) });
    expect(panelView(back, NOW)).toBe('active');
  });

  it('free: the allowance in words, no number anywhere, and a door to the plans', () => {
    const model = settled(
      subscription({ plan: 'free', status: 'free', can_cancel: false, period_end: null }),
      'free',
    );
    expect(panelView(model, NOW)).toBe('free');
    const lines = panelLines(model, NOW);
    expect(lines).toEqual(['Enough for a normal evening, every day, and it resets each morning.']);
    for (const line of lines) expect(line).not.toMatch(/\d/);
    expect(panelControls(model, NOW).map((c) => c.id)).toEqual(['plans']);
  });

  it('a plan we could not read is never drawn as free', () => {
    const unreadable = unread('pro');
    expect(panelView(unreadable, NOW)).toBe('unreadable');
    expect(panelControls(unreadable, NOW).map((c) => c.id)).toEqual(['retry']);
  });

  it('a read that never landed is unreadable even when the tier is silent too', () => {
    // THE WHOLE GATEWAY IS DOWN. `GET /v1/me` failed, so `planId` is null, and the subscription
    // read failed, so there is no subscription. Before the tri-state both were the same value —
    // "no subscription" — and this settled panel printed the heading "Free", the free allowance
    // line, a door to the plans and no error at all: a confident claim about somebody's money,
    // assembled out of an outage, on the only door out of a plan that cannot be refunded.
    const blind = unread(null);
    expect(panelView(blind, NOW)).toBe('unreadable');
    expect(panelTitle(blind, NOW)).not.toBe('Free');
    expect(panelLines(blind, NOW)).toEqual([UNREADABLE]);
    expect(panelControls(blind, NOW).map((c) => c.id)).toEqual(['retry']);
    expect(stateWord(blind, NOW)).toBeNull();
  });

  it('says Free only when the server said free, which it says in a body of its own', () => {
    // The gateway answers a genuinely free learner with a parseable body, so this is a read that
    // LANDED — the only kind the panel is allowed to print "Free" for.
    const free = settled(subscription({ plan: 'free', status: 'free', period_end: null }), null);
    expect(panelView(free, NOW)).toBe('free');
    expect(panelTitle(free, NOW)).toBe('Free');
    expect(panelControls(free, NOW).map((c) => c.id)).toEqual(['plans']);
  });

  it('claims nothing before the first read settles', () => {
    const model = initialModel('pro');
    expect(panelView(model, NOW)).toBe('loading');
    expect(panelControls(model, NOW)).toEqual([]);
    expect(stateWord(model, NOW)).toBeNull();
  });
});

describe('a plan bought in a store', () => {
  it('says exactly where to go, in one sentence, and offers no cancel it cannot honour', () => {
    for (const source of ['app_store', 'play_store'] as const) {
      const model = settled(subscription({ source, can_cancel: false }));
      expect(panelView(model, NOW)).toBe('active');
      expect(panelControls(model, NOW)).toEqual([]);
      const lines = panelLines(model, NOW);
      expect(lines[lines.length - 1]).toBe(STORE_LINES[source]);
    }
  });

  it('blames nobody, and is one sentence', () => {
    for (const line of Object.values(STORE_LINES)) {
      expect(line).not.toMatch(/\b(sorry|unfortunately|their|they (?:do not|don't|won't))\b/i);
      // one full stop, at the end
      expect(line.split('.').filter(Boolean)).toHaveLength(1);
    }
  });
});

// --- the client ----------------------------------------------------------------------------------

describe('the billing client', () => {
  it('reads a subscription, and answers null rather than pretending', async () => {
    const seen: string[] = [];
    const sub = await readSubscription('https://brain.test', async (url) => {
      seen.push(url);
      return Response.json({
        status: 'active',
        plan: 'pro',
        period_end: '2026-10-04T00:00:00Z',
        source: 'web',
      });
    });
    expect(seen).toEqual([`https://brain.test${BILLING_PATHS.read}`]);
    expect(sub.ok && sub.subscription.state).toBe('active');

    // No gateway, and a refusal. Both are "I could not read your plan", and NEITHER is Free.
    expect(await readSubscription(undefined, async () => Response.json({}))).toEqual({
      ok: false,
      message: null,
    });
    expect(
      await readSubscription('https://brain.test', async () => Response.json({}, { status: 500 })),
    ).toEqual({ ok: false, message: null });
    // A learner who IS free is told so by the server, in a body, which is a read that landed.
    const free = await readSubscription('https://brain.test', async () =>
      Response.json({ status: 'free', plan: 'free' }),
    );
    expect(free.ok && free.subscription.state).toBe('free');
  });

  it('reads a cancel that a processor stated as a flag rather than a status', () => {
    const sub = parseSubscription({
      status: 'active',
      plan: 'pro',
      cancel_at_period_end: true,
      period_end: '2026-10-04T00:00:00Z',
    });
    expect(sub?.state).toBe('cancelling');
  });

  it('never reads the free tier as an active subscription', () => {
    expect(parseSubscription({ status: 'active', plan: 'free' })?.state).toBe('free');
    expect(parseSubscription({ status: 'none' })?.state).toBe('free');
  });

  it('refuses a body that is not a subscription', () => {
    for (const body of [null, 'pro', [], {}, { status: 'weird' }]) {
      expect(parseSubscription(body)).toBeNull();
    }
  });

  it('posts cancel and resume to their own routes', async () => {
    const seen: { url: string; method?: string }[] = [];
    const answer = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return Response.json({ status: 'cancelling', plan: 'pro', period_end: PRO.periodEnd });
    };
    await cancelSubscription('https://brain.test', answer);
    await resumeSubscription('https://brain.test', answer);
    expect(seen).toEqual([
      { url: `https://brain.test${BILLING_PATHS.cancel}`, method: 'POST' },
      { url: `https://brain.test${BILLING_PATHS.resume}`, method: 'POST' },
    ]);
  });

  it('an unknown source is read as the web, which is the only one we can cancel', () => {
    expect(parseSubscription({ status: 'active', plan: 'pro', source: 'carrier' })?.source).toBe(
      'web',
    );
  });
});

describe('dates', () => {
  it('writes a date the way a person reads one, and nothing at all when there is none', () => {
    expect(dayLabel('2026-10-04T00:00:00Z')).toBe('4 October 2026');
    expect(dayLabel(null)).toBeNull();
    expect(dayLabel('not a date')).toBeNull();
  });

  it('says it in words when the server gave no date', () => {
    const noDate = settled(
      subscription({ status: 'cancelling', can_cancel: false, can_resume: true, period_end: null }),
    );
    expect(panelLines(noDate, NOW)[0]).toBe(
      'Pro until the end of the period you have paid for, then free.',
    );
    expect(confirmationLines(subscription({ period_end: null }))[0]).toContain(
      'until the end of the period you have paid for',
    );
  });
});

// --- the drawing, and the screen it lives on -----------------------------------------------------

const HERE = import.meta.dir;
const PANEL = readFileSync(join(HERE, 'PlanPanel.tsx'), 'utf8');
const SHEET = readFileSync(join(HERE, 'plan.css'), 'utf8');
const YOU = readFileSync(join(HERE, '..', 'You.tsx'), 'utf8');

/** Comments are where a law is explained, so they are not where it is enforced. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

describe('the confirmation is a real dialog', () => {
  it('announces itself as a modal dialog with a name and a description', () => {
    expect(PANEL).toContain('role="dialog"');
    expect(PANEL).toContain('aria-modal="true"');
    expect(PANEL).toContain('aria-labelledby="wp-confirm-title"');
    expect(PANEL).toContain('aria-describedby="wp-confirm-body"');
  });

  it('takes focus on open, traps Tab, leaves on Escape, and gives focus back', () => {
    expect(PANEL).toContain('(focusables(node)[0] ?? node).focus()');
    expect(PANEL).toContain("if (e.key !== 'Tab') return;");
    expect(PANEL).toContain("if (e.key === 'Escape')");
    expect(PANEL).toContain('restore.current()');
  });

  it('states the plan in a live region, so a screen reader is told when it changes', () => {
    expect(PANEL).toContain('role="status"');
    expect(PANEL).toContain('aria-live="polite"');
    expect(PANEL).toContain('role="alert"');
  });

  it('renders the model’s controls and writes no label of its own', () => {
    // Two maps over `controls`, one on the card and one in the dialog, and nothing hand-placed:
    // every label a learner can press is a string in plan.ts, which is where the tests can reach it.
    expect(code(PANEL).match(/<Button\b/g) ?? []).toHaveLength(2);
    for (const label of [
      'Cancel plan',
      'Cancel the plan',
      'Keep my plan',
      'Resume the plan',
      'See the plans',
      'Try again',
    ]) {
      expect([label, code(PANEL).includes(label)]).toEqual([label, false]);
    }
  });
});

// --- the route the copy names is the route the product has ----------------------------------------

const DOCS = new URL('../../../../../docs/', import.meta.url).pathname;
const doc = (path: string): string => readFileSync(join(DOCS, path), 'utf8');

describe('every instruction names a door that exists', () => {
  /**
   * There is no screen, route or nav item called Settings. The four doors are Home, Learn,
   * Practice and You (`ui/primitives/AppShell.tsx`), the plan lives at /you, and "Your plan" is a
   * card on that screen — a SIBLING of the card tagged Settings, not something inside it. So
   * "Settings → Your plan → Cancel" named a container that does not exist and a nesting that is
   * not there, and it was stated as fact on the plans page, in two help articles, in the terms, in
   * the cancellation document and in three emails. The cancel itself was always two taps; the
   * directions to it were the broken part.
   */
  const SHELL = readFileSync(join(HERE, '..', '..', 'ui', 'primitives', 'AppShell.tsx'), 'utf8');

  it('the tab really is called You, which is what the copy now says', () => {
    expect(SHELL).toContain("{ id: 'you', label: 'You', path: '/you' }");
    expect(SHELL).not.toMatch(/label: 'Settings'/);
  });

  it('no surface sends a learner to a Settings screen to cancel', () => {
    const surfaces: [string, string][] = [
      ['screens/plans/copy.ts', readFileSync(join(HERE, '..', 'plans', 'copy.ts'), 'utf8')],
      ['help 09-plans-and-billing', doc('copy/help-centre/wobo-basics/09-plans-and-billing.md')],
      ['legal/refund-and-cancellation', doc('legal/refund-and-cancellation.md')],
      ['copy/growth/cancel-flow', doc('copy/growth/cancel-flow.md')],
      ['emails/plan-confirmation', doc('copy/emails/plan-confirmation.md')],
      ['emails/receipt', doc('copy/emails/receipt.md')],
    ];
    for (const [name, source] of surfaces) {
      expect([name, /Settings\s*(?:→|,|>)\s*(?:then\s+)?your plan/i.test(source)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it('the plans page prints the route the product has', () => {
    const copy = readFileSync(join(HERE, '..', 'plans', 'copy.ts'), 'utf8');
    expect(copy).toContain('You → Your plan → Cancel');
  });
});

describe('the plan of record no longer prescribes what the owner banned', () => {
  it('WOBO-PLAN does not sanction a save flow, and says why', () => {
    const plan = doc('WOBO-PLAN.md');
    expect(plan).not.toContain('a save flow with pause, a downgrade, or a gifted month');
    expect(plan).toContain('Cancelling is not a growth surface');
  });

  it('PLATFORMS does not send the web terms to a refund policy or an account page', () => {
    const platforms = doc('PLATFORMS.md');
    expect(platforms).not.toContain('our own refund policy, and cancellation through the account');
    expect(platforms).toContain('cancel, never refund');
  });

  it('the cancel spec describes the screen that was built', () => {
    const spec = doc('copy/growth/cancel-flow.md');
    // The spec used to carry a "done" screen with Export and Delete on it that the panel never
    // had, and a failure screen with different words. Both are now the panel's own.
    expect(spec).toContain(CONFIRM_TITLE);
    expect(spec).toContain(CANCEL_FAILED);
    expect(spec).toContain('there is no screen 2');
    expect(spec).not.toContain('[Export everything] · [Delete my account and data]');
  });
});

/**
 * A RENEWAL IS THE SERVER'S ANSWER, NEVER THE SCREEN'S GUESS.
 *
 * This block used to say the opposite: no line the panel prints may carry the word, because
 * "nothing in this repo renews a subscription — there is no payment provider, no webhook and no
 * scheduled sweep" (`billing.py` rule 2, in capitals). That file was deleted with commit 692affc.
 * The package that replaced it has all three, and `billing/plans.py` creates every subscription
 * with a `total_count` of five years or sixty months, so the card is charged again on its own. A
 * payer read "Your plan runs until 7 September 2027." and nothing else, anywhere, about the money
 * that would be taken on that day. The word is now allowed for exactly one reason and no other:
 * the gateway said `renews` about this row.
 */
describe('a plan that renews says so, and one that does not never does', () => {
  it('names the day and the charge when the body says the provider is charging it', () => {
    const renewing = settled(subscription({ renews: true }));
    const lines = panelLines(renewing, NOW);
    expect(lines.some((line) => /renews on 4 October 2026/i.test(line))).toBe(true);
    expect(lines.some((line) => /the same amount is taken again/i.test(line))).toBe(true);
    // and the way out, beside it, in the count the plans page prints
    expect(lines).toContain(STOP_ANY_TIME);
  });

  it('says nothing about a renewal on any plan the server did not say renews', () => {
    const printed = [
      // an operator's grant, a store plan, a free learner, a plan we could not read: nobody is
      // charging any of these, and a date on them is a date the plan simply runs out on
      ...panelLines(settled(PRO), NOW),
      ...panelLines(settled(CANCELLING), NOW),
      ...panelLines(settled(subscription({ plan: 'free', status: 'free' })), NOW),
      ...confirmationLines(PRO),
      ...panelLines(unread('pro'), NOW),
      CANCEL_FAILED,
      UNREADABLE,
      WORK_STAYS,
      ...Object.values(STORE_LINES),
    ];
    for (const line of printed) expect([line, /renew/i.test(line)]).toEqual([line, false]);
  });

  it('and a cancelled plan never renews, whatever the row said before the cancel', () => {
    const stopped = settled(
      subscription({ status: 'cancelling', can_cancel: false, renews: false }),
    );
    for (const line of panelLines(stopped, NOW))
      expect([line, /renew/i.test(line)]).toEqual([line, false]);
  });

  it('and the spec says where the word is allowed to come from', () => {
    expect(doc('copy/growth/cancel-flow.md')).toContain('the gateway says the row renews');
    expect(doc('copy/help-centre/wobo-basics/09-plans-and-billing.md')).not.toContain(
      'annual or family plan',
    );
  });
});

describe('the You screen mounts it', () => {
  it('puts the panel on the page, under Settings, with the plans page as its door', () => {
    expect(YOU).toContain('<PlanPanel');
    expect(YOU).toContain('planId={planId}');
    expect(YOU).toContain("router.navigate({ name: 'plans' })");
    expect(YOU.indexOf('<PlanPanel')).toBeGreaterThan(YOU.indexOf('<Tag>Settings</Tag>'));
  });

  /**
   * AND HANDS IT THE DAY. The bar under the plan is filled from the same `GET /v1/me` the tier
   * comes from (docs/ALLOWANCE.md §2), so the heading and the bar are one answer about one learner
   * rather than two reads that can disagree.
   */
  it('hands the panel today, read off the same answer as the tier', () => {
    expect(YOU).toContain('today={readToday(me)}');
    expect(YOU).toContain("import { readToday } from './you/today'");
    expect(YOU).toContain('const planId = me?.plan ?? null');
  });

  it('says "Your plan" exactly once on the screen, so the sentence points at one thing', () => {
    const printed = [code(YOU), code(PANEL)].join('\n').match(/Your plan/g) ?? [];
    expect(printed).toHaveLength(1);
  });
});

describe('law v5 over the panel’s own sheet', () => {
  it('draws no border line and no hairline', () => {
    expect(SHEET).not.toMatch(/border\s*:\s*(?!0)|0\.5px|1px solid/);
  });

  it('washes nothing: a pigment here is text on the one line that needs care', () => {
    expect(SHEET).not.toMatch(/var\(--[a-z]+-w\)/);
    expect(SHEET).toContain('.wp-bad{color:var(--rose)');
  });

  it('transitions no property a script could also drive', () => {
    expect(SHEET).not.toMatch(/transition\s*:/);
  });

  it('carries one colour of its own, and it is the scrim that must dim in both themes', () => {
    expect(SHEET.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(SHEET.match(/rgba\([^)]*\)/g)).toEqual(['rgba(10,11,14,.34)']);
  });

  it('namespaces every rule, so nothing here meets a rule from another screen', () => {
    for (const selector of SHEET.matchAll(/^\.([a-z-]+)/gm)) {
      expect(selector[1]?.startsWith('wp-')).toBe(true);
    }
  });

  it('names no class it does not own, in any position of any selector', () => {
    // The sheet used to style the kit's own `.wk-btn` from here, which is a rule the kit cannot
    // see it has. Every class this file mentions, anywhere in a selector, is one of its own.
    const declared = SHEET.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const found of declared.matchAll(/\.([a-z][\w-]*)/g)) {
      expect([found[0], found[1]?.startsWith('wp-')]).toEqual([found[0], true]);
    }
  });

  it('is in the cross-sheet set, which is the only place a name collision can be seen', () => {
    // plan.test.ts can hold this sheet to law v5 alone; only law-v5.test.ts, which reads every
    // app stylesheet at once, can catch a short class name that comes to mean two things
    // (DESIGN.md §0, trap 1). So the sheet is registered there, and this keeps it registered.
    const law = readFileSync(join(HERE, '..', 'law-v5.test.ts'), 'utf8');
    expect(law).toContain("'you/plan.css'");
  });
});

describe('the server owns the state, and the screen never works it out', () => {
  it('offers no cancel the gateway has already said it will refuse', () => {
    // The gateway's "unmanaged" answer: a paid plan whose period it cannot see. It reads as
    // running, because it is, and it carries the one line that says where it CAN be ended.
    const unmanaged = subscription({
      can_cancel: false,
      period_end: null,
      line: 'You are on a paid plan, but I cannot see the period it runs to, so I cannot end it from here. Write to support@heywobo.com and we will end it for you.',
    });
    const model = settled(unmanaged);
    expect(panelView(model, NOW)).toBe('active');
    expect(panelControls(model, NOW)).toEqual([]);
    expect(panelLines(model, NOW)[2]).toContain('support@heywobo.com');
  });

  it('offers no resume the gateway has already said it will refuse', () => {
    const model = settled(
      subscription({ status: 'cancelling', can_cancel: false, can_resume: false }),
    );
    expect(panelView(model, NOW)).toBe('cancelled');
    expect(panelControls(model, NOW)).toEqual([]);
  });

  it('opens the door rather than closing it when the server said nothing either way', () => {
    // A body with no can_cancel at all. Hiding the cancel would trap a learner who cannot be
    // refunded; offering one the server refuses costs a refusal with a line of its own.
    const older = parseSubscription({ status: 'active', plan: 'pro', period_end: PRO.periodEnd });
    expect(older?.canCancel).toBe(true);
    expect(parseSubscription({ status: 'cancelling', plan: 'pro' })?.canResume).toBe(true);
    expect(
      parseSubscription({ status: 'active', plan: 'pro', source: 'app_store' })?.canCancel,
    ).toBe(false);
  });

  it('names a tier the price list has not heard of, and invents no allowance for it', () => {
    const model = settled(subscription({ plan: 'plus' }));
    expect(planName(model.sub)).toBe('Plus');
    // One line, not two: the date it runs to, with no made-up multiple of free beside it.
    expect(panelLines(model, NOW)).toEqual(['Your plan runs until 4 October 2026.']);
    expect(allowanceLine(model.sub)).toBeNull();
  });
});

describe('the confirmation has exactly two ways out, and no third', () => {
  it('does not dismiss on a click outside, which a pointer can do by accident', () => {
    const scrim = code(PANEL).slice(
      code(PANEL).indexOf('className="wp-scrim"'),
      code(PANEL).indexOf('wp-confirm-title'),
    );
    expect(scrim).not.toContain('onClick');
  });

  it('leaves nothing to press while a request is in flight, and never without an outcome', () => {
    const asked = tap(tap(settled(PRO), 'cancel'), 'confirm');
    expect(confirmControls(asked).every((c) => c.busy)).toBe(true);
    expect(confirmControls(asked)[0]?.label).toBe('Cancelling…');
    // Both outcomes land: ok changes the plan, a failure hands the same controls back.
    expect(planReducer(asked, { type: 'settled', outcome: ok(CANCELLING) }).step).toBe('idle');
    expect(
      confirmControls(planReducer(asked, { type: 'settled', outcome: failed })).every(
        (c) => !c.busy,
      ),
    ).toBe(true);
  });
});

describe('the heading claims nothing it does not know', () => {
  it('is empty while the first read is out and the tier is unknown', () => {
    expect(panelTitle(initialModel(null), NOW)).toBe('');
  });

  it('says the tier `GET /v1/me` already gave, and never "Free" over a paid plan', () => {
    expect(panelTitle(initialModel('pro'), NOW)).toBe('Pro');
    expect(panelTitle(initialModel('plus'), NOW)).toBe('Plus');
    // the case the smoke test caught: loading, on a paid plan, must not read as Free
    expect(panelTitle(initialModel('max'), NOW)).not.toBe('Free');
    // and an unreadable paid plan keeps its own name rather than borrowing the free one
    expect(panelTitle(unread('pro'), NOW)).toBe('Pro');
  });

  it('says Free only where free is the answer', () => {
    expect(panelTitle(settled(subscription({ plan: 'free', status: 'free' }), 'free'), NOW)).toBe(
      'Free',
    );
    expect(panelTitle(settled(PRO), NOW)).toBe('Pro');
    expect(panelTitle(settled(CANCELLING), NOW)).toBe('Pro');
  });
});
