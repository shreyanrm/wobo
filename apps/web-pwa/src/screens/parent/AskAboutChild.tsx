'use client';

/**
 * ASK WOBO ABOUT MY CHILD, and the parent's own mind beside it (docs/TWO-MINDS.md).
 *
 * The parent asks in their own words and Wobo answers from the child's report-level record through
 * `POST /v1/parent/ask`, never from the child's words: the gateway assembles the context behind an
 * allow-list and answers a request for the child's own words with a warm line and no model call.
 * This screen has no route to anything else, so it cannot show what the gateway will not give.
 *
 * The thread is the record's (docs/MEMORY-LAW.md): it is read back from `GET /v1/parent/ask` on
 * open, and nothing here is kept on the device. When Wobo hears a fact about the child in a
 * question, it asks the parent before anything moves: "Pass it on" stages an offer, the server's
 * note says what passing on means, and only "Yes, pass it on" puts it in the child's mind, marked
 * as from their parent and removable by the child.
 *
 * At a desk the ask and the memory page sit side by side; on a phone a two-way switch picks one.
 * The parent shell (screens/parent, the home and the switch) decides which child is in view; this
 * screen re-reads everything when `learnerId` changes, so no word of the last child is carried.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { GATEWAY_URL } from '../../store/app-sdk';
import { Button, Chip, Segmented } from '../../ui/primitives';
import type { MindFact, OfferRow, ParentMind, Turn } from './ask-wire';
import * as wire from './ask-wire';
import { ParentMemoryView, type Scope } from './ParentMemory';
import { TalkGate } from './TalkFrame';
import { TALK_COPY } from './talk-copy';
import './parent-talk.css';

export type OfferFlow =
  | { phase: 'suggested'; body: string }
  | { phase: 'staged'; body: string; id: string; note: string }
  | { phase: 'passed'; body: string }
  | { phase: 'kept'; body: string };

export interface AskAboutChildViewProps {
  childName: string | null;
  thread: readonly Turn[];
  draft: string;
  sending: boolean;
  line: string | null;
  flow: OfferFlow | null;
  /** A request about the offer is out. */
  busy: boolean;
  onDraft: (text: string) => void;
  onAsk: (question: string) => void;
  onOfferPass: () => void;
  onOfferNotNow: () => void;
  onDecide: (accept: boolean) => void;
}

function OfferCard({
  flow,
  childName,
  busy,
  onOfferPass,
  onOfferNotNow,
  onDecide,
}: {
  flow: OfferFlow;
  childName: string | null;
  busy: boolean;
  onOfferPass: () => void;
  onOfferNotNow: () => void;
  onDecide: (accept: boolean) => void;
}) {
  if (flow.phase === 'passed' || flow.phase === 'kept') {
    return (
      <p className="pt-line" role="status">
        {flow.phase === 'passed' ? TALK_COPY.offerPassed(childName) : TALK_COPY.offerKept}
      </p>
    );
  }
  return (
    <fieldset className="pt-card">
      <legend className="pt-card-q">{TALK_COPY.offerAsk}</legend>
      <p className="pt-quote">{flow.body}</p>
      {flow.phase === 'staged' && flow.note ? <p className="pt-note">{flow.note}</p> : null}
      <div className="pt-acts">
        {flow.phase === 'suggested' ? (
          <>
            <Button tone="ink" size="sm" disabled={busy} onClick={onOfferPass}>
              {TALK_COPY.offerPass}
            </Button>
            <Button tone="quiet" size="sm" disabled={busy} onClick={onOfferNotNow}>
              {TALK_COPY.offerNotNow}
            </Button>
          </>
        ) : (
          <>
            <Button tone="ink" size="sm" disabled={busy} onClick={() => onDecide(true)}>
              {TALK_COPY.offerYes}
            </Button>
            <Button tone="quiet" size="sm" disabled={busy} onClick={() => onDecide(false)}>
              {TALK_COPY.offerKeep}
            </Button>
          </>
        )}
      </div>
    </fieldset>
  );
}

