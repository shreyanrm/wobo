/**
 * The boards desk's honesty, held to the same rules as every other desk in this console.
 *
 * What this file is shaped around, in order:
 *
 *   1. **"We could not ask" is never "nothing refused".** A failed read, and a gateway that says
 *      the registry is unreachable, both produce an absence that says so and no figure at all.
 *   2. **The label on the screen is the gateway's.** Nothing here composes one, so the desk cannot
 *      show "Official …, verified" beside a board nothing has read. The test asserts the sentence
 *      that reaches a cell is the sentence that came over the wire, character for character.
 *   3. **A worker that is off is the first thing a person sees.** Every other figure on this desk
 *      is about a machine that has never run in production.
 *   4. **Unpriced is not free.** `null` renders as "not priced", never `$0.00`.
 *   5. **No row can name a child.** The gateway sends "a learner" or "the prewarm"; the desk's own
 *      shape has no field that could hold an id.
 */

import { describe, expect, it } from 'bun:test';
import type { BoardRow, JobRow, SyllabusDesk } from './contract';
import { isSyllabusDesk, syllabusPanels, toneOfBoard, toneOfJob } from './syllabus';

const AT = '2026-09-15T12:00:00.000Z';

function board(over: Partial<BoardRow> = {}): BoardRow {
  return {
    framework_id: 'cbse',
    framework_name: 'Central Board of Secondary Education',
    kind: 'national',
    country: 'IN',
    region: null,
    official_site: 'https://www.cbse.gov.in',
    label: 'Found on the board’s site, still checking',
    status: 'provisional',
    why: 'Found on the board’s own site and checked by a second reader.',
    has_syllabus: true,
    version_id: 'v1',
    version_label: '2026-27',
    source_url: 'https://cbseacademic.nic.in/maths.pdf',
    published_at: '2026-09-01T00:00:00Z',
    subjects: 23,
    chapters: 412,
    may_promote: true,
    ...over,
  };
}

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    job_id: 'j1',
    framework_id: 'upmsp',
    framework_name: 'Board of High School and Intermediate Education Uttar Pradesh',
    level: 'Class 10',
    subject: 'Mathematics',
    state: 'refused',
    message: 'I could not find an official syllabus for that.',
    reason: 'not_found',
    reason_plain: 'nothing official was found for it',
    attempts: 1,
    waiting_on: 'the prewarm',
    cost_usd: 0.04,
    detail: null,
    tried: [],
    created_at: AT,
    updated_at: AT,
    ...over,
  };
}

function desk(over: Partial<SyllabusDesk> = {}): SyllabusDesk {
  return {
    readable: true,
    worker: { enabled: false, env: 'WOBO_DISCOVERY_WORKER', interval_s: 30 },
    prewarm: {
      enabled: true,
      source: 'seed',
      editable_key: 'curriculum.prewarm.order',
      rejected: [],
      per_tick: 2,
      order: [
        {
          rank: 0,
          framework_id: 'upmsp',
          framework_name: 'Uttar Pradesh board',
          note: 'about 44 million school students in Uttar Pradesh',
          has_syllabus: false,
        },
      ],
      next: [
        {
          framework_id: 'upmsp',
          framework_name: 'Uttar Pradesh board',
          level: 'Class 10',
          subject: 'Mathematics',
        },
      ],
      targets: ['Class 10|Mathematics'],
    },
    boards: [board()],
    queue: [job({ job_id: 'q1', state: 'queued', waiting_on: 'a learner' })],
    landed: [],
    refused: [job()],
    cost: [
      {
        framework_id: 'upmsp',
        framework_name: 'Uttar Pradesh board',
        jobs: 2,
        usd: 0.2,
        unpriced: 1,
      },
    ],
    day: { spent_usd: 0.42, ceiling_usd: 25, fraction: 0.0168, lane: 'stranger', shedding: false },
    counts: { boards: 268, with_syllabus: 4, queued: 1, refused: 1 },
    ...over,
  };
}

