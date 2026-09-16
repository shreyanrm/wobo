/**
 * The growth desk (docs/GROWTH-DESK.md), as pure functions from one gateway reading to its panels.
 *
 * `GET /v1/admin/growth` (services/gateway `growth/api.py`) sends the dials as the gateway is
 * obeying them, the channels in their three tiers, which tier 1 channels have code behind them,
 * the gather's sources, the ranked topics, every piece with its verdict, every post under its
 * campaign id, and the week's report. This file formats and never counts anything the gateway did
 * not send.
 *
 * Reddit and Quora appear as rows with their reason and nothing else. There is no type here with a
 * field that could hold a Reddit draft, and no control is ever drawn for either.
 *
 * `store.readable: false` is its own state, as on every desk: the gateway could not ask, which is
 * not the same fact as nothing having been made.
 */

import { count, type Panel, type Tone } from './panels';

export type Tier = 'script' | 'person' | 'never';

export interface GrowthChannel {
  readonly key: string;
  readonly name: string;
  readonly tier: Tier;
  readonly because: string;
  readonly link_in_last_reply: boolean;
  readonly canonical_back: boolean;
  readonly origin: boolean;
}

export interface GrowthDials {
  readonly running: boolean;
  readonly cadence: Readonly<Record<string, number>>;
  readonly topics_off: readonly string[];
  readonly approval: 'every' | 'person';
  readonly pieces_daily: number;
  readonly readable: boolean;
  readonly ignored: Readonly<Record<string, string>>;
  readonly ceilings: {
    readonly channel: number;
    readonly blog: number;
    readonly pieces_daily: number;
  };
}

export interface GrowthTopic {
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly boards: readonly string[];
  readonly subjects: readonly string[];
  readonly score: number;
  readonly answerability: number;
  readonly query_count: number;
  readonly queries: readonly { readonly text: string; readonly engines: readonly string[] }[];
  readonly core_on_file?: boolean | null;
  readonly served_to_learners?: number;
}

export interface GrowthPiece {
  readonly slug: string;
  readonly title: string;
  readonly drafted_on: string;
  readonly publishable: boolean;
  readonly because: readonly string[];
  readonly owed: Readonly<Record<string, string>>;
  readonly origin_url: string;
  readonly published_at: string | null;
  readonly indexed_at: string | null;
  readonly live: boolean;
}

export type PostStatus =
  | 'drafted'
  | 'awaiting_approval'
  | 'approved'
  | 'posted'
  | 'queued_for_person'
  | 'sent_by_person'
  | 'held'
  | 'failed'
  | 'withdrawn';

export interface GrowthPost {
  readonly id: string;
  readonly piece: string;
  readonly shape: string;
  readonly channel: string;
  readonly tier: string;
  readonly status: PostStatus | string;
  readonly error: string | null;
  readonly posted_at: string | null;
  readonly reference: string | null;
  readonly title: string;
  readonly units: readonly string[];
  readonly link: string;
}

export interface GrowthSource {
  readonly key: string;
  readonly what: string;
  readonly live: boolean;
  readonly because?: string;
  readonly would_fill?: string;
}

export interface GrowthDesk {
  readonly at: string;
  readonly dials: GrowthDials;
  readonly channels: readonly GrowthChannel[];
  readonly wiring: readonly {
    readonly channel: string;
    readonly wired: boolean;
    readonly because?: string;
  }[];
  readonly sources: readonly GrowthSource[];
  readonly gather: {
    readonly at: string;
    readonly sources: Readonly<
      Record<string, { readonly read: boolean; readonly rows?: number; readonly because?: string }>
    >;
    readonly syllabus: { readonly from: string; readonly nodes: number };
    readonly cores_known: boolean;
  } | null;
  readonly topics: { readonly from: string; readonly rows: readonly GrowthTopic[] };
  readonly store: { readonly readable: boolean; readonly because?: string };
  readonly pieces?: readonly GrowthPiece[];
  readonly posts?: readonly GrowthPost[];
  readonly report?: {
    readonly pieces_publishable: number;
    readonly origins_indexed: number;
    readonly posts_by_status: Readonly<Record<string, number>>;
    readonly search_by_family: Readonly<
      Record<string, { readonly impressions: number; readonly clicks: number }>
    >;
    readonly signups_by_campaign: Readonly<Record<string, number>>;
    readonly signups: number;
    readonly absent: Readonly<Record<string, string>>;
  };
}

