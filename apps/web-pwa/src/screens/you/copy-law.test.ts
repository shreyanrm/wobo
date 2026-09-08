/**
 * The two copy laws the You region kept breaking, held to the source that renders them.
 *
 * NO EM DASH IN ANYTHING A LEARNER READS (docs/copy/voice.md:153 — "A colon, a comma or a full stop
 * does the job"). Five learner-facing strings in this region carried one, and one of them went out
 * in a parent's email as well: `week.ts`'s "Rest is part of learning — quiet days are allowed",
 * which `sundayNote` prints too and which had no full stop either.
 *
 * SENTENCE CASE EVERYWHERE, BUTTONS INCLUDED (DESIGN.md §5, docs/copy/voice.md:25). The erase panel
 * — four sentences and two buttons, on the screen where a learner deletes themselves — was the one
 * lower-case thing on a screen where every other control ("Manage", "Choose", "Send an invite",
 * "Cancel plan") obeys it. It read as unfinished in the place that could least afford to.
 *
 * Both are checked against the source with its comments stripped, so a rule explained in a comment
 * is not mistaken for a line somebody reads.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sentenceCase } from '../You';
import { sundayNote, weekSentence } from './week';

const HERE = import.meta.dir;

/** A source with its comments taken out: what it says to a learner, not what it says about itself. */
function spoken(path: string[]): string {
  const source = readFileSync(join(HERE, ...path), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = [
  ['You.tsx', ['..', 'You.tsx']],
  ['you/week.ts', ['week.ts']],
  ['you/TrophyRoom.tsx', ['TrophyRoom.tsx']],
  ['you/ParentInvite.tsx', ['ParentInvite.tsx']],
  ['you/parentLink.ts', ['parentLink.ts']],
  ['you/plan.ts', ['plan.ts']],
  ['you/PlanPanel.tsx', ['PlanPanel.tsx']],
  ['you/MindMemory.tsx', ['MindMemory.tsx']],
  ['you/ledger.ts', ['ledger.ts']],
] as const;

describe('no em dash in anything a learner reads', () => {
  for (const [label, path] of FILES) {
    it(`${label} writes none`, () => {
      expect([label, spoken([...path]).includes('—')]).toEqual([label, false]);
    });
  }

  it('the rest-day line is a sentence now, and it is the one a parent reads too', () => {
    const rest = { showedUp: 0 } as unknown as Parameters<typeof weekSentence>[0];
    const line = weekSentence(rest)[0]?.text ?? '';
    expect(line).toBe('Rest is part of learning. Quiet days are allowed.');
    expect(line).not.toContain('—');
    // the same words go out in the Sunday note, so the law reaches the parent's inbox as well
    expect(sundayNote(rest, 'Asha')[0]?.text).toBe(line);
  });
});

describe('the erase panel is sentence case, like every other control on the screen', () => {
  const YOU = spoken(['..', 'You.tsx']);

  it('starts its sentences and its buttons with a capital', () => {
    expect(YOU).toContain('This deletes your name, photo, progress');
    expect(YOU).toContain('It cannot be undone.');
    expect(YOU).toContain("{erasing ? 'Erasing…' : 'Erase and start over'}");
    expect(YOU).toContain('Keep going');
    for (const old of [
      'this deletes your name',
      'it cannot be undone.',
      "'erase and start over'",
      '>keep going<',
    ]) {
      expect([old, YOU.includes(old)]).toEqual([old, false]);
    }
  });

  it('and lifts the borrowed sentence from the erasure register into the same case', () => {
    // `erasureGapSentence` is written lower case in `packages/sdk`, from the days when this whole
    // panel was. The panel is not any more, so the sentence it borrows is raised where it is read.
    expect(sentenceCase('it does not yet reach x. write to support@heywobo.com for those.')).toBe(
      'It does not yet reach x. Write to support@heywobo.com for those.',
    );
    // and nothing inside an address moves
    expect(sentenceCase('write to support@heywobo.com to have those removed too.')).toBe(
      'Write to support@heywobo.com to have those removed too.',
    );
  });
});