function cellsOf(panels: ReturnType<typeof syllabusPanels>, id: string): string[][] {
  const found = panels.find((panel) => panel.id === id);
  if (!found || found.kind !== 'rows') throw new Error(`no rows panel ${id}`);
  return found.rows.map((row) => [...row.cells]);
}

describe('the boards desk', () => {
  it('says the worker is off before it says anything else', () => {
    const panels = syllabusPanels(desk(), AT);
    expect(panels[0]?.id).toBe('syllabus-worker');
    const first = panels[0];
    if (first?.kind !== 'figure') throw new Error('the switch is a figure');
    expect(first.value).toBe('off');
    expect(first.tone).toBe('critical');
    expect(first.note).toContain('WOBO_DISCOVERY_WORKER');
  });

  it('a running worker is not an alarm', () => {
    const panels = syllabusPanels(
      desk({ worker: { enabled: true, env: 'WOBO_DISCOVERY_WORKER', interval_s: 30 } }),
      AT,
    );
    const first = panels[0];
    if (first?.kind !== 'figure') throw new Error('the switch is a figure');
    expect(first.tone).toBe('ok');
  });

  it('a read that failed is an absence, never an empty table', () => {
    const panels = syllabusPanels(null, AT);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.kind).toBe('absent');
  });

  it('a registry the gateway could not reach says so and shows no rows', () => {
    const panels = syllabusPanels(desk({ readable: false }), AT);
    expect(panels).toHaveLength(1);
    const only = panels[0];
    if (only?.kind !== 'absent') throw new Error('unreadable is an absence');
    expect(only.because).toContain('could not reach');
    expect(only.wouldFill).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('shows the gateway’s own sentence for each board, unchanged', () => {
    const wire = board({ label: 'Official CBSE 2026-27, verified', status: 'verified' });
    const rows = cellsOf(syllabusPanels(desk({ boards: [wire] }), AT), 'syllabus-boards');
    expect(rows[0]).toContain('Official CBSE 2026-27, verified');
    expect(rows[0]).toContain(wire.why);
  });

  it('never writes a label of its own', () => {
    const source = Bun.file(`${import.meta.dir}/syllabus.ts`);
    return source.text().then((text) => {
      expect(text).not.toContain('verified'.toUpperCase());
      expect(text.includes('Official ')).toBe(false);
      expect(text.includes('still checking')).toBe(false);
    });
  });

  it('prices what it can and says "not priced" for what it cannot', () => {
    const rows = cellsOf(
      syllabusPanels(
        desk({
          refused: [job({ cost_usd: 0.04 }), job({ job_id: 'j2', cost_usd: null })],
        }),
        AT,
      ),
      'syllabus-refused',
    );
    expect(rows[0]).toContain('$0.04');
    expect(rows[1]).toContain('not priced');
    expect(rows.flat().join(' ')).not.toContain('$0.00');
  });

  it('a refusal carries the reason a person can act on', () => {
    const rows = cellsOf(syllabusPanels(desk(), AT), 'syllabus-refused');
    expect(rows[0]).toContain('nothing official was found for it');
  });

  // The reason is a CATEGORY, and on Uttar Pradesh the category was the opposite of the fact:
  // the board's own Class 10 Mathematics pdf, in a legacy font, refused as "not the syllabus".
  // The sentence that says what was actually seen, and the list of what was actually opened,
  // are what make the row something a person can act on (docs/BOARD-COLD-START.md §5).
  it('a refusal shows what we saw and what we opened, not only its category', () => {
    const rows = cellsOf(
      syllabusPanels(
        desk({
          refused: [
            job({
              reason: 'document_unreadable',
              reason_plain: 'the board published a file whose text could not be read',
              detail: 'the file the board published names Class 10 in its own url',
              tried: ['https://prereg.upmsp.edu.in/…/928_Class-10th Math.pdf — document_unreadable'],
            }),
          ],
        }),
        AT,
      ),
      'syllabus-refused',
    );
    expect(rows[0]?.join(' ')).toContain('names Class 10 in its own url');
    expect(rows[0]?.join(' ')).toContain('928_Class-10th');
  });

  it('a refusal with nothing recorded beyond its reason says so rather than showing a blank', () => {
    const rows = cellsOf(syllabusPanels(desk(), AT), 'syllabus-refused');
    expect(rows[0]?.join(' ')).toContain('nothing recorded');
  });

  it('nothing refused is a figure, not an empty table', () => {
    const panels = syllabusPanels(desk({ refused: [] }), AT);
    const found = panels.find((panel) => panel.id === 'syllabus-refused');
    expect(found?.kind).toBe('figure');
  });

  it('the queue says who is waiting and never who they are', () => {
    const rows = cellsOf(syllabusPanels(desk(), AT), 'syllabus-queue');
    expect(rows[0]).toContain('a learner');
    const wire = job({ waiting_on: 'a learner' }) as unknown as Record<string, unknown>;
    expect(Object.keys(wire)).not.toContain('requested_by');
  });

  it('the prewarm order shows what puts each board there', () => {
    const rows = cellsOf(syllabusPanels(desk(), AT), 'syllabus-prewarm');
    expect(rows[0]).toContain('about 44 million school students in Uttar Pradesh');
    const panel = syllabusPanels(desk(), AT).find((p) => p.id === 'syllabus-prewarm');
    if (panel?.kind !== 'rows') throw new Error('the order is rows');
    expect(panel.provenance.caveat).toContain('seeded order');
  });

  it('an order set from the console says so instead', () => {
    const panel = syllabusPanels(
      desk({ prewarm: { ...desk().prewarm, source: 'console' } }),
      AT,
    ).find((p) => p.id === 'syllabus-prewarm');
    if (panel?.kind !== 'rows') throw new Error('the order is rows');
    expect(panel.provenance.caveat).toContain('ops.settings');
  });

  it('counts the boards honestly, from the gateway’s own count', () => {
    const panel = syllabusPanels(desk(), AT).find((p) => p.id === 'syllabus-count');
    if (panel?.kind !== 'figure') throw new Error('the count is a figure');
    expect(panel.value).toBe('4 of 268');
  });

  it('the day is shown against its ceiling', () => {
    const panel = syllabusPanels(desk(), AT).find((p) => p.id === 'syllabus-day');
    if (panel?.kind !== 'figure') throw new Error('the day is a figure');
    expect(panel.value).toBe('$0.42 of $25.00');
    expect(panel.tone).toBe('ok');
  });

  it('a spent day is critical and says what happens to the queue', () => {
    const panel = syllabusPanels(desk({ day: { ...desk().day, shedding: true } }), AT).find(
      (p) => p.id === 'syllabus-day',
    );
    if (panel?.kind !== 'figure') throw new Error('the day is a figure');
    expect(panel.tone).toBe('critical');
    expect(panel.note).toContain('tomorrow');
  });

  it('every sourced panel carries its provenance', () => {
    for (const panel of syllabusPanels(desk(), AT)) {
      if (panel.kind === 'absent') continue;
      expect(panel.provenance.source).toContain('/v1/admin/syllabus');
      expect(panel.provenance.at).toBe(AT);
    }
  });
});

describe('tone', () => {
  it('a board with nothing read is unknown, never a warning', () => {
    expect(toneOfBoard(board({ has_syllabus: false }))).toBe('unknown');
  });

  it('only verified is ok', () => {
    expect(toneOfBoard(board({ status: 'verified' }))).toBe('ok');
    expect(toneOfBoard(board({ status: 'provisional' }))).toBe('plain');
  });

  it('a failure outranks a refusal', () => {
    expect(toneOfJob(job({ state: 'failed' }))).toBe('critical');
    expect(toneOfJob(job({ state: 'refused' }))).toBe('warn');
    expect(toneOfJob(job({ state: 'stored' }))).toBe('ok');
  });
});

describe('the shape check', () => {
  it('takes the gateway’s desk', () => {
    expect(isSyllabusDesk(desk())).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isSyllabusDesk(null)).toBe(false);
    expect(isSyllabusDesk({})).toBe(false);
    expect(isSyllabusDesk({ readable: true, boards: [], queue: [] })).toBe(false);
  });
});
