'use client';

/**
 * `/plans` — free every day; more when exams get close. A port of
 * design/prototypes/site-plans.html: the hero with the allowance drawing, the three plan cards,
 * the honest table, the checkout preview with its two consent boxes, the gift block, the money
 * questions and the close.
 *
 * The prices are the owner's (WOBO-PLAN §14, docs/PRICING.md) and every one of them is read from
 * `prices.ts` — the cards, the table and the checkout preview — so a change to a number is one edit
 * and every surface says the same thing in the same breath.
 *
 * ONE CHOICE DRIVES THE WHOLE PAGE. `period` is a single piece of state: every price, the line under
 * each price, the small print under each door, the sentence that closes the cards, both consent
 * boxes, the two cancel answers and the sum at checkout are read from it. There is no second copy
 * of it and nothing that can drift, so the page cannot show a yearly price beside a monthly promise.
 * Yearly is listed first and is what the page opens on, because it is the better deal.
 *
 * WHAT EACH SURFACE MAY SAY ABOUT THE PERIOD (docs/PRICING.md, owner, 2026-09-04): a card shows the
 * per-month amount and the words under it — "billed annually" — and NEVER the annual total. The
 * total is not a selling number, it is the thing being agreed to, so it appears at checkout and
 * NOWHERE ON THIS PAGE. It briefly appeared here twice, in the checkout preview's `Today ₹19,992`
 * and in a sentence naming the day the next charge would be taken; the doc's own words are "It
 * must not appear on the plans page", and the sentence broke a second law as well —
 * `services/gateway/src/wobo_gateway/billing.py` rule 2, in capitals: "NOTHING IN THIS REPO RENEWS
 * A SUBSCRIPTION, and no user-facing line may say one does." At the time there was no payment
 * provider, no webhook and no sweep, so a stated future date was a mechanism we could not show.
 * Both are gone, and the preview says only what this page is allowed to say: the per-month amount
 * and the words. The provider and its webhook have since landed on the gateway
 * (`services/gateway/src/wobo_gateway/billing/`); what they change here is the door, below.
 *
 * There is NO country switch here, and there never will be. Law v5's copy law (DESIGN.md §0):
 * where someone is reading from is not a question worth asking. `readMarket()` answers it from the
 * browser's own locale and time zone, once per mount, and the page simply shows that currency. A
 * switch would only have existed because we could not be bothered to work it out; and the deal is
 * the same in every market regardless (§14 — by country, never by person).
 *
 * THE CHECKOUT IS THE CARD AT THE BOTTOM, and it tells the truth about whether it can take money.
 * "Choose Pro" and "Choose Max" on the cards bring it into view with that plan on it. Its own door
 * asks the gateway once, on mount, whether payments are switched on (`checkout-flow.ts`):
 *
 *  · OFF (no key on the gateway, or no gateway): the door reads "Payments are not switched on
 *    yet" and does nothing. Never a dead button, never a fake success. This is the state the
 *    hermetic suite sees, and the state the site shipped in until the provider's key landed.
 *  · ON: the door carries the tier's own words, the card states the amount taken today (the
 *    total belongs at checkout and nowhere else, docs/PRICING.md), and pressing it starts a
 *    checkout on the gateway, loads the provider's script ONLY THEN, and opens the modal with
 *    the subscription id, the key id, the learner's name and Wobo's colour. Paying does not flip
 *    the plan: the screen says "Confirming with the bank" and polls the plan endpoint until the
 *    webhook has written the row (MEMORY-LAW: the database is the record), for at most a minute,
 *    then says the honest thing either way. A closed modal changes nothing and says so in one
 *    line; a failed payment says the bank's reason in plain words and blames nobody.
 *
 * It used to be a live, saturated pig button labelled "Pay with the payment provider" that took
 * the reader to a page headed "Paying is not open yet." A payment control that looked real but was
 * not, on a product used by children, would be the worst thing on the site.
 *
 * The allowance drawing reads the learner's real budget through `sdk.me()`; where there is no
 * answer it says it cannot see one rather than showing a number nobody verified.
 */

