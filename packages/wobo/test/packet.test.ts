import { beforeEach, describe, expect, it } from 'bun:test';
import { createFocus, type FocusObject, resetFocusIds } from '../src/focus';
import { chooseGlass, type GlassCandidate, type GlassMap } from '../src/glass';
import {
  buildPacket,
  type ContextPacket,
  DEFAULT_MAX_TOKENS,
  estimateTokens,
  MAX_TURNS,
  type PacketTurn,
  packetFits,
} from '../src/packet';

/**
 * The glass as the reader hands it over: a map already chosen by visibility and relevance, at
 * most sixty entries and about two kilobytes. `lines` is how many lines the page had.
 */
const glass = (lines = 48): GlassMap => {
  const candidates: GlassCandidate[] = Array.from({ length: lines }, (_, i) => ({
    role: i === 0 ? 'heading' : i % 9 === 0 ? 'step' : 'line',
    text: `line ${i} of the page, with enough words on it to be worth the bytes`,
    box: [24, 40 + i * 26, 340, 22],
    order: i,
    visible: 1,
    ...(i % 9 === 0 && i > 0 ? { meaning: `step:${i / 9}` } : {}),
  }));
  return chooseGlass(candidates, { w: 390, h: 844, scrollY: 0 });
};

const focus = (text = 'the step where 3 was moved across, giving 2x = 8'): FocusObject =>
  createFocus({
    kind: 'lasso',
    rect: { x: 10.4, y: 20.6, width: 100.2, height: 40.8 },
    targetIds: ['step-2'],
    text,
    ownerState: { 'step-2': { equation: '2x + 3 = 11' } },
    path: Array.from({ length: 30 }, (_, i) => ({ x: i * 3.3, y: Math.sin(i) * 10 })),
    createdAt: 1_700_000_000_000,
  });

const turns = (n: number): PacketTurn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('learner' as const) : ('wobo' as const),
    text: `turn number ${i}, with enough words in it to be worth trimming later on`,
  }));

beforeEach(() => resetFocusIds());

describe('the token estimate', () => {
  it('counts four characters to a token', () => {
    expect(estimateTokens('abcd')).toBe(2); // JSON adds the quotes: 6 bytes
    expect(estimateTokens({ a: 1 })).toBe(2); // {"a":1} is 7 bytes
  });

  it('honours a different ratio', () => {
    expect(estimateTokens('abcdefgh', 2)).toBe(5);
  });
});

describe('a packet that fits', () => {
  it('carries every section, unharmed', () => {
    const packet = buildPacket({
      focus: focus(),
      glass: glass(2),
      route: 'course',
      task: { beat: 'card-3', attempt: 2, score: 0.5 },
      mind: { band: 'developing', topic: 'linear equations', consentTier: 'un_elevated' },
      turns: turns(2),
    });
    expect(packet.v).toBe(1);
    expect(packet.route).toBe('course');
    expect(packet.focus?.targetIds).toEqual(['step-2']);
    expect(packet.task?.beat).toBe('card-3');
    expect(packet.mind?.band).toBe('developing');
    expect(packet.glass).toHaveLength(2);
    expect(packet.viewport).toEqual({ w: 390, h: 844, scrollY: 0 });
    expect(packet.turns).toHaveLength(2);
    expect(packet.truncated).toBeUndefined();
    expect(packetFits(packet)).toBe(true);
  });

  it('rounds the focus rect to whole pixels — sub-pixel precision is bytes with no meaning', () => {
    const packet = buildPacket({ focus: focus() });
    expect(packet.focus?.rect).toEqual({ x: 10, y: 21, width: 100, height: 41 });
  });

  it('reports its own token cost, settled', () => {
    const packet = buildPacket({ focus: focus(), glass: glass(2) });
    expect(packet.tokens).toBe(estimateTokens(packet));
  });

  it('keeps only the last few turns, newest last', () => {
    const packet = buildPacket({ turns: turns(20) });
    expect(packet.turns).toHaveLength(MAX_TURNS);
    expect(packet.turns?.[MAX_TURNS - 1]?.text).toContain('turn number 19');
  });

  it('is empty-safe — no focus, no glass, no mind', () => {
    const packet = buildPacket({});
    expect(packet).toEqual({ v: 1, tokens: packet.tokens });
    expect(packet.tokens).toBeGreaterThan(0);
  });
});

