'use client';

/**
 * `/gift` — a paid plan, bought for someone else.
 *
 * Every word of the page proper is `docs/copy/growth/gift-page.md`, rendered: the heading, the sub,
 * the three steps, what it is, what it is not, and the honest footnote. The page adds structure,
 * not claims.
 *
 * The two rules that shape it, both from that file:
 *
 *  · nothing renews. A gift that quietly becomes a subscription is the exact dark pattern this
 *    product exists to avoid, so the words "paid once, renews never" sit on the cards themselves.
 *  · no testimonial we did not receive. §16 keeps the reference product's testimonial section, and
 *    ours renders as an empty state until real, consented quotes exist.
 *
 * The board chips are the registry's own, generated at build time for the landing page and imported
 * from it, so this page cannot claim a board the registry does not carry.
 */

import { useMemo } from 'react';
import source from '../../../../../docs/copy/growth/gift-page.md?raw';
import { useRouter } from '../../shell/router';
import { Chip, Label } from '../../ui/primitives';
import { countLine } from '../landing/boards';
import boards from '../landing/boards.json';
import { BOARDS } from '../landing/copy';
import { legalPath } from '../legal/catalog';
import { parseBlocks } from '../legal/markdown';
import { Markdown, Spans } from '../legal/Prose';
import { BENEFITS, CHECKOUT_PAGE } from '../plans/copy';
import {
  GIFT_CADENCE,
  GIFT_OPTIONS,
  giftTier,
  PRICE_UNIT,
  priceLabel,
  readMarket,
} from '../plans/prices';
import { ClosePanel } from '../site/ClosePanel';
import { SiteLink } from '../site/nav';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';
import { fillTemplate, giftSections, isButtonLine, sectionText } from './content';
import { GIFT_FOR, GIFT_PAGE } from './copy';

const SECTIONS = giftSections(parseBlocks(fillTemplate(source)));

/** The steps, minus the copy's own button line, which the page draws as a real control. */
const STEPS = (SECTIONS['How it works'] ?? []).filter((block) => !isButtonLine(block));

/** The copy writes the steps as one ordered list; each item becomes a numbered card. */
const STEP_ITEMS = STEPS.flatMap((block) => (block.kind === 'list' ? block.items : []));

const TINTS = ['st-pig', 'st-mint', 'st-marigold'] as const;

function Tick() {
  return (
    <i>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6 l3 3 l5 -6" />
      </svg>
    </i>
  );
}

