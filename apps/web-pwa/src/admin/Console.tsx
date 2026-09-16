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

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityLookup } from './ActivityLookup';
import { type ActivityDesk, activityPanels, isActivityDesk } from './activity';
import { type AllowanceDesk, allowancePanels, isAllowanceDesk } from './allowance';
import { type Fetched, read as readGateway } from './api';
import { BoardChangeActions } from './BoardChangeActions';
import { type BoardChangeDesk, boardChangePanels, isBoardChangeDesk } from './boardChanges';
import type { AdminIdentity, Economics, HealthSnapshot, UsageWindow } from './contract';
import { AllowanceActions, ModelsActions, mayTurn } from './DialActions';
import { type DeskId, desk as deskById } from './desks';
import { GrowthActions } from './GrowthActions';
import { type GrowthDesk, growthPanels, isGrowthDesk } from './growth';
import { MailActions } from './MailActions';
import { isMailDesk, type MailDesk, mailPanels } from './mail';
import { isModelsDesk, type ModelsDesk, routerPanels } from './models';
import { PromoActions } from './PromoActions';
import { asOf, type Panel } from './panels';
import {
  isPromoPage,
  isRedemptionPage,
  type PromoPage,
  promoPanels,
  type RedemptionPage,
} from './promo';
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
import { RegisterActions } from './RegisterActions';
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
import { isRegister, type Register, registerPanels } from './register';
import { SyllabusActions } from './SyllabusActions';
import { firstDesk, holdsEndpoint, isPanelsAnswer, mayAct, mayRead, visibleDesks } from './seats';
import { mayReadConsole, signOut } from './session';
import { isSyllabusDesk, type SyllabusDesk, syllabusPanels } from './syllabus';

/** How often the live desks re-read. Slow on purpose: an operator console polling hard adds load
 *  to the gateway it is watching, and every read is also a row in the audit trail. */
const REFRESH_MS = 30_000;

/** The window the desks read. Wide enough for "what is unusual about today" to have a normal to
 *  measure against; the ledger's rollup is small enough that this costs one indexed scan. */
const WINDOW_DAYS = '30';

/** How much of a queue one desk shows. A queue is worked, not scrolled: past this, the answer is
 *  to close some, not to load more. */
const QUEUE_PAGE = '50';

