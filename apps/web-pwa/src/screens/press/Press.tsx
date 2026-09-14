'use client';

/**
 * /press — the press kit, on the site, in the form a journalist actually uses one.
 *
 * WHY THIS PAGE IS NOT A PITCH. Three products share the name Wobo, and the strongest of them is a
 * job-search app with an App Store listing, Trustpilot reviews and a Product Hunt page. Ask any
 * answer engine what "Wobo AI tutor" is and it answers about that one; one of them says outright
 * that Wobo AI is not an AI tutor (docs/GROWTH-ENTITY.md). An engine decides what a name refers to
 * by what independent sources AGREE on, so the lever is sameness, not persuasion. This page exists
 * to make the agreeing easy: the one line, the hundred words and the three hundred words are here
 * to be LIFTED, identical to every listing and every store, and the machine that reads the page
 * after the journalist has gone reads the same strings.
 *
 * SO IT IS BUILT AS A WORKING DOCUMENT. Every block a person would take is a panel with its own
 * copy control in the same place, the facts are a table that survives a paste, and nothing moves in
 * front of the words. That is also why it carries no ClosePanel: a press page's last line is an
 * address a person writes to, and ending it on a marigold "Start free" would tell a reporter they
 * had been read as a lead (docs/SELL.md §6 gives every page ONE job, and this page's job is to be
 * taken from).
 *
 * IT PRE-RENDERS LIKE EVERY OTHER PAGE. `/press` is in `screens/states/routes.ts`, so
 * `scripts/prerender.ts` writes `dist/press/index.html` with the whole kit in it and the
 * Organization markup carrying the `sameAs` list from `shell/profiles.ts`. Nothing here needs
 * JavaScript to be read: the copy buttons are a convenience over text that is already selectable,
 * and they simply do nothing on a page whose script never ran.
 *
 * EVERY STRING COMES FROM `copy.ts`, which is docs/copy/press-kit.md transcribed and held to it by
 * `press.test.ts`. No sentence is written in this file.
 */

import { type ReactNode, useState } from 'react';
import { Label, Wordmark } from '../../ui/primitives';
import { COMPANY, POSTAL_ADDRESS } from '../site/identity';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import {
  FACTS,
  FILM_NOTE,
  FOUNDER,
  HUNDRED_WORDS,
  LOGOS,
  ONE_LINE,
  PRESS_HEAD,
  PRESS_MAILBOX,
  SCREENSHOTS,
  THREE_HUNDRED_WORDS,
} from './copy';
import { ensurePressStyles } from './styles';

ensurePressStyles();

/**
 * The one control on the page that does anything. It hands the block's text to the clipboard and
 * says so for two seconds, in words rather than a tick, because a tick beside a button a reader
 * has never used before does not say whether it worked.
 *
 * A refusal is silent on purpose: a browser that will not give a page the clipboard is not a
 * failure the reader can act on, and the text is right there to select by hand.
 */
