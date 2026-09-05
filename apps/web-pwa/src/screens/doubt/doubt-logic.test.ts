/**
 * The doubt solver's logic, without a browser: what the gateway's reading has to look like to be
 * shown (api.ts, the wire of services/gateway doubt.py), the order the screen is allowed to move
 * in (flow.ts), and how a solved photo joins the climb (climb.ts).
 *
 * LAW 1 is the one this file exists for: nothing is explained until the reading has been shown and
 * the learner has had the chance to correct it, line by line. `explainAllowed` is false before a
 * reading exists, and what the answer is asked with is the CORRECTED lines under the gateway's own
 * ids, never the raw read.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { DoubtReadResult } from './api';

/** A localStorage stand-in — the re-teach ladder persists through it. */
class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const storage = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const { GatewayError } = await import('@wobo/sdk');
const { answerBody, parseBox, parseDoubtRead, readDoubt, readPayload, readingText, regionsOf } =
  await import('./api');
const { corrected, doubtPacket, explainAllowed, explainPrompt, initialFlow, liveRegions, reduce } =
  await import('./flow');
const { DOUBT_PROGRESS, joinClimb, topicForDoubt } = await import('./climb');
const { conceptMisses, resetReteach } = await import('../../wobo/reteach');
const { topicNodeUuid } = await import('../learn/mastery');

const CAPTURE = { data: 'AAAA', mediaType: 'image/jpeg', width: 1200, height: 1600 };

/** `Doubt.as_dict()` plus `say`, as `POST /v1/doubt` answers. */
const RAW = {
  doubt: 'd9f3a1b2',
  created_at: '2026-09-05T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as: 3x + 5 = 20; Solve for x. Is that right? Fix anything I got wrong first.',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: 'Solve 3x + 5 = 20 for x.',
    lines: [
      { id: 'r1', text: '3x + 5 = 20', box: [0.1, 0.2, 0.6, 0.28] },
      { id: 'r2', text: 'Solve for x.', box: [0.1, 0.3, 0.4, 0.34] },
      { id: 'r3', text: 'a line the reader could not place', box: null },
    ],
    width: 1200,
    height: 1600,
  },
  climb: { node_id: null, node_name: null, framework_id: null },
};

