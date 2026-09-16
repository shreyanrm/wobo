/**
 * The growth desk's controls (docs/GROWTH-DESK.md §4.3 and §4.6). OWNER ONLY: every route behind
 * them needs `admin.manage`, which the guard asks a step-up for. Console.tsx mounts this only for
 * that seat, and the gateway refuses everyone else whatever this bundle draws.
 *
 * Four things, in the order the owner needs them:
 *
 *   1. WAITING ON YOU. Each post that needs a person, with every word it would send, so approving
 *      is reading and never trusting. Script channels get Approve; person channels get "Sent",
 *      with where it went. A copy of a piece whose blog post is not indexed never appears here:
 *      the gateway holds it, and says so on the posts panel.
 *   2. SEEN INDEXED. A blog post that is up and not yet seen indexed, with a note saying how a
 *      person checked. This is the fact that releases every other copy. Beside it, POST IT AGAIN:
 *      a blog file that went out and whose page has gone (a redeploy can wipe it) is posted under
 *      the next attempt. The gateway reads the address and refuses while the page answers.
 *   3. THE DIALS. The kill switch, who approves, the pace per channel, the pieces a day, and topics
 *      off. One save, one line in the trail, with the note beside it.
 *   4. NOTES. Questions a person read in the study communities, pasted one a line. Reddit and
 *      Quora are read by a person and answered by a person; nothing here posts to either, and
 *      there is no control for either anywhere on this desk.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT: a refusal is printed in the gateway's own words.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, write } from './api';
import type { EndpointName } from './contract';
import {
  awaitingIndex,
  type GrowthDesk,
  type GrowthPost,
  isGrowthDesk,
  repostable,
  STATUS_WORDS,
  waitingOnYou,
} from './growth';

type Said = { readonly text: string; readonly tone: 'plain' | 'refused' };

/** The gateway's refusal codes on this desk, in words. Anything else falls back to the shared copy. */
export const GROWTH_REFUSALS: Record<string, string> = {
  refused:
    'the gateway would not make that move: a copy waits until its blog post is indexed, and a post that has gone does not move again',
  bad_dial: 'a dial is outside what the gateway allows',
  not_saved: 'the growth store could not be written',
};

export function refusal<T>(result: Fetched<T>): string {
  if (result.ok) return '';
  return (result.code && GROWTH_REFUSALS[result.code]) || FAILURE_COPY[result.reason];
}

function isNotesAnswer(value: unknown): value is { questions: number; kept: number } {
  const v = value as { questions?: unknown };
  return typeof v === 'object' && v !== null && typeof v.questions === 'number';
}

export function GrowthActions({
  desk,
  onChanged,
}: {
  desk: GrowthDesk | null;
  onChanged: () => void;
}) {
  if (!desk) return null;
  return (
    <>
      <WaitingOnYou desk={desk} onChanged={onChanged} />
      <SeenIndexed desk={desk} onChanged={onChanged} />
      <PostAgain desk={desk} onChanged={onChanged} />
      <Dials desk={desk} onChanged={onChanged} />
      <Notes onChanged={onChanged} />
    </>
  );
}

function useSaid() {
  const [said, setSaid] = useState<Said | null>(null);
  const line = said ? (
    <p className="aq-said" role="status" data-tone={said.tone}>
      {said.text}
    </p>
  ) : null;
  return [line, setSaid] as const;
}

