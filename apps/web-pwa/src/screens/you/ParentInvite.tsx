'use client';

/**
 * "Link a parent, if you'd like." — the one form, shared by onboarding's fourth step and the
 * Parents card on the You screen (design/prototypes/onboarding-v2.html, step 4).
 *
 * An email address goes to the gateway's invite door and nothing else ever goes to that address
 * until the parent says yes. A phone number keeps the device-only link the app always had — the
 * Sunday note does not reach a phone yet, and the line under the card says so in the words it
 * always used rather than promising a message that will not come.
 */

import { type FormEvent, useRef, useState } from 'react';
import { scoped } from '../../store/scope';
import { useSdk } from '../../store/sdk';
import { inviteParent, looksLikeEmail, ownTimezone, type ParentLinkStatus } from './parentLink';
import { PARENT_KEY } from './profile';

/** The device-only phone link, as it always was. */
export const PHONE_LINK_LINE = "they'll receive the weekly note on WhatsApp when we go live";

export interface ParentInviteProps {
  /** The learner's first name, for the invite. */
  learnerName: string;
  /** The link is made, or the invite is out — the status the server (or the device) answered with. */
  onDone: (status: ParentLinkStatus) => void;
  /** "I'll do this later" */
  onLater: () => void;
  /** Read the input first, without a form around it: the You card is already a grid. */
  autoFocus?: boolean;
}

export function ParentInvite({ learnerName, onDone, onLater, autoFocus }: ParentInviteProps) {
  const sdk = useSdk();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const noteId = 'parent-address-note';

  /** One calm line, and the caret back in the field it is about. Never a silent return. */
  const refuse = (line: string) => {
    setNote(line);
    field.current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const raw = value.trim();
    if (!raw) {
      refuse("I need a parent's email or phone number to send the invite to.");
      return;
    }
    setNote(null);
    if (looksLikeEmail(raw)) {
      setBusy(true);
      const got = await inviteParent({
        email: raw,
        ...(learnerName ? { learnerName } : {}),
        ...(ownTimezone() ? { timezone: ownTimezone() } : {}),
      });
      setBusy(false);
      if (got.ok) onDone(got.status);
      else setNote(got.message);
      return;
    }
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8) {
      refuse('That number looks short. Check it once more.');
      return;
    }
    // The learner's own link (store/scope.ts); a refused write means it lives for this session.
    scoped.setItem(PARENT_KEY, JSON.stringify({ phone: raw, linkedAt: new Date().toISOString() }));
    sdk.events.record('parent.linked.v1', {
      parent_ref: crypto.randomUUID(),
      relationship: 'parent',
      channel: 'whatsapp',
    });
    onDone({ status: 'linked', parent_email: null, line: `linked · ${raw} · ${PHONE_LINK_LINE}` });
  };

  return (
    <form className="ob-parent" onSubmit={(e) => void submit(e)}>
      <div className="ob-field">
        <label htmlFor="parent-address">Parent's email or phone</label>
        <input
          id="parent-address"
          ref={field}
          value={value}
          {...(note ? { 'aria-invalid': true as const, 'aria-describedby': noteId } : {})}
          onChange={(e) => setValue(e.target.value)}
          placeholder="They get an invite, nothing else"
          autoComplete="off"
          inputMode="email"
          // biome-ignore lint/a11y/noAutofocus: the field is the step's single intention
          autoFocus={autoFocus}
        />
      </div>
      {note ? (
        <p className="ob-refuse" id={noteId} role="alert">
          {note}
        </p>
      ) : null}
      <button type="submit" className="ob-btn ob-pig" disabled={busy}>
        Send the invite
      </button>
      <button type="button" className="ob-btn ob-link" onClick={onLater}>
        I'll do this later
      </button>
    </form>
  );
}
