/**
 * The syllabus desk: every board, the sentence it is showing a learner, and why that one.
 *
 * `docs/BOARD-COLD-START.md` §4 — "the console shows the queue, what has landed, what refused and
 * why" — and §5, the money and the gate beside it. Pure, like every other reading in this bundle:
 * nothing here fetches, so no panel can hold a figure that did not come from its argument.
 *
 * The four rules this file keeps:
 *
 *   1. **The label is the gateway's.** Every sentence in the label column came out of
 *      `curriculum/labels.py` and was sent over the wire. This console never composes one, because
 *      a console that could compose the sentence naming a board as checked could put that sentence
 *      beside a board nothing has read. There is therefore no label text anywhere in this file, and
 *      `syllabus.test.ts` reads the file itself to prove it. The `why` column is the CONSOLE's own
 *      explanation of how the gateway derived that sentence, and it never reaches a learner.
 *   2. **A worker that is off is the first thing on the screen.** Every other figure on this desk
 *      is about a machine that has never run in production (`WOBO_DISCOVERY_WORKER` unset), and a
 *      queue drawn without that fact reads as a queue that is moving.
 *   3. **Absent is not zero.** A board whose reading could not be priced shows "not priced", never
 *      `$0.00`; a registry that could not be reached produces an absence, never an empty table.
 *   4. **No learner reaches this screen.** The gateway sends "a learner" or "the prewarm" and never
 *      an id, and this file has no field that could hold one.
 */

import type { BoardRow, JobRow, PrewarmRow, SyllabusDesk } from './contract';
import { count, type Panel, percent, type Tone, usd } from './panels';
import { boardSpend, jobCost, money } from './readings';

export type { BoardRow, JobRow, PrewarmRow, SyllabusDesk };

const SOURCE = 'GET /v1/admin/syllabus — curriculum.frameworks, versions and discovery_jobs';

export function isSyllabusDesk(value: unknown): value is SyllabusDesk {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.readable !== 'boolean') return false;
  if (!Array.isArray(body.boards) || !Array.isArray(body.queue)) return false;
  const worker = body.worker as Record<string, unknown> | undefined;
  return typeof worker === 'object' && worker !== null && typeof worker.enabled === 'boolean';
}

/** How a board's label reads as a state. `verified` is the only one that claims the board's name,
 *  so it is the only one that is `ok`; a board with nothing read is `unknown`, never `warn` —
 *  there is nothing wrong with a board nobody has got to yet. */
export function toneOfBoard(row: BoardRow): Tone {
  if (!row.has_syllabus) return 'unknown';
  if (row.status === 'verified') return 'ok';
  return 'plain';
}

export function toneOfJob(row: JobRow): Tone {
  if (row.state === 'failed') return 'critical';
  if (row.state === 'refused') return 'warn';
  if (row.state === 'stored') return 'ok';
  return 'plain';
}

/** What a refused row actually saw, beneath the category its reason is.
 *
 *  A reason is a bucket, and a bucket can be the opposite of the fact: Uttar Pradesh's own Class
 *  10 Mathematics pdf — the board's document, on the board's host — refused under a reason whose
 *  sentence is "what was found is not the syllabus", because its legacy-font text layer matches
 *  nothing we can read. The detail is the gateway's sentence about what it saw; the trail is
 *  every candidate the run opened, with the title it was offered under. An absence says so, and
 *  is never a blank cell that reads as a row with nothing behind it.
 */
export function evidence(row: JobRow): string {
  const parts: string[] = [];
  if (row.detail) parts.push(row.detail);
  if (row.tried && row.tried.length > 0) parts.push(`opened: ${row.tried.join('; ')}`);
  return parts.length > 0 ? parts.join(' · ') : 'nothing recorded beyond the reason';
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : at.toISOString().slice(0, 16).replace('T', ' ');
}

