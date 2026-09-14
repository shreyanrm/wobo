/**
 * Minting a promo code: the second place in this console that changes anything, and the only one
 * that creates something a learner can spend.
 *
 * Everything about its shape is a decision rather than a layout:
 *
 * THE OWNER, AND ONLY THE OWNER. The gateway puts both writes on `admin.manage`, which no seat
 * but the owner's carries and which the guard demands a step-up for. This component renders the
 * form only for a seat that carries it — not as a control, but as a courtesy: a form that can
 * only ever answer 403 is a form that teaches an operator to ignore refusals. The gateway refuses
 * the write whatever this bundle draws, which is where the actual rule lives.
 *
 * THE FIELDS FOLLOW THE KIND, BECAUSE A HALF-DESCRIBED CODE CANNOT BE STORED. Migration 0027
 * checks, per kind, every column that kind may and may not carry. Showing "days of a boost" on a
 * plan code would only produce a refusal a second later, so the form asks for exactly what the
 * chosen kind needs.
 *
 * A PERCENTAGE NEEDS THE PROVIDER'S OFFER. A discount happens at the payment provider or it does
 * not happen. The field is required here for the same reason the constraint requires it: a code
 * that shows a learner a discount and then charges them the full price is the one failure this
 * whole feature must not have.
 *
 * A CODE IS NEVER DELETED. Switching one off is the only way to stop it, and the redemptions that
 * point at it stay readable. The disable control says so rather than reading as a delete.
 *
 * A WRITE IS NEVER RETRIED AND NEVER SILENT. `api.write` does not retry, and the outcome — minted,
 * switched off, or the gateway's own words about why not — is printed here. An operator shown a
 * change that did not save will make it again, and the second one is the one that surprises
 * somebody.
 */

import { useState } from 'react';
import { FAILURE_COPY, type Fetched, write } from './api';
import type { AdminIdentity } from './contract';
import { ADMIN_MANAGE } from './contract';
import {
  isPromoCodeRow,
  KIND_WORDS,
  type PromoCodeRow,
  type PromoKind,
  PROMO_KINDS,
  type PromoPage,
} from './promo';

/** The plans a `plan_days` code may grant. The gateway's own list (`promo.PLAN_ORDER`). */
const PLANS: readonly string[] = ['plus', 'pro', 'max'];

/** What the value box means, per kind. The label is the whole explanation: a number with no unit
 *  on a screen about money is how somebody types rupees into a field that wanted paise. */
const VALUE_LABEL: Record<PromoKind, string> = {
  plan_days: 'How many days',
  allowance_boost_days: 'Extra allowance, in paise a day',
  percent_off_first: 'Percent off the first payment',
};

