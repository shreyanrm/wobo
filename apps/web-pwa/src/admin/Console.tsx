/**
 * The shell: a summary strip that answers "is anything wrong right now" before any detail, a left
 * rail of desks, and one desk at a time.
 *
 * The strip comes FIRST on the page and first in the DOM, so it is also what a screen reader
 * meets first. That ordering is the information design: an operator opening this at speed should
 * not have to read a desk to learn that nothing is on fire.
 *
 * Every panel carries its own freshness and its own source. There is no page-level "updated at",
 * because two panels can come from two reads and one line above both of them would be a claim
 * about data it did not fetch.
 */

import { useCallback, useEffect, useState } from 'react';
import { read } from './api';
import type { AdminIdentity, Economics, HealthSnapshot, UsageWindow } from './contract';
import { DESKS, type DeskId, desk as deskById } from './desks';
import { asOf, type Panel } from './panels';
import { QueueActions } from './QueueActions';
import {
  type DeskSummary,
  isDeskSummary,
  isQueuePage,
  QUEUE_KINDS,
  type QueueKind,
  type QueuePage,
  queuePanels,
  urgentTile,
} from './queues';
import {
  healthPanels,
  isEconomics,
  isHealthSnapshot,
  isUsageWindow,
  modelPanels,
  pacingPanels,
  spendPanels,
  summary,
} from './readings';
import { mayReadConsole, signOut } from './session';

/** How often the live desks re-read. Slow on purpose: an operator console polling hard adds load
 *  to the gateway it is watching, and every read is also a row in the audit trail. */
const REFRESH_MS = 30_000;

/** The window the desks read. Wide enough for "what is unusual about today" to have a normal to
 *  measure against; the ledger's rollup is small enough that this costs one indexed scan. */
const WINDOW_DAYS = '30';

/** How much of a queue one desk shows. A queue is worked, not scrolled: past this, the answer is
 *  to close some, not to load more. */
const QUEUE_PAGE = '50';