const SOURCE = 'GET /v1/admin/growth, from growth.pieces, growth.campaigns and ops.settings';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChannel(row: unknown): row is GrowthChannel {
  return (
    isObject(row) &&
    typeof row.key === 'string' &&
    typeof row.because === 'string' &&
    (row.tier === 'script' || row.tier === 'person' || row.tier === 'never')
  );
}

function isPost(row: unknown): row is GrowthPost {
  return (
    isObject(row) &&
    typeof row.id === 'string' &&
    typeof row.channel === 'string' &&
    typeof row.status === 'string' &&
    Array.isArray(row.units)
  );
}

export function isGrowthDesk(body: unknown): body is GrowthDesk {
  if (!isObject(body)) return false;
  const dials = body.dials;
  const topics = body.topics;
  const store = body.store;
  return (
    isObject(dials) &&
    typeof dials.running === 'boolean' &&
    isObject(dials.cadence) &&
    Array.isArray(dials.topics_off) &&
    Array.isArray(body.channels) &&
    body.channels.every(isChannel) &&
    Array.isArray(body.wiring) &&
    Array.isArray(body.sources) &&
    isObject(topics) &&
    Array.isArray(topics.rows) &&
    isObject(store) &&
    typeof store.readable === 'boolean' &&
    (body.posts === undefined || (Array.isArray(body.posts) && body.posts.every(isPost)))
  );
}

// --- words ---------------------------------------------------------------------------------------
export const STATUS_WORDS: Record<string, string> = {
  drafted: 'Drafted',
  awaiting_approval: 'Waiting for you',
  approved: 'Approved, posts on the next pass',
  posted: 'Posted',
  queued_for_person: 'A person sends this',
  sent_by_person: 'Sent by a person',
  held: 'Held until the blog post is indexed',
  failed: 'Failed',
  withdrawn: 'Withdrawn',
};

const STATUS_TONE: Record<string, Tone> = {
  awaiting_approval: 'warn',
  queued_for_person: 'warn',
  failed: 'critical',
  posted: 'ok',
  sent_by_person: 'ok',
};

const TIER_WORDS: Record<Tier, string> = {
  script: 'A script posts',
  person: 'A person sends',
  never: 'No automation, ever',
};

