'use client';

/**
 * `/parent/refer`: the parent's own invitation, to pass on to another family.
 *
 * WHAT EXISTS, and this screen uses it as it is. `store/referral.ts` is the only place an invite
 * link is built: the code is derived from the ACCOUNT (the signed-in subject), so this parent's code
 * is the same on every phone and says nothing about who they are, and nothing about any child. The
 * gateway has no referral route at all, so nothing is credited, rewarded or counted, and the screen
 * promises none of that. It is a link to hand on, said plainly.
 */

import { useMemo, useState } from 'react';
import { useRouter } from '../../shell/router';
import { inviteLink, referralCode } from '../../store/referral';
import { Label } from '../../ui/primitives';
import { PAY_COPY, REFER_COPY } from './pay-copy';
import './parent-pay.css';

/** The origin the link is built on: this app's own, which is where the invitation should land. */
function origin(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return env.VITE_APP_URL ?? '';
}

export function ReferFamily() {
  const router = useRouter();
  const code = useMemo(() => referralCode(), []);
  const link = useMemo(() => inviteLink(origin(), 'parent', code), [code]);
  const [said, setSaid] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setSaid(REFER_COPY.copied);
    } catch {
      setSaid(REFER_COPY.copyFailed);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ text: REFER_COPY.shareText, url: link });
    } catch {
      // Closing the share sheet is not a failure worth a sentence.
    }
  };

  return (
    <section className="pp" aria-labelledby="pr-title">
      <button type="button" className="pp-back" onClick={() => router.navigate({ name: 'parent' })}>
        {PAY_COPY.back}
      </button>
      <header className="pp-head">
        <Label>{REFER_COPY.eyebrow}</Label>
        <h1 id="pr-title" className="pp-title">
          {REFER_COPY.title}
        </h1>
        <p className="pp-now">{REFER_COPY.lede}</p>
      </header>
      <div className="pp-card">
        <dl className="pp-rows">
          <div className="pp-row">
            <dt>{REFER_COPY.code}</dt>
            <dd className="pp-code">{code}</dd>
          </div>
          <div className="pp-row pp-linkrow">
            <dt>{REFER_COPY.link}</dt>
            <dd>
              <a className="pp-link" href={link}>
                {link}
              </a>
            </dd>
          </div>
        </dl>
        <div className="pp-acts">
          <button type="button" className="wk-btn wk-pig" onClick={() => void copy()}>
            {REFER_COPY.copy}
          </button>
          {canShare ? (
            <button type="button" className="wk-btn wk-quiet" onClick={() => void share()}>
              {REFER_COPY.share}
            </button>
          ) : null}
        </div>
        {said ? (
          <p className="pp-status" role="status" aria-live="polite">
            {said}
          </p>
        ) : null}
      </div>
    </section>
  );
}
