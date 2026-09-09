/**
 * The public ask door from the browser's side: the request the gateway expects, the reply read
 * out of every kind of answer, and never a status code in front of a visitor.
 */

import { describe, expect, it } from 'bun:test';
import { GATEWAY_COPY } from '@wobo/sdk';
import { ABOUT_MAX, askPublic, cleanQuestion, replyFromBody } from './askPublic';

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('the question', () => {
  it('folds whitespace and refuses to send nothing', () => {
    expect(cleanQuestion('  do you   teach\n ICSE ?  ')).toBe('do you teach ICSE ?');
    expect(cleanQuestion('   ')).toBe('');
  });

  it('posts to /v1/ask with the page, and no identity', async () => {
    const calls: Call[] = [];
    await askPublic(
      'https://gw.example/',
      'Do you teach ICSE?',
      'parents',
      fakeFetch(200, { answer: 'Yes.', sources: ['boards'] }, calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://gw.example/v1/ask');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      question: 'Do you teach ICSE?',
      page: 'parents',
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.has('authorization')).toBe(false);
  });

  /**
   * The syllabus pages send what the page is about, so the answer is about that page. Without it
   * the door on a chapter page was the site-wide box with three chip labels swapped: the request
   * said "learn" and nothing else, and a question typed under one chapter was searched over the
   * whole syllabus corpus.
   */
  it('sends what the page is about, and only when a page gives one', async () => {
    const calls: Call[] = [];
    await askPublic(
      'https://gw.example',
      'What comes before this?',
      'learn',
      fakeFetch(200, { answer: 'x', sources: [] }, calls),
      '  Arithmetic Progressions,   CBSE class 10 maths ',
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      question: 'What comes before this?',
      page: 'learn',
      about: 'Arithmetic Progressions, CBSE class 10 maths',
    });

    const bare: Call[] = [];
    await askPublic('https://gw.example', 'q', 'meet', fakeFetch(200, {}, bare));
    expect(JSON.parse(String(bare[0]?.init?.body))).toEqual({ question: 'q', page: 'meet' });
  });

  it('never lets the page subject grow into a second question box', async () => {
    const calls: Call[] = [];
    await askPublic('https://gw.example', 'q', 'learn', fakeFetch(200, {}, calls), 'x'.repeat(400));
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { about: string };
    expect(sent.about.length).toBe(ABOUT_MAX);
  });
});

describe('the reply', () => {
  it('reads the answer and its sources', () => {
    expect(replyFromBody({ answer: 'Yes.', sources: ['boards', 7], remaining: 4 }, true)).toEqual({
      answer: 'Yes.',
      sources: ['boards'],
    });
  });

  it("reads a refusal's own words and drops the status", () => {
    expect(
      replyFromBody({ code: 'ask_limited', message: 'Come back at 6 pm.', remaining: 0 }, false),
    ).toEqual({ answer: 'Come back at 6 pm.', sources: [] });
  });

  it('falls back to the calm line when there are no words at all', () => {
    expect(replyFromBody(null, false).answer).toBe(GATEWAY_COPY.trouble);
    expect(replyFromBody({ answer: '   ' }, true).answer).toBe(GATEWAY_COPY.trouble);
  });

  it('never throws: a dead network gets the same calm line', async () => {
    const dead = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await askPublic('https://gw.example', 'Hi', 'meet', dead)).toEqual({
      answer: GATEWAY_COPY.trouble,
      sources: [],
    });
  });

  it('answers an empty question without asking anyone', async () => {
    const calls: Call[] = [];
    const reply = await askPublic('https://gw.example', '   ', 'how', fakeFetch(200, {}, calls));
    expect(calls).toHaveLength(0);
    expect(reply.answer).toBe(GATEWAY_COPY.trouble);
  });

  it('serves a 429 in Wobo’s words', async () => {
    const reply = await askPublic(
      'https://gw.example',
      'Why?',
      'security',
      fakeFetch(429, { code: 'ask_limited', message: 'That is everything for this hour.' }),
    );
    expect(reply).toEqual({ answer: 'That is everything for this hour.', sources: [] });
  });
});
