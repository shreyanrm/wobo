/**
 * The board and class on the You screen draw exactly what the gateway answered
 * (docs/CONSOLE-ROLES-AND-BOARD.md §1). Static markup, no browser: enough to hold the two shapes,
 * the closed failure, and the cost before the move.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const map = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return map.size;
  },
  key: (i: number) => [...map.keys()][i] ?? null,
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, String(v)),
  removeItem: (k: string) => void map.delete(k),
  clear: () => map.clear(),
};

const { BoardChoice, BoardCost } = await import('./BoardChoice');
type Standing = import('./boardChange').BoardStanding;

const BOARD = { id: 'cbse', name: 'CBSE', framework: null, unlisted: false };
const OPEN: Standing = {
  board: { frameworkId: 'cbse', level: '9' },
  mayChange: true,
  lastChangedAt: null,
  granted: false,
  cost: ['Your climb starts again.', 'Everything stays.', 'Topics are kept.'],
  line: null,
  button: null,
  request: null,
  message: null,
};
const CLOSED: Standing = {
  ...OPEN,
  mayChange: false,
  cost: [],
  line: 'A board change from here needs a person. Ask us and somebody will look at it.',
  button: 'Ask us to change it',
};
const noop = () => {};
const render = (standing: Standing | null) =>
  renderToStaticMarkup(
    <BoardChoice
      board={BOARD}
      grade="9"
      onGrade={noop}
      onBoardMoved={noop}
      onUnlisted={noop}
      onOwnSyllabus={noop}
      initialStanding={standing}
    />,
  );

describe('the board on the You screen', () => {
  it('offers the picker while the change is theirs, and no button to ask anybody', () => {
    const html = render(OPEN);
    expect(html).toContain('Your board or curriculum');
    expect(html).toContain('Your class');
    expect(html).not.toContain('Ask us to change it');
  });

  it('replaces the picker with one line and one button once a person is needed', () => {
    const html = render(CLOSED);
    expect(html).toContain(CLOSED.line as string);
    expect(html).toContain('Ask us to change it');
    expect(html).toContain('CBSE');
    expect(html).not.toContain('Your board or curriculum');
    expect(html).not.toContain('My board isn');
    // the class on the same board is still theirs
    expect(html).toContain('Your class');
  });

  it('shows what was already asked instead of the button', () => {
    const html = render({
      ...CLOSED,
      request: { wanted: 'icse', message: 'I have this. A person will look at it.' },
    });
    expect(html).toContain('I have this. A person will look at it.');
    expect(html).not.toContain('Ask us to change it');
  });

  it('offers no board at all before the gateway has answered, and keeps the class', () => {
    const html = render(null);
    expect(html).not.toContain('Your board or curriculum');
    expect(html).not.toContain('Ask us to change it');
    expect(html).toContain('Your class');
  });

  it('says what the move costs before anything moves, with a way to stay', () => {
    const html = renderToStaticMarkup(
      <BoardCost
        name="ICSE"
        own={false}
        stay="CBSE"
        cost={OPEN.cost}
        busy={false}
        onMove={noop}
        onStay={noop}
      />,
    );
    for (const fact of OPEN.cost) expect(html).toContain(fact);
    expect(html).toContain('Move to ICSE');
    expect(html).toContain('Stay on CBSE');
  });
});

describe('nothing on the You screen moves a board around the rule', () => {
  const YOU = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');
  it('never commits a board the tutor names', () => {
    expect(YOU).not.toContain('commitProfile({ boardId: patch.boardId })');
  });
  it('never moves the board for a board the registry does not hold yet', () => {
    // An unlisted pick asks for the board to be found. It is not a move, so it must not change the
    // board the device (and the tutor, which reads profile.boardId) believes they are on: that
    // would be a board change the gateway never saw. The move happens when they pick the board
    // once it is listed, through the rule like any other.
    const start = YOU.indexOf('onUnlisted={');
    expect(start).toBeGreaterThan(-1);
    const block = YOU.slice(start, YOU.indexOf('onOwnSyllabus=', start));
    expect(block).toContain('askDiscovery(');
    expect(block).not.toContain('commitProfile(');
    expect(block).not.toContain('adoptFramework(');
  });
  it('adopts a new board only after the gateway took it', () => {
    expect(YOU).not.toContain('<GradeBoardPicker');
    const own = YOU.slice(YOU.indexOf('onReady='));
    expect(own.indexOf('changeBoard(')).toBeLessThan(own.indexOf('adoptOwnSyllabus('));
  });
});
