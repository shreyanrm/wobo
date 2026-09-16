/**
 * The board-change desk (docs/CONSOLE-ROLES-AND-BOARD.md §1), as pure functions from one gateway
 * reading to its panels.
 *
 * `GET /v1/admin/board-changes` (services/gateway `board_change.py`) sends every request with the
 * board the learner is on, the board they asked for, when they last changed, and a keyed handle,
 * never an id and never a name; and the three dials as the gateway is obeying them. This file
 * formats and never counts anything the gateway did not send.
 *
 * `readable: false` is its own state, as on every desk: the gateway could not ask, which is not
 * the same fact as nobody having asked.
 */

import { count, type Panel, type Tone } from './panels';

export interface BoardRef {
  readonly framework_id: string | null;
  readonly level: string | null;
}

export interface BoardRequest {
  readonly id: string;
  readonly raised_at: string | null;
  readonly current: BoardRef;
  readonly wanted: BoardRef;
  readonly last_changed_at: string | null;
  readonly raised_by: string;
  readonly state: 'new' | 'granted' | 'declined' | string;
  readonly decided_at: string | null;
  readonly handle: string;
}

export interface BoardDials {
  readonly free_changes: number;
  readonly parent_change_counts: boolean;
  readonly rule_off_for: readonly string[];
}

export interface BoardChangeDesk {
  readonly readable: boolean;
  readonly requests: readonly BoardRequest[];
  readonly dials?: BoardDials;
  /** False while nothing can record a parent's change (board_change.PARENT_CHANGES_POSSIBLE). */
  readonly parent_changes_possible?: boolean;
}

const SOURCE = 'GET /v1/admin/board-changes, from ops.board_change_requests and ops.settings';

function isRequest(row: unknown): row is BoardRequest {
  const r = row as BoardRequest;
  return Boolean(
    r &&
      typeof r.id === 'string' &&
      typeof r.state === 'string' &&
      typeof r.handle === 'string' &&
      r.current &&
      r.wanted,
  );
}

export function isBoardChangeDesk(body: unknown): body is BoardChangeDesk {
  const b = body as BoardChangeDesk;
  return Boolean(
    b &&
      typeof b.readable === 'boolean' &&
      Array.isArray(b.requests) &&
      b.requests.every(isRequest),
  );
}

function board(ref: BoardRef): string {
  return [ref.framework_id ?? 'unknown', ref.level].filter(Boolean).join(' · ');
}

const STATE_WORDS: Record<string, string> = {
  new: 'Waiting',
  granted: 'Granted',
  declined: 'Declined',
};

/** The requests an operator can still act on. */
export function grantable(desk: BoardChangeDesk | null): BoardRequest[] {
  return desk?.readable ? desk.requests.filter((r) => r.state === 'new') : [];
}

/** The cohort box, read the way the gateway reads it: comma separated, blanks dropped. */
export function parseCohorts(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** "2026-09-17 09:00 UTC": a request is days old, so the day is the fact and the clock the detail. */
function dated(iso: string | null): string {
  if (!iso) return 'not recorded';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return 'not recorded';
  const text = moment.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

export function boardChangePanels(desk: BoardChangeDesk | null, at: string | null): Panel[] {
  if (!desk || !desk.readable) {
    return [
      {
        kind: 'absent',
        id: 'board-unreadable',
        label: 'Board changes',
        because: desk
          ? 'The gateway could not reach ops.board_change_requests, so it could not ask.'
          : 'The board-change queue did not answer this console.',
        wouldFill: 'The gateway reaching the project with its service key (board_change.py).',
      },
    ];
  }
  const provenance = { source: SOURCE, at };
  const waiting = grantable(desk).length;
  const panels: Panel[] = [
    {
      kind: 'figure',
      id: 'board-open',
      label: 'Waiting for a person',
      value: count(waiting),
      tone: waiting > 0 ? 'warn' : 'ok',
      provenance,
    },
    {
      kind: 'rows',
      id: 'board-requests',
      label: 'Requests',
      columns: ['Raised', 'On now', 'Asked for', 'Last changed', 'State', 'Who'],
      rows: desk.requests.map((r) => ({
        id: r.id,
        cells: [
          dated(r.raised_at),
          board(r.current),
          board(r.wanted),
          r.last_changed_at ? dated(r.last_changed_at) : 'never',
          STATE_WORDS[r.state] ?? r.state,
          r.handle,
        ],
        tone: (r.state === 'new' ? 'warn' : 'plain') as Tone,
      })),
      provenance: {
        ...provenance,
        caveat: 'Who is a keyed handle, the same one every desk shows. It is not an account id.',
      },
    },
  ];
  if (desk.dials) {
    const d = desk.dials;
    panels.push({
      kind: 'rows',
      id: 'board-dials',
      label: 'The rule, as the gateway obeys it',
      columns: ['Dial', 'Now'],
      rows: [
        {
          id: 'free',
          cells: ['Changes before a person is needed', count(d.free_changes)],
          tone: 'plain',
        },
        {
          id: 'parent',
          cells: ['A parent’s change counts', d.parent_change_counts ? 'yes' : 'no'],
          tone: 'plain',
        },
        {
          id: 'off',
          cells: ['Rule off for', d.rule_off_for.length ? d.rule_off_for.join(', ') : 'nobody'],
          tone: d.rule_off_for.length ? 'warn' : 'plain',
        },
      ],
      provenance: {
        ...provenance,
        caveat: 'Read from ops.settings within thirty seconds of a turn.',
      },
    });
  }
  return panels;
}
