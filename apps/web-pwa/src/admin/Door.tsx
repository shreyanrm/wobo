/**
 * The door. The product's own sign-in, the second factor, and then the register.
 *
 * Nothing here decides anything. It runs the sign-in `admin_auth.py` says it should run
 * (`productSignIn.ts`), posts the result to the guard, and renders whatever the guard says. There
 * is no local account list, no client-side check of a password, and no "admin" value anywhere in
 * this bundle that could be flipped.
 *
 * The guard shows a stranger the same body a missing page shows — the existence of a console is
 * itself information — so this screen cannot tell "you are not in the register" from "the console
 * is not deployed here", and it says both rather than guessing one. Naming which of the email,
 * the password or the code was wrong is likewise never done: that is a gift to whoever is guessing.
 *
 * The pause below is a courtesy, not a control, and it says so on the screen: the limit that
 * matters is `admin_auth`'s own login bucket, keyed by account AND by machine, where it cannot be
 * edited by whoever is holding the browser.
 */

import { type FormEvent, useState } from 'react';
import { LOCK_COPY, type LockReason, type Session, signIn } from './session';

/** After this many refusals the button rests, so a slipped keyboard does not become a burst. */
const COOL_OFF_AFTER = 5;
const COOL_OFF_MS = 30_000;

export function Door({
  why,
  onOpen,
}: {
  why: LockReason | null;
  onOpen: (session: Session) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const [restingUntil, setRestingUntil] = useState(0);
  const [said, setSaid] = useState<LockReason | null>(why);

  const resting = Date.now() < restingUntil;
  /** Nothing to sign in to, or nothing answering. Then the form is pointless and saying so is
   *  the useful act — an operator staring at "that did not sign you in" for an hour is the
   *  failure this block exists to prevent. */
  const nothingToSignInTo =
    said === 'unconfigured' || said === 'unreachable' || said === 'guard_unreachable';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || resting) return;
    setBusy(true);
    const session = await signIn({ email, password, code });
    setBusy(false);
    if (session.state === 'open') {
      onOpen(session);
      return;
    }
    // `signIn` only ever returns open or locked; 'checking' belongs to the first frame of the
    // root and cannot arrive here. Narrowed rather than cast, so the day a third state appears
    // this stops compiling instead of silently reading undefined.
    const why = session.state === 'locked' ? (session.why ?? 'refused') : 'guard_error';
    setSaid(why);
    // The code is always cleared; a TOTP code is single-use and re-submitting one wastes a window.
    setCode('');
    // The password is cleared on anything that is not simply "we need the code", so an operator
    // who has typed it correctly is not made to type it again for a second attempt at the code.
    if (why !== 'code_required') setPassword('');
    const next = refusals + 1;
    setRefusals(next);
    if (next >= COOL_OFF_AFTER) {
      setRestingUntil(Date.now() + COOL_OFF_MS);
      setRefusals(0);
    }
  }

  return (
    <div className="ac-door">
      <div className="ac-door-card">
        <h1>Wobo console</h1>
        <p className="ac-door-sub">
          Operator access. Every sign-in and every screen opened here is written to a trail that
          cannot be edited or deleted, including this attempt.
        </p>

        {said && (
          <div className={nothingToSignInTo ? 'ac-diag' : 'ac-refused'}>
            <p>{LOCK_COPY[said]}</p>
            {nothingToSignInTo && (
              <p>
                <strong>What would fix it:</strong> a reachable gateway and account service at the
                addresses this build points at. Until they answer, this console lets nobody in,
                which is the only safe way for it to be wrong.
              </p>
            )}
          </div>
        )}

        <form className="ac-form" onSubmit={submit}>
          <div className="ac-field">
            <label htmlFor="ac-email">Work email</label>
            <input
              id="ac-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="ac-field">
            <label htmlFor="ac-password">Password</label>
            <input
              id="ac-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="ac-field">
            <label htmlFor="ac-code">Authenticator code</label>
            <input
              id="ac-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button className="ac-go" type="submit" disabled={busy || resting}>
            {resting ? 'Wait a moment' : busy ? 'Checking' : 'Open the console'}
          </button>
        </form>

        <p className="ac-door-sub">
          The limit that matters is on the server, keyed to both the account and the machine. The
          pause here after a few wrong answers only keeps a slipped keyboard from becoming a burst.
        </p>
      </div>
    </div>
  );
}