import { useReducedMotion } from '@wobo/motion';
import type { Me } from '@wobo/sdk';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSdk } from '../../store/sdk';
import { Label, Sticker, WoboHead } from '../../ui/primitives';
import { legalPath } from '../legal/catalog';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';
import { readSubscription } from '../you/billing';
import { dayLabel } from '../you/plan';
import { loadProfile } from '../you/profile';
import { allowanceLine, allowanceShare, readAllowance } from './allowance';
import {
  awaitConfirmation,
  CHECKOUT_LINES,
  checkoutOptions,
  checkoutReducer,
  initialCheckout,
  loadCheckoutJs,
  type PaymentsConfig,
  readPaymentsConfig,
  showsCheckoutPreviewLink,
  startCheckout,
} from './checkout-flow';
import { ALLOWANCE_WORDS, BENEFITS, type Benefit, faqItems, PLANS_PAGE } from './copy';
import {
  BEST_FOR,
  billedLine,
  chargeLabel,
  DEFAULT_PERIOD,
  fineLine,
  PERIOD_LABELS,
  PERIOD_SAVING,
  PERIODS,
  type Period,
  PLAN_TIERS,
  type PlanTier,
  priceLabel,
  priceUnit,
  readMarket,
} from './prices';
import { ensurePlansStyles } from './styles';

// After the site sheet, which `SiteShell` injects when its module runs — imported above this line.
ensurePlansStyles();

/** A tick, drawn. DESIGN.md forbids emoji, and the line beside it says what is included. */
function Tick() {
  return (
    <i>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6 l3 3 l5 -6" />
      </svg>
    </i>
  );
}

function Cell({ value }: { value: Benefit }) {
  if (value === false) return <div className="pl-same">{PLANS_PAGE.table.no}</div>;
  if (value === true || value === 'same') {
    return (
      <div>
        <span className="pl-y">
          <i />
          {value === true ? PLANS_PAGE.table.yes : PLANS_PAGE.table.same}
        </span>
      </div>
    );
  }
  return <div>{value}</div>;
}

/**
 * How you would like to pay. Two segments of the same width, so the indicator ONLY EVER TRANSLATES:
 * transitioning its width would be a layout property animating, which law v5 forbids (DESIGN.md §0).
 * The order is `PERIODS`, which puts yearly first everywhere it is drawn.
 */
function PeriodControl({ period, onChoose }: { period: Period; onChoose: (next: Period) => void }) {
  return (
    <div className="pl-per" data-period={period}>
      {/* biome-ignore lint/a11y/useSemanticElements: no form, and a fieldset draws a UA border */}
      <div className="pl-seg" role="group" aria-label={PLANS_PAGE.period.legend}>
        <span className="pl-pill" aria-hidden="true" />
        {PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={period === option}
            onClick={() => onChoose(option)}
          >
            {PERIOD_LABELS[option]}
          </button>
        ))}
      </div>
      <span className="pl-save">{PERIOD_SAVING}</span>
    </div>
  );
}

/**
 * What is left of today, read from the brain, drawn as the prototype draws it.
 *
 * TWO THINGS THIS DOES NOT DO, both of them for the visitor this page exists for — someone signed
 * out, reading it to decide:
 *
 *  · It does not ask the brain who they are. `/v1/me` is an authenticated endpoint, and calling it
 *    without a session put four console errors (a CORS block, a 422, ERR_FAILED, a failed request)
 *    into every signed-out visit while the page fell back to the unknown-allowance copy anyway.
 *    Now the session is checked first, and the sentence is rendered directly.
 *  · It does not draw a bar it has nothing to put in. The track used to render regardless and fill
 *    to zero for anyone signed out, so an empty meter sat directly under "free, every day" and
 *    beside "enough for a normal evening" — a drained gauge arguing against the page it is on. No
 *    reading, no track: the sentence and the hand carry the promise, which is what they are for.
 */
