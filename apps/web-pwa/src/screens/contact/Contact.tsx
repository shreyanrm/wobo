'use client';

/**
 * `/contact` — where a person writes to a person, and the one place the addresses are listed.
 *
 * There is no message endpoint. The gateway's only mail route is an internal one, guarded by a
 * shared key a browser must never hold, so a form here would have nowhere to post to. Rather than
 * build a form that quietly goes nowhere — the single most common lie a contact page tells — the
 * fields compose a message and hand it to the learner's own email app, and the page says exactly
 * that in one line above the button. Every mailbox is printed as well, so somebody whose device has
 * no mail app set up can still copy one.
 *
 * `/legal/contact` is an alias of this address (`legal/Legal.tsx`), so the mailbox list lives here
 * once and every page that names an address links to the same one.
 */

import { useMemo, useState } from 'react';
import { Label } from '../../ui/primitives';
import { CONTACT } from '../auth/copy';
import { ClosePanel } from '../site/ClosePanel';
import { COMPANY, MAILBOXES, OPEN_TERMS, POSTAL_ADDRESS } from '../site/identity';
import { Reveal } from '../site/Reveal';
import { SiteShell } from '../site/SiteShell';

/** The message, as an address the learner's own mail app understands. */
export function mailtoHref(to: string, subject: string, body: string): string {
  const query = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
  return `mailto:${to}?${query}`;
}

export function Contact() {
  const [reason, setReason] = useState<string>(CONTACT.reasons[0] as string);
  const [message, setMessage] = useState('');
  const href = useMemo(() => mailtoHref(CONTACT.address, reason, message), [reason, message]);

  return (
    <SiteShell current="contact" title="Contact · Wobo" label={CONTACT.title}>
      <section className="st-page-hero">
        <div className="st-wrap">
          <Label>{CONTACT.eyebrow}</Label>
          <h1>{CONTACT.title}</h1>
          <span className="hand">{CONTACT.hand}</span>
          <p className="st-sub">{CONTACT.body}</p>
        </div>
      </section>

      <section className="st-section" style={{ paddingTop: 0 }}>
        <div className="st-wrap">
          <div className="ct-grid">
            <Reveal className="ct-form">
              <div className="st-field">
                <label htmlFor="wc-reason">{CONTACT.subject}</label>
                <select id="wc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {CONTACT.reasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="wc-message">{CONTACT.message}</label>
                <textarea
                  id="wc-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <p className="st-hint">{CONTACT.mailtoNote}</p>
              <div className="st-row">
                <a className="st-btn st-pig" href={href}>
                  {CONTACT.send}
                </a>
              </div>
            </Reveal>

            <Reveal as="section" className="ct-aside">
              <h2>Every mailbox</h2>
              <div className="ct-boxes">
                {MAILBOXES.map((box) => (
                  <div className="ct-box" key={box.address}>
                    <a href={`mailto:${box.address}`}>{box.address}</a>
                    <span>{box.what}</span>
                  </div>
                ))}
              </div>
              <p className="st-hint">
                {OPEN_TERMS.length > 0
                  ? `A postal address and a registered company name belong here too. Neither is settled yet (${OPEN_TERMS.join(' and ')}), and the legal set shows both as blanks rather than printing something we would have to correct.`
                  : `${COMPANY}, ${POSTAL_ADDRESS}. Post reaches us there; email reaches us faster.`}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <ClosePanel page="contact" />
    </SiteShell>
  );
}
