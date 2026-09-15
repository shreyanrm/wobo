/**
 * A subject is the Learn board scoped to one subject, with the Practice board's set list behind
 * its second tab — so subject.css owns three rules and borrows everything else. This holds the
 * frame the set list sits in to the practice board's own grid, and holds the screen to composing
 * from the two boards rather than inventing a third.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CurriculumUnitsView } from '@wobo/sdk';
import type { DisplaySubject } from '../../curriculum/registry';
import { resolveSubject, SUBJECT_COPY, subjectBody, type UnitsState } from '../SubjectScreen';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const APP = readFileSync(join(REPO, 'design', 'prototypes', 'app-v1.html'), 'utf8');
const CSS = readFileSync(join(import.meta.dir, 'subject.css'), 'utf8');
const TSX = readFileSync(join(import.meta.dir, '..', 'SubjectScreen.tsx'), 'utf8');

/** Every `selector{declarations}` in a stylesheet, media blocks flattened, comments dropped. */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] as string).replace(/\s+/g, ' ').trim();
    const decls = (m[2] as string)
      .split(';')
      .map((d) =>
        d
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*:\s*/, ':'),
      )
      .filter(Boolean);
    if (!selector || selector.startsWith('@')) continue;
    out.set(selector, [...(out.get(selector) ?? []), ...decls]);
  }
  return out;
}

const proto = rules(APP);
const mine = rules(CSS);

describe('a subject is composed from the two boards it belongs to', () => {
  it('the set list sits in the practice board’s own two columns', () => {
    const source = proto.get('.prac') ?? [];
    const ported = mine.get('.sb-sets') ?? [];
    expect(source).toContain('grid-template-columns:1fr 360px');
    for (const decl of source) expect(ported).toContain(decl);
    // the phone folds it to one column, exactly as the practice board does
    expect(ported).toContain('grid-template-columns:1fr');
  });

  it('the chapter rows are the learn board’s rows, and the set rows the practice board’s', () => {
    for (const cls of ['ln-units', 'ln-unit', 'ln-now', 'ln-done', 'ln-state', 'ln-prog']) {
      expect(TSX).toContain(cls);
    }
    for (const cls of ['pr-set', 'pr-on', 'pr-ok', 'pr-dot']) expect(TSX).toContain(cls);
    expect(TSX).toContain("import './learn/Learn.css'");
    expect(TSX).toContain("import './practice/practice.css'");
  });

  it('keeps the two boards’ own lines, word for word', () => {
    const line =
      "Something your school does differently? Tell me and I'll reorder, add or drop a chapter for you.";
    expect(APP.replace(/\s+/g, ' ')).toContain(line);
    expect(TSX).toContain(line);
    const how =
      'Wobo never says wrong. When you’re close, it draws the difference on your answer and waits. Get it, and it makes a small fuss.';
    expect(APP.replace(/\s+/g, ' ')).toContain(how.replace(/’/g, "'"));
    expect(TSX.replace(/\s+/g, ' ')).toContain(how.replace(/’/g, "'"));
  });

  it('the crumb names the door and the subject, and the pill names the syllabus', () => {
    expect(TSX).toContain("intent === 'practice' ? 'Practice' : 'Learn'");
    expect(TSX).toContain('ln-prov');
  });
});

/**
 * `/subject/math/learn` was the address before subjects were keyed by their own name, and it is
 * still in every old bookmark and palette entry. It used to print its own URL segment where the
 * subject's name goes — a headline naming "math", a tile grid with nothing outlined, and another
 * subject's chapters underneath.
 */
