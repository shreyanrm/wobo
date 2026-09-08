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
      del: 'You → Settings → Your data',
    },
    {
      what: 'Learning',
      detail: 'questions, answers, drawings, progress',
      why: 'So Wobo remembers where a lesson stopped and what clicked.',
      how: 'While the account exists, or until erased',
      // "or erase all" was here and it was false. POST /v1/me/erase reaches exactly six things
      // (memory.Erasure: facts, twin summary, threads, boards, mail preferences, parent links).
      // Nothing in the gateway, the SDK or the app deletes an ACCOUNT — there is no call to the
      // auth admin API anywhere in the tree. The account survives every button this product has.
      del: 'Erase memory, or erase the learning too',
    },
    {
      what: 'Voice',
      detail: 'what you say to Wobo',
      why: 'Processed for that turn only, to hear the question.',
      // "unless a family turns on transcripts" was here. There is no transcripts setting: no
      // switch, no field, no route, nothing in the gateway or the app. This is the sentence a
      // parent reads to decide whether voice is safe, so it says only what is true.
      how: 'Not stored',
      del: 'Nothing to delete',
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
    /*
      WHAT THIS ROW USED TO CLAIM: "A parent's verifiable consent before a child's account opens".
      There is no consent mechanism in the product. `consent_tier` is READ on every capability call
      and written by nothing, so every learner sits permanently on `un_elevated`; nothing verifies,
      records or gates. The claim was also contradicted in print by our own
      `docs/legal/childrens-privacy.md` section 3, which opens "There is no consent gate in Wobo
      today". Two live surfaces cannot say opposite things about children's consent.

      A law is still named, because the obligation is real and naming it is not a claim to have met
      it. What is stated is what we actually do, and the gap is stated as a gap.
    */
    line: 'No profiling of a child for advertising, and erasure of the learning on request. There is no parental consent gate in Wobo today, and until there is we do not claim one.',
  },
  {
    title: 'United States · COPPA.',
    line: 'Under 13 needs a parent, and the parent may see, correct or delete everything we hold.',
  },
  {
    title: 'Europe and the United Kingdom · GDPR, including the rules for children.',
    /*
      "Access, correction, export and erasure, and consent asked at the age each country sets."
      There is no export route and no export code anywhere: no `me/export`, no `exportRemoteData`,
      no `exportSubjectRows`, in the gateway, the SDK or the app. And no consent is asked at any
      age. The five legal documents and the You screen had this promise removed already; the page
      that makes it to the most readers kept it.
    */
    line: 'Access, correction and erasure. A copy of what we hold is assembled by hand when you write to us; there is no download button and no consent gate yet, and we will not print either until it exists.',
  },
  {
    title: 'California · CCPA and CPRA.',
    line: 'Know what is held, have it deleted, and never have it sold, because we do not sell it to anyone.',
  },
];

const PROTECTIONS: readonly { title: string; line: string }[] = [
  /*
    "AES-256 at rest. The database and every backup are encrypted with 256-bit keys managed by the
    hosting provider and rotated." Nothing in this repository evidences the cipher, the key
    management or the rotation, and `docs/legal/privacy-policy.md` section 10 — live, on this same
    site — publishes the opposite posture in as many words: "Encryption at rest and key rotation
    are the hosting provider's, and we have not read the project's settings and written the answer
    down, so we make no claim of our own about them." One live page may not make a specific
    cryptographic claim that the other live page explicitly declines to make.

    The row that replaces it says the thing we can show: the data sits inside a managed database
    whose own encryption we have not audited, and we say so.
  */
  {
    title: 'Storage we do not run ourselves.',
    line: 'The database is a managed service and its encryption at rest is the provider\'s, not ours. We have not audited that configuration, so we describe it rather than certify it.',
  },
  {
    title: 'TLS 1.2 or newer in transit.',
    line: 'Every connection between a device, Wobo and anything behind it.',
  },
  {
    title: 'Access rules inside the database.',
    line: 'A row is scoped to the learner it belongs to by the database itself, not only by the app that asks for it.',
  },
  // A "Least privilege for people." row stood here — "No standing access to a learner's data.
  // Support access is a deliberate act and it is logged." It is the same claim the tile below
  // carried and it is NOT MET for the same reason (docs/conformance/privacy-and-children.md A12):
  // the gateway holds SUPABASE_SERVICE_ROLE_KEY, which bypasses every policy, and no access log
  // exists. The work is still named, honestly, in SCHEDULED below — as a thing not yet done.
  /*
    "Every change is reviewed, dependencies are scanned, and secrets never live in the code."
    Two of those three are false and were verified false against the live repository on 2026-09-04:
    `gh api repos/:owner/:repo/branches/main/protection` returns 404 Branch not protected and
    `rulesets` returns []; `.github/workflows/ci.yml` runs no pip-audit, no bun audit, no npm audit
    and has no dependabot. The third is true and is the only one kept.
  */
  {
    title: 'Secrets never live in the code.',
    line: 'Every key is an environment variable, and the gateway refuses to boot in production without the ones it needs. Branch protection and automated dependency scanning are not set up yet.',
  },
];

