'use client';

/**
 * The doubts on the memory page — LAW 2's visible half.
 *
 * Every photo the learner kept, newest first, with what Wobo read on it and where it was filed,
 * and a remove that goes to the server BEFORE it forgets the device (doubt-store.ts). The list is
 * the gateway's (`GET /v1/doubt`) whenever it answers, reconciled over the device's own copy, and
 * the pictures come from the gateway too (`GET /v1/doubt/{id}/photo`): the device never keeps the
 * bytes. A remove the network refused is owed and retried the next time this list is opened;
 * nothing here says "gone" about a copy it could not reach.
 */

import { useEffect, useState } from 'react';
import { GATEWAY_URL } from '../../store/app-sdk';
import { Button } from '../../ui/primitives';
import { doubtPhotoUrl, listDoubts, readingText } from './api';
import {
  drainDoubtErasures,
  loadDoubts,
  MAX_DOUBTS,
  pendingErasures,
  reconcileDoubts,
  removeDoubt,
  type StoredDoubt,
} from './doubt-store';
import './doubt.css';

export const DOUBTS_EMPTY_LINE =
  'No photos yet. The camera button on any screen takes one, and it lands here.';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function DoubtMemory() {
  const [list, setList] = useState<StoredDoubt[]>(() => loadDoubts());
  const [owed, setOwed] = useState<number>(() => pendingErasures().length);
  const [removing, setRemoving] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  // The gateway's list is the truth once it answers; the device's copy stands until then.
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      if (!GATEWAY_URL) return;
      await drainDoubtErasures({ gatewayUrl: GATEWAY_URL });
      if (live) setOwed(pendingErasures().length);
      let kept: StoredDoubt[] | null = null;
      try {
        const remote = await listDoubts(GATEWAY_URL);
        kept = reconcileDoubts(
          remote.map((d) => ({
            id: d.id,
            createdAt: d.createdAt,
            reading: readingText(d.reading.lines, d.reading.question),
            lines: d.reading.lines,
            width: d.reading.width,
            height: d.reading.height,
            ...(d.climb.nodeName ? { topicName: d.climb.nodeName } : {}),
            // NOT `d.status === 'answered'` (the adversary, 2026-09-09, finding 9). The server's
            // status says a plan was SHAPED for this doubt, which is not the same as an
            // explanation reaching the child: live, a doubt whose page was read correctly got no
            // explanation at all — the driver waited thirty seconds and gave up — and it was
            // still filed here as explained. The device's own record is the one that watched the
            // say frames land and the ink go down (`doubt/flow.ts`, the placing phase), so it is
            // the one that decides, and `reconcileDoubts` carries it over this. A doubt explained
            // on another device reads as unexplained here, which is the honest way round: telling
            // a child their doubt is answered when nothing was ever drawn is the harm.
            explained: false,
          })),
        );
      } catch {
        // signed out, offline, or a gateway without the route yet: the device's own list stands
      }
      if (!live) return;
      const shown = kept ?? loadDoubts();
      setList(shown);
      for (const d of shown) {
        const url = await doubtPhotoUrl(GATEWAY_URL, d.id);
        if (!url) continue;
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        urls.push(url);
        setPhotos((p) => ({ ...p, [d.id]: url }));
      }
    })();
    return () => {
      live = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const remove = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    try {
      await removeDoubt(id, { gatewayUrl: GATEWAY_URL });
    } finally {
      setList(loadDoubts());
      setOwed(pendingErasures().length);
      setRemoving(null);
    }
  };

  return (
    <div className="db-mem" data-testid="doubt-memory">
      {list.length === 0 ? (
        <p className="db-note">{DOUBTS_EMPTY_LINE}</p>
      ) : (
        list.map((d) => (
          <div className="db-mem-row" key={d.id}>
            {photos[d.id] ? <img src={photos[d.id]} alt="" /> : <span className="db-mem-blank" />}
            <div>
              <b>{d.reading || 'A page with nothing I could read'}</b>
              <span>
                {[d.topicName ?? 'Not filed under a topic', when(d.createdAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Button
              size="sm"
              tone="quiet"
              onClick={() => void remove(d.id)}
              disabled={removing === d.id}
              aria-label={`Remove this photo: ${d.reading || 'a page'}`}
            >
              {removing === d.id ? 'Removing' : 'Remove'}
            </Button>
          </div>
        ))
      )}
      <p className="db-note">
        The last {MAX_DOUBTS} stay here. Removing one takes it off this device and off our servers.
        {owed > 0
          ? ` ${owed === 1 ? 'One removal is' : `${owed} removals are`} still waiting for a connection to reach the server.`
          : ''}
      </p>
    </div>
  );
}