export function WaitingOnYou({ desk, onChanged }: { desk: GrowthDesk; onChanged: () => void }) {
  const waiting = waitingOnYou(desk);
  const [busy, setBusy] = useState('');
  const [references, setReferences] = useState<Record<string, string>>({});
  const [line, setSaid] = useSaid();

  async function move(endpoint: EndpointName, post: GrowthPost, reference?: string) {
    setBusy(post.id);
    setSaid(null);
    const result = await write(endpoint, { campaign_id: post.id, reference }, isGrowthDesk);
    setBusy('');
    if (!result.ok) {
      setSaid({ text: `Not saved: ${refusal(result)}.`, tone: 'refused' });
      return;
    }
    setSaid({ text: `${post.id}: saved.`, tone: 'plain' });
    onChanged();
  }

  return (
    <section className="ac-panel aq ag" aria-label="Waiting on you">
      <span className="ac-panel-label">Waiting on you</span>
      {waiting.length === 0 ? (
        <p className="ac-note">
          Nothing is waiting. Copies of a piece appear here once its blog post is indexed.
        </p>
      ) : (
        <ul className="ag-list">
          {waiting.map((post) => {
            const person = post.status === 'queued_for_person';
            return (
              <li className="ag-post" key={post.id}>
                <div className="ag-post-head">
                  <strong>{post.title || post.piece}</strong>
                  <span className="ag-tag">{post.channel}</span>
                  {post.shape !== post.channel && <span className="ag-tag">{post.shape}</span>}
                  <span className="ag-tag">{STATUS_WORDS[post.status] ?? post.status}</span>
                </div>
                <code className="ag-id">{post.id}</code>
                <details className="ag-words">
                  <summary>Every word it would send ({post.units.length})</summary>
                  <ol>
                    {post.units.map((unit, index) => (
                      // Position is the identity: a thread's replies are ordered and may repeat.
                      // biome-ignore lint/suspicious/noArrayIndexKey: ordered units, never reordered
                      <li key={index}>
                        <pre>{unit}</pre>
                      </li>
                    ))}
                  </ol>
                </details>
                {person && post.link && (
                  <p className="ac-note">
                    Import from the blog post, not from this text, so the copy points home:{' '}
                    <code>{post.link.split('?')[0]}</code>
                  </p>
                )}
                <div className="aq-line">
                  {person && (
                    <label className="aq-field">
                      <span>Where it went</span>
                      <input
                        value={references[post.id] ?? ''}
                        maxLength={300}
                        placeholder="the address of the sent post"
                        onChange={(event) =>
                          setReferences({ ...references, [post.id]: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {person ? (
                    <button
                      className="aq-do"
                      type="button"
                      aria-label={`Mark ${post.id} sent`}
                      disabled={busy === post.id || !(references[post.id] ?? '').trim()}
                      onClick={() =>
                        void move('growthSent', post, (references[post.id] ?? '').trim())
                      }
                    >
                      Mark sent
                    </button>
                  ) : (
                    <button
                      className="aq-do"
                      type="button"
                      aria-label={`Approve ${post.id}`}
                      disabled={busy === post.id}
                      onClick={() => void move('growthApprove', post)}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="aq-quiet"
                    type="button"
                    disabled={busy === post.id}
                    onClick={() => {
                      if (window.confirm(`Withdraw ${post.id}? It will never be posted.`)) {
                        void move('growthWithdraw', post);
                      }
                    }}
                  >
                    Withdraw
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {line}
    </section>
  );
}

export function SeenIndexed({ desk, onChanged }: { desk: GrowthDesk; onChanged: () => void }) {
  const pieces = awaitingIndex(desk);
  const [slug, setSlug] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setSaid] = useSaid();
  if (pieces.length === 0) return null;

  async function save() {
    setBusy(true);
    setSaid(null);
    const result = await write('growthIndexed', { slug, note: note.trim() }, isGrowthDesk);
    setBusy(false);
    if (!result.ok) {
      setSaid({ text: `Not saved: ${refusal(result)}.`, tone: 'refused' });
      return;
    }
    setSaid({ text: `${slug}: its copies are released on the next pass.`, tone: 'plain' });
    setSlug('');
    setNote('');
    onChanged();
  }

  return (
    <section className="ac-panel aq" aria-label="Seen indexed">
      <span className="ac-panel-label">Seen indexed</span>
      <p className="ac-note">
        Every copy of a piece waits until its blog post is indexed. Search Console says so on its
        own once it is connected; until then, say how you saw it.
      </p>
      <div className="aq-line">
        <label className="aq-field">
          <span>Blog post</span>
          <select value={slug} onChange={(event) => setSlug(event.target.value)}>
            <option value="">choose a published piece</option>
            {pieces.map((piece) => (
              <option value={piece.slug} key={piece.slug}>
                {piece.title || piece.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="aq-field">
          <span>How you saw it (goes into the trail)</span>
          <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button
          className="aq-do"
          type="button"
          disabled={busy || !slug || note.trim().length < 8}
          onClick={() => void save()}
        >
          Mark indexed
        </button>
      </div>
      {line}
    </section>
  );
}

export function PostAgain({ desk, onChanged }: { desk: GrowthDesk; onChanged: () => void }) {
  const pieces = repostable(desk);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setSaid] = useSaid();
  if (pieces.length === 0) return null;

  async function save() {
    setBusy(true);
    setSaid(null);
    const result = await write('growthRepost', { slug }, isGrowthDesk);
    setBusy(false);
    if (!result.ok) {
      setSaid({ text: `Not saved: ${refusal(result)}.`, tone: 'refused' });
      return;
    }
    setSaid({ text: `${slug}: a new blog post is waiting on you.`, tone: 'plain' });
    setSlug('');
    onChanged();
  }

  return (
    <section className="ac-panel aq" aria-label="Post a blog file again">
      <span className="ac-panel-label">Post it again</span>
      <p className="ac-note">
        A blog post that went out and no longer answers at its address, because a redeploy wiped the
        file. The gateway checks the address first and refuses while the page is up.
      </p>
      <div className="aq-line">
        <label className="aq-field">
          <span>Blog post</span>
          <select value={slug} onChange={(event) => setSlug(event.target.value)}>
            <option value="">choose a posted piece</option>
            {pieces.map((piece) => (
              <option value={piece.slug} key={piece.slug}>
                {piece.title || piece.slug}
              </option>
            ))}
          </select>
        </label>
        <button
          className="aq-do"
          type="button"
          disabled={busy || !slug}
          onClick={() => void save()}
        >
          Post it again
        </button>
      </div>
      {line}
    </section>
  );
}

export function Dials({ desk, onChanged }: { desk: GrowthDesk; onChanged: () => void }) {
  const dials = desk.dials;
  const [running, setRunning] = useState(dials.running);
  const [approval, setApproval] = useState(dials.approval);
  const [pieces, setPieces] = useState(String(dials.pieces_daily));
  const [cadence, setCadence] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(dials.cadence).map(([key, n]) => [key, String(n)])),
  );
  const [off, setOff] = useState<readonly string[]>(dials.topics_off);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setSaid] = useSaid();
  const channels = desk.channels.filter((channel) => channel.tier !== 'never');

  function toggle(slug: string) {
    setOff(off.includes(slug) ? off.filter((s) => s !== slug) : [...off, slug]);
  }

  async function save() {
    if (
      running &&
      !dials.running &&
      !window.confirm('Turn the desk on? Pieces are made and approved posts go out.')
    ) {
      return;
    }
    const numbers: Record<string, number> = {};
    for (const [key, value] of Object.entries(cadence)) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        setSaid({ text: `Not saved: ${key} needs a whole number.`, tone: 'refused' });
        return;
      }
      numbers[key] = n;
    }
    setBusy(true);
    setSaid(null);
    const result = await write(
      'growthDials',
      {
        running,
        approval,
        pieces_daily: Number(pieces),
        cadence: numbers,
        topics_off: off,
        note: note.trim() || undefined,
      },
      isGrowthDesk,
    );
    setBusy(false);
    if (!result.ok) {
      setSaid({ text: `Not saved: ${refusal(result)}.`, tone: 'refused' });
      return;
    }
    setSaid({ text: 'Saved. The gateway obeys it within a minute.', tone: 'plain' });
    setNote('');
    onChanged();
  }

  return (
    <section className="ac-panel aq" aria-label="Turn the growth dials">
      <span className="ac-panel-label">Turn the dials</span>
      {!dials.readable && (
        <p className="ac-note">
          The dials could not be read, so the desk is stopped whatever they say.
        </p>
      )}
      <div className="aq-line">
        <label className="aq-field">
          <span>The desk</span>
          <select
            value={running ? 'on' : 'off'}
            onChange={(event) => setRunning(event.target.value === 'on')}
          >
            <option value="off">stopped</option>
            <option value="on">running</option>
          </select>
        </label>
        <label className="aq-field">
          <span>Who approves</span>
          <select
            value={approval}
            onChange={(event) => setApproval(event.target.value === 'person' ? 'person' : 'every')}
          >
            <option value="every">every post waits for me</option>
            <option value="person">only person channels wait</option>
          </select>
        </label>
        <label className="aq-field">
          <span>Pieces a day (at most {dials.ceilings.pieces_daily})</span>
          <input
            type="number"
            min={0}
            max={dials.ceilings.pieces_daily}
            value={pieces}
            onChange={(event) => setPieces(event.target.value)}
          />
        </label>
      </div>
      <fieldset className="ag-grid">
        <legend>Posts a day</legend>
        {channels.map((channel) => (
          <label className="aq-field" key={channel.key}>
            <span>{channel.name}</span>
            <input
              type="number"
              min={0}
              max={channel.origin ? dials.ceilings.blog : dials.ceilings.channel}
              value={cadence[channel.key] ?? '0'}
              onChange={(event) => setCadence({ ...cadence, [channel.key]: event.target.value })}
            />
          </label>
        ))}
      </fieldset>
      {desk.topics.rows.length > 0 && (
        <fieldset className="ag-topics">
          <legend>Topics switched off</legend>
          {desk.topics.rows.map((topic) => (
            <label key={topic.slug} className="ag-check">
              <input
                type="checkbox"
                checked={off.includes(topic.slug)}
                onChange={() => toggle(topic.slug)}
              />
              <span>{topic.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="aq-line">
        <label className="aq-field aq-wide">
          <span>Why (goes into the trail)</span>
          <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button className="aq-do" type="button" disabled={busy} onClick={() => void save()}>
          Save the dials
        </button>
      </div>
      {line}
    </section>
  );
}

export function Notes({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setSaid] = useSaid();

  async function save() {
    setBusy(true);
    setSaid(null);
    const result = await write('growthNotes', { text }, isNotesAnswer);
    setBusy(false);
    if (!result.ok) {
      setSaid({ text: `Not saved: ${refusal(result)}.`, tone: 'refused' });
      return;
    }
    setSaid({
      text: `Kept ${result.value.questions} questions for the next gather.`,
      tone: 'plain',
    });
    setText('');
    onChanged();
  }

  return (
    <section className="ac-panel aq" aria-label="Questions people asked">
      <span className="ac-panel-label">Questions people asked</span>
      <p className="ac-note">
        One a line, as you read them in the study communities or under a search result. A person
        reads those places and answers there in their own name; nothing here posts to them.
      </p>
      <label className="aq-field aq-wide">
        <span>Questions</span>
        <textarea
          value={text}
          maxLength={12000}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="aq-line">
        <button
          className="aq-do"
          type="button"
          disabled={busy || text.trim().length < 6}
          onClick={() => void save()}
        >
          Keep these questions
        </button>
      </div>
      {line}
    </section>
  );
}
