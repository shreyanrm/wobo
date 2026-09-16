/**
 * The board-change desk's controls (docs/CONSOLE-ROLES-AND-BOARD.md §1).
 *
 * GRANT is Support work: `panel.boards.act`, which an operator holds by default and the owner may
 * give or take per person, and the guard asks the step-up it asks of every write. The button is
 * drawn only for a seat that holds it (`mayGrant`): a button the gateway refuses is not a control. One button per waiting request. Granting hands the learner
 * their change back, writes the audit row, and the product tells them it is done.
 *
 * THE DIALS are the owner's: `admin.manage`. How many changes before a person is needed, whether
 * a parent's change counts, and which cohorts the rule is off for. The note goes into the trail.
 *
 * A write is never retried and never silent: a refusal is printed in this console's own words.
 */

import { useState } from 'react';
import { FAILURE_COPY, write } from './api';
import { type BoardChangeDesk, type BoardRequest, grantable, parseCohorts } from './boardChanges';

/** Under the parent dial while the gateway says no parent can change a board yet. */
export const PARENT_DIAL_IDLE =
  'No parent can change a board yet, so this has no effect until that is built.';

const isGranted = (body: unknown): body is BoardRequest =>
  Boolean(body && typeof (body as BoardRequest).id === 'string');

const isSaved = (body: unknown): body is { saved: boolean } =>
  Boolean(body && typeof (body as { saved?: unknown }).saved === 'boolean');

export function BoardChangeActions({
  desk,
  mayGrant,
  mayTurn,
  onChanged,
}: {
  desk: BoardChangeDesk | null;
  mayGrant: boolean;
  mayTurn: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const waiting = mayGrant ? grantable(desk) : [];

  async function grant(row: BoardRequest) {
    const move = `${row.current.framework_id ?? 'unknown'} to ${row.wanted.framework_id ?? 'unknown'}`;
    if (!window.confirm(`Grant ${row.handle} a board change (${move})?`)) return;
    setBusy(true);
    setSaid('');
    const result = await write('boardChangeGrant', { id: row.id }, isGranted);
    setBusy(false);
    if (!result.ok) {
      setSaid(`Not granted: ${FAILURE_COPY[result.reason]}.`);
      return;
    }
    setSaid(`Granted. ${row.handle} can change their board again from Settings.`);
    onChanged();
  }

  return (
    <>
      {waiting.length > 0 && (
        <section className="ac-panel">
          <span className="ac-panel-label">Grant a change</span>
          <p className="ac-note">
            Granting lets them change their board once more from Settings. It does not move the
            board for them.
          </p>
          <div className="ac-actions" style={{ flexWrap: 'wrap' }}>
            {waiting.map((row) => (
              <button
                className="aq-do"
                type="button"
                key={row.id}
                disabled={busy}
                onClick={() => void grant(row)}
              >
                Grant {row.handle}: {row.current.framework_id ?? 'unknown'} to{' '}
                {row.wanted.framework_id ?? 'unknown'}
              </button>
            ))}
          </div>
          {said && (
            <p className="ac-note" role="status">
              {said}
            </p>
          )}
        </section>
      )}
      {mayTurn && desk?.dials && (
        <BoardDialsForm key={JSON.stringify(desk.dials)} desk={desk} onSaved={onChanged} />
      )}
    </>
  );
}

function BoardDialsForm({ desk, onSaved }: { desk: BoardChangeDesk; onSaved: () => void }) {
  const dials = desk.dials;
  const [free, setFree] = useState(String(dials?.free_changes ?? 1));
  const [parent, setParent] = useState(dials?.parent_change_counts ?? true);
  const [off, setOff] = useState((dials?.rule_off_for ?? []).join(', '));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  async function save() {
    const changes = Number(free);
    if (!Number.isInteger(changes) || changes < 0 || changes > 100) {
      setSaid('Changes before a person is needed is a whole number from 0 to 100.');
      return;
    }
    setBusy(true);
    setSaid('');
    const result = await write(
      'boardChangeDials',
      {
        free_changes: changes,
        parent_change_counts: parent,
        rule_off_for: parseCohorts(off),
        note: note.trim() || undefined,
      },
      isSaved,
    );
    setBusy(false);
    if (!result.ok) {
      setSaid(
        result.reason === 'gateway_error'
          ? 'Not saved: the gateway refused it. Check each cohort is everyone, board:<id> or plan:<plan>.'
          : `Not saved: ${FAILURE_COPY[result.reason]}.`,
      );
      return;
    }
    setSaid('Saved. The gateway follows it within thirty seconds.');
    setNote('');
    onSaved();
  }

  return (
    <section className="ac-panel">
      <span className="ac-panel-label">Turn the rule</span>
      <p className="ac-note">
        Owner only. Every turn is kept in the settings trail with your note.
      </p>
      <label className="ac-field">
        <span>Changes before a person is needed</span>
        <input inputMode="numeric" value={free} onChange={(event) => setFree(event.target.value)} />
      </label>
      <label className="ac-field">
        <span>A parent’s change counts against the learner’s</span>
        <input
          type="checkbox"
          checked={parent}
          onChange={(event) => setParent(event.target.checked)}
        />
      </label>
      {desk.parent_changes_possible === false ? (
        <p className="ac-note">{PARENT_DIAL_IDLE}</p>
      ) : null}
      <label className="ac-field">
        <span>Rule off for (everyone, board:&lt;id&gt;, plan:&lt;plan&gt;, comma separated)</span>
        <input value={off} onChange={(event) => setOff(event.target.value)} />
      </label>
      <label className="ac-field">
        <span>Why (goes into the trail)</span>
        <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="ac-actions">
        <button className="aq-do" type="button" disabled={busy} onClick={() => void save()}>
          Save the rule
        </button>
      </div>
      {said && (
        <p className="ac-note" role="status">
          {said}
        </p>
      )}
    </section>
  );
}
