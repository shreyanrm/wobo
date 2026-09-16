'use client';

/**
 * "Your plan" — the panel on the You screen, and the one-step confirmation behind its Cancel.
 *
 * The plans page has printed this sentence for a while: "You → Your plan → Cancel. Two taps, no
 * call, no 'are you sure' maze. You keep the plan until the month you paid for ends." Until now
 * there was no Your plan, no Cancel and no subscription behind either. This is that panel, and the
 * count is the sentence's own: the Cancel control sits on the screen (tap one, the confirmation),
 * and the confirmation cancels (tap two). Nothing is hidden behind a "manage", a submenu or a
 * disclosure, because a control you have to find first is a control that costs a tap.
 *
 * Everything the panel says and every tap it accepts lives in `./plan.ts`, which has no React in
 * it — so "two taps reach the confirmation" and "a failed request leaves the plan active" are
 * proved in `./plan.test.ts` rather than asserted here. This file is the drawing and the
 * accessibility, and it renders `planControls` and nothing else.
 *
 * Accessibility is not decoration on this screen; it is where someone takes their money back.
 * The confirmation is a real dialog: focus moves into it, Tab cycles inside it, Escape leaves it,
 * and focus comes back to the control that opened it (or to the plan's own live region, when that
 * control is gone because the cancel landed). The state is a word in that region, never a colour.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardFoot, Pill, Tag } from '../../ui/primitives';
import { PromoField } from '../promo/PromoField';
import { cancelSubscription, readSubscription, resumeSubscription } from './billing';
import {
  CONFIRM_TITLE,
  type ControlId,
  confirmationLines,
  confirmControls,
  initialModel,
  isConfirming,
  moneyLine,
  type PlanControl,
  panelControls,
  panelLines,
  panelTitle,
  panelView,
  planReducer,
  stateWord,
} from './plan';
import { TODAY_TITLE, type Today, todayFill, todayLines, todaySpoken, UNREAD } from './today';
import './plan.css';

/**
 * The id the Cancel control carries, so focus can come back to it when the confirmation closes.
 * An id rather than a ref because the kit's <Button> is a plain function component and forwards
 * its props to the <button>, not a ref.
 */
const CANCEL_ID = 'wp-cancel';

export interface PlanPanelProps {
  /**
   * The plan `GET /v1/me` already told the You screen. A SECOND witness, never the only one: it
   * rides the same gateway as the subscription read, so when that gateway is down this is null
   * too. The panel's "I could not read your plan" therefore hangs off the read's own tri-state
   * (`SubscriptionRead`), and this only sharpens the heading when the tier is known.
   */
  planId: string | null;
  /**
   * TODAY, as a share of itself and never as money (docs/ALLOWANCE.md §2). Read off the same
   * `GET /v1/me` the plan id comes from, so the bar and the heading are one answer rather than
   * two; unread, no bar is drawn at all, because an empty bar would say "you have spent nothing
   * today" on no evidence.
   */
  today?: Today;
  /** The plans page. The free state's one door. */
  onSeePlans: () => void;
  /** The billing client, injectable so a test can drive a refusal. */
  read?: typeof readSubscription;
  cancel?: typeof cancelSubscription;
  resume?: typeof resumeSubscription;
}

/** Everything inside the dialog that can hold focus, in DOM order. */
function focusables(node: HTMLElement): HTMLElement[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
    ),
  );
}

interface ConfirmProps {
  lines: readonly string[];
  controls: readonly PlanControl[];
  error: string | null;
  busy: boolean;
  onTap: (id: ControlId) => void;
  /** Escape. The same thing "Keep my plan" does, and the only other way out. */
  onDismiss: () => void;
  /** Where focus goes when the confirmation leaves. */
  restoreFocus: () => void;
}

/**
 * The confirmation. ONE step, and exactly two choices: cancel, and go back. There is deliberately
 * no discount, no pause, no survey and no reason picker in here — the Security page's own promise
 * is "Cancelling takes as many taps as subscribing", and every extra step is a tap.
 */
