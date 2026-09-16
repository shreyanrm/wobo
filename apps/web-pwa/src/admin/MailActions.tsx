/**
 * The mail desk's one control: lift the deliverability watch's pause on one kind.
 *
 * OWNER ONLY. `POST /v1/admin/mail/unpause` needs `admin.manage`, which only the owner carries and
 * which the guard asks a step-up for. Console.tsx mounts this only for that seat; the gateway
 * refuses everyone else whatever this bundle draws.
 *
 * IT ASKS TWICE. A lifted pause sends that kind to every family again on the next pass, so the
 * button is behind a confirmation, and nothing is offered that is not paused.
 *
 * THE NOTE GOES INTO THE TRAIL. `ops.settings_audit` records the owner and the note beside the
 * change; "what was fixed" is the sentence a later reader will want.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT, as on every other desk: a refusal is printed in the
 * gateway's own words.
 */

import { useState } from 'react';
import { FAILURE_COPY, write } from './api';
import { isMailDesk, type MailDesk, pausedKinds } from './mail';

export function MailActions({ desk, onLifted }: { desk: MailDesk | null; onLifted: () => void }) {
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const paused = pausedKinds(desk);
  if (paused.length === 0) return null;

  async function lift() {
    if (!kind) return;
    if (
      !window.confirm(
        `Lift the pause on ${kind}? Every family it is due to goes back to getting it on the next pass.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setSaid('');
    const result = await write('mailUnpause', { kind, note: note.trim() || undefined }, isMailDesk);
    setBusy(false);
    if (!result.ok) {
      setSaid(`Not lifted: ${FAILURE_COPY[result.reason]}.`);
      return;
    }
    setSaid(`Lifted. ${kind} goes out again from the next pass, judged only on what happens now.`);
    setKind('');
    setNote('');
    onLifted();
  }

  return (
    <section className="ac-panel">
      <span className="ac-panel-label">Lift a pause</span>
      <p className="ac-note">
        Owner only. Fix the cause first: the copy, the audience, the timing. A sender change is a
        manual setting and is never made here.
      </p>

      <label className="ac-field">
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">choose a paused kind</option>
          {paused.map((name) => (
            <option value={name} key={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="ac-field">
        <span>What was fixed (goes into the trail)</span>
        <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
      </label>

      <div className="ac-actions">
        <button type="button" disabled={!kind || busy} onClick={() => void lift()}>
          Lift the pause
        </button>
      </div>

      {said && <p className="ac-note">{said}</p>}
    </section>
  );
}
