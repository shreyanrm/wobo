'use client';

/**
 * `/plans` — free every day; more when exams get close. A port of
 * design/prototypes/site-plans.html: the hero with the allowance drawing, the three plan cards,
 * the honest table, the checkout preview with its two consent boxes, the gift block, the money
 * questions and the close.
 *
 * The prices are the owner's (WOBO-PLAN §14) and every one of them is read from `prices.ts` — the
 * cards, the table and the checkout preview — so a change to a number is one edit and every
 * surface says the same thing in the same breath.
 *
 * There is NO country switch here, and there never will be. Law v5's copy law (DESIGN.md §0):
 * where someone is reading from is not a question worth asking. `readMarket()` answers it from the
 * browser's own locale and time zone, once per mount, and the page simply shows that currency. A
 * switch would only have existed because we could not be bothered to work it out; and the deal is
 * the same in every market regardless (§14 — by country, never by person).
 *
 * What this page deliberately does not do is take a payment. "Choose Pro" and "Choose Max" bring
 * the checkout preview into view with that plan on it; its payment control leads to
 * `/plans/checkout`, which says plainly that checkout opens with launch. A payment page that
 * looked real but was not, on a product used by children, would be the worst thing on the site.
 *
 * The allowance drawing reads the learner's real budget through `sdk.me()`; where there is no
 * answer it says it cannot see one rather than showing a number nobody verified.
 */

import { useReducedMotion } from '@wobo/motion';
import type { Me } from '@wobo/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { useSdk } from '../../store/sdk';
import { Label, Sticker, WoboHead } from '../../ui/primitives';
import { legalPath } from '../legal/catalog';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';
import { allowanceLine, allowanceShare, readAllowance } from './allowance';
import { ALLOWANCE_WORDS, BENEFITS, type Benefit, faqItems, PLANS_PAGE } from './copy';
import {
  BEST_FOR,
  PLAN_TIERS,
  type PlanTier,
  priceLabel,
  priceUnit,
  readMarket,
  renewalLabel,
  renewsOn,
} from './prices';

const FAQ = faqItems();

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
  const router = useRouter();
  const reduced = useReducedMotion();
  // Read once per mount, from the browser and nothing else: the reader is never asked where they
  // are, and there is no control that could change this.
  const market = useMemo(() => readMarket(), []);
  const [previewId, setPreviewId] = useState<PlanTier['id']>('pro');
  const [terms, setTerms] = useState(false);
  const [renewal, setRenewal] = useState(false);
  const checkoutRef = useRef<HTMLElement | null>(null);
  const ready = terms && renewal;
  // Read once per mount: a renewal date must not change under a reader.
  const today = useMemo(() => new Date(), []);
  const preview =
    PLAN_TIERS.find((t) => t.id === previewId && t.price) ??
    PLAN_TIERS.find((t) => t.recommended) ??
    (PLAN_TIERS[1] as PlanTier);
  const c = PLANS_PAGE.checkout;

  const choose = (tier: PlanTier) => {
    setPreviewId(tier.id);
    checkoutRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
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

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="pl-plans">
            {PLAN_TIERS.map((tier) => (
              <div className={CARD_CLASS[tier.id]} key={tier.id}>
                {tier.recommended ? <span className="pl-best">{BEST_FOR}</span> : null}
                <div className="pl-name">{tier.name}</div>
                <div className="pl-price">
                  <span>{priceLabel(tier, market)}</span>
                  <small>{priceUnit(tier)}</small>
                </div>
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
                <div className="pl-fine">{tier.fine}</div>
              </div>
            ))}
          </Reveal>
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
              <p>{c.lead}</p>
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
                  {priceLabel(preview, market)} {c.perMonth}
                </b>
              </div>
              <div className="pl-row">
                <span>{c.starts}</span>
                <b>{c.startsValue}</b>
              </div>
              <div className="pl-row">
                <span>{c.renews}</span>
                <b>
                  {renewalLabel(renewsOn(today))}, {c.renewsSuffix}
                </b>
              </div>
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
                  <b>{c.renewal}</b>
                  {c.renewalNote.replace('{plan}', preview.name)}
                </div>
              </label>
              <div className="pl-total">
                <span>{c.today}</span>
                <b>{priceLabel(preview, market)}</b>
              </div>
              <button
                type="button"
                className="st-btn st-pig"
                disabled={!ready}
                onClick={() => router.navigate({ name: 'plans', checkout: true })}
              >
                {c.pay}
              </button>
              <div className="st-fine">{c.fine}</div>
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
            {FAQ.map((item, i) => (
              <details key={item.question} open={i === 0}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <ClosePanel
        title={PLANS_PAGE.close.title}
        hand={PLANS_PAGE.close.hand}
        primary={{ label: PLANS_PAGE.close.primary, to: { name: 'onboarding' } }}
        quiet={{ label: PLANS_PAGE.close.quiet, to: { name: 'gift' } }}
      />
    </SiteShell>
  );
}
