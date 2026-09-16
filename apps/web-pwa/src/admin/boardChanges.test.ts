/**
 * The board-change desk (docs/CONSOLE-ROLES-AND-BOARD.md §1): every request with the board a
 * learner is on, the one they asked for and when they last changed; one grant per row; and the
 * three dials as the gateway obeys them.
 */

import { describe, expect, it } from 'bun:test';
import { boardChangePanels, grantable, isBoardChangeDesk, parseCohorts } from './boardChanges';

const DESK = {
  readable: true,
  state: null,
  shown: 2,
  requests: [
    {
      id: 'r1',
      raised_at: '2026-09-17T09:00:00+00:00',
      current: { framework_id: 'icse', level: '9' },
      wanted: { framework_id: 'cbse', level: '9' },
      last_changed_at: '2026-09-10T09:00:00+00:00',
      raised_by: 'learner',
      state: 'new',
      decided_at: null,
      handle: 'h-abc',
    },
    {
      id: 'r2',
      raised_at: '2026-09-01T09:00:00+00:00',
      current: { framework_id: 'cbse', level: null },
      wanted: { framework_id: 'ib', level: null },
      last_changed_at: null,
      raised_by: 'learner',
      state: 'granted',
      decided_at: '2026-09-02T09:00:00+00:00',
      handle: 'h-def',
    },
  ],
  dials: { free_changes: 1, parent_change_counts: true, rule_off_for: [] },
};

describe('the board-change desk', () => {
  it('accepts what the gateway sends and nothing else', () => {
    expect(isBoardChangeDesk(DESK)).toBe(true);
    expect(isBoardChangeDesk({ readable: true })).toBe(false);
    expect(isBoardChangeDesk({ ...DESK, requests: [{ id: 1 }] })).toBe(false);
  });

  it('shows the three facts per request, open work first, and no learner id', () => {
    const panels = boardChangePanels(DESK, '2026-09-17T10:00:00Z');
    const rows = panels.find((p) => p.id === 'board-requests');
    expect(rows?.kind).toBe('rows');
    if (rows?.kind !== 'rows') return;
    expect(rows.columns).toEqual(['Raised', 'On now', 'Asked for', 'Last changed', 'State', 'Who']);
    expect(rows.rows[0]?.cells).toContain('icse · 9');
    expect(rows.rows[0]?.cells).toContain('cbse · 9');
    expect(rows.rows[0]?.tone).toBe('warn');
    expect(rows.rows[1]?.cells).toContain('never');
    expect(JSON.stringify(rows)).not.toContain('subject');
  });

  it('counts what is waiting and shows the dials as they stand', () => {
    const panels = boardChangePanels(DESK, null);
    const open = panels.find((p) => p.id === 'board-open');
    expect(open?.kind === 'figure' && open.value).toBe('1');
    const dials = panels.find((p) => p.id === 'board-dials');
    expect(dials?.kind === 'rows' && dials.rows.map((r) => r.cells[1])).toEqual([
      '1',
      'yes',
      'nobody',
    ]);
  });

  it('says it could not ask, rather than showing an empty queue', () => {
    const panels = boardChangePanels({ ...DESK, readable: false, requests: [] }, null);
    expect(panels.some((p) => p.kind === 'absent')).toBe(true);
    expect(boardChangePanels(null, null).every((p) => p.kind === 'absent')).toBe(true);
  });

  it('offers a grant only on a request nobody has decided', () => {
    expect(grantable(DESK).map((r) => r.id)).toEqual(['r1']);
    expect(grantable(null)).toEqual([]);
  });

  it('reads the cohort box the way the gateway will', () => {
    expect(parseCohorts(' board:icse, plan:free ,, ')).toEqual(['board:icse', 'plan:free']);
    expect(parseCohorts('')).toEqual([]);
  });
});

describe('the requests table says when, with the day', () => {
  it('dates the raised and last-changed cells rather than giving a bare clock time', () => {
    const rows = boardChangePanels(DESK as never, null).find((p) => p.id === 'board-requests');
    const cells = JSON.stringify(rows);
    expect(cells).toContain('2026-09-17');
    expect(cells).toContain('2026-09-10');
    expect(cells).not.toContain('as of 09:00:00');
  });
  it('the desk line does not end in two full stops', async () => {
    const { desk } = await import('./desks');
    const from = (desk('boardChanges').supply as { from: string }).from;
    expect(from.endsWith('.')).toBe(false);
  });
});