export function Console({
  admin,
  weakFactor,
  onClosed,
}: {
  admin: AdminIdentity;
  weakFactor: boolean;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState<DeskId>('spend');
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [usage, setUsage] = useState<UsageWindow | null>(null);
  const [economics, setEconomics] = useState<Economics | null>(null);
  // The four queue desks (ops.reports). One summary for the whole strip, and one page per desk,
  // read together so an operator switching desks is not waiting on a fetch.
  const [deskSummary, setDeskSummary] = useState<DeskSummary | null>(null);
  const [queues, setQueues] = useState<Partial<Record<QueueKind, QueuePage>>>({});
  const [at, setAt] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const refresh = useCallback(async () => {
    const [gotHealth, gotUsage, gotEconomics, gotDesks, ...gotQueues] = await Promise.all([
      read('health', isHealthSnapshot),
      read('usage', isUsageWindow, { query: { days: WINDOW_DAYS } }),
      read('economics', isEconomics, { query: { days: WINDOW_DAYS } }),
      read('deskSummary', isDeskSummary),
      ...QUEUE_KINDS.map((kind) =>
        read('reports', isQueuePage, { query: { kind, limit: QUEUE_PAGE } }),
      ),
    ]);
    // A reading that failed is DROPPED, never kept. A stale figure with a fresh timestamp beside
    // it is worse than no figure: it is a number that looks current.
    setHealth(gotHealth.ok ? gotHealth.value : null);
    setUsage(gotUsage.ok ? gotUsage.value : null);
    setEconomics(gotEconomics.ok ? gotEconomics.value : null);
    setDeskSummary(gotDesks.ok ? gotDesks.value : null);
    const pages: Partial<Record<QueueKind, QueuePage>> = {};
    QUEUE_KINDS.forEach((kind, index) => {
      const got = gotQueues[index];
      // Dropped rather than kept when it failed, exactly as the money reads are: a stale queue
      // under a fresh timestamp is a report somebody has already closed, still looking open.
      if (got?.ok) pages[kind] = got.value;
    });
    setQueues(pages);
    setAt(new Date().toISOString());
    // A console session is short and revocable. When the guard starts refusing, the console
    // closes rather than sitting there refreshing into a wall.
    const refused = [gotHealth, gotUsage, gotEconomics, gotDesks, ...gotQueues].some(
      (result) => !result.ok && result.reason === 'not_permitted',
    );
    setEnded(refused);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const permitted = mayReadConsole(admin);
  // The safety-flag tile goes FIRST on the strip. A child saying something upset them outranks
  // every other reading on this console, including the money.
  const tiles = [urgentTile(deskSummary, at), ...summary(health, usage, at)];
  const desk = deskById(open);
  const panels = panelsFor(desk.id, {
    health,
    usage,
    economics,
    deskSummary,
    queues,
    at,
    permitted,
  });

  return (
    <div className="ac">
      <header className="ac-top">
        <span className="ac-mark">Wobo console</span>
        <span className="ac-chip">{admin.role}</span>
        {weakFactor && (
          <span className="ac-chip" data-tone="warn">
            no second factor on this sign-in
          </span>
        )}
        <div className="ac-top-end">
          <span className="ac-who">{admin.email}</span>
          <button className="ac-out" type="button" onClick={() => void signOut().then(onClosed)}>
            Sign out
          </button>
        </div>
      </header>

      {ended && (
        <div className="ac-strip">
          <div className="ac-tile" data-tone="critical">
            <span className="ac-tile-label">This session</span>
            <span className="ac-tile-value">ended</span>
            <span className="ac-tile-detail">
              The gateway is refusing this console session. Sign out and open it again.
            </span>
          </div>
        </div>
      )}

      <section className="ac-strip" aria-label="Is anything wrong right now">
        {tiles.map((tile) => (
          <div className="ac-tile" data-tone={tile.tone} key={tile.id}>
            <span className="ac-tile-label">{tile.label}</span>
            <span className="ac-tile-value">{tile.value}</span>
            <span className="ac-tile-detail">{tile.detail}</span>
          </div>
        ))}
      </section>

      <div className="ac-body">
        <nav className="ac-rail" aria-label="Desks">
          {DESKS.map((entry) => (
            <button
              className="ac-desk"
              type="button"
              key={entry.id}
              aria-current={entry.id === open ? 'page' : undefined}
              onClick={() => setOpen(entry.id)}
            >
              {/* Decorative: the words beside it carry the same fact for a reader who cannot see it. */}
              <span className="ac-dot" data-supply={entry.supply.kind} aria-hidden="true" />
              {entry.name}
              <span className="ac-desk-count">
                {entry.supply.kind === 'live' ? 'live' : 'no source'}
              </span>
            </button>
          ))}
        </nav>

        <main className="ac-main">
          <div className="ac-head">
            <h1>{desk.name}</h1>
            <p>{desk.question}</p>
            {desk.supply.kind === 'live' && (
              <p>
                Sourced from {desk.supply.from}. {asOf(at)}.
              </p>
            )}
          </div>
          <div className="ac-panels">
            {panels.map((panel) => (
              <PanelView panel={panel} key={panel.id} />
            ))}
            {/* The only thing on this console that changes anything, and only on a queue desk. */}
            {isQueueKind(desk.id) && (
              <QueueActions
                key={desk.id}
                kind={desk.id}
                page={queues[desk.id] ?? null}
                onMoved={() => void refresh()}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Which reading a desk draws. A desk with no supplier renders its own honest absence, and a seat
 *  without `console.read` renders a refusal that names the permission rather than a blank. */
function panelsFor(
  id: DeskId,
  ctx: {
    health: HealthSnapshot | null;
    usage: UsageWindow | null;
    economics: Economics | null;
    deskSummary: DeskSummary | null;
    queues: Partial<Record<QueueKind, QueuePage>>;
    at: string | null;
    permitted: boolean;
  },
): Panel[] {
  const desk = deskById(id);
  if (desk.supply.kind === 'none') {
    return [
      {
        kind: 'absent',
        id: `${desk.id}-absent`,
        label: desk.name,
        because: desk.supply.because,
        wouldFill: desk.supply.wouldFill,
      },
    ];
  }
  if (!ctx.permitted) {
    return [
      {
        kind: 'absent',
        id: `${desk.id}-not-permitted`,
        label: desk.name,
        because: 'This seat does not carry console.read, so it may not see the platform’s figures.',
        wouldFill: 'An owner raising this seat’s role in the operator register.',
      },
    ];
  }
  if (isQueueKind(desk.id)) {
    return queuePanels(desk.id, ctx.deskSummary, ctx.queues[desk.id] ?? null, ctx.at);
  }
  switch (desk.id) {
    case 'spend':
      return spendPanels(ctx.usage, ctx.at);
    case 'models':
      return modelPanels(ctx.usage, ctx.at);
    case 'pacing':
      return pacingPanels(ctx.usage, ctx.economics, ctx.at);
    default:
      return healthPanels(ctx.health, ctx.at);
  }
}

/** Narrows a desk id to one of the four queues, so the strip below is typed rather than cast. */
function isQueueKind(id: DeskId): id is QueueKind {
  return (QUEUE_KINDS as readonly string[]).includes(id);
}

function PanelView({ panel }: { panel: Panel }) {
  if (panel.kind === 'absent') {
    return (
      <section className="ac-panel ac-absent">
        <span className="ac-absent-tag">No number behind this</span>
        <span className="ac-panel-label">{panel.label}</span>
        <p>{panel.because}</p>
        <div className="ac-fill">
          <span className="ac-fill-label">What would fill it</span>
          <p>{panel.wouldFill}</p>
        </div>
      </section>
    );
  }

  if (panel.kind === 'rows') {
    return (
      <section className="ac-panel">
        <span className="ac-panel-label">{panel.label}</span>
        <div className="ac-scroll">
          <table className="ac-table">
            <thead>
              <tr>
                {panel.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.rows.map((row, index) => (
                // The row's own id where it has one, and its position where it does not. NEVER the
                // joined cell text: two identical rows are two facts, and keying on content threw
                // one of them away silently — the duplicate-submit case a desk is watching for.
                <tr className="ac-row" data-tone={row.tone} key={row.id ?? `row-${index}`}>
                  {row.cells.map((cell, column) => (
                    <td key={panel.columns[column] ?? `column-${column}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Provenance panel={panel} />
      </section>
    );
  }

  return (
    <section className="ac-panel">
      <span className="ac-panel-label">{panel.label}</span>
      <span className="ac-figure" data-tone={panel.tone}>
        {panel.value}
      </span>
      {panel.note && <span className="ac-note">{panel.note}</span>}
      <Provenance panel={panel} />
    </section>
  );
}

/** The line every sourced panel carries. Not a tooltip: a figure whose provenance is one hover
 *  away is a figure most people will read without it. */
function Provenance({ panel }: { panel: Exclude<Panel, { kind: 'absent' }> }) {
  return (
    <div className="ac-prov">
      <span>
        {asOf(panel.provenance.at)} · <code>{panel.provenance.source}</code>
      </span>
      {panel.provenance.caveat && <span className="ac-caveat">{panel.provenance.caveat}</span>}
    </div>
  );
}
