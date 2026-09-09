'use client';

/**
 * What Wobo remembers: the memory page, the visible half of docs/MEMORY-LAW.md.
 *
 * The list is the RECORD's. On open the wire reads the account (`syncMind({ pull })`) and the
 * device repaints to what came back, with anything still owed laid over it. Every remove goes to
 * the server before the device lets go (`forgetItem`), and a remove the network refused is owed
 * and said so, in one line, never pretended. The facts a parent offered (docs/TWO-MINDS.md) sit in
 * the same list, marked as coming from their parent, and removing one is final.
 *
 * `MindMemoryList` is the markup on its own, from props, so a test can read it without a browser.
 * Trap 1 (DESIGN.md §0): every class here is `wm-`, greppable and used nowhere else.
 */

import { useCallback, useEffect, useState } from 'react';
import { GATEWAY_URL } from '../../store/app-sdk';
import {
  type KnownItem,
  loadMind,
  type MindState,
  observationLines,
  removableItems,
} from '../../store/mind';
import { listOffered, type OfferedFact, removeOffered } from '../../store/mind-offered';
import {
  forgetItem,
  type MindSyncStatus,
  mindSyncStatus,
  onMindSyncChange,
  retryRefused,
  syncMind,
} from '../../store/mind-sync';
import { Button } from '../../ui/primitives';
import './mind-memory.css';

/** The words. Held by a test, never rewritten beside the screen. */
export const MIND_MEMORY_COPY = {
  empty: 'Nothing yet. Tell Wobo what matters to you and it lands here.',
  account: 'This is what your account holds. Sign in anywhere and it is there.',
  device: 'Kept on this device.',
  reading: 'Reading what your account holds.',
  parentTag: 'from your parent',
  parentNote:
    'A line marked from your parent was offered by them and passed on by Wobo, never worked out. Remove it and it stays removed.',
  offeredUnreachable: 'I could not reach that just now. Try once more in a moment.',
  noticed: 'What Wobo has noticed. These change as Wobo watches, so there is nothing to remove.',
  retry: 'try again',
  remove: 'Remove',
  removing: 'Removing',
} as const;

export interface MindMemoryListProps {
  items: readonly KnownItem[];
  offered: readonly OfferedFact[];
  noticed: readonly string[];
  status: MindSyncStatus;
  /** Whether there is a record to read at all: false on a keyless build. */
  wired: boolean;
  /** True while the first read of the record is on the wire and the device has nothing to show. */
  reading: boolean;
  removing: string | null;
  offeredLine: string | null;
  onRemove: (item: KnownItem) => void;
  onRemoveOffered: (offer: OfferedFact) => void;
  onRetry: () => void;
}

