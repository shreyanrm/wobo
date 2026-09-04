'use client';

/**
 * /security — full confidence: what we hold, how we protect it, who can see it. A port of
 * design/prototypes/site-security.html, word for word and section for section: the shield
 * drawing itself on, the short version, the honest table of what is collected, where it lives
 * and the data-flow drawing, children first, who can see what, what we never do, the compliance
 * posture, the sub-processors by role, the report panel and the documents, the request form,
 * the ask block and the close.
 *
 * The request form has no endpoint yet: the gateway's only mail route is internal and guarded by
 * a key a browser must never hold (see contact/Contact.tsx, which says so on its own page). So
 * the form composes the request and hands it to the visitor's own mail app, and says exactly
 * that under the button. TODO(gateway): POST the request to a message endpoint when one exists,
 * and only then say "Sent."
 *
 * The three documents that exist link to the legal set; the data processing agreement is "on
 * request" and points at the form, and the data-flow diagram points at the drawing above until
 * there is a PDF of it.
 */

import { type FormEvent, useState } from 'react';
import { Label } from '../../ui/primitives';
import { CONTACT } from '../auth/copy';
import { mailtoHref } from '../contact/Contact';
import { ClosePanel } from '../site/ClosePanel';
import { MAILBOXES } from '../site/identity';
import { SiteLink } from '../site/nav';
import { SiteShell } from '../site/SiteShell';
import { PitchAsk } from './Ask';
import { Reveal } from './Reveal';
import { ensurePitchStyles } from './styles';

ensurePitchStyles();

/**
 * The mailbox the report panel names. The legal set used to publish a security@ box and now
 * publishes one address a reader writes to, so the panel names that one — read out of the same
 * list /contact renders, never typed here.
 */
const SECURITY_MAILBOX =
  MAILBOXES.find((box) => box.address.startsWith('support@'))?.address ?? CONTACT.address;

const Tick = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2 6 l3 3 l5 -6" />
  </svg>
);

const BigTick = () => (
  <svg viewBox="0 0 28 28" aria-hidden="true">
    <path d="M5 15 l6 6 l12 -14" />
  </svg>
);

const Yes = () => (
  <span className="sc-y">
    <i />
    yes
  </span>
);
const No = () => (
  <span className="sc-n">
    <i />
  </span>
);
const Limited = ({ children }: { children: string }) => (
  <span className="sc-l">
    <i />
    {children}
  </span>
);

const COLLECT: readonly { what: string; detail: string; why: string; how: string; del: string }[] =
  [
    {
      what: 'Account',
      detail: 'email, name, class, board',
      why: 'To sign you in and teach the right syllabus.',
      how: 'While the account exists',
      del: 'Settings → Your data',
    },
    {
      what: 'Learning',
      detail: 'questions, answers, drawings, progress',
      why: 'So Wobo remembers where a lesson stopped and what clicked.',
      how: 'While the account exists, or until erased',
      del: 'Erase memory, keep progress, or erase all',
    },
    {
      what: 'Voice',
      detail: 'what you say to Wobo',
      why: 'Processed for that turn only, to hear the question.',
      how: 'Not stored, unless a family turns on transcripts',
      del: 'Nothing to delete by default',
    },
    {
      what: 'Payment',
      detail: 'card or UPI details',
      why: 'Handled by the payment provider on their pages.',
      how: 'Never stored by Wobo',
      del: 'With the provider',
    },
    {
      what: 'Device and usage',
      detail: 'app version, crashes, screen size',
      why: 'To keep Wobo working on your phone. No advertising identifiers.',
      how: '90 days',
      del: 'Expires on its own',
    },
  ];

const NEVER: readonly { title: string; line: string }[] = [
  { title: 'Sell data', line: 'Not to anyone, not in aggregate, not ever.' },
  { title: 'Track across the web', line: 'No pixels, no third-party cookies, no fingerprinting.' },
  { title: 'Show ads', line: 'Wobo is paid for by families, not by advertisers.' },
  { title: 'Change prices by behaviour', line: 'Everyone in a country sees the same price.' },
  { title: 'Use dark patterns', line: 'Cancelling takes as many taps as subscribing.' },
  {
    title: 'Train on a child without consent',
    line: 'Off by default, explicit to turn on, easy to turn off.',
  },
];

