/**
 * Working the queue: the only place in this console that changes anything.
 *
 * The four desks READ by default (`queues.ts` is pure and fetches nothing). This is the strip
 * underneath them, and everything about its shape is a security decision rather than a layout one:
 *
 * ONE REPORT AT A TIME, CHOSEN EXPLICITLY. There is no "close all", no multi-select, no bulk verb.
 * A queue over children's reports is worked one row at a time by a person who has read the row,
 * and a control that can close forty at once is a control that will one day close a flag nobody
 * read.
 *
 * THE SECOND CONFIRMATION IS WHERE THE MONEY IS. Settling a refund request means somebody is about
 * to move a charge, or has decided not to. That, and only that, asks for a confirmation and a
 * sentence saying what was done — the gateway refuses it otherwise (409 `confirm_required`), and
 * this form asks for both BEFORE it sends so the operator meets the question rather than an error.
 * Nothing else on these desks asks twice: a console that asks on every row trains a person to
 * click through it, and then the one that mattered gets clicked through too.
 *
 * IDENTITY IS A DELIBERATE ACT, AND IT IS RECORDED. "Who raised this" is a button. It is only
 * offered on a refund or a support message — the two that cannot be worked without knowing which
 * account or where to reply — and pressing it calls `GET /v1/admin/reports/who`, which needs
 * `learner.read` and writes its own line (`desk.report.identify`) into `ops.admin_audit`. The
 * answer is held in this component's state for as long as the operator is looking at it and is
 * never stored, never logged, and never folded into the queue row.
 *
 * NOTHING CARRIES BETWEEN DESKS. Console.tsx mounts this with the desk id as its `key`, so
 * switching desks throws this component and its state away rather than resetting it field by
 * field — an identity somebody looked up on a refund must not still be on screen over the flag
 * queue, and a `key` cannot forget one of the fields the way a reset effect can.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT. `api.write` does not retry, and the outcome — moved,
 * or the gateway's own words about why not — is printed here. An operator shown a state change
 * that did not save will make the same change again, and the second one is the one that surprises
 * somebody.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, read, write } from './api';
import {
  isQueueRow,
  isRaisedBy,
  KIND_WORDS,
  type QueueKind,
  type QueuePage,
  type QueueRow,
  type RaisedBy,
  type ReportState,
  reasonWords,
  STATE_WORDS,
  when,
} from './queues';

/** The three a person can move a report to. `new` is missing on purpose: going back would erase
 *  that somebody looked, while the trail would still say they did, and the row would then lie. */
const MOVES: readonly ReportState[] = ['looked_at', 'acted_on', 'closed'];

/** The two kinds that cannot be worked without knowing who. A flag and a bug are fixed by
 *  changing the product, and the gateway refuses to identify anybody on either. */
const IDENTIFIABLE: readonly QueueKind[] = ['refund', 'support'];

export function QueueActions({
  kind,
  page,
  onMoved,
}: {
  kind: QueueKind;
  page: QueuePage | null;
  /** Re-read the desk. The queue this component just changed is now stale, and a stale queue
   *  under a fresh timestamp is a report somebody has already closed, still looking open. */
  onMoved: () => void;
}) {
  const rows = page?.readable ? page.reports : [];
  const [chosen, setChosen] = useState<string>('');
  const [state, setState] = useState<ReportState>('looked_at');
  const [resolution, setResolution] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>('');
  const [who, setWho] = useState<RaisedBy | null>(null);

  const report: QueueRow | undefined = rows.find((row) => row.id === chosen);
  // Money: the gateway asks for both on a refund past "looked at", and so does this form.
  const settling = report?.kind === 'refund' && state !== 'looked_at';

  if (!page?.readable) return null;
  if (rows.length === 0) return null;

  async function move() {
    if (!report) return;
    setBusy(true);
    setSaid('');
    const result = await write(
      'reportState',
      {
        id: report.id,
        state,
        resolution: resolution.trim() || undefined,
        confirm: confirmed,
      },
      isQueueRow,
    );
    setBusy(false);
    if (result.ok) {
      setSaid(`Moved to ${STATE_WORDS[result.value.state].toLowerCase()}.`);
      setChosen('');
      setResolution('');
      setConfirmed(false);
      setWho(null);
      onMoved();
      return;
    }
    setSaid(refusal(result));
  }

  async function identify() {
    if (!report) return;
    setBusy(true);
    const result = await read('reportWho', isRaisedBy, { query: { id: report.id } });
    setBusy(false);
    if (result.ok) {
      setWho(result.value);
      setSaid('');
      return;
    }
    setWho(null);
    setSaid(refusal(result));
  }

  return (
    <section
      className="ac-panel aq"
      aria-label={`Work the ${KIND_WORDS[kind].toLowerCase()} queue`}
    >
      <span className="ac-panel-label">Work one report</span>

      <div className="aq-line">
        <label className="aq-field">
          <span>Report</span>
          <select
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
              // An identity belongs to the row it was looked up for and to no other.
              setWho(null);
              setSaid('');
            }}
          >
            <option value="">Choose one…</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {when(row.raised_at)} · {reasonWords(row.reason)} · {row.handle} ·{' '}
                {STATE_WORDS[row.state].toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="aq-field">
          <span>Move it to</span>
          <select value={state} onChange={(event) => setState(event.target.value as ReportState)}>
            {MOVES.map((next) => (
              <option key={next} value={next}>
                {STATE_WORDS[next]}
              </option>
            ))}
          </select>
        </label>

        {IDENTIFIABLE.includes(kind) && (
          <button
            className="aq-quiet"
            type="button"
            disabled={!report || busy}
            onClick={() => void identify()}
          >
            Who raised this
          </button>
        )}
      </div>

      {/* The note the next person reads. Required only where money is; offered everywhere. */}
      <label className="aq-field aq-wide">
        <span>{settling ? 'What was done about the charge' : 'What you did (optional)'}</span>
        <input
          type="text"
          value={resolution}
          maxLength={2000}
          onChange={(event) => setResolution(event.target.value)}
          placeholder={settling ? 'Duplicate returned in full.' : 'Fixed the lesson.'}
        />
      </label>

      {settling && (
        <label className="aq-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            This is a decision about somebody’s money. Confirm it, and say in one line what was
            done. We do not refund as a gesture of goodwill — only the cases the law gives.
          </span>
        </label>
      )}

      <div className="aq-line">
        <button
          className="aq-do"
          type="button"
          disabled={!report || busy || (settling && (!confirmed || resolution.trim().length < 3))}
          onClick={() => void move()}
        >
          {busy ? 'Sending…' : 'Move it'}
        </button>
        {said && <span className="aq-said">{said}</span>}
      </div>

      {who && (
        <div className="aq-who">
          <span className="aq-who-label">Who raised it · this look is in the audit trail</span>
          <code>{who.learner_id ?? 'no account on this one'}</code>
          <code>{who.reply_to ?? 'no reply address given'}</code>
        </div>
      )}
    </section>
  );
}

/** The gateway's own words where it gave us any, and this console's where it did not. Never a
 *  status code on its own: a number tells an operator nothing they can act on. */
function refusal(result: Fetched<unknown>): string {
  if (result.ok) return '';
  if (result.status === 409) {
    return 'The gateway asked for the confirmation and a line saying what was done.';
  }
  if (result.status === 422) return 'The gateway would not take that — check the words you typed.';
  if (result.reason === 'not_permitted') {
    return 'This seat may not do that, or the session needs you to prove it is you again.';
  }
  return `Not moved: ${FAILURE_COPY[result.reason]}.`;
}
