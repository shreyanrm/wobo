'use client';

/**
 * `/parent/pay`: a parent pays for the child they have chosen, and sees that child's plan.
 *
 * The CHILD is the subscriber and the PARENT is the payer (`pay-flow.ts` holds the contract). The
 * machinery is the plans page's, imported: the provider's script loads on the press and never
 * before, the modal opens with the gateway's session, paying does not flip the plan (the webhook
 * does, and this screen waits for it), a closed modal changes nothing and says so, and payments
 * off is a state that says so rather than a dead button.
 *
 * What is different here is who is spoken to. The consent boxes are the payer's ("I understand
 * this renews every year and the same amount is taken again"), the plan is described in the third
 * person, and the end is the same two taps the learner has, offered only on a plan THIS parent
 * paid for. The total and the day it comes round are drawn only while payments are on, which is
 * when this card is the checkout. One money.md line, verbatim: `parentPay`.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { Label, Segmented } from '../../ui/primitives';
import { legalPath } from '../legal/catalog';
import {
  awaitConfirmation,
  checkoutOptions,
  checkoutReducer,
  initialCheckout,
  loadCheckoutJs,
} from '../plans/checkout-flow';
import {
  bothTicked,
  type ConsentState,
  NO_CONSENT,
  offerKey,
  tick,
  ticked,
} from '../plans/consent';
import {
  DEFAULT_PERIOD,
  PERIOD_LABELS,
  PERIODS,
  type Period,
  PLAN_TIERS,
  type PlanTier,
  readMarket,
} from '../plans/prices';
import { dayLabel, planName } from '../you/plan';
import { readParentMe } from './api';
import { PAY_COPY, who } from './pay-copy';
import {
  type ChildPlan,
  checkoutRows,
  endChildPlan,
  payStage,
  readChildPlan,
  readChildSubscription,
  refusalLine,
  startChildCheckout,
} from './pay-flow';
import './parent-pay.css';

const PAID: readonly PlanTier[] = PLAN_TIERS.filter((t) => t.price !== null);

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; value: ChildPlan }
  | { kind: 'refused'; code: string; message: string };

function Back() {
  const router = useRouter();
  return (
    <button type="button" className="pp-back" onClick={() => router.navigate({ name: 'parent' })}>
      {PAY_COPY.back}
    </button>
  );
}

/** Where the plan stands, and the two-tap end when it is this parent's to end. */
function PlanNow({ value, onChanged }: { value: ChildPlan; onChanged: (next: ChildPlan) => void }) {
  const { child, plan } = value;
  const name = child.name;
  const tierName = planName(plan);
  const day = dayLabel(plan.periodEnd);
  const [step, setStep] = useState<'idle' | 'confirm' | 'working'>('idle');
  const [said, setSaid] = useState<string | null>(null);

  const line = (() => {
    if (plan.state === 'cancelling') return PAY_COPY.state.ending(name, tierName, day);
    if (plan.renews && day) return PAY_COPY.state.running(name, tierName, day);
    return PAY_COPY.state.runningQuiet(name, tierName, day);
  })();
  const aside =
    plan.state !== 'active'
      ? null
      : plan.source !== 'web'
        ? PAY_COPY.state.store
        : !value.paidByYou
          ? PAY_COPY.state.elsewhere
          : null;

  const end = async () => {
    if (step === 'working') return;
    setStep('working');
    const got = await endChildPlan();
    if (got.ok) {
      setSaid(PAY_COPY.end.done(name, dayLabel(got.value.plan.periodEnd)));
      setStep('idle');
      onChanged(got.value);
      return;
    }
    setSaid(
      got.code === 'unreachable' ? PAY_COPY.end.failed : refusalLine(got.code, got.message, name),
    );
    setStep('idle');
  };

  return (
    <div className="pp-card">
      <p className="pp-now">{line}</p>
      {aside ? <p className="pp-aside">{aside}</p> : null}
      {plan.canCancel && step === 'idle' ? (
        <button type="button" className="wk-btn wk-quiet pp-end" onClick={() => setStep('confirm')}>
          {PAY_COPY.end.open}
        </button>
      ) : null}
      {step !== 'idle' ? (
        <fieldset className="pp-confirm" aria-label={PAY_COPY.end.open}>
          <p>{PAY_COPY.end.line(name, day)}</p>
          <div className="pp-acts">
            <button
              type="button"
              className="wk-btn"
              aria-disabled={step === 'working' ? 'true' : undefined}
              onClick={() => void end()}
            >
              {PAY_COPY.end.confirm}
            </button>
            <button type="button" className="wk-btn wk-quiet" onClick={() => setStep('idle')}>
              {PAY_COPY.end.keep}
            </button>
          </div>
        </fieldset>
      ) : null}
      {said ? (
        <p className="pp-status" role="status" aria-live="polite">
          {said}
        </p>
      ) : null}
    </div>
  );
}

