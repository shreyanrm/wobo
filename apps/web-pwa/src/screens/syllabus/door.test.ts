/**
 * The open door, and what a page does with what comes back through it.
 *
 * The rule that matters here is the one about failure: a gateway that is down, slow, unconfigured
 * or aborted must leave the page exactly as the build drew it. These pages are the site's most
 * valuable ones and they are pre-rendered as real HTML, so a fetch that fails must never be able to
 * turn a finished page into an empty one.
 */

import { describe, expect, it } from 'bun:test';
import { askDoor, type DoorNode, doorQuery } from './door';
import { find, type Place } from './tree';
import { applyLive } from './useSyllabus';

const source = (section: string) => ({
  url: 'https://ncert.nic.in/x.pdf',
  section,
  document_hash: 'abc123',
  fetched_at: '2026-09-08T00:00:00Z',
  verified_at: '2026-09-08T00:00:00Z',
  checks_passed: ['unit_order_is_1_to_n'],
});

function ok(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('the query the door is asked', () => {
  it('nests the four depths in the order the door nests them', () => {
    expect(doorQuery({})).toBe('');
    expect(doorQuery({ board: 'cbse' })).toBe('?board=cbse');
    expect(doorQuery({ board: 'cbse', level: 'class-10', subject: 'mathematics' })).toBe(
      '?board=cbse&class=class-10&subject=mathematics',
    );
  });
});

describe('asking the door', () => {
  it('reads a node back', async () => {
    const answer = await askDoor(
      'https://gateway.example',
      { board: 'cbse' },
      {
        fetchImpl: ok({ kind: 'board', children: [{ slug: 'class-10', name: 'Class 10' }] }),
      },
    );
    expect(answer.state).toBe('held');
  });

  it('treats a 404 as a real 404, because the board has withdrawn the path', async () => {
    const answer = await askDoor(
      'https://gateway.example',
      { board: 'x' },
      {
        fetchImpl: ok({ code: 'unknown_syllabus' }, 404),
      },
    );
    expect(answer).toEqual({ state: 'gone' });
  });

  it('never throws, whatever the network does', async () => {
    const boom = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await askDoor('https://gateway.example', {}, { fetchImpl: boom })).toEqual({
      state: 'unavailable',
    });
    expect(
      await askDoor('https://gateway.example', {}, { fetchImpl: ok('not an object') }),
    ).toEqual({ state: 'unavailable' });
    expect(await askDoor('https://gateway.example', {}, { fetchImpl: ok({}, 503) })).toEqual({
      state: 'unavailable',
    });
    // A 200 whose body is not the shape we asked for is not half-read either.
    expect(
      await askDoor('https://gateway.example', {}, { fetchImpl: ok({ kind: 'board' }) }),
    ).toEqual({ state: 'unavailable' });
  });
});

describe('what the door corrects on a page the build already drew', () => {
  const chapter = find({
    board: 'cbse',
    level: 'class-10',
    subject: 'mathematics',
    chapter: 'number-systems',
  }) as Place;

  it('replaces the node it was asked about, and keeps the crumbs it was reached by', () => {
    const answer: DoorNode = {
      kind: 'chapter',
      path: {},
      board: null,
      label: null,
      node: {
        kind: 'chapter',
        slug: 'number-systems',
        name: 'Number systems, revised',
        publishable: true,
      },
      source: source('page 9, Contents'),
      children: [
        {
          kind: 'topic',
          slug: 'real-numbers',
          name: 'Real numbers',
          source: source('page 10'),
          publishable: true,
        },
        {
          kind: 'topic',
          slug: 'surds',
          name: 'Surds',
          source: source('page 11'),
          publishable: true,
        },
      ],
    };
    const live = applyLive(chapter, answer, {
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
    });
    expect(live?.node.name).toBe('Number systems, revised');
    expect(live?.node.source?.section).toBe('page 9, Contents');
    expect(live?.node.children.map((child) => child.name)).toEqual(['Real numbers', 'Surds']);
    // The way up is still the way the reader came.
    expect(live?.board.short).toBe('CBSE');
    expect(live?.subject?.name).toBe('Mathematics');
  });

  it('reads a topic out of its chapter, because a topic is not addressable on its own', () => {
    const topic = find({
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
      topic: 'real-numbers',
    }) as Place;
    const answer: DoorNode = {
      kind: 'chapter',
      path: {},
      board: null,
      label: null,
      node: { kind: 'chapter', slug: 'number-systems', name: 'Number systems', publishable: true },
      source: source('page 9'),
      children: [
        {
          kind: 'topic',
          slug: 'real-numbers',
          name: 'Real numbers',
          source: source('page 12'),
          publishable: true,
        },
        {
          kind: 'topic',
          slug: 'surds',
          name: 'Surds',
          source: source('page 13'),
          publishable: true,
        },
      ],
    };
    const address = {
      board: 'cbse',
      level: 'class-10',
      subject: 'mathematics',
      chapter: 'number-systems',
      topic: 'real-numbers',
    };
    const live = applyLive(topic, answer, address);
    expect(live?.node.name).toBe('Real numbers');
    expect(live?.node.source?.section).toBe('page 12');
    expect(live?.siblings.map((node) => node.slug)).toEqual(['real-numbers', 'surds']);
    expect(live?.index).toBe(0);

    // And a topic the board has dropped is gone, not quietly still there.
    const dropped = applyLive(
      topic,
      { ...answer, children: [answer.children[1] as never] },
      address,
    );
    expect(dropped).toBeNull();
  });
});