/**
 * The four laws a child's tutor is built to, and the five things that actually protect the data.
 * Both lists are design/prototypes/site-security.html's compliance section, word for word: a law
 * is named with the promise it makes to a family, and a protection with the control behind it,
 * because "we take security seriously" is not a control.
 */
const LAWS: readonly { title: string; line: string }[] = [
  {
    title: 'India · Digital Personal Data Protection Act 2023.',
    line: "A parent's verifiable consent before a child's account opens, no profiling of a child for advertising, and erasure on request.",
  },
  {
    title: 'United States · COPPA.',
    line: 'Under 13 needs a parent, and the parent may see, correct or delete everything we hold.',
  },
  {
    title: 'Europe and the United Kingdom · GDPR, including the rules for children.',
    line: 'Access, correction, export and erasure, and consent asked at the age each country sets.',
  },
  {
    title: 'California · CCPA and CPRA.',
    line: 'Know what is held, have it deleted, and never have it sold, because we do not sell it to anyone.',
  },
];

const PROTECTIONS: readonly { title: string; line: string }[] = [
  {
    title: 'AES-256 at rest.',
    line: 'The database and every backup are encrypted with 256-bit keys managed by the hosting provider and rotated.',
  },
  {
    title: 'TLS 1.2 or newer in transit.',
    line: 'Every connection between a device, Wobo and anything behind it.',
  },
  {
    title: 'Access rules inside the database.',
    line: "A learner's rows are readable only by that learner, enforced by the database and not only by our code.",
  },
  {
    title: 'Least privilege for people.',
    line: "No standing access to a learner's data. Support access is a deliberate act and it is logged.",
  },
  {
    title: 'Reviewed and gated.',
    line: 'Every change is reviewed, dependencies are scanned, and secrets never live in the code.',
  },
];

const SCHEDULED: readonly string[] = [
  'Independent penetration test before public launch',
  'Staff break-glass access logging with monthly review',
  'SOC 2 Type I, then Type II, in the first year after launch',
  'ISO 27001 readiness assessment',
  "A children's-safety seal evaluated once the audits are in",
];

const SUBS: readonly { role: string; line: string; region: string }[] = [
  {
    role: 'Hosting and compute',
    line: "Runs the app and Wobo's tutor service.",
    region: 'INDIA · US · EU',
  },
  {
    role: 'Database and storage',
    line: 'Holds accounts, learning data and backups, encrypted.',
    region: 'INDIA, WITH EU FOR EU FAMILIES',
  },
  {
    role: 'AI model providers',
    line: 'Answer the question without ever knowing whose it is.',
    region: 'US · EU',
  },
  {
    role: 'Payments',
    line: 'Take the card or UPI payment on their own pages.',
    region: 'INDIA · GLOBAL',
  },
  { role: 'Email', line: 'Send the Sunday note and account emails.', region: 'US' },
  {
    role: 'Reliability',
    line: 'Crash reports and uptime checks. No advertising identifiers.',
    region: 'US',
  },
];

const DOCS: readonly { title: string; line: string; href: string }[] = [
  { title: 'Privacy policy', line: 'in plain words, then the full text', href: '/legal/privacy' },
  { title: "Children's privacy", line: "what's different for under-18s", href: '/legal/children' },
  { title: 'Terms of service', line: 'the deal, both ways', href: '/legal/terms' },
  { title: 'Data processing agreement', line: 'for schools, on request', href: '#request' },
  { title: 'Data-flow diagram', line: 'the drawing above, as a PDF', href: '#flow' },
];

/** The request, as a draft in the visitor's own mail app, to the mailbox that answers anything. */
export function overviewMailto(email: string, org: string): string {
  const body = org
    ? `Please send the security overview to ${email}.\nSchool or organisation: ${org}`
    : `Please send the security overview to ${email}.`;
  return mailtoHref(CONTACT.address, 'Security overview', body);
}

function RequestForm() {
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    window.location.assign(overviewMailto(email, org));
  };
  return (
    <form onSubmit={submit}>
      <input
        type="email"
        required
        placeholder="Your email"
        aria-label="Your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="text"
        placeholder="School or organisation (optional)"
        aria-label="School or organisation (optional)"
        value={org}
        onChange={(e) => setOrg(e.target.value)}
      />
      <button className="st-btn" type="submit">
        Send me the overview
      </button>
      <small>We use this address once, to send the document.</small>
      <small>{CONTACT.mailtoNote}</small>
    </form>
  );
}