export function Gift() {
  const router = useRouter();
  const give = () => router.navigate({ name: 'plans', checkout: true });
  // Read once per mount: the market is the device's, and a price must not change under a reader.
  const market = useMemo(() => readMarket(), []);

  return (
    <SiteShell current="gift" title="Gift · Wobo">
      <section className="st-page-hero">
        <div className="st-wrap">
          <Label>{GIFT_PAGE.eyebrow}</Label>
          <h1>{sectionText(SECTIONS.Heading)}</h1>
          <p className="st-sub">{sectionText(SECTIONS.Sub)}</p>
          <div className="st-row">
            <button type="button" className="st-btn st-pig" onClick={give}>
              {GIFT_PAGE.cta}
            </button>
            <span className="st-fine">{GIFT_PAGE.ctaNote}</span>
          </div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.cardsTitle}</h2>
            <p>{GIFT_PAGE.cardsNote}</p>
          </Reveal>
          <Reveal className="pl-plans">
            {GIFT_OPTIONS.map((option) => {
              const tier = giftTier(option);
              return (
                <div
                  className={tier.id === 'max' ? 'pl-plan pl-max' : 'pl-plan pl-pro'}
                  key={option.id}
                >
                  <div className="pl-name">{option.name}</div>
                  <div className="pl-price">
                    <span>{priceLabel(tier, market)}</span>
                    <small>{PRICE_UNIT.paid}</small>
                  </div>
                  <div className="pl-x">{tier.allowanceMultiple}× allowance</div>
                  <ul>
                    {option.lines.map((line) => (
                      <li key={line}>
                        <Tick />
                        {line}
                      </li>
                    ))}
                    <li>
                      <Tick />
                      They choose their own board and subjects
                    </li>
                    <li>
                      <Tick />
                      You never see their work unless they show you
                    </li>
                  </ul>
                  <button type="button" className="st-btn" onClick={give}>
                    {GIFT_PAGE.cardCta(option.name)}
                  </button>
                  <div className="pl-fine">{GIFT_CADENCE}</div>
                </div>
              );
            })}
          </Reveal>
        </div>
      </section>

      <section className="st-section" id="how-it-works">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.stepsTitle}</h2>
          </Reveal>
          <Reveal className="gf-steps">
            {STEP_ITEMS.map((spans, i) => (
              <div className="gf-step" key={spans.map((s) => s.text).join('')}>
                <i>{i + 1}</i>
                <p>
                  <Spans spans={spans} known={[]} />
                </p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.forTitle}</h2>
          </Reveal>
          <Reveal className="st-grid3">
            {GIFT_FOR.map((card, i) => (
              <div className={`st-tile ${TINTS[i % TINTS.length]}`} key={card.label}>
                <h3>{card.label}</h3>
                <p>{card.quote}</p>
              </div>
            ))}
          </Reveal>
          <Reveal className="st-grid2">
            <div className="st-tile">
              <h3>What it is</h3>
              <div className="st-prose" style={{ fontSize: 15 }}>
                <Markdown blocks={SECTIONS['What it is'] ?? []} known={[]} />
              </div>
            </div>
            <div className="st-tile">
              <h3>What it is not</h3>
              <div className="st-prose" style={{ fontSize: 15 }}>
                <Markdown blocks={SECTIONS['What it is not'] ?? []} known={[]} />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.benefitsTitle}</h2>
            <p>{GIFT_PAGE.benefitsNote}</p>
          </Reveal>
          <Reveal>
            <ul className="st-lines">
              {BENEFITS.filter((row) => row.pro !== false).map((row) => (
                <li key={row.label}>
                  <Tick />
                  <span>
                    {row.label}
                    {typeof row.pro === 'string' && row.pro !== 'same' ? `: ${row.pro}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="st-hint" style={{ marginTop: 'var(--s3)' }}>
              <SiteLink to={{ name: 'plans' }} className="st-link">
                Free, Pro and Max, side by side
              </SiteLink>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.boardsTitle}</h2>
            <p>{GIFT_PAGE.boardsNote}</p>
          </Reveal>
          <Reveal className="gf-boards">
            <div className="st-chips">
              {boards.shown.map((board) => (
                <Chip key={board.id} title={board.name}>
                  {board.short}
                </Chip>
              ))}
              <Chip on>{BOARDS.more}</Chip>
            </div>
            <span className="st-fine">
              {countLine(BOARDS.countTemplate, {
                shown: boards.shown.length,
                total: boards.total,
                countries: boards.countries,
              })}
            </span>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal className="st-head">
            <h2>{GIFT_PAGE.testimonialsTitle}</h2>
          </Reveal>
          <Reveal>
            <p className="st-quiet-card">{GIFT_PAGE.testimonialsEmpty}</p>
          </Reveal>
        </div>
      </section>

      <ClosePanel page="gift" title={GIFT_PAGE.closingTitle}>
        <Markdown blocks={SECTIONS['The honest footnote'] ?? []} known={[]} />
        {/* The money document. It used to be the close's QUIET ACTION, which put a legal
            document at the same weight as the gift itself; SELL.md §6 gives the close one
            primary and one quiet second, so the document goes here, in the fine print, where a
            buyer who wants it still finds it. */}
        <p>
          <SiteLink href={legalPath('refund-and-cancellation')} className="st-link">
            {CHECKOUT_PAGE.cancelling}
          </SiteLink>
        </p>
      </ClosePanel>
    </SiteShell>
  );
}
