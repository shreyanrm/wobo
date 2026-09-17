'use client';

/**
 * `/donate` — a place, at the price a parent pays, bought for a family who cannot.
 *
 * Every word of the page proper is `docs/copy/growth/donate-page.md`, rendered: the heading, the
 * sub, the three steps, what a place is, what it is not, the family's invitation and the honest
 * footnote. The four policy lines at the top of that file are rendered too, out of the same source,
 * because they are what the page promises and retyping them is how one of them gets softened. The
 * page adds structure, not claims; `copy.ts` holds the handful of structural words the source does
 * not carry and says, line by line, where each one comes from.
 *
 * The drawing is `design/prototypes/site-donate.html` and this is that drawing: the centred hero,
 * the twins, the three steps, the price cards, the denials, the family's panel with the card beside
 * it. `styles.ts` records the two places where law v5 (DESIGN.md §0) has moved on from it.
 *
 * THE ARGUMENT OF THE PAGE IS ONE PICTURE. Two panels sit side by side; one was paid for by a
 * parent, the other by a stranger, and they are identical because they are the same product. So
 * `PlacePanel` TAKES NO ARGUMENTS. There is no prop to differ on, no branch inside it and no second
 * copy of its markup anywhere in the file, which makes the two panels the same render rather than
 * two renders somebody has to keep in step. `Twin` adds the caption and nothing else, and
 * `content.test.ts` fails if either of those facts stops being true.
 *
 * The rules of the copy source are binding and they are all absences, so they are worth naming:
 * there is no counter of places funded, no progress bar toward a target, no photograph of a child,
 * no child's story or first name, no countdown, and no line that suggests a child is lost if the
 * reader closes the tab. The ask is stated once, calmly, and the reader is trusted.
 */

import { useMemo } from 'react';
import source from '../../../../../docs/copy/growth/donate-page.md?raw';
import { useRouter } from '../../shell/router';
import { Label, WoboHead } from '../../ui/primitives';
import { giftSections, isButtonLine } from '../gift/content';
import { legalPath } from '../legal/catalog';
import { type Block, parseBlocks } from '../legal/markdown';
import { Markdown } from '../legal/Prose';
import { MONEY_LINES } from '../money-voice';
import { CHECKOUT_PAGE } from '../plans/copy';
import { GIFT_CADENCE, readMarket } from '../plans/prices';
import { ClosePanel } from '../site/ClosePanel';
import { MAILBOXES } from '../site/identity';
import { SiteLink } from '../site/nav';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';
import {
  emphasise,
  placePrice,
  policyLines,
  proseText,
  sentences,
  splitLead,
  unfoldLists,
} from './content';
import { DONATE_PAGE, PLACE_PANEL, PLACES, PRICE_NOT_SET } from './copy';
import { ensureDonateStyles } from './styles';

// The chunk arriving IS the page being opened, so the sheet goes in at import time.
ensureDonateStyles();

const BLOCKS = parseBlocks(unfoldLists(source));
/** The page proper, keyed by the bold label the copy gives each part. The gift page's reader. */
const SECTIONS = giftSections(BLOCKS);
/** The four lines only the owner can settle, read out of the source's own list. */
const POLICIES = policyLines(BLOCKS);

/** The words of a section the copy writes as one paragraph, minus its own button line. */
const text = (name: string): string => proseText(SECTIONS[name]);

/** The copy draws a control as a bracketed line; the page draws it as a real control. */
function buttonIn(blocks: readonly Block[] | undefined, fallback: string): string {
  return blocks?.map(isButtonLine).find(Boolean) ?? fallback;
}

const FUND = buttonIn(SECTIONS['How it works'], 'Fund a place');
const ASK = buttonIn(SECTIONS['If this is you'], 'Ask for a place');

/** The steps, as the copy's own ordered list, minus its button line. */
const STEPS = (SECTIONS['How it works'] ?? []).flatMap((block) =>
  block.kind === 'list' ? block.items.map((spans) => spans.map((s) => s.text).join('')) : [],
);

/** The denials, one per sentence of the copy's paragraph. */
const NOTS = sentences(text('What it is not'));

const SUPPORT = MAILBOXES[0]?.address ?? '';

/**
 * The panel, drawn once.
 *
 * It takes no arguments on purpose: the page's whole argument is that a funded place and a bought
 * place are the same thing, and a component with no parameters cannot render two different things.
 *
 * The two panels render byte for byte the same markup, with two exceptions that both belong to the
 * shipped character rig rather than to this page: the clip-path id React mints per instance (two
 * SVGs in one document may not share one), and the eyes, which drift on their own idle timer. Wobo
 * is alive in both panels; the product in them is identical.
 */
function PlacePanel() {
  return (
    <div className="dn-mini">
      <div className="dn-top">
        <WoboHead size={32} className="dn-face" />
        <span>{PLACE_PANEL.ask}</span>
      </div>
      <div className="dn-board">
        <svg viewBox="0 0 240 96" role="img" aria-label={PLACE_PANEL.board}>
          <rect x="8" y="20" width="96" height="56" rx="8" fill="var(--pig-w)" />
          <rect x="8" y="20" width="32" height="56" rx="8" fill="var(--pig)" opacity=".62" />
          <rect x="40" y="20" width="32" height="56" fill="var(--pig)" opacity=".62" />
          <path d="M40 20V76M72 20V76" stroke="var(--paper)" strokeWidth="3" />
          <path
            d="M116 48h16m-8-8v16"
            stroke="var(--ink-3)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect x="144" y="20" width="88" height="56" rx="8" fill="var(--marigold-w)" />
          <rect x="144" y="20" width="29" height="56" rx="8" fill="var(--marigold)" />
          <path d="M173 20V76M202 20V76" stroke="var(--paper)" strokeWidth="3" />
        </svg>
      </div>
      <div className="dn-chips">
        {PLACE_PANEL.kinds.map((kind, i) => (
          <i key={kind} {...(i === 0 ? { className: 'dn-lit' } : {})}>
            {kind}
          </i>
        ))}
      </div>
      <div className="dn-foot">
        <span className="dn-ring" aria-hidden="true" />
        <b>{PLACE_PANEL.foot}</b>
      </div>
    </div>
  );
}