describe('an address names a subject, whatever the address happens to say', () => {
  const subjects: DisplaySubject[] = [
    { id: 'Mathematics', name: 'Mathematics', line: '', subjectIds: ['math'] },
    { id: 'Science', name: 'Science', line: '', subjectIds: ['science'] },
  ];

  it('resolves the subject’s own id', () => {
    expect(resolveSubject(subjects, 'Mathematics')?.id).toBe('Mathematics');
  });

  it('resolves the name however it is cased', () => {
    expect(resolveSubject(subjects, 'mathematics')?.id).toBe('Mathematics');
    expect(resolveSubject(subjects, 'SCIENCE')?.id).toBe('Science');
  });

  it('resolves the old slug through the family behind it', () => {
    expect(resolveSubject(subjects, 'math')?.id).toBe('Mathematics');
    expect(resolveSubject(subjects, 'maths')?.id).toBe('Mathematics');
  });

  it('resolves nothing rather than inventing a subject out of the URL', () => {
    expect(resolveSubject(subjects, 'no-such-subject')).toBeUndefined();
    expect(resolveSubject(subjects, '')).toBeUndefined();
    expect(resolveSubject([], 'math')).toBeUndefined();
  });

  it('hands the address over rather than rendering the segment', () => {
    // the screen replaces onto the canonical address, and onto Learn when nothing resolves
    expect(TSX).toContain("router.replace({ name: 'subject', subjectId: subject.id, intent })");
    expect(TSX).toContain("router.replace({ name: 'learn' })");
    // and everything it draws reads the resolved subject, never the raw segment
    expect(TSX).toContain('const openId = subject?.id ?? subjectId;');
    expect(TSX).toContain('useUnits(openId)');
    expect(TSX).toContain('rowsOf(openId)');
    expect(TSX).toContain('on={s.id === openId}');
  });
});

describe('the subject stylesheet keeps the law (DESIGN.md §2, §3)', () => {
  it('prefixes every class, so nothing meets an older screen’s rule', () => {
    for (const selector of mine.keys()) {
      for (const cls of selector.matchAll(/\.([\w-]+)/g)) {
        const c = cls[1] ?? '';
        expect(c.startsWith('sb-') || c.startsWith('wk-') || c.startsWith('pr-')).toBe(true);
      }
    }
  });

  it('draws no hairline, names no colour, and adds no corner of its own', () => {
    expect(CSS).not.toMatch(/border[^;]*:\s*1px/);
    expect(CSS).not.toMatch(/border[^;]*:\s*0?\.\d+px/);
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS).not.toMatch(/border-radius/);
  });

  it('puts a set row on the 44px touch floor', () => {
    expect(mine.get('.sb-sets .pr-set button')).toContain('min-height:44px');
  });
});

/**
 * WHAT THE MIDDLE OF THE SCREEN IS, AND WHAT IT MAY NEVER SAY (docs/BOARD-COLD-START.md §3).
 *
 * Three things were wrong here at once, and all three were sentences.
 *
 *  1. **It narrated the fetch.** While the first `curriculum.units` request was in flight the
 *     screen had no view and no rows, so it fell straight past the discovery card onto a plain
 *     card reading "I am fetching the chapters <board> teaches in <subject>." That is 1.0-1.7s of
 *     narration on a throttled phone in EVERY run, warm board or cold, and §3 is absolute: the
 *     learner never reads that we are fetching anything. The designed wait says nothing, so the
 *     designed wait is what covers a request with nothing behind it yet.
 *  2. **It quoted the brain at the child.** `units.error` is `hooks.voiceOf`, which falls through
 *     to `error.message` for anything that is not a `CurriculumError` — so an unreachable gateway
 *     printed the browser's own "Failed to fetch" on a card, with no door out of it.
 *  3. **The ends had no doors.** Both cards were a sentence and nothing else.
 *
 * `subjectBody` is the whole decision as one pure function, so these are assertions about what
 * the screen DOES rather than greps for what it happens to contain.
 */
