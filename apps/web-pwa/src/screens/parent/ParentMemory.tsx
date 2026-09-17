/**
 * The parent's memory page (docs/TWO-MINDS.md): what the parent told Wobo about this child and
 * about the household, what came from the weekly note, and what the parent has offered to the
 * child's own mind.
 *
 * Steerable and never hidden, the same promise the child's memory page makes: every line says
 * where it came from and every line can be cleared. Only a line the PARENT said about THIS child
 * can be offered on; a report line is the child's record already, and the family layer is the
 * household's. An offer is staged first, the server's note is read, and only a yes passes it on.
 *
 * `ParentMemoryView` is the markup from props, so a test reads it without a browser; the wiring
 * lives in AskAboutChild.tsx, which holds both halves of the parent's page.
 */

import type { FormEvent } from 'react';
import { Button, Segmented } from '../../ui/primitives';
import type { MindFact, OfferRow, ParentMind } from './ask-wire';
import { TALK_COPY } from './talk-copy';

export type Scope = 'child' | 'family';

export interface ParentMemoryViewProps {
  childName: string | null;
  /** Null until the record has answered; nothing is shown in its place. */
  mind: ParentMind | null;
  offers: readonly OfferRow[];
  draft: string;
  scope: Scope;
  sending: boolean;
  line: string | null;
  /** The id of the fact or offer a request is out for, so its buttons hold still. */
  working: string | null;
  /** The offer waiting for the parent's yes, with the server's note. */
  staged: { id: string; note: string } | null;
  onDraft: (text: string) => void;
  onScope: (scope: Scope) => void;
  onRemember: () => void;
  onForget: (fact: MindFact) => void;
  onOfferFact: (fact: MindFact) => void;
  onDecide: (id: string, accept: boolean) => void;
}

function statusWord(status: OfferRow['status']): string {
  if (status === 'pending') return TALK_COPY.statusPending;
  if (status === 'withdrawn') return TALK_COPY.statusWithdrawn;
  return TALK_COPY.statusAccepted;
}

function FactRow({
  fact,
  offerable,
  childName,
  working,
  offered,
  onForget,
  onOfferFact,
}: {
  fact: MindFact;
  offerable: boolean;
  childName: string | null;
  working: string | null;
  offered: boolean;
  onForget: (fact: MindFact) => void;
  onOfferFact: (fact: MindFact) => void;
}) {
  const busy = working === fact.id;
  return (
    <li className="pt-fact" data-fact={fact.id} data-source={fact.source}>
      <p className="pt-fact-text">
        {fact.body}
        <span className="pt-tag">
          {fact.source === 'report' ? TALK_COPY.sourceReport : TALK_COPY.sourceParent}
        </span>
      </p>
      <div className="pt-fact-acts">
        {offerable && !offered ? (
          <Button tone="quiet" size="sm" disabled={busy} onClick={() => onOfferFact(fact)}>
            {TALK_COPY.offerTo(childName)}
          </Button>
        ) : null}
        <Button tone="quiet" size="sm" disabled={busy} onClick={() => onForget(fact)}>
          {busy ? TALK_COPY.forgetting : TALK_COPY.forget}
        </Button>
      </div>
    </li>
  );
}

export function ParentMemoryView({
  childName,
  mind,
  offers,
  draft,
  scope,
  sending,
  line,
  working,
  staged,
  onDraft,
  onScope,
  onRemember,
  onForget,
  onOfferFact,
  onDecide,
}: ParentMemoryViewProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sending && draft.trim()) onRemember();
  };
  const offeredBodies = new Set(offers.map((o) => o.body.toLowerCase()));
  const row = (fact: MindFact, offerable: boolean) => (
    <FactRow
      key={fact.id}
      fact={fact}
      offerable={offerable && fact.source === 'parent'}
      childName={childName}
      working={working}
      offered={offeredBodies.has(fact.body.toLowerCase())}
      onForget={onForget}
      onOfferFact={onOfferFact}
    />
  );

  return (
    <section className="pt-mem" aria-labelledby="pt-mem-title">
      <header className="pt-head">
        <h2 id="pt-mem-title" className="pt-title">
          {TALK_COPY.memoryTitle}
        </h2>
        <p className="pt-lede">{TALK_COPY.memoryLede}</p>
      </header>

      <form className="pt-tell" onSubmit={submit}>
        <label className="pt-label" htmlFor="pt-tell-input">
          {TALK_COPY.tellLabel}
        </label>
        <textarea
          id="pt-tell-input"
          className="pt-input"
          rows={2}
          maxLength={500}
          value={draft}
          placeholder={TALK_COPY.tellPlaceholder}
          onChange={(e) => onDraft(e.target.value)}
        />
        <div className="pt-tell-row">
          <Segmented<Scope>
            className="pt-scope"
            options={[
              { id: 'child', label: TALK_COPY.scopeChild(childName) },
              { id: 'family', label: TALK_COPY.scopeFamily },
            ]}
            value={scope}
            onChange={onScope}
          />
          <Button type="submit" tone="ink" disabled={sending || !draft.trim()}>
            {sending ? TALK_COPY.tellSending : TALK_COPY.tellSend}
          </Button>
        </div>
      </form>

      {line ? (
        <p className="pt-line" role="status">
          {line}
        </p>
      ) : null}

      {mind ? (
        <>
          <div className="pt-group">
            <h3 className="pt-sub">{TALK_COPY.aboutChild(childName)}</h3>
            {mind.child.length ? (
              <ul className="pt-list">{mind.child.map((f) => row(f, true))}</ul>
            ) : (
              <p className="pt-empty">{TALK_COPY.emptyChild(childName)}</p>
            )}
          </div>
          <div className="pt-group">
            <h3 className="pt-sub">{TALK_COPY.aboutFamily}</h3>
            {mind.family.length ? (
              <ul className="pt-list">{mind.family.map((f) => row(f, false))}</ul>
            ) : (
              <p className="pt-empty">{TALK_COPY.emptyFamily}</p>
            )}
          </div>
        </>
      ) : null}

      {offers.length ? (
        <div className="pt-group">
          <h3 className="pt-sub">{TALK_COPY.offeredTitle(childName)}</h3>
          <p className="pt-note">{TALK_COPY.offeredLede(childName)}</p>
          <ul className="pt-list">
            {offers.map((o) => (
              <li className="pt-offer" key={o.id} data-status={o.status}>
                <div className="pt-offer-main">
                  <p className="pt-fact-text">{o.body}</p>
                  <span className={o.status === 'accepted' ? 'pt-state pt-done' : 'pt-state'}>
                    {statusWord(o.status)}
                  </span>
                </div>
                {o.status === 'pending' ? (
                  <div className="pt-stage">
                    {staged?.id === o.id && staged.note ? (
                      <p className="pt-note">{staged.note}</p>
                    ) : null}
                    <div className="pt-acts">
                      <Button
                        tone="ink"
                        size="sm"
                        disabled={working === o.id}
                        onClick={() => onDecide(o.id, true)}
                      >
                        {TALK_COPY.offerYes}
                      </Button>
                      <Button
                        tone="quiet"
                        size="sm"
                        disabled={working === o.id}
                        onClick={() => onDecide(o.id, false)}
                      >
                        {TALK_COPY.offerKeep}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
