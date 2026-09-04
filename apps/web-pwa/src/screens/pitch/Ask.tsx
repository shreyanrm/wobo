'use client';

/**
 * The ask block at the end of a pitch page — the site shell's block (Wobo's head, the label, one
 * line, the box, the chips), wired to the door a visitor can actually use.
 *
 * Where the question goes:
 *   · a signed-in learner's question is asked on the way and the conversation opens, as the
 *     shell's own AskWobo does — the tutor is a better answer than a help page;
 *   · a visitor with no account asks the public door (`askPublic.ts` → POST /v1/ask, help-grounded,
 *     unauthenticated, a tiny allowance) and Wobo's reply is written under the box, in its own
 *     hand, typed — whole at once under reduced motion, and `aria-live` so it is read as one line;
 *   · with no gateway configured (a hermetic build, a test) there is nobody to ask, so the visitor
 *     is taken to the door where signing in happens, which is what the shell's block does too.
 *
 * The words are the page's own; the block adds nothing.
 */

import { useReducedMotion } from '@wobo/motion';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { useViewport } from '../../shell/useViewport';
import { useSdk } from '../../store/sdk';
import { AskBox, Chip, Label, WoboHead } from '../../ui/primitives';
import { useWoboChat } from '../../wobo/chat';
import { type AskPage, askPublic, TYPE_STEP, TYPE_TICK_MS } from './askPublic';

export interface PitchAskProps {
  /** The prototype's page key, sent with the question so the gateway can count by page. */
  page: AskPage;
  /** The small pigment label. The prototypes say "Still wondering?". */
  label?: string;
  /** The line under it. */
  heading: string;
  /** The question already in the box, as a placeholder. */
  placeholder: string;
  /** Questions people ask, as chips. */
  chips: readonly string[];
}

export function PitchAsk({
  page,
  label = 'Still wondering?',
  heading,
  placeholder,
  chips,
}: PitchAskProps) {
  const router = useRouter();
  const sdk = useSdk();
  const chat = useWoboChat();
  const reduced = useReducedMotion();
  const { width } = useViewport();
  const [reply, setReply] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearInterval(timer.current);
    };
  }, []);

  // The typewriter: one interval per reply, cleared the moment the reply is finished or replaced.
  useEffect(() => {
    clearInterval(timer.current);
    if (reply === null) return;
    if (reduced) {
      setChars(reply.length);
      return;
    }
    setChars(0);
    timer.current = setInterval(() => {
      setChars((c) => {
        const next = c + TYPE_STEP;
        if (next >= reply.length) clearInterval(timer.current);
        return Math.min(reply.length, next);
      });
    }, TYPE_TICK_MS);
    return () => clearInterval(timer.current);
  }, [reply, reduced]);

  const signedIn = sdk.config.devAuth || sdk.identity.isAuthenticated();
  const gateway = sdk.config.gatewayUrl;

  const ask = (text: string) => {
    if (signedIn) {
      void chat.ask(text);
      router.navigate({ name: 'chat' });
      return;
    }
    if (!gateway) {
      router.navigate({ name: 'onboarding' });
      return;
    }
    if (busy) return;
    setBusy(true);
    setReply(null);
    void askPublic(gateway, text, page).then((answer) => {
      if (!alive.current) return;
      setBusy(false);
      setReply(answer.answer);
    });
  };

  return (
    <div className="st-ask">
      <WoboHead size={width <= 900 ? 80 : 120} shadow mood={busy ? 'thinking' : 'idle'} />
      <div>
        <Label>{label}</Label>
        <h2 style={{ marginTop: 8 }}>{heading}</h2>
        {/* INK, NOT PIG — the same rule as `site/AskWobo.tsx`. This block sits roughly six
            hundred pixels above the page's ClosePanel, whose primary IS the conversion. Two
            saturated pills of the same size within a screen of each other at the point of decision
            are two calls to action, and two convert worse than one (docs/SELL.md §6); DESIGN.md §0
            allows one pointer per view. The ask is the demo, the close is the door. */}
        <AskBox placeholder={placeholder} onAsk={ask} tone="ink" label="Ask Wobo" mic={false} />
        <div className="st-chips">
          {chips.map((chip) => (
            <Chip key={chip} onClick={() => ask(chip)}>
              {chip}
            </Chip>
          ))}
        </div>
        {busy || reply !== null ? (
          <p className={busy ? 'pt-reply pt-busy' : 'pt-reply'} aria-live="polite">
            {busy ? '…' : reply?.slice(0, chars)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