/** A reason as a sentence: a capital first letter and one full stop, never two. */
export function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, '');
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.` : '';
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** The posts waiting on the owner: approval for a script channel, a send for a person's. */
export function waitingOnYou(desk: GrowthDesk | null): GrowthPost[] {
  return (desk?.posts ?? []).filter(
    (post) => post.status === 'awaiting_approval' || post.status === 'queued_for_person',
  );
}

/** Pieces whose blog post is up and not yet seen indexed: the one fact that releases the rest. */
export function awaitingIndex(desk: GrowthDesk | null): GrowthPiece[] {
  return (desk?.pieces ?? []).filter((piece) => piece.published_at && !piece.indexed_at);
}

/**
 * Pieces whose blog file has gone out (or failed) and has nothing waiting to go again: the ones a
 * redeploy could have wiped. The gateway asks the live address and refuses while it answers, so
 * offering one here never posts a page twice.
 */
export function repostable(desk: GrowthDesk | null): GrowthPiece[] {
  const origins = (desk?.posts ?? []).filter((post) => post.channel === 'blog');
  return (desk?.pieces ?? []).filter((piece) => {
    const mine = origins.filter((post) => post.piece === piece.slug);
    return (
      piece.publishable &&
      mine.some((post) => post.status === 'posted' || post.status === 'failed') &&
      !mine.some((post) => post.status === 'awaiting_approval' || post.status === 'approved')
    );
  });
}

// --- panels --------------------------------------------------------------------------------------
export function growthPanels(desk: GrowthDesk | null, at: string | null): Panel[] {
  if (!desk) {
    return [
      {
        kind: 'absent',
        id: 'growth-unread',
        label: 'Growth',
        because: 'The growth desk could not be read on the last refresh.',
        wouldFill:
          'The gateway answering GET /v1/admin/growth, which reads growth.* and ops.settings.',
      },
    ];
  }
  const provenance = { source: SOURCE, at };
  const dials = desk.dials;
  const panels: Panel[] = [
    {
      kind: 'figure',
      id: 'growth-switch',
      label: 'The desk',
      value: !dials.readable ? 'stopped, dials unread' : dials.running ? 'running' : 'stopped',
      note: dials.running
        ? dials.approval === 'every'
          ? 'Every post waits for your approval.'
          : 'Script channels post once released; person channels wait for you.'
        : 'Nothing is made and nothing is posted until the switch is on.',
      tone: !dials.readable ? 'critical' : dials.running ? 'ok' : 'plain',
      provenance,
    },
  ];

  if (!desk.store.readable) {
    panels.push({
      kind: 'absent',
      id: 'growth-store',
      label: 'Pieces and posts',
      because: `The growth store could not be read: ${desk.store.because ?? 'no reason given'}.`,
      wouldFill:
        'Migration 0038 applied, and the gateway configured with the project and its service key.',
    });
  }

  const waiting = waitingOnYou(desk);
  panels.push({
    kind: 'figure',
    id: 'growth-waiting',
    label: 'Waiting on you',
    value: count(waiting.length),
    note: 'Approvals for script channels, and posts a person sends by hand.',
    tone: waiting.length ? 'warn' : 'ok',
    provenance,
  });

  panels.push({
    kind: 'rows',
    id: 'growth-topics',
    label: 'What to write next',
    columns: ['Topic', 'Boards', 'Queries', 'Core on file', 'Served', 'Score'],
    rows: desk.topics.rows.map((topic) => ({
      id: topic.slug,
      cells: [
        dials.topics_off.includes(topic.slug) ? `${topic.name} (off)` : topic.name,
        topic.boards.join(', '),
        count(topic.query_count),
        topic.core_on_file === undefined || topic.core_on_file === null
          ? 'not known'
          : topic.core_on_file
            ? 'yes'
            : 'no',
        count(topic.served_to_learners ?? 0),
        topic.score.toFixed(1),
      ],
      tone: dials.topics_off.includes(topic.slug) ? 'plain' : topic.core_on_file ? 'ok' : 'unknown',
    })),
    provenance: {
      ...provenance,
      caveat: `Ranked from ${desk.topics.from}. Autocomplete is not a volume figure.`,
    },
  });

  const pieces = desk.pieces ?? [];
  if (desk.store.readable) {
    panels.push(
      pieces.length
        ? {
            kind: 'rows',
            id: 'growth-pieces',
            label: 'Pieces',
            columns: ['Piece', 'Drafted', 'Gate', 'Blog post', 'Indexed', 'Owed'],
            rows: pieces.map((piece) => ({
              id: piece.slug,
              cells: [
                piece.title || piece.slug,
                piece.drafted_on,
                piece.publishable ? 'passed' : piece.because.join(' '),
                day(piece.published_at) || 'not yet',
                day(piece.indexed_at) || 'not yet',
                Object.keys(piece.owed).join(', ') || 'nothing',
              ],
              tone: !piece.publishable ? 'critical' : piece.live ? 'ok' : 'warn',
            })),
            provenance,
          }
        : {
            kind: 'absent',
            id: 'growth-pieces',
            label: 'Pieces',
            because:
              'No piece has been made. A piece needs a concept core, a drawn figure the verifier passed, an official document and a writer, and each missing one is named on the make pass.',
            wouldFill:
              'Concept cores and verified figures on file for the top topics, and the make pass run with the switch on.',
          },
    );
  }

  const posts = desk.posts ?? [];
  if (posts.length) {
    panels.push({
      kind: 'rows',
      id: 'growth-posts',
      label: 'Posts, by campaign id',
      columns: ['Campaign id', 'Channel', 'Shape', 'Status', 'Note'],
      rows: posts.map((post) => ({
        id: post.id,
        cells: [
          post.id,
          post.channel,
          post.shape,
          STATUS_WORDS[post.status] ?? post.status,
          post.status === 'held' ? '' : (post.error ?? post.reference ?? ''),
        ],
        tone: STATUS_TONE[post.status] ?? 'plain',
      })),
      provenance,
    });
  }

  const wired = new Map(desk.wiring.map((row) => [row.channel, row]));
  panels.push({
    kind: 'rows',
    id: 'growth-channels',
    label: 'Where a piece may go',
    columns: ['Channel', 'Who sends', 'Per day', 'Why'],
    rows: desk.channels.map((channel) => {
      const wiring = wired.get(channel.key);
      const why =
        wiring && !wiring.wired && wiring.because
          ? `${channel.because} ${sentence(wiring.because)}`
          : channel.because;
      return {
        id: channel.key,
        cells: [
          channel.name,
          TIER_WORDS[channel.tier],
          channel.tier === 'never' ? 'never' : count(dials.cadence[channel.key] ?? 0),
          why,
        ],
        tone: channel.tier === 'never' ? 'plain' : wiring && !wiring.wired ? 'unknown' : 'ok',
      };
    }),
    provenance: {
      ...provenance,
      caveat:
        'X carries its link in the last reply only. Every copy waits until the blog post is indexed.',
    },
  });

  for (const source of desk.sources) {
    if (source.live) continue;
    const read = desk.gather?.sources[source.key];
    if (read?.read) continue;
    const said = source.because ?? '';
    const last =
      read?.because && !said.includes(read.because) ? ` Last pass: ${sentence(read.because)}` : '';
    panels.push({
      kind: 'absent',
      id: `growth-source-${source.key}`,
      label: `Gather: ${source.key}`,
      because: `${said}${last}`,
      wouldFill: source.would_fill ?? '',
    });
  }

  const report = desk.report;
  if (report) {
    const campaigns = Object.entries(report.signups_by_campaign);
    panels.push(
      campaigns.length
        ? {
            kind: 'rows',
            id: 'growth-signups',
            label: 'Sign-ups by campaign',
            columns: ['Campaign id', 'Sign-ups'],
            rows: campaigns.map(([id, n]) => ({
              id,
              cells: [id, count(n)],
              tone: 'plain' as Tone,
            })),
            provenance: {
              ...provenance,
              caveat: 'Written once on each new account, from the link it arrived by.',
            },
          }
        : {
            kind: 'absent',
            id: 'growth-signups',
            label: 'Sign-ups by campaign',
            because: 'No account has arrived through a campaign link yet.',
            wouldFill:
              'A post going out with its utm_id, and a person signing up after following it.',
          },
    );
    const families = Object.entries(report.search_by_family);
    if (families.length) {
      panels.push({
        kind: 'rows',
        id: 'growth-search',
        label: 'Search, by page family',
        columns: ['Pages', 'Impressions', 'Clicks'],
        rows: families.map(([family, n]) => ({
          id: family,
          cells: [family, count(n.impressions), count(n.clicks)],
          tone: 'plain' as Tone,
        })),
        provenance: {
          ...provenance,
          caveat: 'Near misses only: positions 4.5 to 20 over 28 days.',
        },
      });
    }
    for (const [key, because] of Object.entries(report.absent)) {
      panels.push({
        kind: 'absent',
        id: `growth-absent-${key}`,
        label: key === 'cost_per_signup' ? 'Cost per sign-up' : 'Do the answer engines name us',
        because,
        wouldFill:
          key === 'cost_per_signup'
            ? 'The writer recording its cost on the piece it wrote, summed per campaign beside the sign-ups.'
            : 'A weekly check that asks the answer engines the top questions and records whether Wobo is named.',
      });
    }
  }
  return panels;
}