describe('api — what a reading has to look like', () => {
  it("parses the gateway's shape: corner boxes become page boxes, an unplaced line stays text", () => {
    const read = parseDoubtRead(RAW);
    expect(read?.id).toBe('d9f3a1b2');
    expect(read?.status).toBe('read');
    expect(read?.say).toContain('Is that right?');
    expect(read?.reading.question).toBe('Solve 3x + 5 = 20 for x.');
    expect(read?.reading.lines.map((l) => l.id)).toEqual(['r1', 'r2', 'r3']);
    expect(read?.reading.lines[0]?.box).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.08 });
    expect(read?.reading.lines[2]?.box).toBeNull();
    expect(read?.climb).toEqual({});
    // only the placed lines are targets; the third is editable text and nothing more
    expect(regionsOf(read?.reading.lines ?? []).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(regionsOf(read?.reading.lines ?? [])[0]?.label).toBe('3x + 5 = 20');
  });

  it('a box is clamped to the page, whichever way its corners came, and nothing off it survives', () => {
    expect(parseBox([0.9, 0.9, 1.4, 1.2])).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect(parseBox([0.6, 0.28, 0.1, 0.2])).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.08 });
    expect(parseBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.08 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.08,
    });
    expect(parseBox([1.1, 0, 1.5, 0.2])).toBeNull();
    expect(parseBox([0, 0, 0, 0.5])).toBeNull();
    expect(parseBox('nope')).toBeNull();
  });

  it('drops a line with no id or no text, and a repeated id', () => {
    const read = parseDoubtRead({
      ...RAW,
      reading: {
        ...RAW.reading,
        lines: [
          { id: 'r1', text: 'a', box: null },
          { id: 'r1', text: 'b', box: null },
          { id: '', text: 'c', box: null },
          { id: 'r4', text: '   ', box: null },
        ],
      },
    });
    expect(read?.reading.lines.map((l) => `${l.id}:${l.text}`)).toEqual(['r1:a']);
  });

  it('refuses a reply that is not a reading at all', () => {
    expect(parseDoubtRead(null)).toBeNull();
    expect(parseDoubtRead({ doubt: 'x' })).toBeNull();
    expect(parseDoubtRead({ reading: {} })).toBeNull();
  });

  it('carries where the gateway filed it', () => {
    const read = parseDoubtRead({
      ...RAW,
      climb: {
        node_id: topicNodeUuid('m1-1'),
        node_name: 'Linear equations',
        framework_id: 'cbse',
      },
    });
    expect(read?.climb).toEqual({
      nodeId: topicNodeUuid('m1-1'),
      nodeName: 'Linear equations',
      frameworkId: 'cbse',
    });
  });

  it('the read payload carries the bytes, their type, the words and the board, nothing else', () => {
    expect(readPayload(CAPTURE)).toEqual({ image: { data: 'AAAA', mediaType: 'image/jpeg' } });
    expect(readPayload(CAPTURE, { words: ' why? ', frameworkId: 'cbse' })).toEqual({
      image: { data: 'AAAA', mediaType: 'image/jpeg' },
      words: 'why?',
      framework_id: 'cbse',
    });
  });

  it('readDoubt posts to the one door, and a refusal keeps the line the gateway wrote', async () => {
    const calls: [string, unknown][] = [];
    const read = await readDoubt(
      async (path, payload) => {
        calls.push([path, payload]);
        return RAW;
      },
      CAPTURE,
      { frameworkId: 'cbse' },
    );
    expect(calls).toEqual([['/v1/doubt', readPayload(CAPTURE, { frameworkId: 'cbse' })]]);
    expect(read.reading.lines).toHaveLength(3);
    await expect(readDoubt(async () => ({ nonsense: true }), CAPTURE)).rejects.toThrow(
      /could not read/i,
    );
    await expect(
      readDoubt(async () => {
        throw new GatewayError(422, 'There is a face in this one. Try just the page?');
      }, CAPTURE),
    ).rejects.toThrow('There is a face in this one. Try just the page?');
  });

  it('the answer body is every line as the learner left it, by the gateway id', () => {
    expect(answerBody([{ id: 'r1', text: ' 3x + 5 = 26 ' }], 'why is x seven?')).toEqual({
      lines: [{ id: 'r1', text: '3x + 5 = 26' }],
      words: 'why is x seven?',
    });
    expect(readingText([{ text: 'a' }, { text: ' ' }, { text: 'b' }])).toBe('a; b');
    expect(readingText([], 'the question')).toBe('the question');
  });
});