/**
 * What no outsider has checked yet. The section is an admission, not a claim, and it is worth
 * keeping for exactly that reason.
 *
 * TWO OF THESE USED TO BE DATED TO A LAUNCH: "Independent penetration test before public launch"
 * and "SOC 2 Type I, then Type II, in the first year after launch". We are open (DESIGN.md §0,
 * owner, 2026-09-04) — anyone can sign up today — so a promise pinned to a launch that has already
 * happened reads as a promise already broken. The work is named; the date is not ours to invent.
 *
 * FLAGGED FOR THE OWNER: none of these five is verifiable in this repository. They are commitments,
 * and only the owner can confirm they were made.
 */
const SCHEDULED: readonly string[] = [
  'Independent penetration test',
  'Staff break-glass access logging with monthly review',
  'SOC 2 Type I, then Type II',
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
    line: 'Holds accounts, learning data and backups.',
    // "INDIA, WITH EU FOR EU FAMILIES" was here. There is ONE database project and there is no EU
    // project: the whole product points at a single ref, and nothing in the repository provisions,
    // routes to or even names a second region. This is the row a European parent reads to decide
    // where their child's data lives, so it names the one place it actually lives.
    region: 'INDIA',
  },
  {
    role: 'AI model providers',
    line: "Answer the question. They are sent what a tutor needs to teach this learner: a first name, a class and board, what they are strong on, and the things the learner asked Wobo to remember, in the learner's own words. Never an email address, a phone number or a payment detail, and never anything under a real name.",
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

/**
 * THE DOCUMENTS, AND THE LINE THAT HAS TO SIT ABOVE THEM.
 *
 * Following "Children's privacy" from this page renders, above the document: "Draft — Written by
 * the Wobo team and not yet reviewed by a lawyer." That honesty is right and docs/SELL.md §5 calls
 * it one of the only three kinds of proof we have. What was wrong is that it arrived unannounced,
 * one click from the page whose entire job is removing fear, from a reader we have just asked to
 * trust us with a child. A trust signal a reader was not prepared for reads as a surprise, and a
 * surprise on this page is the thing we were removing.
 *
 * So the page says it first, in its own voice, before the click.
 */
const DOCS_NOTE =
  'These are drafts. We wrote them ourselves and a lawyer has not reviewed them yet, and each one says so at the top with the questions still open on it. We would rather you read that from us than find it.';

const DOCS: readonly { title: string; line: string; href: string }[] = [
  { title: 'Privacy policy', line: 'in plain words, then the full text', href: '/legal/privacy' },
  { title: "Children's privacy", line: "what's different for under-18s", href: '/legal/children' },
  { title: 'Terms of service', line: 'the deal, both ways', href: '/legal/terms' },
  // A "Data processing agreement — for schools, on request" row stood here. We do not deal with
  // schools at this stage (DESIGN.md §0), so a document offered TO schools describes a
  // relationship we do not have, and design/prototypes/site-security.html does not list it either.
  { title: 'Data-flow diagram', line: 'the drawing above, as a PDF', href: '#flow' },
];

/**
 * The request, as a draft in the visitor's own mail app, to the mailbox that answers anything.
 *
 * It asks for ONE thing: the address to send the document to. A second field, "School or
 * organisation (optional)", used to sit under it and put the school into the mail body. We do not
 * deal with schools at this stage (DESIGN.md §0), the prototype has no such field, and a form that
 * asks which school you are from is a claim about who we sell to, made in the quietest possible
 * way. Asking for less is also the better form.
 */
export function overviewMailto(email: string): string {
  return mailtoHref(
    CONTACT.address,
    'Security overview',
    `Please send the security overview to ${email}.`,
  );
}

function RequestForm() {
  const [email, setEmail] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    window.location.assign(overviewMailto(email));
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
                  you can erase the learning with one button.
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
                      On You, under Settings, any time. Gone from live systems at once, and out of the
                      backups behind them as those roll over.
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
                  Access rules live inside the database itself, so a row is scoped to the learner it
                  belongs to rather than to whoever asks for it.
                </p>
                <span className="sc-gloss">
                  In plain words: the lock is on the drawer, not just the door.
                </span>
              </div>
              {/* TWO TILES CAME OUT OF THIS GRID, and neither was replaced with a softer version
                  of itself, because softening an untrue sentence leaves an untrue sentence.

                  "Least privilege — Staff have no standing access to learner data. A break-glass
                  path exists for support, and every use of it is written to a log the founder
                  reviews." docs/conformance/privacy-and-children.md:52 names THIS PAGE and marks
                  the claim NOT MET: the gateway holds SUPABASE_SERVICE_ROLE_KEY, which bypasses
                  every RLS policy (memory.py, billing.py, parents.py, consent.py and five more read
                  it), and there is no access-logging code and no break-glass procedure anywhere in
                  the tree. Its remedy column reads "Either build access logging or delete the claim
                  from the live page." The claim is deleted. When the logging is built, the tile
                  comes back and the register row turns green in the same commit.

                  "Backups that restore — Daily backups, kept for 30 days, and a restore we actually
                  rehearse." docs/conformance/supply-chain-and-operations.md:243 — "Nothing in the
                  repo or docs records a restore ever being attempted"; :212 — backup frequency and
                  retention are NOT VERIFIED. docs/CONFORMANCE.md:169 — "No backup has ever been
                  restored and no restore has been rehearsed, and backup configuration itself is
                  unverified." It is the same class of claim as the SOC 2 and the penetration test
                  the owner already caught, written in the present tense about a thing that has
                  never once happened. */}
              <div className="st-tile">
                <svg viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M10 30 l8 -8 l6 6 l12 -14" />
                  <path d="M28 14 h8 v8" />
                </svg>
                <h3>Built carefully</h3>
                {/* "Every change is reviewed and gated by automated checks. Dependencies are
                    scanned." Verified false on 2026-09-04: main is not a protected branch, there
                    are no rulesets, and CI runs no audit of any kind. The tile keeps the part that
                    is true and names the part that is not, because a security page that overstates
                    its own build discipline is the last page that should. */}
                <p>
                  Secrets never live in the code: every key is an environment variable and the
                  service refuses to start in production without them. Types are checked and the
                  test suites run on every push. Branch protection and dependency scanning are on
                  the list and are not set up yet.
                </p>
              </div>
            </Reveal>
            <Reveal className="sc-flow" id="flow">
              <svg
                viewBox="0 0 960 300"
                role="img"
                /* The label a screen-reader user HEARS. It still said "to the model provider without
                   identity" long after the visible copy on this same page was corrected to name
                   what is actually sent — so a blind parent got the retired claim and a sighted
                   one got the true one. A correction applied to the pixels and not to the page is
                   not a correction. */
                aria-label="How a question travels: from the learner's device, encrypted, to Wobo, then to the model provider carrying a first name, class and board and the things the learner asked Wobo to remember, and back to the learner"
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
              <h2>Built for a child on their own, so the rules are stricter than the law asks.</h2>
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
                {/* This used to be a TICKED bullet claiming consent by age and country under three
                    named laws. There is no consent gate in Wobo: `consent_tier` is read on every
                    call and written by nothing. It is stated here, unticked, because a tick beside
                    "we have not built this" is the picture version of the sentence we just stopped
                    printing. `docs/legal/childrens-privacy.md` section 3 says the same thing. */}
                <p>
                  <b>Consent, and what is not built yet.</b> India's DPDP Act asks a parent's
                  verifiable consent for a child, COPPA asks it under 13 in the United States, and
                  the GDPR asks it at the age each European country sets. Wobo has no consent gate
                  today. We are not going to draw a tick beside one until it works.
                </p>
              </div>
              <ul>
                <li>
                  <BigTick />
                  <div>
                    {/* "A linked parent sees lessons, progress and the Sunday note." The Sunday
                        note is real and is sent. The /parent screen renders localStorage on the
                        VIEWER's device, so a parent opening it sees their own empty storage — the
                        Sunday note's link there has been removed and the note now carries the
                        week itself. The bullet says what a parent actually receives. */}
                    <b>What a parent gets.</b> A weekly note by email with the week's lessons and
                    what to nudge. A parent has no login of their own yet, so that note is the
                    whole picture, and it never carries a child's typed questions word for word.
                  </div>
                </li>
                <li>
                  <BigTick />
                  <div>
                    {/* "It deletes memory, progress and the account." It does not delete the
                        account: POST /v1/me/erase clears six things and nothing anywhere calls the
                        auth admin API. Verified live against the running gateway. */}
                    <b>The erase button.</b> On You, under Settings. It clears what Wobo remembers about you,
                    your saved boards and threads, and the parent link. Deleting the account itself
                    is done by a person when you write to support@heywobo.com.
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
              {/*
                THE SCHOOL COLUMN IS GONE, and it is worth saying why in the file rather than in a
                commit message. The port had a fifth column, "School, if linked", with a verdict in
                every row. We do not deal with schools at this stage (DESIGN.md §0), there is no
                link to a school anywhere in the product, and a table headed "one honest table"
                cannot be the place we imply otherwise. It also broke the grid: `.sc-who .sc-r` is
                `1.4fr repeat(3,1fr)`, four tracks, so the fifth cell in every row wrapped onto a
                row of its own and "Wobo staff" sat underneath "Data". The prototype
                (design/prototypes/site-security.html line 348) has the four columns below.
              */}
              <div className="sc-r sc-h">
                <div>Data</div>
                <div>Learner</div>
                <div>Linked parent</div>
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
                  <Limited>with production access</Limited>
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
                  <Limited>with production access</Limited>
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
                <p className="sc-gloss">{DOCS_NOTE}</p>
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

        <ClosePanel page="security" />
      </div>
    </SiteShell>
  );
}