function Allowance() {
  const sdk = useSdk();
  const [me, setMe] = useState<Me | null>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    let live = true;
    // No session, no question. Where live auth is wired, `subjectId()` is null until someone has
    // actually signed in, and asking an authenticated endpoint on their behalf is what filled a
    // signed-out console with a CORS block, a 422 and two failed requests. Where there is no
    // account layer at all the identity IS the dev mock, and the call is meaningful again.
    if (sdk.account && sdk.account.subjectId() === null) return;
    // A budget the page cannot read is not an error worth showing: the drawing says so itself.
    void sdk
      .me()
      .then((answer) => {
        if (live) setMe(answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sdk]);
  // The bar fills after the first paint, so it draws itself rather than arriving full.
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const allowance = readAllowance(me);
  const share = allowanceShare(allowance);
  return (
    <Reveal className="pl-allow">
      <Sticker rotate={6}>{PLANS_PAGE.allowance.sticker}</Sticker>
      <b>{PLANS_PAGE.allowance.title}</b>
      {share !== null && (
        <div
          className="pl-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={allowance.limit ?? 0}
          aria-valuenow={allowance.remaining ?? 0}
          aria-label={PLANS_PAGE.allowance.title}
        >
          {/* scaleX from a left origin, never width: a width transition relayouts every frame,
              which is law v5 §8's second cause of jitter. The same fix course/shared.tsx made. */}
          <i style={{ transform: `scaleX(${drawn ? share : 0})` }} />
        </div>
      )}
      <span>{allowanceLine(allowance)}</span>
      <div className="hand">{PLANS_PAGE.allowance.hand}</div>
    </Reveal>
  );
}

const CARD_CLASS: Record<PlanTier['id'], string> = {
  free: 'pl-plan',
  pro: 'pl-plan pl-pro',
  max: 'pl-plan pl-max',
};

export function Plans() {
  const sdk = useSdk();
  const reduced = useReducedMotion();
  // Read once per mount, from the browser and nothing else: the reader is never asked where they
  // are, and there is no control that could change this.
  const market = useMemo(() => readMarket(), []);
  // The one choice the whole page reads from. Yearly, because it is the better deal.
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [previewId, setPreviewId] = useState<PlanTier['id']>('pro');
  const [terms, setTerms] = useState(false);
  const [renewal, setRenewal] = useState(false);
  const checkoutRef = useRef<HTMLElement | null>(null);
  const preview =
    PLAN_TIERS.find((t) => t.id === previewId && t.price) ??
    PLAN_TIERS.find((t) => t.recommended) ??
    (PLAN_TIERS[1] as PlanTier);
  const c = PLANS_PAGE.checkout;
  // The two cancel answers follow the period, so the page never answers for the other one.
  const faq = useMemo(() => faqItems(period), [period]);

  const choose = (tier: PlanTier) => {
    setPreviewId(tier.id);
    checkoutRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };

  // --- the checkout ------------------------------------------------------------------------------
  // Whether the deploy can take money. `null` until the gateway has answered; off when it says
  // so, when it has no such route, or when there is no gateway at all. The browser never decides.
  const [pay, setPay] = useState<PaymentsConfig | null>(null);
  useEffect(() => {
    let live = true;
    void readPaymentsConfig().then((config) => {
      if (live) setPay(config);
    });
    return () => {
      live = false;
    };
  }, []);
  const [flow, dispatch] = useReducer(checkoutReducer, undefined, initialCheckout);
  // The page may be left while the bank is still confirming; nothing then lands on a dead screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = flow.step === 'opening' || flow.step === 'open' || flow.step === 'confirming';

  const buy = async () => {
    if (!pay?.on || busy) return;
    if (!terms || !renewal) {
      dispatch({ type: 'stopped', message: CHECKOUT_LINES.untick });
      return;
    }
    // A public page, so the reader may be signed out; the plan needs an account to land on.
    if (sdk.account && sdk.account.subjectId() === null) {
      dispatch({ type: 'stopped', message: CHECKOUT_LINES.signIn });
      return;
    }
    const plan = preview.id;
    if (plan === 'free') return;
    const tier = preview;
    const chosen = period;
    dispatch({ type: 'choose' });
    // 1. The gateway creates the subscription with its own secret and hands back the id.
    const started = await startCheckout(plan, chosen);
    if (!mounted.current) return;
    if (!started.ok) {
      if (started.off) setPay({ on: false });
      dispatch({ type: 'stopped', message: started.message });
      return;
    }
    // 2. ONLY NOW the provider's script, never on page load.
    let Checkout: Awaited<ReturnType<typeof loadCheckoutJs>>;
    try {
      Checkout = await loadCheckoutJs();
    } catch {
      if (mounted.current) dispatch({ type: 'stopped', message: CHECKOUT_LINES.loadFailed });
      return;
    }
    if (!mounted.current) return;
    // A session with no public key id is one the modal cannot open. The gateway always sends it;
    // if it ever does not, this stops here rather than opening a modal that fails on its own.
    if (!started.session.keyId) {
      dispatch({ type: 'stopped', message: null });
      return;
    }
    // 3. The modal, with the id, the key, the learner's name and Wobo's colour.
    const modal = new Checkout(
      checkoutOptions({
        keyId: started.session.keyId,
        subscriptionId: started.session.subscriptionId,
        tierName: tier.name,
        period: chosen,
        learnerName: loadProfile().name,
        onPaid: () => {
          // 4. THE HANDLER DOES NOT FLIP THE PLAN. The webhook writes the row; we wait for it.
          dispatch({ type: 'paid' });
          void awaitConfirmation({ read: () => readSubscription(), planId: tier.id }).then(
            (sub) => {
              if (!mounted.current) return;
              if (sub) {
                dispatch({
                  type: 'confirmed',
                  planName: tier.name,
                  until: dayLabel(sub.periodEnd),
                });
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

  /** The door's own words: the tier's, or what it is doing, or that it cannot. */
  const doorLabel = (): string => {
    if (!pay?.on) return CHECKOUT_LINES.off;
    if (flow.step === 'confirming') return c.confirming;
    if (flow.step === 'opening' || flow.step === 'open') return c.opening;
    return preview.cta;
  };

  return (
    <SiteShell current="plans" title="Wobo plans">
      <section className="pl-hero">
        <div className="st-wrap">
          <Label>{PLANS_PAGE.eyebrow}</Label>
          <h1>
            {PLANS_PAGE.title} <em>{PLANS_PAGE.titleEm}</em>
          </h1>
          <p className="pl-sub">{PLANS_PAGE.lead}</p>
          <Allowance />
        </div>
      </section>

      <section className="st-section" id="plans">
        <div className="st-wrap">
          <PeriodControl period={period} onChoose={setPeriod} />
          <Reveal className="pl-plans">
            {PLAN_TIERS.map((tier) => (
              <div className={CARD_CLASS[tier.id]} key={tier.id}>
                {tier.recommended ? <span className="pl-best">{BEST_FOR}</span> : null}
                <div className="pl-name">{tier.name}</div>
                <div className="pl-price">
                  <span>{priceLabel(tier, market, period)}</span>
                  <small>{priceUnit(tier)}</small>
                </div>
                {/* The words, never the total: both periods carry a line here, so the switch
                    cannot change the height of a card. The free tier has no period and no line. */}
                {billedLine(tier, period) ? (
                  <div className="pl-billed">{billedLine(tier, period)}</div>
                ) : null}
                {tier.allowanceMultiple > 1 ? (
                  <div className="pl-x">
                    {ALLOWANCE_WORDS[tier.allowanceMultiple] ?? 'more'} the free allowance
                  </div>
                ) : null}
                <p>{tier.blurb}</p>
                <ul>
                  {tier.lines.map((line) => (
                    <li key={line}>
                      <Tick />
                      {line}
                    </li>
                  ))}
                </ul>
                {tier.price ? (
                  <button
                    type="button"
                    className={tier.recommended ? 'st-btn st-pig' : 'st-btn'}
                    onClick={() => choose(tier)}
                  >
                    {tier.cta}
                  </button>
                ) : (
                  <SiteLink to={{ name: 'onboarding' }} className="st-btn st-quiet pl-free">
                    {tier.cta}
                  </SiteLink>
                )}
                <div className="pl-fine">{fineLine(tier, period)}</div>
              </div>
            ))}
          </Reveal>
          <p className="pl-close-line">
            {PLANS_PAGE.same} {PLANS_PAGE.keepIt[period]}
          </p>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>{PLANS_PAGE.table.eyebrow}</Label>
            <h2>{PLANS_PAGE.table.title}</h2>
            <p>{PLANS_PAGE.table.lead}</p>
          </Reveal>
          <Reveal className="pl-tbl">
            <div className="pl-r pl-h">
              {PLANS_PAGE.table.head.map((head) => (
                <div key={head}>{head}</div>
              ))}
            </div>
            {BENEFITS.map((row) => (
              <div className="pl-r" key={row.label}>
                <div>{row.label}</div>
                <Cell value={row.free} />
                <Cell value={row.pro} />
                <Cell value={row.max} />
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="st-section" ref={checkoutRef} id="checkout">
        <div className="st-wrap">
          <Reveal className="pl-checkout">
            <div className="pl-head">
              <Label>{c.eyebrow}</Label>
              <h2>{c.title}</h2>
              <p>{c.lead[period]}</p>
              <div className="pl-say">
                {c.say} <em>{c.sayEm}</em>
              </div>
            </div>
            <div className="pl-card">
              <div className="pl-row">
                <span>
                  {preview.name} · {c.learners[preview.learners] ?? `${preview.learners} learners`}
                </span>
                <b>
                  {priceLabel(preview, market, period)} {c.perMonth}
                </b>
              </div>
              {/* The words, and never the total: docs/PRICING.md gives the plans page the
                  per-month amount and the words, and gives the total to the checkout alone. */}
              <div className="pl-row">
                <span>{c.billed}</span>
                <b>{billedLine(preview, period)}</b>
              </div>
              <div className="pl-row">
                <span>{c.starts}</span>
                <b>{c.startsValue}</b>
              </div>
              {/* THE AMOUNT BEING AGREED TO, and only when this card can take it: while payments
                  are off this is a preview on the plans page, and docs/PRICING.md keeps the total
                  off the plans page. The monthly period names the month, never a year. */}
              {pay?.on ? (
                <div className="pl-total">
                  <span>{c.today}</span>
                  <b>
                    {chargeLabel(preview, market, period)} {c.totalFor[period]}
                  </b>
                </div>
              ) : null}
              <label htmlFor="consent-terms">
                <input
                  id="consent-terms"
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                <div>
                  <b>{c.terms}</b>
                  <SiteLink href={legalPath('terms-of-service')}>{c.termsNote}</SiteLink>
                </div>
              </label>
              <label htmlFor="consent-renewal">
                <input
                  id="consent-renewal"
                  type="checkbox"
                  checked={renewal}
                  onChange={(e) => setRenewal(e.target.checked)}
                />
                <div>
                  <b>{c.renewal[period]}</b>
                  {c.renewalNote[period].replace('{plan}', preview.name)}
                </div>
              </label>
              {/* THE DOOR. Off, it says payments are not switched on yet and does nothing: never
                  a dead button, never a fake success. On, it is the ink door that starts the
                  checkout (the pig stays with the recommended card: one pointer per view), and
                  while it works its label says what it is doing. `aria-disabled` rather than
                  `disabled` on the off state, so a screen reader still reaches the words. */}
              {pay?.on ? (
                <button
                  type="button"
                  className="st-btn pl-pay"
                  // aria-disabled, not disabled, while it works: the site sheet dims a disabled
                  // button to 42%, which would put "Opening the payment page" under AA. `buy`
                  // ignores the press while busy, and the label says what is happening.
                  aria-disabled={busy ? 'true' : undefined}
                  aria-describedby="pl-pay-note"
                  onClick={() => void buy()}
                >
                  {doorLabel()}
                </button>
              ) : (
                <button
                  type="button"
                  className="st-btn st-quiet pl-pay"
                  aria-disabled="true"
                  aria-describedby="pl-pay-note"
                >
                  {doorLabel()}
                </button>
              )}
              <p className="st-fine" id="pl-pay-note">
                {pay?.on ? c.fine : CHECKOUT_LINES.offNote}
              </p>
              {/* What just happened, in one line the screen reader is told about. Confirmed,
                  slow, dismissed and failed all arrive here, and none of them by colour. */}
              {flow.line ? (
                <p className="pl-status" role="status" aria-live="polite" data-step={flow.step}>
                  {flow.line}
                </p>
              ) : null}
              {/* The preview's own link, and only while this card is a preview: with payments on
                  the card IS the checkout, and `/plans/checkout` sends a reader back here. */}
              {showsCheckoutPreviewLink(pay) ? (
                <SiteLink to={{ name: 'plans', checkout: true }} className="st-btn st-quiet">
                  {c.payMore}
                </SiteLink>
              ) : null}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="pl-gift">
            <div>
              <Label>{PLANS_PAGE.gift.eyebrow}</Label>
              <h2>{PLANS_PAGE.gift.title}</h2>
              <p>{PLANS_PAGE.gift.lead}</p>
              <div className="pl-row">
                <SiteLink to={{ name: 'gift' }} className="st-btn">
                  {PLANS_PAGE.gift.cta}
                </SiteLink>
                <SiteLink to={{ name: 'gift' }} className="st-btn st-quiet">
                  {PLANS_PAGE.gift.how}
                </SiteLink>
              </div>
            </div>
            <div className="pl-art">
              <svg viewBox="0 0 300 260" aria-hidden="true">
                <rect x="40" y="90" width="220" height="150" rx="18" fill="var(--pig)" />
                <rect x="30" y="70" width="240" height="44" rx="14" fill="var(--violet)" />
                <rect x="138" y="70" width="24" height="170" fill="var(--marigold)" />
                <path
                  d="M150 70 c-30 -50 -70 -30 -40 0 M150 70 c30 -50 70 -30 40 0"
                  fill="none"
                  stroke="var(--marigold)"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
              </svg>
              <WoboHead size={70} />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <Label>{PLANS_PAGE.faq.eyebrow}</Label>
            <h2>{PLANS_PAGE.faq.title}</h2>
          </Reveal>
          <Reveal className="pl-faq">
            {faq.map((item, i) => (
              <details key={item.question} open={i === 0}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      {/* The close names itself: every word of it is `screens/site/handoffs.ts`, so no page can
          type its own door. `PLANS_PAGE.close` is kept only as the words that table was built
          from, and this page no longer renders them. */}
      <ClosePanel page="plans" />
    </SiteShell>
  );
}