describe('the middle of a subject screen (docs/BOARD-COLD-START.md §3)', () => {
  const view = (over: Partial<CurriculumUnitsView> = {}): CurriculumUnitsView => ({
    frameworkId: 'msbshse',
    level: 'Class 9',
    subject: 'Science',
    status: 'ready',
    subjectId: 'Science',
    units: [],
    placeholder: null,
    plan: null,
    jobId: null,
    waitMs: 0,
    label: 'Official Maharashtra State Board',
    notListed: null,
    ...over,
  });

  const units = (over: Partial<UnitsState> = {}): UnitsState => ({
    looking: false,
    loading: false,
    error: null,
    view: null,
    ...over,
  });

  it('says nothing at all while the first request is in flight', () => {
    const body = subjectBody(units({ loading: true }), 0, true);
    expect(body.kind).toBe('wait');
    // and it is the designed wait with no answer behind it, never a previous subject's plan
    expect(body.kind === 'wait' && body.view).toBeNull();
  });

  it('keeps saying nothing while another subject’s answer is still on the hook', () => {
    // switching subjects leaves the last subject's view in the hook until the next one lands
    const body = subjectBody(units({ loading: true, view: view() }), 0, true);
    expect(body.kind).toBe('wait');
    expect(body.kind === 'wait' && body.view).toBeNull();
  });

  it('hands the cold board’s own answer to the wait, so the plan can follow it', () => {
    const cold = view({ status: 'shared', waitMs: 8000, jobId: 'job-1' });
    const body = subjectBody(units({ looking: true, view: cold }), 0, true);
    expect(body.kind === 'wait' && body.view).toBe(cold);
  });

  it('never repeats the brain’s words to the child, whatever they are', () => {
    const poison = 'Failed to fetch';
    for (const rows of [0, 3]) {
      for (const looking of [false, true]) {
        const body = subjectBody(units({ error: poison, looking, loading: false }), rows, true);
        if (body.kind === 'end') expect(body.line).not.toContain(poison);
      }
    }
    const end = subjectBody(units({ error: poison }), 0, true);
    expect(end.kind).toBe('end');
    expect(end.kind === 'end' && end.line).toBe(SUBJECT_COPY.unreachable);
  });

  it('gives a child a way out of every end it can reach', () => {
    const ends = [
      subjectBody(units({ error: 'Failed to fetch' }), 0, true),
      subjectBody(units(), 0, true),
      subjectBody(units(), 0, false),
      subjectBody(units({ view: view({ plan: null }) }), 0, true),
    ];
    for (const body of ends) {
      expect(body.kind).toBe('end');
      expect(body.kind === 'end' && body.doors.length).toBeGreaterThan(0);
    }
    // an unreachable brain is worth trying again; a board with nothing on it is not
    expect(ends[0]?.kind === 'end' && ends[0].doors).toContain('again');
    expect(ends[3]?.kind === 'end' && ends[3].doors).toContain('own-syllabus');
    expect(ends[2]?.kind === 'end' && ends[2].doors).toContain('class');
  });

  it('names no board and no fetch in any line it can print', () => {
    for (const line of Object.values(SUBJECT_COPY)) {
      const said = line.toLowerCase();
      for (const narration of ['fetch', 'looking for', 'searching', 'loading', 'no syllabus']) {
        expect(said).not.toContain(narration);
      }
    }
    expect(TSX).not.toContain('I am fetching');
  });

  it('draws the wait itself when there is no answer to hang one on', () => {
    // the discovery card's wait is a budget that runs out into the shared plan, and a request with
    // no answer yet has no plan to run out into — so the scene runs for as long as the request
    // does rather than falling through to a sentence about a syllabus nobody looked for
    expect(TSX).toContain("body.kind === 'wait' && !body.view");
    expect(TSX).toContain('<WaitScene');
    expect(mine.get('.wk-card.sb-wait')).toContain('justify-items:center');
  });

  it('shows the chapters the moment there are chapters', () => {
    expect(subjectBody(units({ view: view() }), 7, true).kind).toBe('chapters');
    // a refresh running behind chapters already on screen never takes them away
    expect(subjectBody(units({ loading: true, view: view() }), 7, true).kind).toBe('chapters');
  });
});

/**
 * THE QUIET FLAG'S BAND (the adversary, wave 53).
 *
 * `ui/FlagControl.tsx` floats the "Tell Wobo" pill at the foot of a phone screen: `.wf-float` is
 * `bottom: calc(84px + …)` and the control is on the 44px touch floor, so it occupies the band
 * 84-128px above the viewport's bottom edge. The shell's own foot is 110px
 * (`ui/primitives/ui.css`, `.wk-main`), which is INSIDE that band — so Wobo's line, the last thing
 * on this screen, sat under the pill at 390 with no scroll left to clear it. The screen gives the
 * pill its band rather than the pill moving, because the pill is the promise.
 */
describe('the foot of the screen clears the floating flag', () => {
  it('reserves the pill’s band under the last line on a phone', () => {
    const foot = mine.get('.ln-wobo.sb-foot') ?? mine.get('.sb-foot') ?? [];
    const declared = foot.join(' ');
    expect(declared).toContain('padding-bottom');
    expect(declared).toContain('env(safe-area-inset-bottom');
    expect(TSX).toContain('sb-foot');
  });
});