/** A read this seat does not hold, never sent. Not a refusal: nothing was asked. */
const NOT_HELD = 'not_held';
function notHeld<T>(): Fetched<T> {
  return { ok: false, reason: 'not_permitted', status: null, code: NOT_HELD };
}

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
  // What this seat EFFECTIVELY holds (docs/CONSOLE-ROLES-AND-BOARD.md §2): the rail, the controls
  // and the reads all follow it. Seeded from the session the gateway minted and replaced by every
  // GET /v1/admin/panels, so a grant or a revocation shows on the next refresh.
  const [held, setHeld] = useState<readonly string[]>(admin.capabilities ?? []);
  const heldRef = useRef<readonly string[]>(admin.capabilities ?? []);
  // The register (ops.admins), read only by a seat that holds its panel.
  const [register, setRegister] = useState<Register | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [usage, setUsage] = useState<UsageWindow | null>(null);
  const [economics, setEconomics] = useState<Economics | null>(null);
  // The four queue desks (ops.reports). One summary for the whole strip, and one page per desk,
  // read together so an operator switching desks is not waiting on a fetch.
  const [deskSummary, setDeskSummary] = useState<DeskSummary | null>(null);
  const [queues, setQueues] = useState<Partial<Record<QueueKind, QueuePage>>>({});
  // The promo desk (ops.promo_codes, migration 0027): the codes, and the trail of who took one.
  // Two reads because they are two tables and either can fail on its own, and a failure of one
  // must not be able to empty the other.
  // The models desk and the allowance (docs/CONSOLE-MODELS.md, docs/ALLOWANCE.md §3): the
  // router's own table, and how generous a day is. Two reads, because the router is known from
  // the gateway's memory even on a day the ledger cannot be reached.
  const [models, setModels] = useState<ModelsDesk | null>(null);
  const [allowance, setAllowance] = useState<AllowanceDesk | null>(null);
  const [promo, setPromo] = useState<PromoPage | null>(null);
  // The boards desk (docs/BOARD-COLD-START.md §4): what every board is showing a learner and why,
  // the discovery queue, what refused, and what each one cost.
  const [syllabus, setSyllabus] = useState<SyllabusDesk | null>(null);
  // The activity desk (learner.activity, migration 0034): who came when, and the mail ladder.
  const [activity, setActivity] = useState<ActivityDesk | null>(null);
  // The mail desk (ops.mail_watch, migration 0036): where our mail lands, and what was paused.
  const [mail, setMail] = useState<MailDesk | null>(null);
  // The growth desk (growth.*, migration 0038): what to write next, what was made, where it went.
  const [growth, setGrowth] = useState<GrowthDesk | null>(null);
  const [redeemed, setRedeemed] = useState<RedemptionPage | null>(null);
  // The board-change queue (ops.board_change_requests, migration 0031) and its three dials.
  const [boardChanges, setBoardChanges] = useState<BoardChangeDesk | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  // After a change on the register, only the register and this seat's own panels are read again.
  // A whole refresh is about twenty requests against the console's sixty a minute, and an owner
  // shaping one person's seat presses several cells in a row.
  const rereadRegister = useCallback(async () => {
    const gotPanels = await readGateway('panels', isPanelsAnswer);
    if (gotPanels.ok) {
      heldRef.current = gotPanels.value.capabilities;
      setHeld(gotPanels.value.capabilities);
    }
    if (!holdsEndpoint(heldRef.current, 'admins')) return;
    const gotRegister = await readGateway('admins', isRegister);
    setRegister(gotRegister.ok ? gotRegister.value : null);
  }, []);

  const refresh = useCallback(async () => {
    const gotPanels = await readGateway('panels', isPanelsAnswer);
    if (gotPanels.ok) {
      heldRef.current = gotPanels.value.capabilities;
      setHeld(gotPanels.value.capabilities);
    }
    // Every read below asks only for a desk this seat holds. A desk it does not hold is not there,
    // and asking anyway would come back refused and read as a closed session.
    const read: typeof readGateway = (endpoint, guard, options, fetcher) =>
      holdsEndpoint(heldRef.current, endpoint)
        ? readGateway(endpoint, guard, options, fetcher)
        : Promise.resolve(notHeld());
    const gotRegister = await read('admins', isRegister);
    // Dropped rather than kept: an old list is a person who was suspended, still looking seated.
    setRegister(gotRegister.ok ? gotRegister.value : null);
    const [
      gotHealth,
      gotUsage,
      gotEconomics,
      gotDesks,
      gotModels,
      gotAllowance,
      gotPromo,
      gotRedeemed,
      gotSyllabus,
      gotActivity,
      gotMail,
      gotBoardChanges,
      gotGrowth,
      ...gotQueues
    ] = await Promise.all([
      read('health', isHealthSnapshot),
      read('usage', isUsageWindow, { query: { days: WINDOW_DAYS } }),
      read('economics', isEconomics, { query: { days: WINDOW_DAYS } }),
      read('deskSummary', isDeskSummary),
      read('models', isModelsDesk),
      read('allowance', isAllowanceDesk),
      read('promo', isPromoPage, { query: { limit: QUEUE_PAGE } }),
      read('promoRedemptions', isRedemptionPage, { query: { limit: QUEUE_PAGE } }),
      read('syllabus', isSyllabusDesk, { query: { limit: QUEUE_PAGE } }),
      read('activity', isActivityDesk),
      read('mail', isMailDesk),
      read('boardChanges', isBoardChangeDesk, { query: { limit: QUEUE_PAGE } }),
      read('growth', isGrowthDesk),
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
    setModels(gotModels.ok ? gotModels.value : null);
    setAllowance(gotAllowance.ok ? gotAllowance.value : null);
    // Dropped rather than kept, exactly as the money reads are: a stale code list under a fresh
    // timestamp is a code somebody has already switched off, still looking live.
    setPromo(gotPromo.ok ? gotPromo.value : null);
    setRedeemed(gotRedeemed.ok ? gotRedeemed.value : null);
    // Dropped rather than kept, for the same reason: a stale board list under a fresh timestamp
    // is a board somebody already confirmed, still reading as provisional.
    setSyllabus(gotSyllabus.ok ? gotSyllabus.value : null);
    // Dropped rather than kept: yesterday's count under today's timestamp is a learner who came
    // this morning still reading as away.
    setActivity(gotActivity.ok ? gotActivity.value : null);
    // Dropped rather than kept: an old rate under a fresh timestamp is a pause that was lifted, or
    // a complaint that arrived, still reading as it was.
    setMail(gotMail.ok ? gotMail.value : null);
    // Dropped rather than kept: a stale queue is a request somebody already granted, still open.
    setBoardChanges(gotBoardChanges.ok ? gotBoardChanges.value : null);
    // Dropped rather than kept: a stale queue is a post somebody already approved, still waiting.
    setGrowth(gotGrowth.ok ? gotGrowth.value : null);
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
    const refused = [
      gotPanels,
      gotRegister,
      gotHealth,
      gotUsage,
      gotEconomics,
      gotDesks,
      gotPromo,
      gotRedeemed,
      gotSyllabus,
      gotActivity,
      gotMail,
      ...gotQueues,
    ].some((result) => !result.ok && result.reason === 'not_permitted' && result.code !== NOT_HELD);
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
  const rail = visibleDesks(held);
  const shown = firstDesk(held, open);
  const desk = deskById(shown ?? open);
  const panels = panelsFor(desk.id, {
    health,
    usage,
    economics,
    deskSummary,
    queues,
    models,
    allowance,
    promo,
    redeemed,
    syllabus,
    activity,
    mail,
    boardChanges,
    growth,
    register,
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
          {rail.map((entry) => (
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
          {shown === null ? (
            <p className="ac-none">
              This seat holds no desks yet. The owner decides what it can see, and it appears here
              as soon as they do.
            </p>
          ) : (
            <>
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
                {/* The two things on this console that change anything: working a queue, and minting
                a code. Each is mounted with the desk id as its key, so switching desks throws the
                component and its half-typed state away rather than carrying it somewhere else. */}
                {isQueueKind(desk.id) && mayAct(held, desk.id) && (
                  <QueueActions
                    key={desk.id}
                    kind={desk.id}
                    page={queues[desk.id] ?? null}
                    onMoved={() => void refresh()}
                  />
                )}
                {/* Owner only. A seat without admin.manage sees the desk and no controls, rather
                than a control that answers 403: the seat already knows what it is. */}
                {desk.id === 'models' && mayTurn(admin.permissions) && mayAct(held, desk.id) && (
                  <ModelsActions key={desk.id} desk={models} onSaved={() => void refresh()} />
                )}
                {desk.id === 'allowance' && mayTurn(admin.permissions) && mayAct(held, desk.id) && (
                  <AllowanceActions key={desk.id} desk={allowance} onSaved={() => void refresh()} />
                )}
                {desk.id === 'promo' && permitted && mayAct(held, desk.id) && (
                  <PromoActions
                    key={desk.id}
                    admin={admin}
                    page={promo}
                    onChanged={() => void refresh()}
                  />
                )}
                {/* One learner's page. Drawn only for a seat that holds the learner desk's read,
                by role or by the owner's grant, which is exactly what the gateway asks: a box
                that can only ever answer 403 is not a control. */}
                {desk.id === 'activity' && permitted && mayRead(held, 'users') && (
                  <ActivityLookup key={desk.id} />
                )}
                {/* Owner only: lifting the watch's pause on a kind. */}
                {desk.id === 'mail' && mayTurn(admin.permissions) && mayAct(held, desk.id) && (
                  <MailActions key={desk.id} desk={mail} onLifted={() => void refresh()} />
                )}
                {/* Owner only: the growth desk's approvals, sends, indexed marks, dials and notes. */}
                {desk.id === 'growth' && mayTurn(admin.permissions) && mayAct(held, desk.id) && (
                  <GrowthActions key={desk.id} desk={growth} onChanged={() => void refresh()} />
                )}
                {/* Retrying a refusal is an operator's act; confirming a reading and turning the
                queue's order are the owner's, and the component draws only what this seat
                carries. */}
                {/* Granting is this seat's act on the desk; the dials are the owner's. */}
                {desk.id === 'boardChanges' && permitted && (
                  <BoardChangeActions
                    key={desk.id}
                    desk={boardChanges}
                    mayGrant={mayAct(held, desk.id)}
                    mayTurn={mayTurn(admin.permissions) && mayAct(held, desk.id)}
                    onChanged={() => void refresh()}
                  />
                )}
                {desk.id === 'syllabus' && permitted && mayAct(held, desk.id) && (
                  <SyllabusActions
                    key={desk.id}
                    desk={syllabus}
                    mayTurn={mayTurn(admin.permissions)}
                    onChanged={() => void refresh()}
                  />
                )}
                {/* The owner's alone: admin.manage AND the register's act. Anyone else who reads the
                register sees who has a seat and no controls. */}
                {desk.id === 'register' && mayTurn(admin.permissions) && mayAct(held, desk.id) && (
                  <RegisterActions
                    key={desk.id}
                    admin={admin}
                    register={register}
                    onChanged={() => void rereadRegister()}
                  />
                )}
              </div>
            </>
          )}
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
    models: ModelsDesk | null;
    allowance: AllowanceDesk | null;
    promo: PromoPage | null;
    redeemed: RedemptionPage | null;
    syllabus: SyllabusDesk | null;
    activity: ActivityDesk | null;
    mail: MailDesk | null;
    boardChanges: BoardChangeDesk | null;
    growth: GrowthDesk | null;
    register: Register | null;
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
      // The router's table first — what answers what, and who is carrying it — then the same
      // window's rollup grouped by the model that actually answered.
      return [...routerPanels(ctx.models, ctx.at), ...modelPanels(ctx.usage, ctx.at)];
    case 'allowance':
      return allowancePanels(ctx.allowance, ctx.at);
    case 'pacing':
      return pacingPanels(ctx.usage, ctx.economics, ctx.at);
    case 'promo':
      return promoPanels(ctx.promo, ctx.redeemed, ctx.at);
    case 'syllabus':
      return syllabusPanels(ctx.syllabus, ctx.at);
    case 'activity':
      return activityPanels(ctx.activity, ctx.at);
    case 'mail':
      return mailPanels(ctx.mail, ctx.at);
    case 'boardChanges':
      return boardChangePanels(ctx.boardChanges, ctx.at);
    case 'growth':
      return growthPanels(ctx.growth, ctx.at);
    case 'register':
      return registerPanels(ctx.register, ctx.at);
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
      <section className="ac-panel" data-panel={panel.id}>
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
