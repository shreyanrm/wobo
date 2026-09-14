/**
 * A promo code, as a model and a client — every word the field says and every state it can be in,
 * with no React in it, so "the result is honest" is proved rather than asserted.
 *
 * WHERE IT IS USED. Two surfaces, one component, one voice (docs/ALLOWANCE.md §3: "Redeemed at
 * checkout (a field on the checkout card) or on You"): the checkout card on the plans page, and
 * the plan panel on You. The field looks and behaves the same on both, because it is the same
 * field.
 *
 * THE RULES, and they are the billing client's own (`screens/you/billing.ts`):
 *  · NOTHING IS PRETENDED. No gateway, a refusal, a body we cannot read, a network that never
 *    answered: every one of those is a failure with a plain line, never a cheerful default. A code
 *    is claimed to have worked only when the server said, in its own body, that it did.
 *  · THE SERVER'S WORDS FIRST. A promo has kinds (days of a plan, a bigger day for a while, a
 *    percentage off a first payment) and only the gateway knows which one this code is and what it
 *    gave. When it sends a line, that line is what the learner reads; the constants below are the
 *    fallback for a server that sent none, and they are deliberately vague about the gift rather
 *    than specific about the wrong one.
 *  · NO MONEY, EITHER WAY. Money is internal (docs/ALLOWANCE.md §2), so nothing here prints an
 *    amount, a percentage or a day's figure, and the accepted fallback names no size of gift.
 *    `promo.test.ts` greps every line this file can produce for a digit.
 *
 * The register is 10a (docs/copy/voice.md): short words, a contraction where it is natural, no em
 * dash, no exclamation, sentence case, and the failure says what did NOT happen rather than
 * apologising for it.
 */

import { GATEWAY_COPY, gatewayFetch } from '@wobo/sdk';

/**
 * The gateway's redeem door. Named here and nowhere else in the app, so a rename upstream is one
 * edit; it follows the shape every other learner-owned route on the gateway already has
 * (`/v1/me/erase`, `/v1/me/mail-preferences`, `/v1/me/subscription/cancel`).
 */
export const PROMO_PATH = '/v1/me/promo';

// --- the words -----------------------------------------------------------------------------------

/** The label over the field, on both surfaces. A question, because that is what it is asking. */
export const PROMO_LABEL = 'Have a code?';
export const PROMO_SUBMIT = 'Apply';
export const PROMO_BUSY = 'Checking…';

/** Nothing was typed. Not a failure, and not spoken as one. */
export const PROMO_EMPTY = 'Type the code first and I will check it.';

/** The server said yes and said nothing else. Vague about the gift, certain about the fact. */
export const PROMO_OK = 'That code worked. It is on your account now.';

/** The server said no and said nothing else. */
export const PROMO_NO = 'That code did not work. Check it once more.';

/** The request never landed. The account is exactly as it was, and the line says so. */
export const PROMO_FAILED =
  'That did not go through, so nothing has changed. Try again in a moment.';

/**
 * The refusals worth their own words. Every one of them is a thing the learner can act on, which
 * is the only reason to be specific: a code that is simply wrong and a code that has expired want
 * different next moves. Anything else the gateway refuses with falls to `PROMO_NO`.
 */
export const PROMO_REFUSALS: Readonly<Record<string, string>> = {
  promo_not_found: 'I could not find that code. Check it once more.',
  promo_expired: 'That code has expired.',
  promo_used: 'That code has already been used on this account.',
  promo_exhausted: 'That code has all been claimed.',
  promo_ineligible: 'That code does not apply to this plan.',
  sign_in_required: GATEWAY_COPY.signIn,
};

// --- the code itself -----------------------------------------------------------------------------

/** How long a code may be. Long enough for anything the console can make, short enough to bound. */
export const MAX_CODE = 64;

/**
 * The code as the gateway should see it: upper case, no spaces anywhere, trimmed to a length.
 * A learner pasting "  wobo hello  " and a learner typing "WOBOHELLO" have entered one code, and
 * the field must not be the reason one of them is refused.
 */