describe('flow — law 1, the reading is shown before the answer', () => {
  const result = parseDoubtRead(RAW) as NonNullable<ReturnType<typeof parseDoubtRead>>;

  it('nothing can be explained before a reading exists', () => {
    expect(explainAllowed(initialFlow)).toBe(false);
    const captured = reduce(initialFlow, { type: 'captured', capture: CAPTURE });
    expect(captured.phase).toBe('reading');
    expect(explainAllowed(captured)).toBe(false);
    // an explain asked for too early is refused: the state does not move
    expect(reduce(captured, { type: 'explain' })).toBe(captured);
    expect(doubtPacket(captured)).toBeNull();
  });

  it('the reading arrives, line by line, and Explain opens only then', () => {
    const shown = reduce(reduce(initialFlow, { type: 'captured', capture: CAPTURE }), {
      type: 'read',
      result,
    });
    expect(shown.phase).toBe('confirm');
    expect(shown.lines.map((l) => l.text)).toEqual([
      '3x + 5 = 20',
      'Solve for x.',
      'a line the reader could not place',
    ]);
    expect(explainAllowed(shown)).toBe(true);
    expect(corrected(shown)).toBe(false);
    expect(liveRegions(shown).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(doubtPacket(shown)).toEqual({
      id: 'd9f3a1b2',
      lines: [
        { id: 'r1', text: '3x + 5 = 20' },
        { id: 'r2', text: 'Solve for x.' },
        { id: 'r3', text: 'a line the reader could not place' },
      ],
    });
    // the tap's meaning over the first line AS READ, never the reader's own `question` (which is
    // not shown and cannot be corrected, so it could carry a misread number the learner fixed)
    expect(explainPrompt(shown)).toBe('Explain this to me: 3x + 5 = 20');
  });

  it('a corrected line is what the answer carries, under the same id; an emptied line leaves', () => {
    let state = reduce(reduce(initialFlow, { type: 'captured', capture: CAPTURE }), {
      type: 'read',
      result,
    });
    state = reduce(state, { type: 'editLine', id: 'r1', text: '3x + 5 = 26' });
    state = reduce(state, { type: 'editLine', id: 'r3', text: '' });
    expect(corrected(state)).toBe(true);
    expect(doubtPacket(state)?.lines).toEqual([
      { id: 'r1', text: '3x + 5 = 26' },
      { id: 'r2', text: 'Solve for x.' },
      { id: 'r3', text: '' },
    ]);
    // the emptied line is no longer a target on the photo
    expect(
      liveRegions(reduce(state, { type: 'editLine', id: 'r2', text: '' })).map((r) => r.id),
    ).toEqual(['r1']);
    // every line emptied is no reading at all; Explain closes again
    const emptied = ['r1', 'r2', 'r3'].reduce(
      (s, id) => reduce(s, { type: 'editLine', id, text: '  ' }),
      state,
    );
    expect(explainAllowed(emptied)).toBe(false);
  });

  it('a refused photo never reaches confirm, and the bytes are gone from memory too', () => {
    const state = reduce(reduce(initialFlow, { type: 'captured', capture: CAPTURE }), {
      type: 'unreadable',
      say: 'This one has a face in it. Try just the page?',
    });
    expect(state.phase).toBe('capture');
    expect(state.error).toBe('This one has a face in it. Try just the page?');
    expect(state.capture).toBeNull();
  });

  it('lighting a line is a state the screen renders, and retake starts clean', () => {
    let state = reduce(reduce(initialFlow, { type: 'captured', capture: CAPTURE }), {
      type: 'read',
      result,
    });
    state = reduce(state, { type: 'light', regionId: 'r2' });
    expect(state.lit).toBe('r2');
    state = reduce(state, { type: 'explain' });
    expect(state.phase).toBe('explaining');
    state = reduce(state, { type: 'explained' });
    expect(state.phase).toBe('placing');
    expect(reduce(state, { type: 'retake' })).toEqual(initialFlow);
  });
});

describe('climb — a doubt joins the learning', () => {
  const T = (id: string, name: string) => ({
    id,
    name,
    chapterId: 'c1',
    blurb: '',
    prereqTopicIds: [],
    kind: 'syllabus' as const,
    xp: 10,
  });
  const topics = [
    T('m1-1', 'Linear equations in one variable'),
    T('m1-2', 'Fractions and decimals'),
    T('s2-1', 'Photosynthesis'),
  ];

  beforeEach(() => {
    storage.clear();
    resetReteach();
  });

  it("places the doubt by the gateway's node first, then its name, then the reading itself", () => {
    expect(topicForDoubt('anything', { nodeId: topicNodeUuid('m1-2') }, topics)?.id).toBe('m1-2');
    expect(topicForDoubt('anything', { name: 'photosynthesis' }, topics)?.id).toBe('s2-1');
    expect(topicForDoubt('anything', { id: 'm1-2' }, topics)?.id).toBe('m1-2');
    expect(topicForDoubt('Solve the linear equation 3x + 5 = 20', undefined, topics)?.id).toBe(
      'm1-1',
    );
    expect(topicForDoubt('What is 7 times 8', undefined, topics)).toBeUndefined();
  });

  it('shows on the map, comes back if it slipped, and feeds the re-teach ladder', () => {
    const events: { type: string; payload: Record<string, unknown>; node?: string }[] = [];
    const progress: [string, number][] = [];
    const placed = joinClimb('11111111-2222-4333-8444-555555555555', 'm1-1', {
      nowMs: Date.parse('2026-09-05T09:00:00Z'),
      record: (type, payload, ctx) => events.push({ type, payload, node: ctx?.ontologyNodeId }),
      reportProgress: (id, f) => progress.push([id, f]),
      progressNow: 0,
    });
    const nodeId = topicNodeUuid('m1-1');
    expect(placed.nodeId).toBe(nodeId);
    // on the learner map: the topic is 'started' (an open ring), never 'learnt'
    expect(progress).toEqual([['m1-1', DOUBT_PROGRESS]]);
    // it comes back: a lapse-shaped retrieval, due soon, on the real scheduler
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('practice.retrieval.scheduled.v1');
    expect(events[0]?.node).toBe(nodeId);
    expect(events[0]?.payload).toMatchObject({
      node_id: nodeId,
      item_id: '11111111-2222-4333-8444-555555555555',
      scheduler: 'fsrs',
    });
    const dueMs = Date.parse(String(events[0]?.payload.due_at));
    expect(dueMs - Date.parse('2026-09-05T09:00:00Z')).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(placed.dueAt).toBe(String(events[0]?.payload.due_at));
    // the re-teach ladder counts a doubt as a miss on that concept
    expect(conceptMisses(nodeId)).toBe(1);
  });

  it('never pulls a topic backwards on the map', () => {
    const progress: [string, number][] = [];
    joinClimb('11111111-2222-4333-8444-555555555555', 'm1-1', {
      nowMs: 0,
      record: () => {},
      reportProgress: (id, f) => progress.push([id, f]),
      progressNow: 0.6,
    });
    expect(progress).toEqual([['m1-1', 0.6]]);
  });
});

// --- the fixer's pass, 2026-09-05 ------------------------------------------------------------------

const { MAX_LINE_CHARS } = await import('./api');
const { doorFor } = await import('./flow');
const { suggestTopics, wordsOf } = await import('./climb');
const { captionAt, doubtCaption } = await import('./caption');

describe('one ceiling for a line, on both sides of the wire', () => {
  it('a line is at most 200 characters, in the reading and in the correction (doubt.py MAX_LINE_CHARS)', () => {
    expect(MAX_LINE_CHARS).toBe(200);
    const long = 'x'.repeat(300);
    expect(answerBody([{ id: 'r1', text: long }])).toEqual({
      lines: [{ id: 'r1', text: 'x'.repeat(200) }],
    });
    const read = parseDoubtRead({
      ...RAW,
      reading: { ...RAW.reading, lines: [{ id: 'r1', text: long, box: null }] },
    });
    expect(read?.reading.lines[0]?.text).toHaveLength(200);
  });
});

describe("the learner's own words", () => {
  it('ride the packet and are the prompt; with none, the prompt is over the CORRECTED first line', () => {
    let s = reduce(initialFlow, { type: 'captured', capture: CAPTURE });
    s = reduce(s, {
      type: 'read',
      result: parseDoubtRead({
        ...RAW,
        reading: {
          ...RAW.reading,
          question: 'Solve 8x + 5 = 20 for x.',
          lines: [{ id: 'r1', text: '8x + 5 = 20', box: [0.1, 0.2, 0.6, 0.28] }],
        },
      }) as DoubtReadResult,
    });
    s = reduce(s, { type: 'editLine', id: 'r1', text: '3x + 5 = 20' });
    // the reader's question carried the misread 8; the prompt never does
    expect(explainPrompt(s)).toBe('Explain this to me: 3x + 5 = 20');
    expect(doubtPacket(s)?.words).toBeUndefined();
    s = reduce(s, { type: 'words', text: '  I do not get how the 5 moves across  ' });
    expect(explainPrompt(s)).toBe('I do not get how the 5 moves across');
    expect(doubtPacket(s)?.words).toBe('I do not get how the 5 moves across');
    // words are taken on the confirm step only, and bounded
    expect(reduce(initialFlow, { type: 'words', text: 'x' }).words).toBe('');
    expect(reduce(s, { type: 'words', text: 'y'.repeat(900) }).words).toHaveLength(500);
  });
});

describe('the door: signed in before the shutter (law 2)', () => {
  it('an anonymous session is sent to sign in; an account gets the camera; no account layer defers to the gateway', () => {
    const account = (auth: boolean, anon: boolean) => ({
      isAuthenticated: () => auth,
      isAnonymous: () => anon,
    });
    expect(doorFor(account(true, true))).toBe('sign-in');
    expect(doorFor(account(false, false))).toBe('sign-in');
    expect(doorFor(account(true, false))).toBe('camera');
    expect(doorFor(undefined)).toBe('camera');
  });
});

describe('the climb, in any script', () => {
  const topics = [
    { id: 't-frac', name: 'Fractions and decimals' },
    { id: 't-quad', name: 'द्विघात समीकरण' },
    { id: 't-light', name: 'प्रकाश का परावर्तन' },
    { id: 't-lin', name: 'Linear equations in one variable' },
  ] as never[];

  it('a Hindi reading matches a Hindi topic, whole words with their vowel signs', () => {
    expect([...wordsOf('द्विघात समीकरण को हल करो')]).toEqual([
      'द्विघात',
      'समीकरण',
      'को',
      'हल',
      'करो',
    ]);
    expect(topicForDoubt('द्विघात समीकरण को हल करो', undefined, topics)?.id).toBe('t-quad');
    expect(topicForDoubt('3x + 5 = 20 solve the linear equations', undefined, topics)?.id).toBe(
      't-lin',
    );
  });

  it('the chips offered are the topics that could be this doubt, then the ones already started, never the first eight of the world', () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `z${i}`, name: `Chapter ${i} something` })),
      ...topics,
    ] as never[];
    const offered = suggestTopics('प्रकाश किरण', undefined, many, { z12: 0.4, 't-frac': 0.2 });
    expect(offered.map((t: { id: string }) => t.id).slice(0, 3)).toEqual([
      't-light',
      'z12',
      't-frac',
    ]);
    expect(offered).toHaveLength(8);
    // a hint name from the gateway counts as words of the reading
    expect(suggestTopics('', 'linear equations', many)[0]?.id).toBe('t-lin');
  });
});

