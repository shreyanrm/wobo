/**
 * The board-change controls follow the seat (docs/CONSOLE-ROLES-AND-BOARD.md §2): a Grant button
 * is drawn only for a seat that holds `panel.boards.act`, and the dials only for the owner. A
 * button the gateway will refuse with 403 is a control that fails, not an absent one.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardChangeActions, PARENT_DIAL_IDLE } from './BoardChangeActions';
import type { BoardChangeDesk } from './boardChanges';

const DESK = {
  readable: true,
  state: null,
  shown: 1,
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
  ],
  dials: { free_changes: 1, parent_change_counts: true, rule_off_for: [] },
} as unknown as BoardChangeDesk;

const draw = (mayGrant: boolean, mayTurn: boolean) =>
  renderToStaticMarkup(
    <BoardChangeActions desk={DESK} mayGrant={mayGrant} mayTurn={mayTurn} onChanged={() => {}} />,
  );

describe('the board-change controls', () => {
  it('draw a Grant button for a seat that may act on the desk', () => {
    expect(draw(true, false)).toContain('Grant h-abc');
  });

  it('draw no Grant button for a seat that may only read the desk', () => {
    const html = draw(false, false);
    expect(html).not.toContain('Grant h-abc');
    expect(html).not.toContain('Grant a change');
  });

  it('say under the parent dial that it governs nothing while no parent can change a board', () => {
    const closed = { ...DESK, parent_changes_possible: false } as BoardChangeDesk;
    const html = renderToStaticMarkup(
      <BoardChangeActions desk={closed} mayGrant mayTurn onChanged={() => {}} />,
    );
    expect(html).toContain(PARENT_DIAL_IDLE);
    expect(draw(true, true)).not.toContain(PARENT_DIAL_IDLE);
  });

  it('draw the dials for the owner only', () => {
    expect(draw(true, true)).toContain('Turn the rule');
    expect(draw(true, false)).not.toContain('Turn the rule');
  });

  it('are handed the seat’s act on the desk by the console', () => {
    const source = readFileSync(join(import.meta.dir, 'Console.tsx'), 'utf8');
    const mount = source.slice(source.indexOf('<BoardChangeActions'));
    expect(mount.slice(0, 400)).toContain('mayGrant={mayAct(held, desk.id)}');
  });
});
