'use client';

/**
 * "Have a code?" — the one promo field, on both of the surfaces that have one.
 *
 * docs/ALLOWANCE.md §3 puts a promo field at the checkout and on You. This is that field, once:
 * the plans page mounts it on the checkout card and the plan panel mounts it under the plan, and
 * they get the same label, the same control, the same result line and the same failure, because it
 * is the same component. Everything it says and every state it can be in lives in `./promo.ts`,
 * which has no React in it, so "a code is only claimed when the server said so" is proved in
 * `./promo.test.ts` rather than asserted here.
 *
 * This file is the drawing and the accessibility:
 *  · A real `<label>` bound to the field, never a placeholder standing in for one.
 *  · The result is a live region, so a learner who cannot see the line is still told what
 *    happened, and it is `aria-describedby` the field, so moving back to the box reads it again.
 *  · A failure marks the field `aria-invalid`, which is a state and not a colour.
 *  · The button says what it is doing while it works and cannot be pressed twice; it is
 *    `aria-disabled` rather than `disabled`, so the busy word stays reachable to a screen reader.
 *  · Enter submits, because a one-field form where Enter does nothing is a trap.
 */

import { type ReactNode, useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import {
  initialPromo,
  normaliseCode,
  PROMO_BUSY,
  PROMO_LABEL,
  PROMO_SUBMIT,
  type PromoOutcome,
  promoReducer,
  redeemPromo,
} from './promo';
import './promo.css';

export interface PromoFieldProps {
  /**
   * Told when the server has just honoured a code, with the code as the gateway saw it. The
   * checkout carries it into the session it then creates; You has nothing to carry it to and
   * leaves this out.
   */
  onApplied?: (code: string) => void;
  /** The redeem client, injectable so a test can drive a refusal without a network. */
  redeem?: typeof redeemPromo;
  className?: string;
}

export function PromoField({
  onApplied,
  redeem = redeemPromo,
  className,
}: PromoFieldProps): ReactNode {
  const [model, dispatch] = useReducer(promoReducer, initialPromo);
  const id = useId();
  const fieldId = `${id}-code`;
  const saidId = `${id}-said`;
  const busy = model.step === 'checking';
  // The page may be left while the gateway is still answering; nothing then lands on a dead field.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The attempt in flight, carrying the code it is about. An object rather than a counter so the
   * effect depends on nothing that can go stale: the code it posts is the code that was in the box
   * when the button was pressed, and a later keystroke cannot change what is being asked.
   *
   * Deliberately unguarded against StrictMode's dev-only double-invoke: a ref that skipped the
   * second pass would also swallow the outcome (the first pass's cleanup has already dropped it)
   * and the button would spin with no answer at all. Redeeming twice is the gateway's to be
   * idempotent about, and it is: a code already on this account comes back `promo_used`.
   */
  const [attempt, setAttempt] = useState<{ n: number; code: string } | null>(null);
  useEffect(() => {
    if (!attempt) return;
    let dropped = false;
    void redeem(attempt.code).then((outcome: PromoOutcome) => {
      if (dropped || !mounted.current) return;
      dispatch({ type: 'settled', outcome });
      if (outcome.ok) onApplied?.(attempt.code);
    });
    return () => {
      dropped = true;
    };
  }, [attempt, redeem, onApplied]);

  const submit = useCallback(() => {
    if (busy) return;
    dispatch({ type: 'check' });
    // `check` refuses an empty box itself and leaves the step idle; only a code worth asking about
    // gets an attempt, and it is normalised once, here, so the field and the wire agree.
    const code = normaliseCode(model.code);
    if (code) setAttempt((last) => ({ n: (last?.n ?? 0) + 1, code }));
  }, [busy, model.code]);

  return (
    <form
      className={className ? `pm ${className}` : 'pm'}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={fieldId}>{PROMO_LABEL}</label>
      <div className="pm-row">
        <input
          id={fieldId}
          name="promo"
          value={model.code}
          onChange={(e) => dispatch({ type: 'type', value: e.target.value })}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          {...(model.ok === false ? { 'aria-invalid': true as const } : {})}
          {...(model.line ? { 'aria-describedby': saidId } : {})}
        />
        <button type="submit" aria-disabled={busy ? 'true' : undefined}>
          {busy ? PROMO_BUSY : PROMO_SUBMIT}
        </button>
      </div>
      {/* What happened, in one line, announced. Never a colour and never a tick: the sentence is
          the state (DESIGN.md §0). */}
      {model.line ? (
        <p className="pm-said" id={saidId} role="status" aria-live="polite">
          {model.line}
        </p>
      ) : null}
    </form>
  );
}