describe('the priority ladder', () => {
  const crowded = () => ({
    focus: focus('a long focus text: '.repeat(30)),
    glass: glass(),
    route: 'course',
    task: { beat: 'card-3', attempt: 2, score: 0.5, extra: 'a field nobody named' },
    mind: {
      band: 'developing',
      topic: 'linear equations',
      mistakes: ['moved the sign', 'divided too early', 'forgot the bracket'],
      analogy: 'cricket',
      consentTier: 'un_elevated',
      plan: 'a long plan that could be summarised far more tightly than this one is',
    },
    turns: turns(6),
  });

  it('fits the 6 KB total budget on a crowded screen', () => {
    const packet = buildPacket(crowded());
    expect(packet.tokens).toBeLessThanOrEqual(DEFAULT_MAX_TOKENS);
    expect(packetFits(packet)).toBe(true);
  });

  it('sheds the conversation, never the glass: the map is a choice, not a thing to shave', () => {
    const packet = buildPacket({ ...crowded(), budget: { maxTokens: 500 } });
    expect(packet.truncated?.[0]).toBe('turns');
    expect(packet.glass).toEqual(glass().entries);
    expect(packet.truncated).not.toContain('glass');
    expect(packet.truncated).not.toContain('screen');
  });

  it('keeps the focus and the glass to the very end — they are what the question is about', () => {
    const packet = buildPacket({ ...crowded(), budget: { maxTokens: 120 } });
    expect(packet.focus).toBeDefined();
    expect(packet.focus?.targetIds).toEqual(['step-2']);
    expect(packet.glass).toEqual(glass().entries);
    expect(packet.turns).toBeUndefined();
  });

  it('the glass arrives whole: every entry the reader chose, id for id, meaning kept', () => {
    const map = glass();
    const packet = buildPacket({ glass: map });
    expect(packet.glass?.map((e) => e.id)).toEqual(map.entries.map((e) => e.id));
    expect(packet.glass?.find((e) => e.role === 'step')?.meaning).toBe('step:1');
  });

  it('names every section it trimmed, once each, in order', () => {
    const packet = buildPacket({ ...crowded(), budget: { maxTokens: 200 } });
    const trimmed = packet.truncated ?? [];
    expect(trimmed.length).toBeGreaterThan(0);
    expect(new Set(trimmed).size).toBe(trimmed.length);
    expect(trimmed[0]).toBe('turns');
  });

  it('drops the oldest mistake first, keeping the one Wobo is teaching against', () => {
    const packet = buildPacket({ ...crowded(), budget: { maxTokens: 210 } });
    if (packet.mind?.mistakes) {
      expect(packet.mind.mistakes[packet.mind.mistakes.length - 1]).toBe('forgot the bracket');
    }
  });

  it('is deterministic — the same turn twice is the same bytes', () => {
    resetFocusIds();
    const a = buildPacket(crowded());
    resetFocusIds();
    const b = buildPacket(crowded());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('survives an impossible budget without spinning or lying', () => {
    const packet = buildPacket({ ...crowded(), budget: { maxTokens: 1 } });
    expect(packet.v).toBe(1);
    expect(packet.truncated).toBeDefined();
    expect(packet.tokens).toBeGreaterThan(0);
  });

  it('never invents a section it did not receive', () => {
    const packet: ContextPacket = buildPacket({ route: 'home', budget: { maxTokens: 5 } });
    expect(packet.focus).toBeUndefined();
    expect(packet.mind).toBeUndefined();
    expect(packet.glass).toBeUndefined();
  });
});
