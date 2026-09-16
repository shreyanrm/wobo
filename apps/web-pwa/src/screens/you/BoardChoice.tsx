'use client';

/**
 * The board and class on the You screen, under the rule of docs/CONSOLE-ROLES-AND-BOARD.md §1.
 *
 * The gateway says which of two things to draw, and this file draws it:
 *
 *   - the change is theirs: the picker, and after a pick the three facts it costs with one button
 *     to move and one to stay. Nothing moves until they press it.
 *   - a person is needed: the picker is not offered. One line and one button, "Ask us to change
 *     it", which opens a form carrying the board they are on and the one they want, and nothing
 *     else.
 *
 * The class on the board they already follow is not a board change, so the class picker is here
 * in both states and never waits on the gateway. When the gateway cannot be reached, the board
 * stays exactly where it is and one line says so: a rule that opened whenever the network dropped
 * would not be a rule.
 */

import { useEffect, useState } from 'react';
import { BoardSearch } from '../../curriculum/BoardSearch';
import { SectionLabel, surface } from '../../ui/kit';
import { Button } from '../../ui/primitives';
import { askForChange, type BoardStanding, changeBoard, readStanding } from './boardChange';
import {
  BoardPicker,
  boardOf,
  type ChosenBoard,
  GradePicker,
  unlistedBoard,
} from './GradeBoardPicker';

/** What the learner is about to move to, waiting on the cost being read. */
type Pending = { kind: 'board'; board: ChosenBoard } | { kind: 'own' };

/** The name the ask form carries when the board they want is their own syllabus. */
export const OWN_SYLLABUS_WANTED = 'Your own syllabus';

const line = { fontSize: '0.92rem', color: surface.ink, lineHeight: 1.5, margin: 0 } as const;

export function BoardChoice({
  board,
  grade,
  loading,
  onGrade,
  onBoardMoved,
  onUnlisted,
  onOwnSyllabus,
  initialStanding = null,
}: {
  /** What the gateway last answered, when the caller already holds it. Read again on mount. */
  initialStanding?: BoardStanding | null;
  /** The board they follow now, with its framework, or null before they have one. */
  board: ChosenBoard | null;
  grade: string | null;
  loading?: boolean;
  onGrade: (grade: string) => void;
  /** The gateway took the change: move the device to it. */
  onBoardMoved: (board: ChosenBoard) => void;
  /** A board the registry does not hold yet: the discovery door. A request to find it, never a
   *  move, so the caller must not change the board the device is on. */
  onUnlisted: (board: ChosenBoard) => void;
  /** The cost of their own syllabus has been read and accepted: open it. */
  onOwnSyllabus: () => void;
}) {
  const [standing, setStanding] = useState<BoardStanding | null>(initialStanding);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [wanted, setWanted] = useState<ChosenBoard | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readStanding().then((got) => {
      if (cancelled) return;
      if (got.ok) setStanding(got.standing);
      else setNote(got.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const from = board?.id ?? null;
  const pick = (next: ChosenBoard) => {
    setNote(null);
    if (next.unlisted) return onUnlisted(next);
    if (next.id === from) return;
    setPending({ kind: 'board', board: next });
  };

  const confirm = () => {
    if (!pending || busy) return;
    if (pending.kind === 'own') {
      setPending(null);
      onOwnSyllabus();
      return;
    }
    const target = pending.board;
    setBusy(true);
    void changeBoard({ to: target.id, level: grade, from }).then((got) => {
      setBusy(false);
      setPending(null);
      if (got.ok) {
        if (got.standing) setStanding(got.standing);
        onBoardMoved(target);
        return;
      }
      setNote(got.message);
      if (got.needsAPerson && standing) setStanding({ ...standing, mayChange: false });
    });
  };

  const send = () => {
    if (!wanted || busy) return;
    setBusy(true);
    void askForChange({ to: wanted.id, level: grade, from }).then((got) => {
      setBusy(false);
      if (got.ok) {
        setSent(got.message);
        setAsking(false);
      } else setNote(got.message);
    });
  };

  const grades = <GradePicker board={board} grade={grade} onGrade={onGrade} loading={loading} />;
  const noteLine = note ? (
    <p role="status" style={line}>
      {note}
    </p>
  ) : null;

  // Nothing read yet, or nothing could be read: the board stays put and the class is still theirs.
  if (!standing) {
    return (
      <div style={{ display: 'grid', gap: 22, width: '100%' }}>
        {noteLine}
        {grades}
      </div>
    );
  }

  if (pending) {
    const name = pending.kind === 'board' ? pending.board.name : 'your own syllabus';
    return (
      <BoardCost
        name={name}
        own={pending.kind === 'own'}
        stay={board?.name ?? null}
        cost={standing.cost}
        busy={busy}
        onMove={confirm}
        onStay={() => setPending(null)}
      />
    );
  }

  if (standing.mayChange) {
    return (
      <div style={{ display: 'grid', gap: 22, width: '100%' }}>
        {standing.message ? <p style={line}>{standing.message}</p> : null}
        {noteLine}
        <BoardPicker
          board={board}
          onBoard={pick}
          onOwnSyllabus={() => setPending({ kind: 'own' })}
        />
        {grades}
      </div>
    );
  }

  // A person is needed. One line and one button, or what was already asked.
  const waiting = sent ?? standing.request?.message ?? null;
  return (
    <div style={{ display: 'grid', gap: 22, width: '100%' }}>
      <div style={{ display: 'grid', gap: 12 }} data-board-person>
        <SectionLabel>Your board</SectionLabel>
        {board ? <p style={{ ...line, fontWeight: 600 }}>{board.name}</p> : null}
        {waiting ? (
          <p role="status" style={line}>
            {waiting}
          </p>
        ) : asking ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <BoardSearch
              autoFocus
              onPick={(framework) => setWanted(boardOf(framework))}
              onNotListed={(name) => name && setWanted(unlistedBoard(name))}
              onOwnSyllabus={() => setWanted(unlistedBoard(OWN_SYLLABUS_WANTED))}
            />
            {wanted ? (
              <p style={line}>{board ? `${board.name} to ${wanted.name}` : wanted.name}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={send} disabled={!wanted || busy}>
                Send
              </Button>
              <Button size="sm" tone="quiet" onClick={() => setAsking(false)} disabled={busy}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <>
            {standing.line ? <p style={line}>{standing.line}</p> : null}
            {standing.button ? (
              <div>
                <Button size="sm" onClick={() => setAsking(true)}>
                  {standing.button}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {noteLine}
      </div>
      {grades}
    </div>
  );
}

/** The three facts, before anything moves, with one button to move and one to stay. */
export function BoardCost({
  name,
  own,
  stay,
  cost,
  busy,
  onMove,
  onStay,
}: {
  name: string;
  own: boolean;
  stay: string | null;
  cost: readonly string[];
  busy: boolean;
  onMove: () => void;
  onStay: () => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 14, width: '100%' }} data-board-cost>
      <SectionLabel>Moving to {name}</SectionLabel>
      <ul style={{ ...line, display: 'grid', gap: 8, paddingLeft: 18 }}>
        {cost.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={onMove} disabled={busy}>
          {own ? 'Build my own syllabus' : `Move to ${name}`}
        </Button>
        <Button size="sm" tone="quiet" onClick={onStay} disabled={busy}>
          {stay ? `Stay on ${stay}` : 'Not now'}
        </Button>
      </div>
    </div>
  );
}