/** The plans and the checkout, for a child with nothing running. */
function Choose({
  value,
  payer,
  onPaid,
}: {
  value: ChildPlan;
  payer: string | null;
  onPaid: (line: string) => void;
}) {
  const { child } = value;
  const name = child.name;
  const market = useMemo(() => readMarket(), []);
  const [tierId, setTierId] = useState<PlanTier['id']>('pro');
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [consent, setConsent] = useState<ConsentState>(NO_CONSENT);
  const [paymentsOn, setPaymentsOn] = useState(value.paymentsOn);
  const [flow, dispatch] = useReducer(checkoutReducer, undefined, initialCheckout);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const tier = PAID.find((t) => t.id === tierId) ?? (PAID[0] as PlanTier);
  const offer = offerKey(tier.id, period);
  const boxes = ticked(consent, offer);
  const rows = checkoutRows({ tier, market, period, paymentsOn, now: new Date() });
  const busy = flow.step === 'opening' || flow.step === 'open' || flow.step === 'confirming';
  const intro =
    value.plan.state === 'ended' ? PAY_COPY.state.ended(name) : PAY_COPY.state.free(name);

  const pay = async () => {
    if (!paymentsOn || busy) return;
    if (!bothTicked(consent, offer)) {
      dispatch({ type: 'stopped', message: PAY_COPY.untick });
      return;
    }
    if (tier.id === 'free') return;
    const chosen = period;
    const bought = tier;
    dispatch({ type: 'choose' });
    // 1. The gateway opens the CHILD's subscription, with this parent as payer.
    const started = await startChildCheckout(bought.id as 'pro' | 'max', chosen, child.learnerId);
    if (!mounted.current) return;
    if (!started.ok) {
      if (started.off) setPaymentsOn(false);
      dispatch({ type: 'stopped', message: refusalLine(started.code, started.message, name) });
      return;
    }
    if (!started.session.keyId) {
      dispatch({ type: 'stopped', message: null });
      return;
    }
    // 2. Only now the provider's script.
    let Checkout: Awaited<ReturnType<typeof loadCheckoutJs>>;
    try {
      Checkout = await loadCheckoutJs();
    } catch {
      if (mounted.current) dispatch({ type: 'stopped', message: PAY_COPY.loadFailed });
      return;
    }
    if (!mounted.current) return;
    // 3. The modal, prefilled with the PAYER's name: the person typing the card is the parent.
    const modal = new Checkout(
      checkoutOptions({
        keyId: started.session.keyId,
        subscriptionId: started.session.subscriptionId,
        tierName: bought.name,
        period: chosen,
        learnerName: payer ?? '',
        onPaid: () => {
          // 4. The handler flips nothing. The webhook writes the child's row; we wait for it.
          dispatch({ type: 'paid' });
          void awaitConfirmation({ read: () => readChildSubscription(), planId: bought.id }).then(
            (sub) => {
              if (!mounted.current) return;
              if (sub) {
                const until = dayLabel(sub.periodEnd);
                dispatch({ type: 'confirmed', planName: bought.name, until });
                // The plan is running now, so this card gives way to it; the line goes with it.
                onPaid(PAY_COPY.confirmed(name, bought.name, until));
              } else dispatch({ type: 'slow' });
            },
          );
        },
        onDismiss: () => dispatch({ type: 'dismissed' }),
      }),
    );
    modal.on('payment.failed', (failure) => dispatch({ type: 'failed', failure }));
    dispatch({ type: 'opened' });
    modal.open();
  };

  // The reducer speaks to a learner once ("Your plan updates by itself"); this says it for a
  // parent. The confirmed line is carried up by `onPaid`, because this card gives way on it.
  const status =
    !flow.line || flow.step === 'confirmed'
      ? null
      : flow.step === 'slow'
        ? PAY_COPY.slow
        : flow.line;

  const doorLabel = !paymentsOn
    ? PAY_COPY.off
    : flow.step === 'confirming'
      ? PAY_COPY.confirmingDoor
      : flow.step === 'opening' || flow.step === 'open'
        ? PAY_COPY.opening
        : PAY_COPY.door(name);

  return (
    <>
      <p className="pp-now pp-intro">{intro}</p>
      <div className="pp-card pp-checkout">
        <h2 className="pp-h2">{PAY_COPY.choose.heading}</h2>
        <div className="pp-pick">
          <span className="pp-label">{PAY_COPY.choose.plan}</span>
          <Segmented
            options={PAID.map((t) => ({ id: t.id, label: t.name }))}
            value={tier.id}
            onChange={(id) => setTierId(id)}
          />
        </div>
        <div className="pp-pick">
          <span className="pp-label">{PAY_COPY.choose.period}</span>
          <Segmented
            options={PERIODS.map((p) => ({ id: p, label: PERIOD_LABELS[p] }))}
            value={period}
            onChange={(p) => setPeriod(p)}
          />
        </div>
        {/* The money.md line for this screen, beside the price. */}
        <p className="pp-money">{PAY_COPY.money}</p>
        <dl className="pp-rows">
          <div className="pp-row">
            <dt>{PAY_COPY.rows.forWhom}</dt>
            <dd>{who(child.name, true)}</dd>
          </div>
          {rows.map((row) => (
            <div className={row.key === 'today' ? 'pp-row pp-total' : 'pp-row'} key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <label className="pp-box" htmlFor="pp-terms">
          <input
            id="pp-terms"
            type="checkbox"
            checked={boxes.terms}
            onChange={(e) => setConsent(tick(consent, offer, 'terms', e.target.checked))}
          />
          <span>
            <b>{PAY_COPY.consent.terms}</b>
            <a href={legalPath('terms-of-service')}>{PAY_COPY.consent.termsNote}</a>
          </span>
        </label>
        <label className="pp-box" htmlFor="pp-renewal">
          <input
            id="pp-renewal"
            type="checkbox"
            checked={boxes.renewal}
            onChange={(e) => setConsent(tick(consent, offer, 'renewal', e.target.checked))}
          />
          <span>
            <b>{PAY_COPY.consent.renewal[period]}</b>
            {PAY_COPY.consent.renewalNote[period](name)}
          </span>
        </label>
        <button
          type="button"
          className={paymentsOn ? 'wk-btn wk-pig pp-pay' : 'wk-btn wk-quiet pp-pay'}
          aria-disabled={!paymentsOn || busy ? 'true' : undefined}
          aria-describedby="pp-pay-note"
          onClick={() => void pay()}
        >
          {doorLabel}
        </button>
        <p className="pp-fine" id="pp-pay-note">
          {paymentsOn ? PAY_COPY.fine : PAY_COPY.offNote}
        </p>
        {status ? (
          <p className="pp-status" role="status" aria-live="polite" data-step={flow.step}>
            {status}
          </p>
        ) : null}
      </div>
    </>
  );
}

export function PayForChild() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [payer, setPayer] = useState<string | null>(null);
  const [paidLine, setPaidLine] = useState<string | null>(null);

  const read = useCallback(async () => {
    const got = await readChildPlan();
    setLoad(got.ok ? { kind: 'ready', value: got.value } : { kind: 'refused', ...got });
  }, []);

  useEffect(() => {
    let live = true;
    void read();
    void readParentMe().then((me) => {
      if (live && me.kind === 'parent') setPayer(me.displayName);
    });
    return () => {
      live = false;
    };
  }, [read]);

  const value = load.kind === 'ready' ? load.value : null;
  const name = value?.child.name ?? null;
  const stage = payStage(value);

  return (
    <section className="pp" aria-labelledby="pp-title">
      <Back />
      <header className="pp-head">
        <Label>{PAY_COPY.eyebrow}</Label>
        <h1 id="pp-title" className="pp-title">
          {PAY_COPY.title(name)}
        </h1>
      </header>

      {/* While the plan is on its way the card is simply not there yet: no caption for the wait. */}
      {load.kind === 'loading' ? <div className="pp-card pp-wait" aria-busy="true" /> : null}

      {load.kind === 'refused' ? (
        <div className="pp-card">
          <p className="pp-now" role="alert">
            {load.code === 'unreachable'
              ? PAY_COPY.unreadable
              : refusalLine(load.code, load.message, null)}
          </p>
          <div className="pp-acts">
            {load.code === 'no_child_selected' || load.code === 'no_such_child' ? (
              <button
                type="button"
                className="wk-btn"
                onClick={() => router.navigate({ name: 'parent' })}
              >
                {PAY_COPY.chooseChild}
              </button>
            ) : (
              <button type="button" className="wk-btn wk-quiet" onClick={() => void read()}>
                {PAY_COPY.retry}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {value && stage === 'choose' ? (
        <Choose
          value={value}
          payer={payer}
          onPaid={(line) => {
            setPaidLine(line);
            void read();
          }}
        />
      ) : null}
      {value && (stage === 'running' || stage === 'ending') ? (
        <>
          <p className="pp-money">{PAY_COPY.money}</p>
          {paidLine ? (
            <p className="pp-status pp-done" role="status" aria-live="polite">
              {paidLine}
            </p>
          ) : null}
          <PlanNow value={value} onChanged={(next) => setLoad({ kind: 'ready', value: next })} />
        </>
      ) : null}
    </section>
  );
}