describe('the printed caption follows the beat (law 5, sound off)', () => {
  it('captionAt reveals the sentences due by the clock, in order', () => {
    const frames = [
      { text: 'So x is five.', t: 4800, dur: 2200 },
      { text: 'Look at the five first.', t: 0, dur: 2400 },
      { text: 'It moves across.', t: 2400, dur: 2400 },
    ];
    expect(captionAt(frames, 0)).toBe('Look at the five first.');
    expect(captionAt(frames, 2399)).toBe('Look at the five first.');
    expect(captionAt(frames, 2400)).toBe('Look at the five first. It moves across.');
    expect(captionAt(frames, 99999)).toBe('Look at the five first. It moves across. So x is five.');
  });

  it('the store starts its clock on the first say frame, shows the rest as their time comes, and everything at the end', () => {
    doubtCaption.begin();
    expect(doubtCaption.visible(1000)).toBe('');
    doubtCaption.say('Look at the five first.', 0, 2400, 1000);
    doubtCaption.say('It moves across.', 2400, 2400, 1010); // arrives at wire delivery, early
    doubtCaption.say('So x is five.', 4800, 2200, 1020);
    expect(doubtCaption.visible(1020)).toBe('Look at the five first.');
    expect(doubtCaption.pending(1020)).toBe(true);
    expect(doubtCaption.visible(3400)).toBe('Look at the five first. It moves across.');
    expect(doubtCaption.visible(5800)).toBe(
      'Look at the five first. It moves across. So x is five.',
    );
    expect(doubtCaption.pending(5800)).toBe(false);
    doubtCaption.begin();
    doubtCaption.say('One.', 0, 900, 0);
    doubtCaption.say('Two.', 5000, 900, 0);
    doubtCaption.end();
    expect(doubtCaption.visible(1)).toBe('One. Two.');
  });
});