/** The desk, as panels. The worker's switch first, then the money, then the work. */
export function syllabusPanels(desk: SyllabusDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'syllabus-unreadable',
        label: 'The boards',
        because:
          'GET /v1/admin/syllabus did not answer, so this console cannot say what any board is ' +
          'showing a learner. That is a fact about this console, not about the registry.',
        wouldFill: 'The gateway answering that read again, or a session that has not ended.',
      },
    ];
  }
  if (!desk.readable) {
    return [
      {
        kind: 'absent',
        id: 'syllabus-registry-down',
        label: 'The boards',
        because:
          'The gateway answered and said it could not reach the syllabus registry ' +
          '(curriculum.frameworks). There are no rows rather than an empty table, because an ' +
          'empty table here would read as "no board has ever refused".',
        wouldFill:
          'The registry answering again — SUPABASE_SERVICE_ROLE_KEY on the gateway, and the ' +
          'project reachable from it.',
      },
    ];
  }

  const provenance = { source: SOURCE, at };
  const panels: Panel[] = [];

  // 1. THE SWITCH. Everything below is about a machine that may never have run.
  panels.push({
    kind: 'figure',
    id: 'syllabus-worker',
    label: 'The discovery worker',
    value: desk.worker.enabled ? 'running' : 'off',
    tone: desk.worker.enabled ? 'ok' : 'critical',
    note: desk.worker.enabled
      ? `Every ${Math.round(desk.worker.interval_s)}s it drains the queue, re-checks one stored subject, and reads ahead of demand.`
      : `${desk.worker.env} is not set on this gateway. Nothing in the queue below will move until it is: the boards are named and none of them is being read.`,
    provenance,
  });

  // 2. THE DAY, against the ceiling §5 asks for an alert on.
  panels.push({
    kind: 'figure',
    id: 'syllabus-day',
    label: 'The platform’s day',
    value: `${usd(desk.day.spent_usd)} of ${usd(desk.day.ceiling_usd)}`,
    tone: desk.day.shedding
      ? 'critical'
      : desk.day.fraction && desk.day.fraction > 0.5
        ? 'warn'
        : 'ok',
    note: desk.day.shedding
      ? 'The day is spent for internal work. Queued boards are left queued and looked at tomorrow.'
      : `${desk.day.fraction === null ? '—' : percent(desk.day.fraction)} of the ceiling. A discovery is shed in the ${desk.day.lane} lane, so it stops long before a paying learner does.`,
    provenance,
  });

  // 3. HOW MANY BOARDS ACTUALLY HAVE ANYTHING. The honest count (WOBO-TASKS §10.21).
  const held = desk.counts?.with_syllabus ?? desk.boards.filter((row) => row.has_syllabus).length;
  const total = desk.counts?.boards ?? desk.boards.length;
  panels.push({
    kind: 'figure',
    id: 'syllabus-count',
    label: 'Boards with a syllabus we hold',
    value: `${count(held)} of ${count(total)}`,
    tone: held < total / 2 ? 'warn' : 'ok',
    note: 'A board with nothing read still teaches: the learner starts on the class-and-subject plan every board shares while theirs is read behind them.',
    provenance,
  });

  // 4. THE PREWARM QUEUE, in its order, with what puts each board there.
  panels.push({
    kind: 'rows',
    id: 'syllabus-prewarm',
    label: `Read ahead of demand, biggest first (${desk.prewarm.enabled ? 'on' : 'off'})`,
    columns: ['#', 'Board', 'Why it is here', 'Held'],
    rows: desk.prewarm.order.map((row) => ({
      id: row.framework_id,
      cells: [
        String(row.rank + 1),
        row.framework_name,
        row.note,
        row.has_syllabus ? 'yes' : 'not yet',
      ],
      tone: (row.has_syllabus ? 'ok' : 'plain') as Tone,
    })),
    provenance: {
      source: SOURCE,
      at,
      caveat:
        desk.prewarm.source === 'console'
          ? `This order was set here and is stored in ops.settings under ${desk.prewarm.editable_key}.`
          : 'This is the seeded order — approximate school enrolment per state, used only to set a rank. Reorder it below and the stored order wins outright.',
    },
  });

  if (desk.prewarm.next.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'syllabus-next',
      label: 'What the next tick would queue',
      columns: ['Board', 'Class', 'Subject'],
      rows: desk.prewarm.next.map((row) => ({
        id: `${row.framework_id}-${row.level}-${row.subject}`,
        cells: [row.framework_name, row.level, row.subject],
        tone: 'plain' as Tone,
      })),
      provenance,
    });
  }

  // 5. THE QUEUE, in drain order, saying who is waiting.
  if (desk.queue.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'syllabus-queue',
      label: 'In the queue, in the order they will be read',
      columns: ['Board', 'Class', 'Subject', 'Stage', 'Waiting on', 'Tries'],
      rows: desk.queue.map((row) => ({
        id: row.job_id,
        cells: [
          row.framework_name,
          row.level ?? '—',
          row.subject ?? '—',
          row.state,
          row.waiting_on,
          String(row.attempts),
        ],
        tone: (row.waiting_on === 'a learner' ? 'warn' : 'plain') as Tone,
      })),
      provenance: {
        source: SOURCE,
        at,
        caveat: desk.worker.enabled
          ? 'A learner waiting is drained before a board nobody asked for, however long the prewarm queue is.'
          : 'Nothing here will move: the worker is off.',
      },
    });
  }

  // 6. WHAT REFUSED, AND WHY. §5: a refusal is remembered and goes to the console.
  panels.push(
    desk.refused.length === 0
      ? {
          kind: 'figure',
          id: 'syllabus-refused',
          label: 'Refused',
          value: 'none',
          tone: 'ok',
          note: 'No board has been looked for and turned away. With the worker off, that is because none has been looked for.',
          provenance,
        }
      : {
          kind: 'rows',
          id: 'syllabus-refused',
          label: 'Could not be read, and why',
          columns: ['Board', 'Class', 'Subject', 'Why', 'What we saw', 'Cost', 'When'],
          rows: desk.refused.map((row) => ({
            id: row.job_id,
            cells: [
              row.framework_name,
              row.level ?? '—',
              row.subject ?? '—',
              row.reason_plain ?? row.message ?? 'not recorded',
              evidence(row),
              money(jobCost(row)),
              when(row.updated_at ?? row.created_at),
            ],
            tone: toneOfJob(row),
          })),
          provenance: {
            source: SOURCE,
            at,
            caveat:
              'A refusal is remembered for a day so a dead link is not re-fetched on every learner who picks that board. Retry sends one back to the queue now.',
          },
        },
  );

  // 7. WHAT EACH BOARD COST.
  if (desk.cost.length > 0) {
    panels.push({
      kind: 'rows',
      id: 'syllabus-cost',
      label: 'What each board cost to read',
      columns: ['Board', 'Readings', 'Spent', 'Unpriced'],
      rows: desk.cost.map((row) => ({
        id: row.framework_id,
        cells: [row.framework_name, String(row.jobs), money(boardSpend(row)), String(row.unpriced)],
        tone: 'plain' as Tone,
      })),
      provenance: {
        source: SOURCE,
        at,
        caveat:
          'Summed from what each run’s own model calls cost. A run nothing could price is counted under "unpriced" and adds nothing, so this is a floor and never a total.',
      },
    });
  }

  // 8. EVERY BOARD, AND THE SENTENCE IT SHOWS.
  panels.push({
    kind: 'rows',
    id: 'syllabus-boards',
    label: 'Every board, the sentence it shows a learner, and why that one',
    columns: ['Board', 'Shows', 'Why', 'Chapters'],
    rows: desk.boards.map((row) => ({
      id: row.framework_id,
      cells: [
        row.region ? `${row.framework_name} (${row.region})` : row.framework_name,
        row.label,
        row.why,
        row.has_syllabus ? count(row.chapters) : '—',
      ],
      tone: toneOfBoard(row),
    })),
    provenance: {
      source: SOURCE,
      at,
      caveat:
        'Every sentence in "Shows" is the gateway’s own, derived in curriculum/labels.py. This console never writes one.',
    },
  });

  return panels;
}