/** One panel and who paid for it. The caption is the only thing either twin is given. */
function Twin({ caption }: { caption: string }) {
  return (
    <figure className="dn-twin">
      <PlacePanel />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Donate() {
  const router = useRouter();
  const fund = () => router.navigate({ name: 'plans', checkout: true });
  // Read once per mount: the market is the device's, and a price must not change under a reader.
  const market = useMemo(() => readMarket(), []);
  const [before, mark, after] = emphasise(text('Heading'), DONATE_PAGE.headingEm);
  const invitation = splitLead(text('If this is you'));

  return (
    <SiteShell current="donate" title="Donate Wobo">
      <section className="dn-hero">
        <div className="st-wrap">
          <Label>{DONATE_PAGE.eyebrow}</Label>
          <h1>
            {before}
            <em>{mark}</em>
            {after}
          </h1>
          <p className="dn-sub">{text('Sub')}</p>
          <div className="dn-row">
            <a className="st-btn st-pig" href="#fund">
              {FUND}
            </a>
            <a className="st-btn st-quiet" href="#ask">
              {ASK}
            </a>
          </div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.sameLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.sameTitle}</h2>
            <p className="dn-lede">{DONATE_PAGE.sameLede}</p>
          </Reveal>
          <Reveal className="dn-twins">
            <Twin caption={DONATE_PAGE.paidByParent} />
            <span className="hand dn-vs">{DONATE_PAGE.sameHand}</span>
            <Twin caption={DONATE_PAGE.paidByStranger} />
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.stepsLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.stepsTitle}</h2>
          </Reveal>
          <Reveal>
            <ol className="dn-steps">
              {STEPS.map((step, i) => {
                const { lead, rest } = splitLead(step);
                return (
                  <li key={step}>
                    <b>{String(i + 1).padStart(2, '0')}</b>
                    <h3>{lead}</h3>
                    {rest ? <p>{rest}</p> : null}
                  </li>
                );
              })}
            </ol>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.rulesLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.rulesTitle}</h2>
          </Reveal>
          <Reveal>
            <ol className="dn-rules">
              {POLICIES.map((line) => (
                <li key={line.lead}>
                  <b>{line.lead}</b>
                  <p>{line.text}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section className="st-section dn-anchor" id="fund">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.costLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.costTitle}</h2>
            {/* docs/copy/money.md, "donate screen": the one money line on this page, by the price. */}
            <p className="dn-lede">{MONEY_LINES.donate}</p>
          </Reveal>
          <Reveal className="dn-places">
            {PLACES.map((place) => {
              const price = placePrice(place, market);
              return (
                <div
                  className={place.id === 'term' ? 'dn-place dn-lead' : 'dn-place'}
                  key={place.id}
                >
                  <b>{place.name}</b>
                  <div className="dn-price">
                    {price ? (
                      <span>{price}</span>
                    ) : (
                      <span className="dn-slot" title="Not decided yet">
                        {PRICE_NOT_SET}
                      </span>
                    )}
                  </div>
                  <p>{place.note}</p>
                  {place.cta ? (
                    <button
                      type="button"
                      className={place.id === 'term' ? 'st-btn st-pig' : 'st-btn'}
                      onClick={fund}
                    >
                      {place.cta}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </Reveal>
          <Reveal>
            <p className="dn-fine">
              {`The plan price, ${GIFT_CADENCE}. ${CHECKOUT_PAGE.title}`}
              <SiteLink to={{ name: 'plans' }} className="st-link">
                {DONATE_PAGE.costLink}
              </SiteLink>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.insideLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.insideTitle}</h2>
          </Reveal>
          <Reveal className="st-prose">
            <Markdown blocks={SECTIONS['What a place is'] ?? []} known={[]} />
          </Reveal>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <Reveal>
            <Label>{DONATE_PAGE.notLabel}</Label>
            <h2 className="dn-t">{DONATE_PAGE.notTitle}</h2>
          </Reveal>
          <Reveal>
            <ul className="dn-nots">
              {NOTS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="st-section dn-anchor" id="ask">
        <div className="st-wrap">
          <Reveal className="dn-ask">
            <div className="dn-ask-say">
              <Label>{DONATE_PAGE.askLabel}</Label>
              <h2>{invitation.lead}</h2>
              {invitation.rest ? <span className="hand dn-note">{invitation.rest}</span> : null}
              <a className="st-btn" href={`mailto:${SUPPORT}`}>
                {ASK}
              </a>
            </div>
            <aside className="dn-eg">
              <span className="dn-eg-label">{DONATE_PAGE.askAsideLabel}</span>
              <a className="dn-eg-line" href={`mailto:${SUPPORT}`}>
                {SUPPORT}
              </a>
              <span className="dn-eg-foot">{DONATE_PAGE.askAsideFoot}</span>
            </aside>
          </Reveal>
        </div>
      </section>

      <ClosePanel page="donate" title={DONATE_PAGE.closeTitle}>
        <Markdown blocks={SECTIONS['The honest footnote'] ?? []} known={[]} />
        <p>
          <SiteLink href={legalPath('refund-and-cancellation')} className="st-link">
            {CHECKOUT_PAGE.cancelling}
          </SiteLink>
        </p>
      </ClosePanel>
    </SiteShell>
  );
}