function Copy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pr-copy"
      data-done={done ? 'yes' : 'no'}
      aria-label={`Copy ${what}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
          .catch(() => undefined);
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** A block of the kit: what it is, where it is used, the words, and the control to take them. */
function Block({
  id,
  title,
  where,
  text,
  lead,
  children,
}: {
  id: string;
  title: string;
  /** The surfaces this exact wording belongs on, so a reader knows what they are taking. */
  where: string;
  /** The plain text the copy control hands over. */
  text: string;
  lead?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="pr-block" id={id}>
      <div className="pr-top">
        <h3>{title}</h3>
        <span className="pr-where">{where}</span>
        <Copy text={text} what={title.toLowerCase()} />
      </div>
      <div className={lead ? 'pr-words pr-lead' : 'pr-words'}>{children}</div>
    </div>
  );
}

/** Wobo's own face, the square mark, drawn at the size the file is published at. */
function Mark() {
  return (
    <svg viewBox="20 11 110 110" role="img" aria-label="The Wobo mark">
      <circle cx="75" cy="66" r="42" fill="currentColor" fillOpacity="0.92" />
      <rect x="41" y="50" width="68" height="30" rx="15" fill="var(--paper)" />
      <circle cx="62" cy="65.5" r="7.4" fill="var(--pig)" />
      <circle cx="88" cy="65.5" r="7.4" fill="var(--pig)" />
    </svg>
  );
}

const FACTS_TEXT = FACTS.map((fact) => `${fact.label}: ${fact.value}`).join('\n');

export function Press() {
  return (
    <SiteShell current="press" title={PRESS_HEAD.title}>
      <>
        <section className="pr-hero">
          <div className="st-wrap">
            <Label>{PRESS_HEAD.eyebrow}</Label>
            <h1>{PRESS_HEAD.heading}</h1>
            <p>{PRESS_HEAD.sub}</p>
            <div className="pr-jump">
              <a href="#descriptions">Descriptions</a>
              <a href="#facts">The facts</a>
              <a href="#founder">Founder</a>
              <a href="#logos">Logo</a>
              <a href="#screenshots">Screenshots</a>
              <a href="#reach">Contact</a>
            </div>
          </div>
        </section>

        <section className="st-section" id="descriptions">
          <div className="st-wrap">
            <div className="st-head">
              <Label>The descriptions</Label>
              <h2>Three lengths, and every one of them is the one we use everywhere else.</h2>
              <p>
                If you change a word, we cannot tell an answer engine that the listings and the site
                are describing the same company. That is the whole reason this page exists, so take
                them as they are.
              </p>
            </div>
            <div className="pr-stack">
              <Block
                id="one-line"
                title="The one line"
                where="Listings, app stores, social bios, a standfirst"
                text={ONE_LINE}
                lead
              >
                <p>{ONE_LINE}</p>
              </Block>
              <Block
                id="hundred"
                title="The hundred words"
                where="A boilerplate paragraph at the foot of a piece"
                text={HUNDRED_WORDS}
              >
                <p>{HUNDRED_WORDS}</p>
              </Block>
              <Block
                id="three-hundred"
                title="The three hundred words"
                where="A feature, a profile, a company description"
                text={THREE_HUNDRED_WORDS.join('\n\n')}
              >
                {THREE_HUNDRED_WORDS.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                ))}
              </Block>
            </div>
          </div>
        </section>

        <section className="st-section" id="facts">
          <div className="st-wrap">
            <div className="st-head">
              <Label>The facts</Label>
              <h2>The box, for the side of the page.</h2>
              <p>
                Every row is checkable, and there is no number here we cannot show you. Ask for
                anything that is missing and we will either send it or tell you we do not have it.
              </p>
            </div>
            <div className="pr-block">
              <div className="pr-top">
                <h3>Wobo, in seven rows</h3>
                <Copy text={FACTS_TEXT} what="the facts box" />
              </div>
              <dl className="pr-facts">
                {FACTS.map((fact) => (
                  <div className="pr-row" key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="st-section" id="founder">
          <div className="st-wrap">
            <div className="st-head">
              <Label>The founder</Label>
              <h2>One name, spelled the same way everywhere.</h2>
            </div>
            <div className="pr-founder">
              <b>{FOUNDER.name}</b>
              <span>
                {FOUNDER.role}, {COMPANY}, Hyderabad
              </span>
              <span className="hand">Available for an interview, in writing or on a call.</span>
            </div>
          </div>
        </section>

        <section className="st-section" id="logos">
          <div className="st-wrap">
            <div className="st-head">
              <Label>The logo</Label>
              <h2>The same drawing the site wears, in the formats a page needs.</h2>
              <p>
                Please do not redraw it, recolour it or set the name in another face. Ink on a light
                ground or paper on a dark one, and room around it the height of the W.
              </p>
            </div>
            <div className="pr-files">
              {LOGOS.map((logo) => (
                <a className="pr-file" key={logo.href} href={logo.href} download>
                  <span className="pr-art">
                    {logo.href.includes('mark') ? <Mark /> : <Wordmark />}
                  </span>
                  <b>{logo.title}</b>
                  <span>{logo.note}</span>
                  <em>{logo.href}</em>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="st-section" id="screenshots">
          <div className="st-wrap">
            <div className="st-head">
              <Label>Screenshots</Label>
              <h2>Three pictures of the product, taken off the product.</h2>
              <p>
                Each one was captured from the page named under it, which is live on this site right
                now. Nothing here was drawn for a press kit.
              </p>
            </div>
            <div className="pr-shots">
              {SCREENSHOTS.map((shot) => (
                <a className="pr-shot" key={shot.href} href={shot.href} download>
                  <img src={shot.href} alt={shot.note} width={1440} height={900} loading="lazy" />
                  <b>{shot.title}</b>
                  <span>{shot.note}</span>
                  <em>Taken from heywobo.com{shot.from === '/' ? '' : shot.from}</em>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="st-section" id="reach">
          <div className="st-wrap">
            <div className="pr-reach">
              <div className="pr-block">
                <div className="pr-top">
                  <h3>Write to a person</h3>
                  <span className="pr-where">Answered within a day</span>
                </div>
                <a className="pr-mail" href={`mailto:${PRESS_MAILBOX}`}>
                  {PRESS_MAILBOX}
                </a>
                <p className="pr-note">
                  Not a form and not a no-reply. Ask for a demonstration, a number, a quote, or the
                  answer to something on this page that does not add up, and a person will answer
                  it.
                </p>
              </div>
              <div className="pr-stack">
                <p className="pr-note">{FILM_NOTE}</p>
                <p className="pr-note">
                  {COMPANY}, {POSTAL_ADDRESS}
                </p>
                <p className="pr-note">
                  More on how the product is built and what it does with a child’s data is on the{' '}
                  <SiteLink href="/security">security page</SiteLink>, and what we do and do not
                  claim is on the <SiteLink href="/about">about page</SiteLink>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </>
    </SiteShell>
  );
}
