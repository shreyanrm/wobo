/**
 * The dials: the only controls in this console that change what a child is answered by.
 *
 * Everything about their shape is a decision rather than a layout:
 *
 * THE PRICE IS PREVIEWED BEFORE IT IS SAVED, and the preview is a separate round trip that writes
 * nothing (`docs/CONSOLE-MODELS.md` §2). Moving a tier changes every turn in the product and its
 * bill; a control that did it on one click would be a control somebody uses while distracted. So
 * the save button is not offered until the difference has been shown, exactly as the refund desk
 * asks twice where money moves and nowhere else.
 *
 * THE MODEL LIST IS THE GATEWAY'S OWN. The select is built from `catalogue` on the read, which is
 * `routing.CATALOGUE`, so this screen cannot offer an id the gateway would refuse. A console that
 * can propose an invalid change is a console that teaches an operator to expect errors.
 *
 * "BACK TO THE OWNER'S TABLE" ASKS TWICE. It clears every override at once, which is the one verb
 * on this screen with more than one consequence.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT. `api.write` does not retry, and the gateway's own
 * words about a refusal are printed here: an owner shown a change that did not save will make it
 * again, and the second one is the one that surprises somebody.
 *
 * NOTHING IS TYPED IN THAT COULD BE CHOSEN. The only free text is the note, which is the one field
 * a person writes a sentence into and which lands in `ops.settings_audit` beside the change.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, write } from './api';
import {
  type AllowanceDesk,
  type AllowanceEffectRow,
  isAllowanceDesk,
  planWords,
} from './allowance';
import { isModelsDesk, type ModelsDesk, type PricePreview } from './models';
import { usd } from './panels';

function refusal(result: Extract<Fetched<unknown>, { ok: false }>): string {
  return `Not saved: ${FAILURE_COPY[result.reason]}.`;
}

/** The owner seat is the only one that may turn any of this. Anyone else sees the desk and no
 *  controls, rather than a control that answers 403 — the seat already knows what it is. */
export function mayTurn(permissions: readonly string[]): boolean {
  return permissions.includes('admin.manage');
}