export function normaliseCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase().slice(0, MAX_CODE);
}

// --- what a redemption answered ------------------------------------------------------------------

export type PromoOutcome =
  | { ok: true; line: string }
  /** `line` is always a sentence: the server's own where it sent one, else ours. */
  | { ok: false; line: string };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A body's own sentence, wherever the gateway put it (FastAPI wraps a refusal in `detail`). */
export function bodyLine(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { message?: unknown; line?: unknown; detail?: unknown };
  const direct = text(b.message) ?? text(b.line);
  if (direct) return direct;
  const detail = b.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as { message?: unknown; line?: unknown };
    return text(d.message) ?? text(d.line);
  }
  return text(b.detail);
}

/** A body's own refusal code, wherever the gateway put it. */
export function bodyCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { code?: unknown; detail?: unknown };
  const detail = b.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const inner = text((detail as { code?: unknown }).code);
    if (inner) return inner;
  }
  return text(b.code);
}

type Fetch = typeof gatewayFetch;

/**
 * Redeem a code.
 *
 * The gateway decides everything: whether the code exists, whether this account may use it, what
 * it gives and what to say about it. This posts the code and reads the answer, and it treats a
 * body it cannot read as a failure rather than as a success, because a promo that quietly did
 * nothing while the screen said it worked is the one outcome a learner cannot recover from.
 */
export async function redeemPromo(
  code: string,
  gatewayUrl: string | undefined = import.meta.env.VITE_GATEWAY_URL,
  fetcher: Fetch = gatewayFetch,
): Promise<PromoOutcome> {
  const normalised = normaliseCode(code);
  if (!normalised) return { ok: false, line: PROMO_EMPTY };
  if (!gatewayUrl) return { ok: false, line: PROMO_FAILED };
  try {
    const res = await fetcher(`${gatewayUrl}${PROMO_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: normalised }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const named = bodyCode(body);
      const known = named ? PROMO_REFUSALS[named] : undefined;
      return { ok: false, line: bodyLine(body) ?? known ?? PROMO_NO };
    }
    // A 200 that does not say the code was applied is not proof of anything. `applied: false` is
    // how the gateway refuses a code it looked up and would not honour, with its own reason.
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.applied === false || b.ok === false) {
      const named = bodyCode(body);
      const known = named ? PROMO_REFUSALS[named] : undefined;
      return { ok: false, line: bodyLine(body) ?? known ?? PROMO_NO };
    }
    return { ok: true, line: bodyLine(body) ?? PROMO_OK };
  } catch {
    return { ok: false, line: PROMO_FAILED };
  }
}

// --- the field's own state -----------------------------------------------------------------------

export type PromoStep = 'idle' | 'checking';

export interface PromoModel {
  /** What is in the box, exactly as typed. Normalised only on the way out. */
  code: string;
  step: PromoStep;
  /** What the last attempt answered, or null when there has not been one since the last keystroke. */
  ok: boolean | null;
  line: string | null;
}

export const initialPromo: PromoModel = { code: '', step: 'idle', ok: null, line: null };

export type PromoAction =
  | { type: 'type'; value: string }
  | { type: 'check' }
  | { type: 'settled'; outcome: PromoOutcome };

export function promoReducer(model: PromoModel, action: PromoAction): PromoModel {
  if (action.type === 'type') {
    // A result belongs to the code it was about. The moment the code changes it is cleared, so a
    // green line can never stand over a different code from the one it was said about.
    if (model.step === 'checking') return model;
    return { code: action.value, step: 'idle', ok: null, line: null };
  }
  if (action.type === 'check') {
    if (model.step === 'checking') return model;
    if (!normaliseCode(model.code)) return { ...model, ok: false, line: PROMO_EMPTY };
    return { ...model, step: 'checking', ok: null, line: null };
  }
  return { ...model, step: 'idle', ok: action.outcome.ok, line: action.outcome.line };
}
