'use client';

/**
 * THE BOARD FINDER — the control that decides whether /subjects does its job.
 *
 * docs/SELL.md §6 gives this page one job: remove the "does it cover mine" objection, for the
 * highest-intent reader on the site. Somebody who has scrolled to this page is not browsing; they
 * are checking whether we are for them, and until now the page answered them with a DRAWING of a
 * search box — a still, hidden from assistive technology, showing somebody else typing "tel". A
 * picture of an answer is not an answer, and a reader could finish this page still not knowing.
 *
 * So the still is now the real thing, wearing the prototype's own skin (`.sb-type`, `.sb-in`,
 * `.sb-opt`, `.sb-own` — the same rules, ported in `styles.ts`). It searches the whole curriculum
 * registry, offline, on the keystroke, and it tells the truth per board:
 *
 *   Syllabus held   we hold that board's official chapter lists. Four boards today, and the row
 *                   names the subjects and the syllabus year rather than implying more.
 *   In the list     Wobo knows the board by name and can be told you are on it, but the official
 *                   chapter list is not ours yet, so the syllabus comes from you, once.
 *
 * That distinction is the page's credibility. "Comprehensive coverage" is a conversion leak;
 * "Wobo holds the official 2026-27 chapter list for CBSE" is a sale, and the reader who is NOT
 * covered gets a real answer and a real way in rather than a hedge (SELL.md §5).
 *
 * Every path out of this control ends somewhere: a board that is held, a board that is not, and a
 * name the registry has never heard of all finish on the same door, which the page passes in.
 *
 * The words, the boards, the counts, the subjects and the year are `boardFind.ts`, over data
 * generated from `content/` by `scripts/pitch-boards.ts`. Nothing here is typed by hand.
 */

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useId, useState } from 'react';
import {
  boardAnswer,
  findBoards,
  isHeld,
  matchedName,
  NO_MATCH,
  type PitchBoard,
  statusWord,
} from './boardFind';

/** The label the input carries, for a reader and for a screen reader alike. */
export const FINDER_LABEL = 'Find your board';
export const FINDER_PLACEHOLDER = 'Your board, in your own words';

/** The matched run of a name, marked, so a reader sees why the row is there. Never invented. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** What we hold for one board, said in the page's own voice. Only ever shown where it is true. */
function Held({ board }: { board: PitchBoard }) {
  return (
    <div className="sb-subs">
      <span className="sb-lk">Chapter lists held</span>
      <div>
        {board.subjects.map((subject) => (
          <b key={subject}>{subject}</b>
        ))}
      </div>
    </div>
  );
}

export function BoardFinder({ door }: { door?: ReactNode }) {
  const listId = useId();
  const rowId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<PitchBoard | null>(null);

  const rows = findBoards(query);
  const showing = Math.min(active, Math.max(rows.length - 1, 0));

  const type = (text: string) => {
    setQuery(text);
    setActive(0);
    setPicked(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const board = rows[showing];
      if (board) setPicked(board);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (picked) setPicked(null);
      else type('');
    }
  };

  return (
    <div className="sb-type sb-find">
      <div className="sb-in">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="sb-mag">
          <circle cx="11" cy="11" r="6" />
          <path d="M15.5 15.5 L20 20" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={FINDER_PLACEHOLDER}
          aria-label={FINDER_LABEL}
          role="combobox"
          aria-expanded={picked === null}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(picked === null && rows[showing]
            ? { 'aria-activedescendant': `${rowId}-${showing}` }
            : {})}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="sb-clear" onClick={() => type('')}>
            Clear
          </button>
        ) : null}
      </div>

      {picked ? (
        <div className="sb-answer">
          <div className="sb-head">
            <b>{picked.name}</b>
            <span className={isHeld(picked) ? 'sb-pill sb-on' : 'sb-pill'}>
              {statusWord(picked)}
            </span>
          </div>
          <p>{boardAnswer(picked)}</p>
          {isHeld(picked) ? <Held board={picked} /> : null}
          <div className="sb-do">
            {door}
            <button type="button" className="sb-back" onClick={() => setPicked(null)}>
              Look for another board
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* A combobox's popup is a listbox and its options are pressable rows; focus stays in
              the input, and `.sb-rows` rather than `.sb-list`, which the chip strip further down
              this page already owns (DESIGN.md §0, trap 1: a short class name meaning two things). */}
          <div className="sb-rows" id={listId} role="listbox" aria-label={FINDER_LABEL}>
            {rows.map((board, i) => (
              <button
                key={board.id}
                type="button"
                role="option"
                id={`${rowId}-${i}`}
                aria-selected={i === showing}
                className={i === showing ? 'sb-opt sb-lit' : 'sb-opt'}
                onClick={() => setPicked(board)}
              >
                <b>
                  <Marked text={matchedName(board, query)} query={query} />
                </b>
                <span>{board.where}</span>
                <em className={isHeld(board) ? 'sb-pill sb-on' : 'sb-pill'}>{statusWord(board)}</em>
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <div className="sb-none">
              <p>{NO_MATCH}</p>
              <div className="sb-do">{door}</div>
            </div>
          ) : (
            <div className="sb-own">
              {query ? 'Not the one? ' : 'Not listed? '}
              <b>Paste your school's syllabus</b>
            </div>
          )}
        </>
      )}
    </div>
  );
}
