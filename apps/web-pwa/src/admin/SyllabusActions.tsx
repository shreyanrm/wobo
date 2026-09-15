/**
 * The three things a person does on the boards desk, and the reason each one is shaped this way.
 *
 * RETRY IS ONE BOARD, CHOSEN. `docs/BOARD-COLD-START.md` §5 remembers a refusal so a dead link is
 * not re-fetched on every learner who picks that board. This is a person overriding that memory
 * for one board they have looked at, which is what the console queue is for. There is no "retry
 * all": a hundred retries against a host that was down is a hundred paid searches and a worse
 * relationship with a state board's webmaster.
 *
 * PROMOTE IS A CLAIM SOMEBODY MAKES, NOT A BUTTON THAT TIDIES A STATUS. §5: *"Nothing is published
 * that a second reader did not verify against the same document, and it is labelled provisional
 * until a person confirms it. That gate already exists and does not move."* So the checkbox is not
 * a formality this form ticks for you — the gateway refuses without it (409 `confirm_required`),
 * and the words beside it say exactly what is being claimed, because "verified" is the one label
 * in this product that names the board and therefore the one that can be falsified.
 *
 * THE ORDER IS THE OWNER'S, AND IT IS EDITED AS TEXT. The queue is a list of board ids in the
 * order they will be read; a drag-and-drop over two hundred and sixty-eight rows would be a worse
 * way to say "put Bihar second". A board id that is not in the registry is refused by the gateway
 * BY NAME rather than dropped, so a typo cannot quietly change which boards the platform pays to
 * read.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT, exactly as on the queue desks: `api.write` does not
 * retry, and the outcome — done, or the gateway's own words about why not — is printed here.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, write } from './api';
import type { SyllabusDesk } from './syllabus';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isRetried = (value: unknown): value is { job_id: string; state: string } =>
  isObject(value) && typeof value.state === 'string';

const isPromoted = (value: unknown): value is { version_id: string; label: string | null } =>
  isObject(value) && typeof value.version_id === 'string';

const isTurned = (value: unknown): value is Record<string, unknown> => isObject(value);

export function SyllabusActions({
  desk,
  mayTurn,
  onChanged,
}: {
  desk: SyllabusDesk | null;
  /** `admin.manage`. A seat without it is shown the desk and no owner controls, rather than a
   *  control that would only ever answer 403 — the seat already knows what it is. */
  mayTurn: boolean;
  onChanged: () => void;
}) {
  const [job, setJob] = useState('');
  const [version, setVersion] = useState('');
  const [read, setRead] = useState(false);
  const [order, setOrder] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  if (!desk?.readable) return null;

  const refused = desk.refused;
  const promotable = desk.boards.filter((row) => row.may_promote);
  const chosen = promotable.find((row) => row.version_id === version);

  async function retry() {
    if (!job) return;
    setBusy(true);
    setSaid('');
    const result = await write('syllabusRetry', { job_id: job }, isRetried);
    setBusy(false);
    if (result.ok) {
      setSaid(
        desk?.worker.enabled
          ? 'Back in the queue. The next tick picks it up.'
          : `Back in the queue — but ${desk?.worker.env} is not set, so nothing will read it yet.`,
      );
      setJob('');
      onChanged();
      return;
    }
    setSaid(refusal(result, 'Not retried'));
  }

  async function promote() {
    if (!version || !read) return;
    setBusy(true);
    setSaid('');
    const result = await write('syllabusPromote', { version_id: version, read: true }, isPromoted);
    setBusy(false);
    if (result.ok) {
      setSaid(`Verified. Learners now read: “${result.value.label ?? 'the verified label'}”.`);
      setVersion('');
      setRead(false);
      onChanged();
      return;
    }
    setSaid(refusal(result, 'Not promoted'));
  }

  async function turn(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setSaid('');
    const result = await write('syllabusPrewarm', body, isTurned);
    setBusy(false);
    if (result.ok) {
      setSaid(done);
      onChanged();
      return;
    }
    setSaid(refusal(result, 'Not changed'));
  }

  return (
    <>
      {refused.length > 0 && (
        <section className="ac-panel aq" aria-label="Retry a board that could not be read">
          <span className="ac-panel-label">Look at one board again</span>
          <div className="aq-line">
            <label className="aq-field aq-wide">
              <span>Which refusal</span>
              <select value={job} onChange={(event) => setJob(event.target.value)}>
                <option value="">Choose one…</option>
                {refused.map((row) => (
                  <option key={row.job_id} value={row.job_id}>
                    {row.framework_name} · {row.level ?? '—'} {row.subject ?? ''} ·{' '}
                    {row.reason_plain ?? 'no reason recorded'}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="aq-do"
              type="button"
              disabled={!job || busy}
              onClick={() => void retry()}
            >
              {busy ? 'Sending…' : 'Put it back in the queue'}
            </button>
          </div>
          <span className="ac-note">
            A refusal is remembered for a day so a board whose site was down is not re-fetched on
            every learner who picks it. This is you deciding to look now.
          </span>
        </section>
      )}

      {mayTurn && promotable.length > 0 && (
        <section className="ac-panel aq" aria-label="Confirm a reading as verified">
          <span className="ac-panel-label">Confirm a reading</span>
          <div className="aq-line">
            <label className="aq-field aq-wide">
              <span>Which board</span>
              <select
                value={version}
                onChange={(event) => {
                  setVersion(event.target.value);
                  // The confirmation belongs to the reading it was given for and to no other.
                  setRead(false);
                  setSaid('');
                }}
              >
                <option value="">Choose one…</option>
                {promotable.map((row) => (
                  <option key={row.framework_id} value={row.version_id ?? ''}>
                    {row.framework_name} · {row.version_label} · {row.chapters} chapters
                  </option>
                ))}
              </select>
            </label>
          </div>
          {chosen?.source_url && (
            <span className="ac-note">
              Read it against the document it was made from:{' '}
              <a href={chosen.source_url} target="_blank" rel="noreferrer">
                {chosen.source_url}
              </a>
            </span>
          )}
          <label className="aq-confirm">
            <input
              type="checkbox"
              checked={read}
              onChange={(event) => setRead(event.target.checked)}
            />
            <span>
              I have read this reading against the board’s own document and it matches. Verified is
              the only label that names the board, so it is the only one that can be proved wrong,
              and this puts my name on the trail.
            </span>
          </label>
          <div className="aq-line">
            <button
              className="aq-do"
              type="button"
              disabled={!version || !read || busy}
              onClick={() => void promote()}
            >
              {busy ? 'Sending…' : 'Mark it verified'}
            </button>
          </div>
        </section>
      )}

      {mayTurn && (
        <section className="ac-panel aq" aria-label="The order boards are read in">
          <span className="ac-panel-label">Read ahead of demand</span>
          <div className="aq-line">
            <button
              className="aq-quiet"
              type="button"
              disabled={busy}
              onClick={() =>
                void turn(
                  { enabled: !desk.prewarm.enabled },
                  desk.prewarm.enabled
                    ? 'Off. Boards are now read only when a learner picks one.'
                    : 'On. The biggest boards are read ahead of demand again.',
                )
              }
            >
              {desk.prewarm.enabled ? 'Stop reading ahead' : 'Start reading ahead'}
            </button>
          </div>
          <label className="aq-field aq-wide">
            <span>The order, one board id a line, biggest first</span>
            <textarea
              rows={6}
              value={order}
              placeholder={desk.prewarm.order.map((row) => row.framework_id).join('\n')}
              onChange={(event) => setOrder(event.target.value)}
            />
          </label>
          <div className="aq-line">
            <button
              className="aq-do"
              type="button"
              disabled={busy || order.trim().length === 0}
              onClick={() =>
                void turn(
                  {
                    order: order
                      .split(/[\n,]/)
                      .map((line) => line.trim())
                      .filter(Boolean),
                  },
                  'Saved. That is the order boards are read in from the next tick.',
                )
              }
            >
              {busy ? 'Sending…' : 'Save the order'}
            </button>
          </div>
          <span className="ac-note">
            Stored in <code>ops.settings</code> under{' '}
            <code>{desk.prewarm.editable_key ?? 'curriculum.prewarm.order'}</code>, with your name
            on the change. A board id the registry does not hold is refused by name rather than
            dropped.
          </span>
        </section>
      )}

      {said && <span className="aq-said">{said}</span>}
    </>
  );
}

/** The gateway's own words where it gave us any, and this console's where it did not. */
function refusal(result: Fetched<unknown>, what: string): string {
  if (result.ok) return '';
  if (result.status === 409) {
    return `${what}: the gateway asked for something first — say a person read it, or the board is already being read.`;
  }
  if (result.status === 422) {
    return `${what}: the gateway would not take that — check the board ids you typed.`;
  }
  if (result.reason === 'not_permitted') {
    return `${what}: this seat may not do that, or the session needs you to prove it is you again.`;
  }
  return `${what}: ${FAILURE_COPY[result.reason]}.`;
}