export function Security() {
  return (
    <SiteShell current="security" title="Security and trust · Wobo">
      <div className="pt">
        <section className="pt-hero sc-hero">
          <div className="st-wrap">
            <div>
              <Label>Security and trust</Label>
              <h1>
                Your child's questions stay <em>between them and Wobo.</em>
              </h1>
              <p className="pt-sub">
                This page says exactly what we hold, where it lives, who can see it and how to
                delete it. No jargon without a plain-words line beside it, and no claim we can't
                show you.
              </p>
              <div className="pt-row">
                <a className="st-btn" href="#collect">
                  What we collect
                </a>
                <a className="st-btn st-quiet" href="#report">
                  Report a concern
                </a>
                <span className="pt-note">Last reviewed September 2026</span>
              </div>
            </div>
            <div className="sc-shield">
              <svg viewBox="0 0 420 460" role="img" aria-label="A drawn shield with Wobo's eyes">
                <path
                  className="sc-fill"
                  d="M210 40 L360 96 C360 260 300 360 210 420 C120 360 60 260 60 96 Z"
                />
                <path
                  className="sc-draw"
                  d="M210 40 L360 96 C360 260 300 360 210 420 C120 360 60 260 60 96 Z"
                />
                <g className="sc-eyes">
                  <rect x="118" y="170" width="184" height="78" rx="39" fill="var(--ink)" />
                  <g className="pt-blink">
                    <circle cx="172" cy="209" r="19" fill="var(--eye)" />
                    <circle cx="248" cy="209" r="19" fill="var(--eye)" />
                    <circle cx="166" cy="203" r="6" fill="var(--paper)" opacity=".85" />
                    <circle cx="242" cy="203" r="6" fill="var(--paper)" opacity=".85" />
                  </g>
                </g>
                <text className="sc-hw" x="150" y="318" fontSize="34">
                  i've got this
                </text>
              </svg>
            </div>
          </div>
        </section>

        <section className="pt-tight">
          <div className="st-wrap">
            <Reveal className="sc-short">
              <div>
                <Label>The short version</Label>
                <div className="hand" style={{ marginTop: 12 }}>
                  We keep what a tutor needs to teach, <em>nothing a marketer would want,</em> and
                  you can erase all of it with one button.
                </div>
              </div>
              <div className="sc-five">
                <div>
                  <i>1</i>
                  <div>
                    <b>What we collect</b>
                    <span>
                      An account, the learning itself, and enough about the device to keep things
                      working.
                    </span>
                  </div>
                </div>
                <div>
                  <i>2</i>
                  <div>
                    <b>Why</b>
                    <span>
                      To teach the right chapter, remember where a lesson stopped, and write the
                      Sunday note.
                    </span>
                  </div>
                </div>
                <div>
                  <i>3</i>
                  <div>
                    <b>Where it lives</b>
                    <span>
                      Encrypted, in a managed database in a named region, behind row-level access
                      rules.
                    </span>
                  </div>
                </div>
                <div>
                  <i>4</i>
                  <div>
                    <b>Who sees it</b>
                    <span>
                      The learner, a linked parent, and nobody at Wobo without a logged reason.
                    </span>
                  </div>
                </div>
                <div>
                  <i>5</i>
                  <div>
                    <b>How to delete it</b>
                    <span>
                      You, in Settings, any time. Gone from live systems at once and from backups
                      within 30 days.
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="collect">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>What we collect, and why</Label>
              <h2>Every row here has a purpose, a shelf life and a delete button.</h2>
              <p>If something isn't on this list, we don't collect it.</p>
            </Reveal>
            <Reveal className="sc-tbl">
              <div className="sc-r sc-h">
                <div>Data</div>
                <div>Why we need it</div>
                <div>How long</div>
                <div>How to delete</div>
              </div>
              {COLLECT.map((row) => (
                <div className="sc-r" key={row.what}>
                  <div>
                    <b>{row.what}</b>
                    <span>
                      <br />
                      {row.detail}
                    </span>
                  </div>
                  <div>
                    <span>{row.why}</span>
                  </div>
                  <div>
                    <span>{row.how}</span>
                  </div>
                  <div>
                    <span className="sc-del">
                      <i />
                      {row.del}
                    </span>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Where it lives, and how it's protected</Label>
              <h2>
                Locked in transit, locked at rest, and opened only by the person it belongs to.
              </h2>
            </Reveal>
            <Reveal className="st-grid3">
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <rect x="8" y="19" width="28" height="19" rx="5" />
                  <path d="M14 19 v-5 a8 8 0 0 1 16 0 v5" />
                </svg>
                <h3>Encrypted on the way</h3>
                <p>Every connection uses TLS 1.2 or newer.</p>
                <span className="sc-gloss">
                  In plain words: nobody on the same Wi-Fi can read it.
                </span>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <ellipse cx="22" cy="12" rx="13" ry="5" />
                  <path d="M9 12 v20 c0 3 6 5 13 5 s13 -2 13 -5 v-20 M9 22 c0 3 6 5 13 5 s13 -2 13 -5" />
                </svg>
                <h3>Encrypted where it sits</h3>
                <p>
                  The database and its backups are encrypted at rest, keys managed by the hosting
                  provider and rotated.
                </p>
                <span className="sc-gloss">In plain words: a stolen disk is unreadable.</span>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <circle cx="22" cy="16" r="7" />
                  <path d="M8 38 c2 -9 26 -9 28 0" />
                  <path d="M30 8 l6 6" />
                </svg>
                <h3>Only your own rows</h3>
                <p>
                  Access rules live inside the database itself, so a learner can read their rows and
                  nobody else's, even if our app made a mistake.
                </p>
                <span className="sc-gloss">
                  In plain words: the lock is on the drawer, not just the door.
                </span>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M8 34 h28 M12 34 v-12 M20 34 v-18 M28 34 v-8 M36 34 v-22" />
                </svg>
                <h3>Least privilege</h3>
                <p>
                  Staff have no standing access to learner data. A break-glass path exists for
                  support, and every use of it is written to a log the founder reviews.
                </p>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M22 6 a16 16 0 1 1 -11 4" />
                  <path d="M8 6 v8 h8" />
                </svg>
                <h3>Backups that restore</h3>
                <p>Daily backups, kept for 30 days, and a restore we actually rehearse.</p>
              </div>
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M10 30 l8 -8 l6 6 l12 -14" />
                  <path d="M28 14 h8 v8" />
                </svg>
                <h3>Built carefully</h3>
                <p>
                  Every change is reviewed and gated by automated checks. Dependencies are scanned.
                  Secrets never live in the code.
                </p>
              </div>
            </Reveal>
            <Reveal className="sc-flow" id="flow">
              <svg
                viewBox="0 0 960 300"
                role="img"
                aria-label="How a question travels: from the learner's device, encrypted, to Wobo, to the model provider without identity, back to the learner"
              >
                <rect className="sc-box" x="20" y="100" width="180" height="100" rx="18" />
                <text className="sc-t" x="110" y="140" textAnchor="middle">
                  Your device
                </text>
                <text className="sc-s" x="110" y="162" textAnchor="middle">
                  the question, your drawing
                </text>
                <path className="sc-ink sc-fdraw" d="M200 150 h110" />
                <path className="sc-ink sc-fdraw" d="M300 142 l10 8 l-10 8" />
                <rect className="sc-lock" x="236" y="128" width="26" height="20" rx="5" />
                <path className="sc-ink" d="M242 128 v-5 a7 7 0 0 1 14 0 v5" />
                <rect className="sc-box sc-pig" x="320" y="80" width="220" height="140" rx="18" />
                <text className="sc-t" x="430" y="122" textAnchor="middle">
                  Wobo
                </text>
                <text className="sc-s" x="430" y="146" textAnchor="middle">
                  checks who you are, finds
                </text>
                <text className="sc-s" x="430" y="164" textAnchor="middle">
                  your chapter, plans the board
                </text>
                <text className="sc-s" x="430" y="196" textAnchor="middle">
                  named region · encrypted at rest
                </text>
                <path className="sc-ink sc-fdraw" d="M540 150 h110" />
                <path className="sc-ink sc-fdraw" d="M640 142 l10 8 l-10 8" />
                <rect
                  className="sc-box sc-marigold"
                  x="660"
                  y="100"
                  width="280"
                  height="100"
                  rx="18"
                />
                <text className="sc-t" x="800" y="138" textAnchor="middle">
                  AI model provider
                </text>
                <text className="sc-s" x="800" y="160" textAnchor="middle">
                  sees the question, never your name,
                </text>
                <text className="sc-s" x="800" y="178" textAnchor="middle">
                  email or account · no training on it
                </text>
                <path className="sc-ink sc-fdraw" d="M800 200 v40 h-690 v-40" />
                <path className="sc-ink sc-fdraw" d="M102 210 l8 -10 l8 10" />
                <text className="sc-hw" x="470" y="268" textAnchor="middle">
                  the answer comes back drawn, and the provider forgets the turn
                </text>
              </svg>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Children first</Label>
              <h2>
                Built for a ten-year-old at 9 pm, so the rules are stricter than the law asks.
              </h2>
            </Reveal>
            <Reveal className="sc-children">
              <div className="sc-card">
                <div className="hand">
                  A parent can see everything. A stranger can see nothing.{' '}
                  <em>Wobo has no opinions about anything but the chapter.</em>
                </div>
                <p>
                  Neutral by design: no politics, no religion, no ads, no nudges to buy. When a
                  question strays outside school, Wobo says so kindly and comes back to the lesson.
                </p>
              </div>
              <ul>
                <li>
                  <BigTick />
                  <div>
                    <b>Consent by age and country.</b> Under 18 in India needs a parent's verifiable
                    consent under the DPDP Act 2023. Under 13 in the United States follows COPPA.
                    Under 16 in the EU follows GDPR's rules for children.
                  </div>
                </li>
                <li>
                  <BigTick />
                  <div>
                    <b>The parent view.</b> A linked parent sees lessons, progress and the Sunday
                    note. They cannot read a child's typed questions word for word unless the
                    child's settings allow it.
                  </div>
                </li>
                <li>
                  <BigTick />
                  <div>
                    <b>The erase-everything button.</b> In Settings, for the learner and for a
                    linked parent. It deletes memory, progress and the account.
                  </div>
                </li>
                <li>
                  <BigTick />
                  <div>
                    <b>No profiling for advertising.</b> There is no advertising in Wobo, so there
                    is nothing to profile for.
                  </div>
                </li>
                <li>
                  <BigTick />
                  <div>
                    <b>No training on a child's data.</b> A child's questions and drawings are never
                    used to train models unless a parent turns that on, explicitly, and it can be
                    turned off again.
                  </div>
                </li>
              </ul>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Who can see what</Label>
              <h2>Four kinds of people, one honest table.</h2>
            </Reveal>
            <Reveal className="sc-who">
              <div className="sc-r sc-h">
                <div>Data</div>
                <div>Learner</div>
                <div>Linked parent</div>
                <div>School, if linked</div>
                <div>Wobo staff</div>
              </div>
              <div className="sc-r">
                <div>Lessons and progress</div>
                <div>
                  <Yes />
                </div>
                <div>
                  <Yes />
                </div>
                <div>
                  <Limited>progress only</Limited>
                </div>
                <div>
                  <Limited>break-glass, logged</Limited>
                </div>
              </div>
              <div className="sc-r">
                <div>Typed questions, word for word</div>
                <div>
                  <Yes />
                </div>
                <div>
                  <Limited>if the learner allows</Limited>
                </div>
                <div>
                  <No />
                </div>
                <div>
                  <Limited>break-glass, logged</Limited>
                </div>
              </div>
              <div className="sc-r">
                <div>Voice</div>
                <div>
                  <span className="sc-n">
                    <i /> not stored
                  </span>
                </div>
                <div>
                  <No />
                </div>
                <div>
                  <No />
                </div>
                <div>
                  <No />
                </div>
              </div>
              <div className="sc-r">
                <div>The Sunday note</div>
                <div>
                  <Yes />
                </div>
                <div>
                  <Yes />
                </div>
                <div>
                  <No />
                </div>
                <div>
                  <No />
                </div>
              </div>
              <div className="sc-r">
                <div>Email and payment status</div>
                <div>
                  <Yes />
                </div>
                <div>
                  <Yes />
                </div>
                <div>
                  <No />
                </div>
                <div>
                  <Limited>support, logged</Limited>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>What we never do</Label>
              <h2>Six lines we'd put in a contract.</h2>
            </Reveal>
            <Reveal className="sc-never">
              {NEVER.map((item) => (
                <div key={item.title}>
                  <span className="sc-x">✗</span>
                  <b>{item.title}</b>
                  <span>{item.line}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Compliance</Label>
              <h2>The laws we are built to, and how the data is protected.</h2>
            </Reveal>
            <Reveal className="sc-posture">
              <div className="sc-col sc-today">
                <h3>The laws we are built to</h3>
                <ul>
                  {LAWS.map((law) => (
                    <li key={law.title}>
                      <i>
                        <Tick />
                      </i>
                      <span>
                        <b>{law.title}</b> {law.line}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sc-col sc-next">
                <h3>How it is protected</h3>
                <ul>
                  {PROTECTIONS.map((item) => (
                    <li key={item.title}>
                      <i />
                      <span>
                        <b>{item.title}</b> {item.line}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="sc-honest">
                  Where a claim needs an outside auditor to be worth anything, we would rather show
                  you the control than print a badge we have not earned.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/*
          The audits are their own paragraph rather than a second column: a family reading the two
          lists above is owed the honest state of what has NOT been checked by an outsider yet, and
          burying it in a "scheduled" column made it look like a feature list.
        */}
        <section className="pt-tight">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Not yet</Label>
              <h2>What an outsider has not checked yet.</h2>
              <p>
                Every line below is scheduled, and each one moves up with the date it landed. Ask us
                for the current status any time.
              </p>
            </Reveal>
            <Reveal className="sc-never">
              {SCHEDULED.map((line) => (
                <div key={line}>
                  <span>{line}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="st-section">
          <div className="st-wrap">
            <Reveal className="st-head">
              <Label>Sub-processors</Label>
              <h2>The companies that touch data on our behalf, by role.</h2>
              <p>
                We name the roles here and the companies in the document you can request below. If a
                sub-processor changes, account holders get 30 days' notice by email.
              </p>
            </Reveal>
            <Reveal className="sc-subs">
              {SUBS.map((sub) => (
                <div key={sub.role}>
                  <b>{sub.role}</b>
                  <span>{sub.line}</span>
                  <span className="sc-reg">{sub.region}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="st-section" id="report">
          <div className="st-wrap">
            <Reveal className="sc-two">
              <div className="sc-panel">
                <Label style={{ color: 'var(--rose)' }}>Report a concern</Label>
                <h3>Found something? Tell us and we'll answer within 72 hours.</h3>
                <p>
                  Researchers who report responsibly get our thanks in public and never a legal
                  letter. Families with a worry get a person, not a form.
                </p>
                <a className="sc-mail" href={`mailto:${SECURITY_MAILBOX}`}>
                  {SECURITY_MAILBOX}
                </a>
              </div>
              <div className="sc-panel">
                <Label>Documents</Label>
                <h3>The paperwork, in plain words first.</h3>
                <div className="sc-docs">
                  {DOCS.map((doc) => (
                    <SiteLink key={doc.title} href={doc.href}>
                      {doc.title} <span>{doc.line}</span>
                    </SiteLink>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="pt-tight" id="request">
          <div className="st-wrap">
            <Reveal className="sc-req">
              <div>
                <h3>Want the full security overview?</h3>
                <p>
                  The named sub-processors, the region map, the incident-response plan and the
                  current audit status, as one document. Written plainly, and readable by anyone.
                </p>
              </div>
              <RequestForm />
            </Reveal>
          </div>
        </section>

        <section className="pt-tight">
          <div className="st-wrap">
            <Reveal>
              <PitchAsk
                page="security"
                heading="Ask Wobo about any of this. It answers for itself."
                placeholder="Can my school see my questions?"
                chips={[
                  'Where is my data stored?',
                  'What happens when I delete my account?',
                  'Does Wobo listen all the time?',
                ]}
              />
            </Reveal>
          </div>
        </section>

        <ClosePanel title="Satisfied? Ask for early access." />
      </div>
    </SiteShell>
  );
}