function CancelConfirm({
  lines,
  controls,
  error,
  busy,
  onTap,
  onDismiss,
  restoreFocus,
}: ConfirmProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Refs, not deps: the effect must run once, or re-running it would drag focus back to the first
  // control on every render (including the one that shows the failure).
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  const locked = useRef(busy);
  locked.current = busy;

  // The trap is set up once, on open. Re-running it would drag focus back to the first control on
  // every render — including the render that shows a failure, which is the one a learner is
  // reading. Every callback it needs rides a ref above, so the dependency list is honestly empty.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    (focusables(node)[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A request is in flight; leaving now would leave the learner guessing what happened.
        if (locked.current) return;
        e.preventDefault();
        dismiss.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(node);
      e.preventDefault();
      if (items.length === 0) {
        node.focus();
        return;
      }
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? at <= 0
          ? items.length - 1
          : at - 1
        : at < 0 || at === items.length - 1
          ? 0
          : at + 1;
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restore.current();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    // The scrim is a scrim and nothing else. A click-outside would be a THIRD way out, reachable
    // by accident with a pointer and by nobody with a keyboard, on the one screen where a stray
    // click costs money either way. The two ways out are the two choices, and Escape.
    <div className="wp-scrim">
      <div
        ref={panel}
        className="wp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wp-confirm-title"
        aria-describedby="wp-confirm-body"
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <h2 id="wp-confirm-title">{CONFIRM_TITLE}</h2>
        <ul id="wp-confirm-body" className="wp-what">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {error ? (
          <p className="wp-bad" role="alert">
            {error}
          </p>
        ) : null}
        <div className="wp-choices">
          {controls.map((control) => (
            <Button
              key={control.id}
              tone={control.tone}
              size={control.size}
              disabled={control.busy}
              onClick={() => onTap(control.id)}
            >
              {control.label}
            </Button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * THE BAR. One bar, named Today, filled by the share of the day already spent, with the reset line
 * under it and, when it is full, the line the question counter already says (`./today.ts`).
 *
 * There is no number on it and there is no money near it: the allowance is rupees in the gateway
 * and a proportion here (docs/ALLOWANCE.md §2, the owner: *"it's not money based at the users'
 * end"*). The drawn bar is hidden from assistive technology, because the only thing it could
 * announce is a percentage and the copy law forbids printing a raw allowance (DESIGN.md §0); the
 * same fact goes to a screen reader as a sentence instead, which is what `todaySpoken` is.
 */
function TodayBar({ today, money }: { today: Today; money: string | null }) {
  const fill = todayFill(today);
  if (fill === null) return null;
  const lines = todayLines(today);
  const spoken = todaySpoken(today);
  return (
    <div className="wp-today">
      <b>{TODAY_TITLE}</b>
      <div className="wp-bar" aria-hidden="true">
        <i style={{ width: `${fill}%` }} />
      </div>
      {spoken ? <span className="wp-sr">{spoken}</span> : null}
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      {/*
       * WHERE THE MONEY GOES, under the day's allowance (docs/copy/money.md, the two rows written
       * for this bar; the owner, 2026-09-15). It says where a plan's money went and never how
       * much: the learner's surfaces carry no currency at all (docs/ALLOWANCE.md §2), which is why
       * these lines name the drawings and the voice rather than a figure.
       *
       * WHICH of the two is true for this learner is `moneyLine` in ./plan.ts, with the rule and
       * the reason. One sentence or none, never two.
       */}
      {money ? <span className="wp-money">{money}</span> : null}
    </div>
  );
}

export function PlanPanel({
  planId,
  today = UNREAD,
  onSeePlans,
  read = readSubscription,
  cancel = cancelSubscription,
  resume = resumeSubscription,
}: PlanPanelProps): ReactNode {
  const [state, dispatch] = useReducer(planReducer, planId, initialModel);
  // The plan id arrives from the screen's own `GET /v1/me`, which may settle after this mounts.
  const model = useMemo(() => ({ ...state, planId }), [state, planId]);
  // One reading of the clock per mount: the panel must not re-render itself on a moving `now`,
  // and the only thing it asks the clock is whether a period end has already passed.
  const now = useMemo(() => new Date(), []);
  const view = panelView(model, now);
  const controls = panelControls(model, now);
  const confirming = isConfirming(model);
  const busy = state.step === 'cancelling' || state.step === 'resuming';

  /** The plan's own text, and the live region: where focus lands when the Cancel control is gone. */
  const stateRegion = useRef<HTMLDivElement | null>(null);

  // The first read, and every retry — `retry` puts the model back into `loading`, which is what
  // this watches, so there is one place a read is made.
  useEffect(() => {
    if (!state.loading) return;
    let dropped = false;
    void read().then((result) => {
      if (!dropped) dispatch({ type: 'read', result });
    });
    return () => {
      dropped = true;
    };
  }, [state.loading, read]);

  // The write. Every path through the client resolves, so a control never spins without an
  // outcome; a failure carries the plan through untouched (see `planReducer`).
  //
  // Deliberately unguarded against StrictMode's dev-only double-invoke. A ref that skipped the
  // second pass would also swallow the second dispatch — the first pass's cleanup has already set
  // `dropped` — and the control would spin with no outcome at all, which is the one thing this
  // panel must never do. Cancel and resume are idempotent by the gateway's own contract, so the
  // worst a second pass costs is a second request that changes nothing. Production runs once.
  useEffect(() => {
    if (state.step !== 'cancelling' && state.step !== 'resuming') return;
    let dropped = false;
    const run = state.step === 'cancelling' ? cancel : resume;
    void run().then((outcome) => {
      if (!dropped) dispatch({ type: 'settled', outcome });
    });
    return () => {
      dropped = true;
    };
  }, [state.step, cancel, resume]);

  const tap = useCallback(
    (id: ControlId) => {
      if (id === 'plans') {
        onSeePlans();
        return;
      }
      dispatch({ type: 'tap', id });
    },
    [onSeePlans],
  );

  /**
   * Back to the control that opened the confirmation. When the cancel landed that control is gone,
   * so focus goes to the plan's own text instead — which is the live region, so the state a
   * learner just changed is where they are put and what they are read.
   */
  const restoreFocus = useCallback(() => {
    const button = typeof document === 'undefined' ? null : document.getElementById(CANCEL_ID);
    if (button) {
      button.focus();
      return;
    }
    stateRegion.current?.focus();
  }, []);

  const word = stateWord(model, now);
  const lines = panelLines(model, now);
  const title = panelTitle(model, now);

  return (
    <Card compact>
      <Tag>Your plan</Tag>
      {/* No heading until there is something true to put in it: "Free" over somebody's paid plan,
          for the second the first read is out, is a claim about their money. */}
      {title ? <h3>{title}</h3> : null}
      {/* The state is a word, in a region a screen reader is told about when it changes — never a
          colour, and never only the presence or absence of a button. */}
      <div className="wp-lines" role="status" aria-live="polite" tabIndex={-1} ref={stateRegion}>
        {view === 'loading' ? (
          <span>Reading your plan…</span>
        ) : (
          lines.map((line) => <span key={line}>{line}</span>)
        )}
      </div>
      {/* TODAY, under the plan and above the way out of it. It is a separate reading from the
          subscription, so it draws whatever it has whichever state the plan is in, and nothing at
          all when the brain has not answered with an allowance. */}
      {/*
        The view is what decides WHICH money line under the bar is true: the paid sentence for a
        plan that pays (a cancelled plan counts — it is paid for until the period ends, and that
        is exactly the stretch the sentence is about), the free learner's own sentence on free,
        and nothing at all while the plan is loading or unreadable, because a line about somebody's
        money made out of a read that never landed is a claim we cannot support — the same trap
        the heading above already refuses to fall into.
      */}
      <TodayBar today={today} money={moneyLine(view)} />
      {state.error && !confirming ? (
        <p className="wp-bad" role="alert">
          {state.error}
        </p>
      ) : null}
      {controls.length > 0 || word ? (
        <CardFoot>
          {controls.map((control) => (
            <Button
              key={control.id}
              {...(control.id === 'cancel' ? { id: CANCEL_ID } : {})}
              tone={control.tone}
              size={control.size}
              disabled={control.busy}
              onClick={() => tap(control.id)}
            >
              {control.label}
            </Button>
          ))}
          {word ? <Pill>{word}</Pill> : null}
        </CardFoot>
      ) : null}
      {/* "Have a code?" — the You half of the redeem door (docs/ALLOWANCE.md §3). The same field
          the checkout card carries, so a code works the same way in both places, and it is the
          last thing on the panel because it is the least of what this card is for. */}
      <PromoField className="wp-promo" />
      {confirming ? (
        <CancelConfirm
          lines={confirmationLines(model.sub)}
          controls={confirmControls(model)}
          error={state.error}
          busy={busy}
          onTap={tap}
          onDismiss={() => tap('back')}
          restoreFocus={restoreFocus}
        />
      ) : null}
    </Card>
  );
}
