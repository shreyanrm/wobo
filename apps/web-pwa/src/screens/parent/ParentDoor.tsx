'use client';

/**
 * THE PARENT'S DOOR, and the frame every other moment before the parent's home stands in.
 *
 * It is one of the doors, so it wears the doors' own sheet and layout (screens/auth): Wobo and what
 * Wobo says on the left, the thing you do on the right, stacking below 900px. It reads the same
 * ONE auth client the learner doors read, and draws only what that client can really do.
 *
 * ONE WAY IN, AND WHY. A child links a parent by inviting an EMAIL ADDRESS, and the gateway finds a
 * parent's children by the keyed digest of the address on their verified, confirmed token
 * (parent_api.py `_address_is_confirmed`). A Google account carries a confirmed address. A phone
 * number carries none, so a parent who signed in by phone could never be matched to an invite, and
 * the server refuses that sign-up outright. The door therefore offers the way in that can find a
 * child, says why in one line, and does not draw a phone field that would end in a refusal.
 *
 * WHAT PRESSING IT DOES. It writes down that the parent's door was pressed (device.ts), then leaves
 * for the provider with this address as the way back. On the far side the parent's host asks the
 * server who this is, and only because this door was pressed does it make the account a parent's.
 *
 * THE DIAL. While new accounts are closed (docs/DOORS-CLOSED.md) the door still signs an existing
 * parent in, and says plainly that new parent accounts are not open; the list lives where the
 * learner's sign-up door sends people.
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSdk } from '../../store/sdk';
import { WoboHead, Wordmark } from '../../ui/primitives';
import { ProviderButton } from '../auth/Auth';
import { callSeam, liveSeams, methodStates } from '../auth/client';
import { CONSENT, DOOR_LEGAL, ERRORS, NO_WAY_IN } from '../auth/copy';
import { waysIn } from '../auth/doors';
import { ensureAuthStyles } from '../auth/styles';
import { useDoorsOpen } from '../site/dial';
import { LIST } from '../site/invitation';
import { SiteLink } from '../site/nav';
import { DOOR } from './copy';
import { pressParentDoor } from './device';

ensureAuthStyles();

/** The door's frame: the bar, Wobo's side and the action side. Every pre-home stage uses it. */
export function DoorFrame({
  title,
  lede,
  busy,
  children,
}: {
  title: string;
  lede: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = `${DOOR.tab} · Wobo`;
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <div className="au">
      <a className="au-skip" href="#au-main">
        Skip to the page
      </a>
      <div className="au-top">
        <div className="au-wrap">
          <SiteLink to={{ name: 'landing' }} className="au-mark" aria-label="Wobo, the front page">
            <Wordmark />
          </SiteLink>
          <SiteLink to={{ name: 'sign-in' }} className="au-other">
            <span className="au-lead">{DOOR.learnerPrompt}</span>
            <b>{DOOR.learnerAction}</b>
          </SiteLink>
        </div>
      </div>
      <main className="au-body" id="au-main" aria-label={DOOR.tab} aria-busy={busy || undefined}>
        <div className="au-wrap">
          <div className="au-grid">
            <div className="au-say">
              <div className="au-who">
                <WoboHead
                  className="au-face"
                  size={84}
                  shadow
                  mood={busy ? 'thinking' : 'greeting'}
                />
                <span className="au-bubble">{DOOR.hand}</span>
              </div>
              <h1>{title}</h1>
              <p className="au-lede" role={busy ? 'status' : undefined}>
                {lede}
              </p>
            </div>
            <div className="au-act">{children}</div>
          </div>
          {/* The parent's action column is short, so the grid ends at the lede; the legal line
              keeps a clear gap from it rather than sitting under the last sentence. */}
          <p className="au-legal" style={{ marginTop: 'var(--s6)' }}>
            {DOOR_LEGAL.lead} <a href={CONSENT.termsHref}>{DOOR_LEGAL.terms}</a> {DOOR_LEGAL.and}{' '}
            <a href={CONSENT.privacyHref}>{DOOR_LEGAL.privacy}</a>.
          </p>
        </div>
      </main>
    </div>
  );
}

export function ParentDoor() {
  const sdk = useSdk();
  const open = useDoorsOpen();
  const seams = useMemo(
    () =>
      liveSeams({
        account: sdk.account as unknown as Record<string, unknown> | null,
        identityAuth: sdk.identity.auth as unknown as Record<string, unknown> | null,
        devAuth: sdk.config.devAuth,
      }),
    [sdk],
  );
  const states = useMemo(() => methodStates(seams), [seams]);
  const google = useMemo(() => {
    const door = waysIn(states).providers.find((p) => p.name === 'google');
    const seam = states.find((s) => s.name === 'google')?.seam ?? null;
    return door?.status === 'open' && seam ? seam : null;
  }, [states]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    if (!google || busy || typeof window === 'undefined') return;
    setBusy(true);
    setError(null);
    pressParentDoor();
    // The way back is the parent's own address, so the far side is the parent's host and never
    // the learner's setup.
    const back = `${window.location.origin}/parent`;
    callSeam(seams, google, back).catch((err: unknown) => {
      console.error('parent sign-in failed', err);
      setError(
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? ERRORS.offline
          : ERRORS.unknown,
      );
      setBusy(false);
    });
  };

  return (
    <DoorFrame title={DOOR.title} lede={open ? DOOR.lede : DOOR.closedLede}>
      {google ? (
        <>
          <ProviderButton name="google" open busy={busy} onSelect={go} />
          <p className="au-fine">{DOOR.whyEmail}</p>
          {error ? (
            <p className="au-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <p className="au-fine">{NO_WAY_IN}</p>
      )}
      {open ? null : (
        <SiteLink to={{ name: 'sign-up' }} className="au-btn au-quiet">
          {LIST.label}
        </SiteLink>
      )}
    </DoorFrame>
  );
}
