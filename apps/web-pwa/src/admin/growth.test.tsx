/**
 * The growth desk: the panels say only what the gateway sent, every number carries its source, an
 * absence says what would fill it, and Reddit and Quora are rows with a reason and no control.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { GROWTH_REFUSALS, GrowthActions, refusal } from './GrowthActions';
import {
  awaitingIndex,
  type GrowthDesk,
  type GrowthPost,
  growthPanels,
  isGrowthDesk,
  repostable,
  sentence,
  waitingOnYou,
} from './growth';
import { DESK_PANEL, ENDPOINT_PANEL } from './seats';

const AT = '2026-09-16T06:00:00.000Z';

function reading(overrides: Partial<GrowthDesk> = {}): GrowthDesk {
  return {
    at: AT,
    dials: {
      running: false,
      cadence: { blog: 1, x: 1, medium: 1 },
      topics_off: ['energy'],
      approval: 'every',
      pieces_daily: 1,
      readable: true,
      ignored: {},
      ceilings: { channel: 10, blog: 3, pieces_daily: 3 },
    },
    channels: [
      {
        key: 'blog',
        name: 'The blog',
        tier: 'script',
        because: 'Ours.',
        link_in_last_reply: false,
        canonical_back: false,
        origin: true,
      },
      {
        key: 'x',
        name: 'X',
        tier: 'script',
        because: 'Native threads.',
        link_in_last_reply: true,
        canonical_back: false,
        origin: false,
      },
      {
        key: 'linkedin',
        name: 'The LinkedIn page',
        tier: 'script',
        because: 'Documents.',
        link_in_last_reply: false,
        canonical_back: true,
        origin: false,
      },
      {
        key: 'medium',
        name: 'Medium',
        tier: 'person',
        because: 'The API is closed.',
        link_in_last_reply: false,
        canonical_back: true,
        origin: false,
      },
      {
        key: 'reddit',
        name: 'Reddit',
        tier: 'never',
        because: 'Shadowbans.',
        link_in_last_reply: false,
        canonical_back: false,
        origin: false,
      },
      {
        key: 'quora',
        name: 'Quora',
        tier: 'never',
        because: 'No write API.',
        link_in_last_reply: false,
        canonical_back: false,
        origin: false,
      },
    ],
    wiring: [
      { channel: 'blog', wired: true },
      { channel: 'x', wired: true },
      { channel: 'linkedin', wired: false, because: 'not wired: nothing renders the pages yet' },
    ],
    sources: [
      { key: 'autocomplete', what: 'What engines suggest.', live: true },
      {
        key: 'search-console',
        what: 'Near misses.',
        live: false,
        because: 'No property is verified.',
        would_fill: 'A verified property and a daily pull of the Search Analytics API.',
      },
    ],
    gather: null,
    topics: {
      from: 'the harvest alone, before any gather',
      rows: [
        {
          slug: 'probability',
          name: 'Probability',
          kind: 'topic',
          boards: ['CBSE', 'ICSE'],
          subjects: ['Mathematics'],
          score: 248.6,
          answerability: 1,
          query_count: 227,
          queries: [],
          core_on_file: true,
          served_to_learners: 52,
        },
        {
          slug: 'energy',
          name: 'Energy',
          kind: 'unit',
          boards: ['NIOS'],
          subjects: ['Science'],
          score: 267.4,
          answerability: 0.8,
          query_count: 282,
          queries: [],
        },
      ],
    },
    store: { readable: true },
    pieces: [
      {
        slug: 'probability',
        title: 'What probability means',
        drafted_on: '2026-09-16',
        publishable: true,
        because: [],
        owed: {},
        origin_url: 'https://heywobo.com/blog/probability',
        published_at: '2026-09-16T06:00:00+00:00',
        indexed_at: null,
        live: false,
      },
    ],
    posts: [
      {
        id: 'blog-202609-probability-01',
        piece: 'probability',
        shape: 'blog',
        channel: 'blog',
        tier: 'script',
        status: 'posted',
        error: null,
        posted_at: AT,
        reference: '07-probability.md',
        title: 'What probability means',
        units: ['---'],
        link: '',
      },
      {
        id: 'x-202609-probability-01',
        piece: 'probability',
        shape: 'thread',
        channel: 'x',
        tier: 'script',
        status: 'awaiting_approval',
        error: null,
        posted_at: null,
        reference: null,
        title: 'What probability means',
        units: [
          'one',
          'two',
          'The whole explanation: https://heywobo.com/blog/probability?utm_id=x-202609-probability-01',
        ],
        link: 'https://heywobo.com/blog/probability?utm_id=x-202609-probability-01',
      },
      {
        id: 'medium-202609-probability-01',
        piece: 'probability',
        shape: 'medium',
        channel: 'medium',
        tier: 'person',
        status: 'queued_for_person',
        error: null,
        posted_at: null,
        reference: null,
        title: 'What probability means',
        units: ['whole piece'],
        link: 'https://heywobo.com/blog/probability?utm_id=medium-202609-probability-01',
      },
      {
        id: 'linkedin-202609-probability-01',
        piece: 'probability',
        shape: 'document',
        channel: 'linkedin',
        tier: 'script',
        status: 'held',
        error: 'waiting for the blog post to be published and indexed first',
        posted_at: null,
        reference: null,
        title: 'What probability means',
        units: ['p1'],
        link: '',
      },
    ],
    report: {
      pieces_publishable: 1,
      origins_indexed: 0,
      posts_by_status: { posted: 1 },
      search_by_family: {},
      signups_by_campaign: {},
      signups: 0,
      absent: { cost_per_signup: 'not measured yet', answer_engines: 'not measured yet' },
    },
    ...overrides,
  };
}

describe('the growth reading', () => {
  it('is recognised, and a wrong shape is not', () => {
    expect(isGrowthDesk(reading())).toBe(true);
    expect(isGrowthDesk({})).toBe(false);
    expect(isGrowthDesk({ ...reading(), channels: [{ key: 'x' }] })).toBe(false);
    expect(isGrowthDesk({ ...reading(), posts: [{ id: 'x' }] })).toBe(false);
  });

  it('finds what waits on the owner and what waits on the index', () => {
    expect(waitingOnYou(reading()).map((p) => p.id)).toEqual([
      'x-202609-probability-01',
      'medium-202609-probability-01',
    ]);
    expect(awaitingIndex(reading()).map((p) => p.slug)).toEqual(['probability']);
    expect(waitingOnYou(null)).toEqual([]);
  });
});

describe('the growth panels', () => {
  it('source every number and explain every absence', () => {
    for (const panel of [...growthPanels(reading(), AT), ...growthPanels(null, null)]) {
      if (panel.kind === 'absent') {
        expect(panel.because.length).toBeGreaterThan(15);
        expect(panel.wouldFill.length).toBeGreaterThan(40);
      } else {
        expect(panel.provenance.source).toContain('/v1/admin/growth');
      }
    }
  });

  it('say the desk is stopped, and say it loudly when the dials could not be read', () => {
    const [stopped] = growthPanels(reading(), AT);
    expect(stopped?.kind === 'figure' && stopped.value).toBe('stopped');
    const unread = reading({ dials: { ...reading().dials, readable: false } });
    const [closed] = growthPanels(unread, AT);
    expect(closed?.kind === 'figure' && closed.tone).toBe('critical');
  });

  it('list Reddit and Quora with their reason and never a cadence', () => {
    const channels = growthPanels(reading(), AT).find((p) => p.id === 'growth-channels');
    expect(channels?.kind).toBe('rows');
    if (channels?.kind !== 'rows') return;
    const never = channels.rows.filter((row) => row.cells[1] === 'No automation, ever');
    expect(never.map((row) => row.cells[0])).toEqual(['Reddit', 'Quora']);
    expect(never.every((row) => row.cells[2] === 'never')).toBe(true);
    const linkedin = channels.rows.find((row) => row.cells[0] === 'The LinkedIn page');
    expect(linkedin?.cells[3]).toContain('Documents. Not wired: nothing renders the pages yet.');
  });

  it('mark a topic that is switched off', () => {
    const topics = growthPanels(reading(), AT).find((p) => p.id === 'growth-topics');
    expect(topics?.kind === 'rows' && topics.rows.map((r) => r.cells[0])).toEqual([
      'Probability',
      'Energy (off)',
    ]);
  });

  it('say the store could not be read rather than showing no pieces', () => {
    const unread = reading({
      store: { readable: false, because: 'no project is configured' },
      pieces: undefined,
      posts: undefined,
    });
    const panels = growthPanels(unread, AT);
    expect(panels.find((p) => p.id === 'growth-store')?.kind).toBe('absent');
    expect(panels.find((p) => p.id === 'growth-pieces')).toBeUndefined();
  });

  it('never say an absent source twice, and end every reason once', () => {
    const same = reading({
      gather: {
        at: AT,
        sources: { 'search-console': { read: false, because: 'No property is verified.' } },
        syllabus: { from: 'the curriculum store', nodes: 1 },
        cores_known: false,
      },
    });
    const absent = growthPanels(same, AT).find((p) => p.id === 'growth-source-search-console');
    expect(absent?.kind === 'absent' && absent.because).toBe('No property is verified.');
    const other = reading({
      gather: {
        at: AT,
        sources: { 'search-console': { read: false, because: 'the token is not set.' } },
        syllabus: { from: 'the curriculum store', nodes: 1 },
        cores_known: false,
      },
    });
    const told = growthPanels(other, AT).find((p) => p.id === 'growth-source-search-console');
    expect(told?.kind === 'absent' && told.because).toBe(
      'No property is verified. Last pass: The token is not set.',
    );
    expect(sentence('ends twice..')).toBe('Ends twice.');
  });

  it('say held once, in the status, not again in the note', () => {
    const posts = growthPanels(reading(), AT).find((p) => p.id === 'growth-posts');
    const held =
      posts?.kind === 'rows' ? posts.rows.find((r) => r.id?.startsWith('linkedin')) : null;
    expect(held?.cells[3]).toBe('Held until the blog post is indexed');
    expect(held?.cells[4]).toBe('');
  });

  it('carry no em dash in anything they say', () => {
    const text =
      JSON.stringify(growthPanels(reading(), AT)) + JSON.stringify(growthPanels(null, null));
    expect(text).not.toContain('—');
  });
});

describe('the growth controls', () => {
  const html = renderToStaticMarkup(<GrowthActions desk={reading()} onChanged={() => {}} />);

  it('show every word of a post before it is approved', () => {
    expect(html).toContain('aria-label="Approve x-202609-probability-01"');
    expect(html).toContain(
      'The whole explanation: https://heywobo.com/blog/probability?utm_id=x-202609-probability-01',
    );
  });

  it('ask a person where a person-channel post went, and point the import home', () => {
    expect(html).toContain('aria-label="Mark medium-202609-probability-01 sent"');
    expect(html).toContain('https://heywobo.com/blog/probability</code>');
    expect(html).not.toContain('Approve medium-');
  });

  it('never offer a held copy, and never a control for Reddit or Quora', () => {
    expect(html).not.toContain('linkedin-202609-probability-01');
    expect(html.toLowerCase()).not.toContain('reddit');
    expect(html.toLowerCase()).not.toContain('quora');
  });

  it('offer the indexed mark only for a published origin not yet seen', () => {
    expect(html).toContain('Mark indexed');
    const none = renderToStaticMarkup(
      <GrowthActions desk={reading({ pieces: [] })} onChanged={() => {}} />,
    );
    expect(none).not.toContain('Mark indexed');
  });

  it('offer to post a blog file again only once it has gone out, and not while one waits', () => {
    expect(html).toContain('Post it again');
    expect(repostable(reading()).map((piece) => piece.slug)).toEqual(['probability']);
    const posts = reading().posts ?? [];
    const again: GrowthPost = {
      ...(posts[0] as GrowthPost),
      id: 'blog-202609-probability-02',
      status: 'awaiting_approval',
    };
    const both = reading({ posts: [...posts, again] });
    expect(repostable(both)).toEqual([]);
    const none = renderToStaticMarkup(
      <GrowthActions desk={reading({ posts: [] })} onChanged={() => {}} />,
    );
    expect(none).not.toContain('Post it again');
  });

  it('draw nothing without a reading', () => {
    expect(renderToStaticMarkup(<GrowthActions desk={null} onChanged={() => {}} />)).toBe('');
  });

  it('turn the gateway refusal codes into words', () => {
    expect(refusal({ ok: false, reason: 'gateway_error', status: 409, code: 'refused' })).toBe(
      GROWTH_REFUSALS.refused as string,
    );
    expect(refusal({ ok: false, reason: 'not_permitted', status: 403 })).toContain('session');
  });

  it('are mounted for the owner only', () => {
    const source = readFileSync(join(import.meta.dir, 'Console.tsx'), 'utf8');
    const mount = source.slice(source.indexOf("desk.id === 'growth'"));
    expect(mount.slice(0, 160)).toContain('mayTurn(admin.permissions) && mayAct(held, desk.id)');
  });

  it('are filed under the growth panel, every endpoint of them', () => {
    expect(DESK_PANEL.growth).toBe('growth');
    for (const name of [
      'growth',
      'growthDials',
      'growthApprove',
      'growthSent',
      'growthWithdraw',
      'growthIndexed',
      'growthRepost',
      'growthNotes',
    ] as const) {
      expect(ENDPOINT_PANEL[name]).toBe('growth');
    }
  });
});