export function AskAboutChildView({
  childName,
  thread,
  draft,
  sending,
  line,
  flow,
  busy,
  onDraft,
  onAsk,
  onOfferPass,
  onOfferNotNow,
  onDecide,
}: AskAboutChildViewProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sending && draft.trim()) onAsk(draft);
  };
  return (
    <section className="pt-ask" aria-labelledby="pt-ask-title">
      <header className="pt-head">
        <h1 id="pt-ask-title" className="pt-title">
          {TALK_COPY.askTitle(childName)}
        </h1>
        <p className="pt-lede">{TALK_COPY.askLede}</p>
      </header>

      {thread.length ? (
        <ol className="pt-thread" aria-live="polite">
          {thread.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a thread is append-only and read whole
            <li key={i} className="pt-turn" data-role={t.role}>
              <span className="pt-who">{t.role === 'parent' ? TALK_COPY.you : TALK_COPY.wobo}</span>
              <p className="pt-said">{t.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="pt-sugs">
          {TALK_COPY.askSuggestions.map((q) => (
            <Chip key={q} className="pt-sug" onClick={() => onAsk(q)} disabled={sending}>
              {q}
            </Chip>
          ))}
        </div>
      )}

      {flow ? (
        <OfferCard
          flow={flow}
          childName={childName}
          busy={busy}
          onOfferPass={onOfferPass}
          onOfferNotNow={onOfferNotNow}
          onDecide={onDecide}
        />
      ) : null}

      {line ? (
        <p className="pt-line" role="status">
          {line}
        </p>
      ) : null}

      <form className="pt-askbar" onSubmit={submit}>
        <input
          className="pt-input"
          aria-label={TALK_COPY.askLabel}
          maxLength={1000}
          value={draft}
          placeholder={TALK_COPY.askPlaceholder}
          onChange={(e) => onDraft(e.target.value)}
        />
        <Button type="submit" tone="pig" disabled={sending || !draft.trim()}>
          {sending ? TALK_COPY.askSending : TALK_COPY.askSend}
        </Button>
      </form>
    </section>
  );
}

/** The codes that mean the page cannot open at all, rather than that one request failed. */
const GATE_CODES = new Set([
  'no_child_selected',
  'no_such_child',
  'not_a_parent_account',
  'sign_in_required',
  'no_gateway',
]);

type Pane = 'ask' | 'memory';

export interface AskAboutChildProps {
  /** The child the parent shell has in view. A change re-reads everything from the record. */
  learnerId?: string;
  /** Where "Choose a child" goes. The parent home by default. */
  onChooseChild?: () => void;
}

export function AskAboutChild({ learnerId, onChooseChild }: AskAboutChildProps) {
  const router = useRouter();
  const [gate, setGate] = useState<{ code: string; message: string } | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pane, setPane] = useState<Pane>('ask');

  const [thread, setThread] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [askLine, setAskLine] = useState<string | null>(null);
  const [flow, setFlow] = useState<OfferFlow | null>(null);
  const [busy, setBusy] = useState(false);

  const [mind, setMind] = useState<ParentMind | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [tell, setTell] = useState('');
  const [scope, setScope] = useState<Scope>('child');
  const [telling, setTelling] = useState(false);
  const [memLine, setMemLine] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ id: string; note: string } | null>(null);

  // A reply that lands after the child in view has changed belongs to the last child: dropped.
  const epoch = useRef(0);

  /** One failed request: a gate if the page cannot go on, otherwise the line it came with. */
  const settle = useCallback(
    (r: { ok: false; code: string; message: string }, say: (line: string) => void) => {
      if (GATE_CODES.has(r.code)) setGate({ code: r.code, message: r.message });
      else say(r.message);
    },
    [],
  );

  const readMemory = useCallback(async () => {
    const mine = epoch.current;
    const [m, o] = await Promise.all([wire.readMind(GATEWAY_URL), wire.listOffers(GATEWAY_URL)]);
    if (mine !== epoch.current) return;
    if (m.ok) setMind(m.value);
    else settle(m, setMemLine);
    if (o.ok) setOffers(o.value);
  }, [settle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the child in view is the trigger
  useEffect(() => {
    epoch.current += 1;
    const mine = epoch.current;
    setGate(null);
    setReady(false);
    setThread([]);
    setFlow(null);
    setAskLine(null);
    setMind(null);
    setOffers([]);
    setStaged(null);
    setMemLine(null);
    setDraft('');
    setTell('');
    void (async () => {
      const child = await wire.readChild(GATEWAY_URL);
      if (mine !== epoch.current) return;
      if (!child.ok) {
        setGate({ code: child.code, message: child.message });
        setReady(true);
        return;
      }
      setChildName(child.value.name);
      const t = await wire.readThread(GATEWAY_URL);
      if (mine !== epoch.current) return;
      if (t.ok) setThread(t.value);
      else settle(t, setAskLine);
      setReady(true);
      await readMemory();
    })();
  }, [learnerId, readMemory, settle]);

  const onAsk = async (question: string) => {
    const text = question.replace(/\s+/g, ' ').trim();
    if (!text || sending) return;
    const mine = epoch.current;
    setSending(true);
    setAskLine(null);
    setFlow(null);
    setDraft('');
    setThread((t) => [...t, { role: 'parent', text, at: new Date().toISOString() }]);
    const r = await wire.ask(GATEWAY_URL, text);
    if (mine !== epoch.current) return;
    setSending(false);
    if (!r.ok) {
      // The question did not land in the record, so it does not stay on the screen either.
      setThread((t) => t.slice(0, -1));
      setDraft(text);
      settle(r, setAskLine);
      return;
    }
    setThread((t) => [...t, { role: 'wobo', text: r.value.say, at: new Date().toISOString() }]);
    if (r.value.offer) setFlow({ phase: 'suggested', body: r.value.offer });
  };

  const stage = async (body: string) => {
    const r = await wire.offer(GATEWAY_URL, body);
    if (!r.ok) return r;
    await readMemory();
    return r;
  };

  const onOfferPass = async () => {
    if (flow?.phase !== 'suggested' || busy) return;
    const mine = epoch.current;
    setBusy(true);
    const r = await stage(flow.body);
    if (mine !== epoch.current) return;
    setBusy(false);
    if (!r.ok) {
      setFlow(null);
      settle(r, setAskLine);
      return;
    }
    setFlow({ phase: 'staged', body: flow.body, id: r.value.offer.id, note: r.value.note });
  };

  const onAskDecide = async (accept: boolean) => {
    if (flow?.phase !== 'staged' || busy) return;
    const mine = epoch.current;
    setBusy(true);
    const r = await wire.decide(GATEWAY_URL, flow.id, accept);
    if (mine !== epoch.current) return;
    setBusy(false);
    if (!r.ok) {
      setFlow(null);
      settle(r, setAskLine);
      return;
    }
    setFlow({ phase: r.value.status === 'accepted' ? 'passed' : 'kept', body: flow.body });
    void readMemory();
  };

  const onRemember = async () => {
    if (telling || !tell.trim()) return;
    const mine = epoch.current;
    setTelling(true);
    setMemLine(null);
    const r = await wire.remember(GATEWAY_URL, tell, scope);
    if (mine !== epoch.current) return;
    setTelling(false);
    if (!r.ok) return settle(r, setMemLine);
    setTell('');
    await readMemory();
  };

  const onForget = async (fact: MindFact) => {
    if (working) return;
    const mine = epoch.current;
    setWorking(fact.id);
    setMemLine(null);
    const r = await wire.forget(GATEWAY_URL, fact.id);
    if (mine !== epoch.current) return;
    setWorking(null);
    if (!r.ok) return settle(r, setMemLine);
    await readMemory();
  };

  const onOfferFact = async (fact: MindFact) => {
    if (working) return;
    const mine = epoch.current;
    setWorking(fact.id);
    setMemLine(null);
    const r = await stage(fact.body);
    if (mine !== epoch.current) return;
    setWorking(null);
    if (!r.ok) return settle(r, setMemLine);
    setStaged({ id: r.value.offer.id, note: r.value.note });
  };

  const onMemDecide = async (id: string, accept: boolean) => {
    if (working) return;
    const mine = epoch.current;
    setWorking(id);
    setMemLine(null);
    const r = await wire.decide(GATEWAY_URL, id, accept);
    if (mine !== epoch.current) return;
    setWorking(null);
    setStaged(null);
    if (!r.ok) return settle(r, setMemLine);
    await readMemory();
  };

  const choose = onChooseChild ?? (() => router.navigate({ name: 'parent' }));

  if (gate) {
    return (
      <div className="pt-talk pt-solo">
        <TalkGate
          code={gate.code}
          message={gate.message}
          onChoose={choose}
          onSignIn={() => router.navigate({ name: 'sign-in' })}
        />
      </div>
    );
  }
  // Nothing is shown until the record has answered: never a caption for an absence.
  if (!ready) return <div className="pt-talk" aria-busy="true" />;

  return (
    <div className="pt-talk">
      <Segmented<Pane>
        className="pt-panes"
        options={[
          { id: 'ask', label: TALK_COPY.tabAsk },
          { id: 'memory', label: TALK_COPY.tabMemory },
        ]}
        value={pane}
        onChange={setPane}
      />
      <div className={pane === 'ask' ? 'pt-pane' : 'pt-pane pt-off'} data-pane="ask">
        <AskAboutChildView
          childName={childName}
          thread={thread}
          draft={draft}
          sending={sending}
          line={askLine}
          flow={flow}
          busy={busy}
          onDraft={setDraft}
          onAsk={(q) => void onAsk(q)}
          onOfferPass={() => void onOfferPass()}
          onOfferNotNow={() => setFlow(null)}
          onDecide={(accept) => void onAskDecide(accept)}
        />
      </div>
      <div className={pane === 'memory' ? 'pt-pane' : 'pt-pane pt-off'} data-pane="memory">
        <ParentMemoryView
          childName={childName}
          mind={mind}
          offers={offers}
          draft={tell}
          scope={scope}
          sending={telling}
          line={memLine}
          working={working}
          staged={staged}
          onDraft={setTell}
          onScope={setScope}
          onRemember={() => void onRemember()}
          onForget={(f) => void onForget(f)}
          onOfferFact={(f) => void onOfferFact(f)}
          onDecide={(id, accept) => void onMemDecide(id, accept)}
        />
      </div>
    </div>
  );
}