// --- the models desk -------------------------------------------------------------------------------
export function ModelsActions({
  desk,
  onSaved,
}: {
  desk: ModelsDesk | null;
  onSaved: () => void;
}) {
  const [tier, setTier] = useState('');
  const [primary, setPrimary] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  if (!desk) return null;
  const ids = Object.keys(desk.catalogue);
  const row = desk.tiers.find((entry) => entry.tier === tier);
  const moved = Boolean(row && primary && primary !== row.primary);

  async function send(body: Record<string, unknown>): Promise<ModelsDesk | null> {
    setBusy(true);
    setSaid('');
    const result = await write('models', body, isModelsDesk);
    setBusy(false);
    if (result.ok) return result.value;
    setSaid(refusal(result));
    return null;
  }

  async function look() {
    const answer = await send({ tier, primary, preview: true, note: note.trim() || undefined });
    if (answer) {
      setPreview(answer.preview ?? null);
      setSaid('Nothing was saved. This is what it would cost.');
    }
  }

  async function save() {
    const answer = await send({ tier, primary, note: note.trim() || undefined });
    if (answer) {
      setSaid(`Saved. ${tier} now asks ${primary} first, with no restart.`);
      setPreview(null);
      setPrimary('');
      onSaved();
    }
  }

  async function reset() {
    if (!window.confirm('Clear every tier override and go back to the owner’s table?')) return;
    const answer = await send({ reset: true, note: note.trim() || undefined });
    if (answer) {
      setSaid(`Cleared ${answer.cleared ?? 0} override(s). The owner’s table is standing.`);
      setPreview(null);
      onSaved();
    }
  }

  async function applyNow() {
    setBusy(true);
    setSaid('');
    const result = await write('settingsApply', {}, (value): value is unknown => value !== null);
    setBusy(false);
    setSaid(result.ok ? 'The gateway has re-read every dial.' : refusal(result));
    if (result.ok) onSaved();
  }

  return (
    <section className="ac-panel">
      <span className="ac-panel-label">Move a tier</span>

      <label className="ac-field">
        <span>Tier</span>
        <select
          value={tier}
          onChange={(event) => {
            setTier(event.target.value);
            setPrimary('');
            setPreview(null);
          }}
        >
          <option value="">choose one</option>
          {desk.tiers.map((entry) => (
            <option value={entry.tier} key={entry.tier}>
              {entry.tier} — now {entry.primary}
            </option>
          ))}
        </select>
      </label>

      <label className="ac-field">
        <span>Asks this first</span>
        <select
          value={primary}
          disabled={!tier}
          onChange={(event) => {
            setPrimary(event.target.value);
            setPreview(null);
          }}
        >
          <option value="">leave it alone</option>
          {ids.map((id) => (
            <option value={id} key={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      <label className="ac-field">
        <span>Why (goes into the trail)</span>
        <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
      </label>

      {preview && (
        <p className="ac-note">
          {preview.readable
            ? `At ${preview.day}’s volume (${preview.calls} calls): ` +
              `${usd(preview.now_usd ?? 0)} becomes ${usd(preview.then_usd ?? 0)}, a difference of ` +
              `${usd(preview.delta_usd ?? 0)}. Per thousand calls, ` +
              `${usd(preview.per_thousand_calls?.delta_usd ?? 0)}.`
            : preview.why}
        </p>
      )}

      <div className="ac-actions">
        <button type="button" disabled={!moved || busy} onClick={() => void look()}>
          What would it cost
        </button>
        {/* Not offered until the difference has been shown. See the header. */}
        <button type="button" disabled={!moved || !preview || busy} onClick={() => void save()}>
          Save it
        </button>
        <button type="button" disabled={busy} onClick={() => void reset()}>
          Back to the owner’s table
        </button>
        <button type="button" disabled={busy} onClick={() => void applyNow()}>
          Apply now
        </button>
      </div>

      {said && <p className="ac-note">{said}</p>}
    </section>
  );
}

// --- the allowance desk ------------------------------------------------------------------------------
export function AllowanceActions({
  desk,
  onSaved,
}: {
  desk: AllowanceDesk | null;
  onSaved: () => void;
}) {
  const [pro, setPro] = useState('');
  const [max, setMax] = useState('');
  const [free, setFree] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<readonly AllowanceEffectRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  if (!desk) return null;

  /** Only the fields that were actually typed in. An untouched dial is not sent, so a save cannot
   *  quietly rewrite a dial the operator never looked at. */
  function body(preview_: boolean): Record<string, unknown> {
    const generosity: Record<string, number> = {};
    if (pro.trim()) generosity.pro = Number(pro);
    if (max.trim()) generosity.max = Number(max);
    return {
      generosity: Object.keys(generosity).length > 0 ? generosity : undefined,
      free_daily_paise: free.trim() ? Number(free) : undefined,
      inr_per_usd: rate.trim() ? Number(rate) : undefined,
      preview: preview_,
      note: note.trim() || undefined,
    };
  }

  const touched = Boolean(pro.trim() || max.trim() || free.trim() || rate.trim());

  async function send(preview_: boolean) {
    setBusy(true);
    setSaid('');
    const result = await write('allowance', body(preview_), isAllowanceDesk);
    setBusy(false);
    if (!result.ok) {
      setSaid(refusal(result));
      return;
    }
    if (preview_) {
      setPreview(result.value.preview ?? null);
      setSaid('Nothing was saved. This is what it would give.');
      return;
    }
    setPreview(null);
    setPro('');
    setMax('');
    setFree('');
    setRate('');
    setSaid('Saved. The gateway is already using it.');
    onSaved();
  }

  return (
    <section className="ac-panel">
      <span className="ac-panel-label">Turn the dials</span>
      <p className="ac-note">
        Internal only. Nothing here reaches a learner or a parent: they see a bar and never a
        number.
      </p>

      <label className="ac-field">
        <span>Pro generosity (a fraction of what they pay, now {desk.generosity.pro})</span>
        <input
          inputMode="decimal"
          value={pro}
          placeholder="leave blank to keep it"
          onChange={(event) => {
            setPro(event.target.value);
            setPreview(null);
          }}
        />
      </label>

      <label className="ac-field">
        <span>Max generosity (now {desk.generosity.max})</span>
        <input
          inputMode="decimal"
          value={max}
          placeholder="leave blank to keep it"
          onChange={(event) => {
            setMax(event.target.value);
            setPreview(null);
          }}
        />
      </label>

      <label className="ac-field">
        <span>The free day, in paise (now {desk.free_daily_paise}, which is {desk.free_daily})</span>
        <input
          inputMode="numeric"
          value={free}
          placeholder="leave blank to keep it"
          onChange={(event) => {
            setFree(event.target.value);
            setPreview(null);
          }}
        />
      </label>

      <label className="ac-field">
        <span>Rupees to the dollar (now {desk.inr_per_usd})</span>
        <input
          inputMode="decimal"
          value={rate}
          placeholder="leave blank to keep it"
          onChange={(event) => {
            setRate(event.target.value);
            setPreview(null);
          }}
        />
      </label>

      <label className="ac-field">
        <span>Why (goes into the trail)</span>
        <input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
      </label>

      {preview && (
        <ul className="ac-note">
          {preview.map((row) => (
            <li key={`${row.plan}-${row.period ?? 'none'}`}>
              {planWords(row)} would get {row.a_day} a day.
            </li>
          ))}
        </ul>
      )}

      <div className="ac-actions">
        <button type="button" disabled={!touched || busy} onClick={() => void send(true)}>
          What would it give
        </button>
        <button type="button" disabled={!touched || !preview || busy} onClick={() => void send(false)}>
          Save it
        </button>
      </div>

      {said && <p className="ac-note">{said}</p>}
    </section>
  );
}