export function PromoActions({
  admin,
  page,
  onChanged,
}: {
  admin: AdminIdentity;
  page: PromoPage | null;
  /** Re-read the desk. The list this component just changed is now stale, and a stale list under
   *  a fresh timestamp is a code somebody has already switched off, still looking live. */
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<PromoKind>('plan_days');
  const [code, setCode] = useState('');
  const [value, setValue] = useState('30');
  const [days, setDays] = useState('7');
  const [plan, setPlan] = useState('pro');
  const [offer, setOffer] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');
  const [oncePerAccount, setOncePerAccount] = useState(true);
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  if (!admin.permissions.includes(ADMIN_MANAGE)) return null;

  const live = (page?.readable ? page.codes : []).filter((row) => !row.disabled_at);

  async function mint() {
    setBusy(true);
    setSaid('');
    const body: Record<string, unknown> = {
      code: code.trim().toUpperCase(),
      kind,
      value: Number(value),
      once_per_account: oncePerAccount,
    };
    if (kind === 'plan_days') body.plan = plan;
    if (kind === 'allowance_boost_days') body.days = Number(days);
    if (kind === 'percent_off_first') body.provider_offer_id = offer.trim();
    if (maxUses.trim()) body.max_uses = Number(maxUses);
    // A date typed as a day means the end of that day nowhere in particular, so it is sent as an
    // explicit UTC moment: the gateway's clock, the ledger's day and this console all agree on UTC.
    if (expires.trim()) body.expires_at = `${expires.trim()}T23:59:59Z`;
    if (note.trim()) body.note = note.trim();

    const result = await write('promoCreate', body, isPromoCodeRow);
    setBusy(false);
    if (result.ok) {
      setSaid(minted(result.value));
      setCode('');
      setNote('');
      onChanged();
      return;
    }
    setSaid(refusal(result, 'Not minted'));
  }

  async function switchOff() {
    if (!chosen) return;
    setBusy(true);
    setSaid('');
    const result = await write('promoDisable', { code: chosen }, isPromoCodeRow);
    setBusy(false);
    if (result.ok) {
      setSaid(`${result.value.code} is switched off. It stays on this desk, with its redemptions.`);
      setChosen('');
      onChanged();
      return;
    }
    setSaid(refusal(result, 'Not switched off'));
  }

  const ready =
    code.trim().length >= 3 &&
    Number(value) > 0 &&
    (kind !== 'allowance_boost_days' || Number(days) > 0) &&
    (kind !== 'percent_off_first' || offer.trim().length > 0);

  return (
    <section className="ac-panel aq" aria-label="Mint or switch off a promo code">
      <span className="ac-panel-label">Mint a code</span>

      <div className="aq-line">
        <label className="aq-field">
          <span>What it grants</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as PromoKind)}>
            {PROMO_KINDS.map((one) => (
              <option key={one} value={one}>
                {KIND_WORDS[one]}
              </option>
            ))}
          </select>
        </label>

        <label className="aq-field">
          <span>Code</span>
          <input
            type="text"
            value={code}
            maxLength={32}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="WELCOME-10"
          />
        </label>

        <label className="aq-field">
          <span>{VALUE_LABEL[kind]}</span>
          <input
            type="number"
            min={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>

        {kind === 'plan_days' && (
          <label className="aq-field">
            <span>Which plan</span>
            <select value={plan} onChange={(event) => setPlan(event.target.value)}>
              {PLANS.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'allowance_boost_days' && (
          <label className="aq-field">
            <span>For how many days</span>
            <input
              type="number"
              min={1}
              max={366}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
        )}

        {kind === 'percent_off_first' && (
          <label className="aq-field">
            <span>The provider’s offer id</span>
            <input
              type="text"
              value={offer}
              maxLength={128}
              onChange={(event) => setOffer(event.target.value)}
              placeholder="offer_…"
            />
          </label>
        )}
      </div>

      <div className="aq-line">
        <label className="aq-field">
          <span>Use limit (blank is no limit)</span>
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </label>

        <label className="aq-field">
          <span>Expires (blank never does)</span>
          <input
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </label>

        <label className="aq-confirm">
          <input
            type="checkbox"
            checked={oncePerAccount}
            onChange={(event) => setOncePerAccount(event.target.checked)}
          />
          <span>One per account, ever. The database holds this, not the gateway alone.</span>
        </label>
      </div>

      <label className="aq-field aq-wide">
        <span>Why this code exists (optional)</span>
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          placeholder="For the first hundred people off the waiting list."
        />
      </label>

      {kind === 'percent_off_first' && (
        <p className="ac-note">
          A percentage comes off the first payment at the payment provider, before it is taken.
          Create the offer there first and paste its id above. Nothing here ever gives money back:
          a discount that is not on the payment cannot be applied afterwards.
        </p>
      )}

      <div className="aq-line">
        <button className="aq-do" type="button" disabled={!ready || busy} onClick={() => void mint()}>
          {busy ? 'Sending…' : 'Mint it'}
        </button>
        {said && <span className="aq-said">{said}</span>}
      </div>

      <span className="ac-panel-label">Switch one off</span>
      <div className="aq-line">
        <label className="aq-field">
          <span>Code</span>
          <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
            <option value="">Choose one…</option>
            {live.map((row) => (
              <option key={row.id} value={row.code}>
                {row.code} · {KIND_WORDS[row.kind] ?? row.kind} · taken {row.uses}
              </option>
            ))}
          </select>
        </label>
        <button
          className="aq-quiet"
          type="button"
          disabled={!chosen || busy}
          onClick={() => void switchOff()}
        >
          Switch it off
        </button>
      </div>
      <p className="ac-note">
        Switching off is the only way to stop a code. Nothing here deletes one: the redemptions
        point at it, and a grant whose code has vanished is a row nobody can explain.
      </p>
    </section>
  );
}

/** What was minted, said back in the operator's register: plainly, with the numbers. */
function minted(row: PromoCodeRow): string {
  const limit = row.max_uses === null ? 'no limit on uses' : `up to ${row.max_uses} uses`;
  return `${row.code} is live: ${KIND_WORDS[row.kind] ?? row.kind}, ${limit}.`;
}

/** The gateway's own words where it gave us any, and this console's where it did not. Never a
 *  status code on its own: a number tells an operator nothing they can act on. */
function refusal(result: Fetched<unknown>, what: string): string {
  if (result.ok) return '';
  if (result.status === 409) return `${what}: there is already a code with that name.`;
  if (result.status === 422) {
    return `${what}: the gateway would not take that — check the fields you typed.`;
  }
  if (result.status === 404) return `${what}: there is no code with that name.`;
  if (result.reason === 'not_permitted') {
    return `${what}: this seat may not mint codes, or the session needs you to prove it is you again.`;
  }
  return `${what}: ${FAILURE_COPY[result.reason]}.`;
}
