/**
 * One learner's page on the activity desk: last came, days active this month, streak, mail step.
 *
 * IDENTITY IS A DELIBERATE ACT, AND IT IS RECORDED — the same rule as "Who raised this" on the
 * queues. The operator types an account id and presses the button; the console never looks anyone
 * up on its own. `GET /v1/admin/learners/activity` needs `learner.read` and writes its own line
 * (`console.learner.activity`) into the audit trail, and Console.tsx draws this box only for a
 * seat that carries that permission.
 *
 * FOUR FACTS AND NOTHING ELSE. The record also holds what the learner's own mail is written from
 * (the chapter, the moments, the hour they usually come). None of it reaches this screen: the
 * gateway does not send it and `LearnerActivity` has no field for it.
 *
 * The answer is held in this component's state while the operator is looking at it, and is never
 * stored or logged. Console.tsx mounts it with the desk id as its key, so leaving the desk throws
 * it away.
 */

import { useState } from 'react';
import { isLearnerActivity, type LearnerActivity, learnerPanels, lookedAt } from './activity';
import { FAILURE_COPY, read } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ActivityLookup() {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [view, setView] = useState<{ value: LearnerActivity; at: string } | null>(null);
  const wanted = id.trim();
  const valid = UUID.test(wanted);

  async function look() {
    if (!valid) return;
    setBusy(true);
    setSaid('');
    const result = await read('learnerActivity', isLearnerActivity, { query: { id: wanted } });
    setBusy(false);
    if (result.ok) {
      setView({ value: result.value, at: result.at });
      return;
    }
    setView(null);
    setSaid(
      result.reason === 'not_permitted'
        ? 'This seat may not open a learner’s record, or the session has ended.'
        : `Not read: ${FAILURE_COPY[result.reason]}.`,
    );
  }

  const facts = view ? learnerPanels(view.value, view.at) : [];

  return (
    <section className="ac-panel aq" aria-label="Look up one learner">
      <span className="ac-panel-label">One learner</span>
      <div className="aq-line">
        <label className="aq-field">
          <span>Account id</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={id}
            maxLength={64}
            placeholder="5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            onChange={(event) => {
              setId(event.target.value);
              // A record belongs to the id it was looked up for and to no other.
              setView(null);
              setSaid('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void look();
            }}
          />
        </label>
        <button
          className="aq-do"
          type="button"
          disabled={!valid || busy}
          onClick={() => void look()}
        >
          {busy ? 'Reading…' : 'Look up'}
        </button>
        {said && (
          <span className="aq-said" role="status">
            {said}
          </span>
        )}
      </div>

      {view && (
        <div className="aq-who" aria-live="polite">
          <span className="aq-who-label">
            {wanted} · this look is in the audit trail · {lookedAt(view.at)}
          </span>
          <dl className="aa-facts">
            {facts.map((fact) => (
              <div className="aa-fact" key={fact.id}>
                <dt>{fact.label}</dt>
                {fact.kind === 'figure' ? (
                  <dd>
                    <span className="aa-value" data-tone={fact.tone}>
                      {fact.value}
                    </span>
                    {fact.note && <span className="ac-note">{fact.note}</span>}
                  </dd>
                ) : (
                  <dd>
                    <span className="ac-note">{fact.kind === 'absent' ? fact.because : ''}</span>
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
