/**
 * The owner's hand on the register: invite a person, shape what each person holds, send a fresh
 * link, suspend. The console's only screen that changes who can see anything.
 *
 * THE LAW (docs/CONSOLE-ROLES-AND-BOARD.md §2 and the 2026-09-15 section), and what each part of
 * this component does about it:
 *
 * ADDING A PERSON IS THE OWNER'S ACTION ALONE: an email, a role to start from, and the
 * capabilities. The form starts the grid at the role's defaults and sends only what differs, as
 * grants and revocations, so the register row says exactly what the owner chose by hand.
 *
 * THE INVITATION IS A LINK, AND NOTHING HERE SENDS IT. The gateway answers with the link and the
 * message; this screen shows them once, with copy buttons, and says plainly that nothing was sent.
 * The link is never stored in this bundle and never read back.
 *
 * THE SCREEN SHOWS THE EFFECTIVE SET. Each cell is what the person holds now, with where it came
 * from beside it, and one press is one change with a row in the trail. The owner's own row has no
 * controls: nobody hollows that seat out, the owner included.
 *
 * SUSPENDING IS INSTANT AND ENDS THEIR SESSIONS, and it asks first.
 *
 * A write is never retried and never silent. The gateway's refusal code is turned into a sentence
 * here; its own message is not shown, because a proxy could put words there.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, write } from './api';
import type { AdminIdentity } from './contract';
import {
  cellOf,
  changeFor,
  type Invitation,
  isInvitationAnswer,
  isSeatAnswer,
  type Register,
  type RegisterSeat,
  ROLE_WORDS,
  SOURCE_WORDS,
  seatPath,
  stamp,
  startingSet,
  stateWords,
} from './register';

/** The roles a person may start from. The owner is never granted from this screen. */
const STARTING_ROLES = ['viewer', 'operator'] as const;

const REFUSED: Record<string, string> = {
  reauth_required:
    'Confirm it is you first. Sign out, open the console again with your code, and make the ' +
    'change straight away.',
  already_invited: 'This address is already invited. Send a fresh link from its row instead.',
  already_seated: 'This address already has a seat. Change what it holds from its row.',
  invitation_unavailable:
    'This gateway cannot make an invitation link yet. It needs CONSOLE_URL and a signing key.',
  not_a_grant: 'That address and role were not accepted. Check the address.',
  one_owner: 'There is one owner account, and it is not granted from here.',
  not_the_owners: 'The owner’s seat cannot be changed from here.',
  not_an_invitation: 'This seat has already been taken, so there is no link to send.',
  no_such_admin: 'That person is no longer in the register.',
  register_unavailable: 'The register could not be reached. Nothing has changed.',
};

function refusal(result: Extract<Fetched<unknown>, { ok: false }>, what: string): string {
  const said = result.code ? REFUSED[result.code] : undefined;
  return `${what}. ${said ?? `The gateway said: ${FAILURE_COPY[result.reason]}.`}`;
}

function copy(text: string, done: (said: string) => void) {
  if (!navigator.clipboard) {
    done('This browser will not copy for you. Select the text and copy it.');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => done('Copied.'),
    () => done('This browser will not copy for you. Select the text and copy it.'),
  );
}

function InvitationBox({ invitation }: { invitation: Invitation }) {
  const [said, setSaid] = useState('');
  return (
    <div className="ar-invite" role="status">
      <p className="ar-invite-head">
        Nothing has been sent. Copy this and send it from your own mail to{' '}
        <strong>{invitation.to}</strong>.
      </p>
      <p className="aq-said">
        This link is shown once here. It works until {stamp(invitation.expires_at)}.
      </p>
      <label className="aq-field aq-wide">
        <span>Subject</span>
        <input type="text" readOnly value={invitation.mail.subject} />
      </label>
      <label className="aq-field aq-wide">
        <span>Link</span>
        <input type="text" readOnly value={invitation.link} onFocus={(e) => e.target.select()} />
      </label>
      <label className="aq-field aq-wide">
        <span>Message</span>
        <textarea readOnly rows={9} value={invitation.mail.text} className="ar-message" />
      </label>
      <div className="aq-line">
        <button className="aq-do" type="button" onClick={() => copy(invitation.link, setSaid)}>
          Copy the link
        </button>
        <button
          className="aq-quiet"
          type="button"
          onClick={() => copy(invitation.mail.text, setSaid)}
        >
          Copy the message
        </button>
        {said && <span className="aq-said">{said}</span>}
      </div>
    </div>
  );
}

