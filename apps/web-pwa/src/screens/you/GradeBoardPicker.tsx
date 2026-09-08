'use client';

/**
 * Board and class, read from the global registry (CURRICULUM.md §3).
 *
 * There is no list of boards in this file any more. The learner types, the registry answers, and
 * the two doors that must never be more than one tap away sit under the field: "my board isn't
 * here", which sends the name they typed to a discovery job, and their own syllabus.
 *
 * Classes come from the framework itself — grades 4 to 13 wherever it has them (§11) — so a
 * curriculum that runs to Year 13 offers Year 13 and one that stops at Class 10 stops at Class 10.
 * Nothing here offers a class a board does not teach.
 */

import type { CurriculumFramework, CurriculumFrameworkView } from '@wobo/sdk';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { BoardSearch } from '../../curriculum/BoardSearch';
import { LevelPicker } from '../../curriculum/Pickers';
import { SectionLabel, surface } from '../../ui/kit';

/**
 * What a learner ends up having chosen. A framework when the registry knew it; otherwise the raw
 * name they typed, which is a search we have not run yet — never a substituted board.
 */
export interface ChosenBoard {
  /** The framework id, or the typed name when nothing in the registry matched. */
  id: string;
  name: string;
  framework: CurriculumFramework | null;
  /** True when this is a name we are about to go looking for. */
  unlisted: boolean;
}

export function boardOf(framework: CurriculumFramework): ChosenBoard {
  return { id: framework.id, name: framework.name, framework, unlisted: false };
}

export function unlistedBoard(name: string): ChosenBoard {
  return { id: name, name, framework: null, unlisted: true };
}

/**
 * The board a learner already has, as this picker needs it: the WORLD names it, and the framework
 * VIEW carries the classes it teaches. Both, or the picker has nothing to offer.
 *
 * The You screen used to build this inline with `framework: null`, which made `levelsFor` empty on
 * every board that was already pinned: the class list was blank and the line under it asked for a
 * board the crumb one line above was already showing. A learner could not change their class at
 * all. One function now, so the two halves cannot be separated again.
 */
export function chosenBoard(
  world: { frameworkId: string; frameworkName: string } | null,
  view: CurriculumFrameworkView | null,
): ChosenBoard | null {
  if (!world) return null;
  return {
    id: world.frameworkId,
    name: view?.framework.name || world.frameworkName,
    framework: view?.framework ?? null,
    unlisted: false,
  };
}

/**
 * The line where a class list would be. Four states, and each of them true: no board yet, a board
 * we are still fetching the classes for, a board we are out looking for, and a board whose classes
 * the registry does not have.
 */
export function classesEmptyLine(board: ChosenBoard | null, loading = false): string {
  if (!board) return 'Pick your board and I will bring its classes.';
  if (board.unlisted)
    return `I do not have ${board.name}'s classes yet. Pick your board first and I will bring them.`;
  if (loading) return `Bringing ${board.name}'s classes.`;
  return `I do not have ${board.name}'s classes yet. Ask me again in a moment.`;
}

/** The classes a chosen board offers. Empty until one is chosen — never a default ladder. */
export function levelsFor(board: ChosenBoard | null): string[] {
  return board?.framework?.levels ?? [];
}

export function BoardPicker({
  board,
  onBoard,
  onOwnSyllabus,
}: {
  board: ChosenBoard | null;
  onBoard: (board: ChosenBoard) => void;
  /** The own-syllabus door. */
  onOwnSyllabus: () => void;
}) {
  // The free-text door stays a deliberate second step: a learner who types "cbs" is searching, not
  // declaring that their board is missing.
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState('');
  const unlisted = board?.unlisted === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      <SectionLabel>Your board</SectionLabel>

      <BoardSearch
        onPick={(framework) => onBoard(boardOf(framework))}
        onNotListed={(query) => {
          setCustom(query);
          setTyping(true);
        }}
        onOwnSyllabus={onOwnSyllabus}
      />

      {!typing && !unlisted ? (
        <button
          type="button"
          onClick={() => setTyping(true)}
          style={{
            alignSelf: 'flex-start',
            border: 'none',
            background: 'transparent',
            color: surface.inkFaint,
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: 4,
          }}
        >
          My board isn't here
        </button>
      ) : (
        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', maxWidth: 380 }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: the field is this affordance's single intention
            autoFocus
            value={custom || (unlisted ? board.name : '')}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && custom.trim() && onBoard(unlistedBoard(custom.trim()))
            }
            placeholder="Type your board's name"
            aria-label="your board's name"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '1rem',
              fontFamily: 'inherit',
              color: surface.ink,
              background: surface.tonal,
              border: 'none',
              borderRadius: surface.radius.control,
              padding: '11px 14px',
            }}
          />
          <button
            type="button"
            onClick={() => custom.trim() && onBoard(unlistedBoard(custom.trim()))}
            style={{
              minWidth: 64,
              font: 'inherit',
              padding: '11px 14px',
              border: 'none',
              borderRadius: surface.radius.control,
              background: surface.ink,
              color: 'var(--wobo-on-ink)',
              cursor: 'pointer',
            }}
          >
            Set
          </button>
        </div>
      )}

      <AnimatePresence>
        {unlisted && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
            style={{ fontSize: '0.85rem', color: surface.inkFaint, lineHeight: 1.5 }}
          >
            I'll try to source {board.name} when you arrive
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The classes the chosen board teaches — its own beat, after the board is set. */
export function GradePicker({
  board,
  grade,
  onGrade,
  loading,
}: {
  board: ChosenBoard | null;
  grade: string | null;
  onGrade: (grade: string) => void;
  /** True while the framework this board names is still being fetched. */
  loading?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <SectionLabel>Your class</SectionLabel>
      <LevelPicker
        levels={levelsFor(board)}
        level={grade}
        onLevel={onGrade}
        emptyLine={classesEmptyLine(board, loading)}
      />
    </div>
  );
}

/** Both at once — the edit a learner makes from their own page. */
export function GradeBoardPicker({
  grade,
  board,
  onGrade,
  onBoard,
  onOwnSyllabus,
  loading,
}: {
  grade: string | null;
  board: ChosenBoard | null;
  onGrade: (grade: string) => void;
  onBoard: (board: ChosenBoard) => void;
  onOwnSyllabus: () => void;
  /** True while the chosen board's framework is still being fetched. */
  loading?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
      <BoardPicker board={board} onBoard={onBoard} onOwnSyllabus={onOwnSyllabus} />
      <GradePicker board={board} grade={grade} onGrade={onGrade} loading={loading} />
    </div>
  );
}