export function MindMemoryList({
  items,
  offered,
  noticed,
  status,
  wired,
  reading,
  removing,
  offeredLine,
  onRemove,
  onRemoveOffered,
  onRetry,
}: MindMemoryListProps) {
  const nothing = items.length === 0 && offered.length === 0;
  const source = !wired
    ? MIND_MEMORY_COPY.device
    : reading
      ? MIND_MEMORY_COPY.reading
      : status.stored !== null
        ? MIND_MEMORY_COPY.account
        : null;
  return (
    <div className="wm-mem" data-testid="mind-memory">
      {nothing ? (
        <p className="wm-note">{MIND_MEMORY_COPY.empty}</p>
      ) : (
        <ul className="wm-list">
          {items.map((it) => (
            <li className="wm-row" key={`${it.kind}:${it.text}`}>
              <span className="wm-text">{it.text}</span>
              <Button
                size="sm"
                tone="quiet"
                onClick={() => onRemove(it)}
                disabled={removing === `${it.kind}:${it.text}`}
                aria-label={`${MIND_MEMORY_COPY.remove}: ${it.text}`}
              >
                {removing === `${it.kind}:${it.text}`
                  ? MIND_MEMORY_COPY.removing
                  : MIND_MEMORY_COPY.remove}
              </Button>
            </li>
          ))}
          {offered.map((o) => (
            <li className="wm-row" key={`offered:${o.id}`} data-source="parent">
              {/* A REAL SPACE before the mark, not only the margin the sheet draws. Without it the
                  row is one run in the accessibility tree and a screen reader says "he gets
                  nervous before mathsfrom your parent", gluing the provenance to the fact it is
                  there to qualify. The Remove button's own label already got this right. */}
              <span className="wm-text">
                {o.body} <em className="wm-tag">{MIND_MEMORY_COPY.parentTag}</em>
              </span>
              <Button
                size="sm"
                tone="quiet"
                onClick={() => onRemoveOffered(o)}
                disabled={removing === `offered:${o.id}`}
                aria-label={`${MIND_MEMORY_COPY.remove}, for good: ${o.body}`}
              >
                {removing === `offered:${o.id}`
                  ? MIND_MEMORY_COPY.removing
                  : MIND_MEMORY_COPY.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {status.line ? (
        <p className="wm-note wm-owed" role="status">
          {status.line}
          {status.refused > 0 ? (
            <>
              {' '}
              <button type="button" className="wm-retry" onClick={onRetry} disabled={status.busy}>
                {MIND_MEMORY_COPY.retry}
              </button>
            </>
          ) : null}
        </p>
      ) : source ? (
        <p className="wm-note">{source}</p>
      ) : null}
      {offeredLine ? (
        <p className="wm-note" role="status">
          {offeredLine}
        </p>
      ) : null}
      {offered.length > 0 ? <p className="wm-note">{MIND_MEMORY_COPY.parentNote}</p> : null}
      {noticed.length > 0 ? (
        <div className="wm-noticed">
          <p className="wm-note">{MIND_MEMORY_COPY.noticed}</p>
          <ul className="wm-quiet">
            {noticed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function MindMemory() {
  const [mind, setMind] = useState<MindState>(() => loadMind());
  const [status, setStatus] = useState<MindSyncStatus>(() => mindSyncStatus());
  const [offered, setOffered] = useState<OfferedFact[]>([]);
  const [offeredLine, setOfferedLine] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reading, setReading] = useState<boolean>(() => Boolean(GATEWAY_URL));

  const refresh = useCallback(() => {
    setMind(loadMind());
    setStatus(mindSyncStatus());
  }, []);

  // The record is the truth: read it on open, and repaint on every change the wire reports.
  useEffect(() => {
    let live = true;
    const off = onMindSyncChange(refresh);
    void syncMind({ pull: true, force: true }).finally(() => {
      if (!live) return;
      setReading(false);
      refresh();
    });
    void listOffered(GATEWAY_URL).then((list) => {
      if (live && list) setOffered(list);
    });
    return () => {
      live = false;
      off();
    };
  }, [refresh]);

  const remove = async (item: KnownItem) => {
    if (removing) return;
    const key = `${item.kind}:${item.text}`;
    setRemoving(key);
    try {
      await forgetItem(item.kind, item.text);
    } finally {
      refresh();
      setRemoving(null);
    }
  };

  const removeParentFact = async (offer: OfferedFact) => {
    if (removing) return;
    setRemoving(`offered:${offer.id}`);
    setOfferedLine(null);
    try {
      const gone = await removeOffered(GATEWAY_URL, offer.id);
      if (gone) setOffered((list) => list.filter((o) => o.id !== offer.id));
      else setOfferedLine(MIND_MEMORY_COPY.offeredUnreachable);
    } finally {
      setRemoving(null);
    }
  };

  const retry = () => {
    void retryRefused().finally(refresh);
  };

  return (
    <MindMemoryList
      items={removableItems(mind)}
      offered={offered}
      noticed={observationLines(mind)}
      status={status}
      wired={Boolean(GATEWAY_URL)}
      reading={reading && removableItems(mind).length === 0}
      removing={removing}
      offeredLine={offeredLine}
      onRemove={(it) => void remove(it)}
      onRemoveOffered={(o) => void removeParentFact(o)}
      onRetry={retry}
    />
  );
}