function Grid({
  register,
  held,
  onPress,
  busy,
  label,
}: {
  register: Register;
  held: (capability: string) => { on: boolean; note: string };
  onPress: ((capability: string) => void) | null;
  busy: boolean;
  label: string;
}) {
  return (
    <div className="ac-scroll">
      <table className="ac-table ar-grid" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Desk</th>
            <th scope="col">See it</th>
            <th scope="col">Act on it</th>
          </tr>
        </thead>
        <tbody>
          {register.vocabulary.map((entry) => (
            <tr key={entry.id}>
              <th scope="row" className="ar-desk">
                {entry.name}
              </th>
              {[entry.read, entry.act].map((capability, side) => {
                const cell = held(capability);
                const verb = side === 0 ? 'see' : 'act on';
                return (
                  <td key={capability}>
                    {onPress ? (
                      <button
                        type="button"
                        className="ar-cell"
                        aria-pressed={cell.on}
                        disabled={busy}
                        aria-label={`${cell.on ? 'Can' : 'Cannot'} ${verb} ${entry.name}${cell.note ? `, ${cell.note}` : ''}`}
                        onClick={() => onPress(capability)}
                      >
                        <span className="ar-mark" aria-hidden="true" />
                        <span>{cell.on ? 'Yes' : 'No'}</span>
                        {cell.note && <span className="ar-note">{cell.note}</span>}
                      </button>
                    ) : (
                      <span className="ar-cell" data-on={cell.on}>
                        <span className="ar-mark" aria-hidden="true" />
                        <span>{cell.on ? 'Yes' : 'No'}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegisterActions({
  admin,
  register,
  onChanged,
}: {
  admin: AdminIdentity;
  register: Register | null;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('viewer');
  const [chosenCaps, setChosenCaps] = useState<string[] | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [chosen, setChosen] = useState('');
  const [latest, setLatest] = useState<RegisterSeat | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [addSaid, setAddSaid] = useState('');

  if (!register) return null;

  const defaults = startingSet(register, role);
  const caps = chosenCaps ?? defaults;
  const listed = register.admins.find((seat) => seat.id === chosen) ?? null;
  // The answer to the last change is fresher than the list until the list is read again.
  const seat = latest && latest.id === chosen ? latest : listed;

  async function invite() {
    setBusy(true);
    setAddSaid('');
    setInvitation(null);
    const changes = register
      ? register.vocabulary
          .flatMap((entry) => [entry.read, entry.act])
          .filter((capability) => caps.includes(capability) !== defaults.includes(capability))
          .map((capability) => ({
            capability,
            effect: caps.includes(capability) ? 'grant' : 'revoke',
          }))
      : [];
    const result = await write(
      'admins',
      { email: email.trim(), role, capabilities: changes },
      isInvitationAnswer,
    );
    setBusy(false);
    if (!result.ok) {
      setAddSaid(refusal(result, 'Nobody was added'));
      return;
    }
    setInvitation(result.value.invitation);
    setEmail('');
    setChosenCaps(null);
    onChanged();
  }

  async function press(capability: string) {
    if (!seat) return;
    const path = seatPath(seat.id, 'capabilities');
    if (!path) return;
    const effect = changeFor(cellOf(seat, capability));
    setBusy(true);
    setSaid('');
    const result = await write(
      'admins',
      { capability, effect },
      isSeatAnswer,
      undefined,
      'POST',
      path,
    );
    setBusy(false);
    if (!result.ok) {
      setSaid(refusal(result, 'Not changed'));
      return;
    }
    setLatest(result.value.admin);
    setSaid('Changed. It is in the trail, and it holds on their next request.');
    onChanged();
  }

  async function renew() {
    if (!seat) return;
    const path = seatPath(seat.id, 'invitation');
    if (!path) return;
    setBusy(true);
    setSaid('');
    setInvitation(null);
    const result = await write('admins', undefined, isInvitationAnswer, undefined, 'POST', path);
    setBusy(false);
    if (!result.ok) {
      setSaid(refusal(result, 'No fresh link was made'));
      return;
    }
    setLatest(result.value.admin);
    setInvitation(result.value.invitation);
    setSaid('The old link has stopped working.');
    onChanged();
  }

  async function suspend() {
    if (!seat || !sure) return;
    const path = seatPath(seat.id, 'suspend');
    if (!path) return;
    setBusy(true);
    setSaid('');
    const result = await write('admins', undefined, isSeatAnswer, undefined, 'POST', path);
    setBusy(false);
    setSure(false);
    if (!result.ok) {
      setSaid(refusal(result, 'Not suspended'));
      return;
    }
    setLatest(result.value.admin);
    setSaid(`${result.value.admin.email} is suspended. Every session they had has ended.`);
    onChanged();
  }

  const isOwnerRow = seat?.role === 'owner';
  const isMe = seat?.id === admin.id;
  const addressLooksRight = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <>
      <section className="ac-panel aq" aria-label="Invite a person">
        <span className="ac-panel-label">Invite a person</span>
        <p className="aq-said">
          They get a link that works once, for this address only. Their seat opens after they sign
          in with a second factor.
        </p>
        <div className="aq-line">
          <label className="aq-field">
            <span>Their work email</span>
            <input
              type="email"
              autoComplete="off"
              value={email}
              maxLength={320}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="aq-field">
            <span>Start them as</span>
            <select
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setChosenCaps(null);
              }}
            >
              {STARTING_ROLES.map((one) => (
                <option key={one} value={one}>
                  {ROLE_WORDS[one]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Grid
          register={register}
          label="What the new person can see and act on"
          busy={busy}
          held={(capability) => {
            const on = caps.includes(capability);
            const moved = on !== defaults.includes(capability);
            return { on, note: moved ? (on ? 'added' : 'taken away') : '' };
          }}
          onPress={(capability) =>
            setChosenCaps(
              caps.includes(capability)
                ? caps.filter((one) => one !== capability)
                : [...caps, capability],
            )
          }
        />
        <div className="aq-line">
          <button
            className="aq-do"
            type="button"
            disabled={busy || !addressLooksRight}
            onClick={() => void invite()}
          >
            {busy ? 'Working' : 'Make the invitation'}
          </button>
          {addSaid && <span className="aq-said">{addSaid}</span>}
        </div>
        {invitation && !seat && <InvitationBox invitation={invitation} />}
      </section>

      <section className="ac-panel aq" aria-label="One person">
        <span className="ac-panel-label">One person</span>
        <label className="aq-field aq-wide">
          <span>Who</span>
          <select
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
              setLatest(null);
              setSaid('');
              setSure(false);
              setInvitation(null);
            }}
          >
            <option value="">choose a person</option>
            {register.admins.map((one) => (
              <option key={one.id} value={one.id}>
                {one.email}, {ROLE_WORDS[one.role] ?? one.role}, {stateWords(one).text}
              </option>
            ))}
          </select>
        </label>

        {seat && isOwnerRow && (
          <p className="aq-said">
            The owner holds every desk, and that cannot be changed from here by anyone.
          </p>
        )}

        {seat && !isOwnerRow && (
          <>
            <p className="aq-said">
              Started as {ROLE_WORDS[seat.role] ?? seat.role}. What you see below is what they hold
              now. Press a cell to change it.
            </p>
            <Grid
              register={register}
              label={`What ${seat.email} can see and act on`}
              busy={busy || seat.status === 'suspended'}
              held={(capability) => {
                const cell = cellOf(seat, capability);
                return {
                  on: cell.held,
                  note: cell.source === 'role' ? '' : SOURCE_WORDS[cell.source],
                };
              }}
              onPress={seat.status === 'suspended' ? null : (capability) => void press(capability)}
            />
            <div className="aq-line">
              {seat.status === 'invited' && (
                <button
                  className="aq-quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void renew()}
                >
                  Make a fresh link
                </button>
              )}
              {seat.status !== 'suspended' && !isMe && (
                <>
                  <label className="aq-confirm">
                    <input
                      type="checkbox"
                      checked={sure}
                      onChange={(event) => setSure(event.target.checked)}
                    />
                    <span>
                      Suspend {seat.email}. Their sessions end now, and they cannot sign in again
                      unless you invite them again.
                    </span>
                  </label>
                  <button
                    className="aq-quiet"
                    type="button"
                    disabled={busy || !sure}
                    onClick={() => void suspend()}
                  >
                    Suspend
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {said && <p className="aq-said">{said}</p>}
        {invitation && seat && <InvitationBox invitation={invitation} />}
      </section>
    </>
  );
}
