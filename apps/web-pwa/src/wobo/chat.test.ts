import { beforeAll, describe, expect, it } from 'bun:test';
import { appendToArchive, mintTurnId, readArchive, writeArchive } from './chat';

/** The archive lives in localStorage; the suite has none, so a plain map stands in. */
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
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

describe('turn ids (the single mint site)', () => {
  it('never repeats — not even past the archive cap, where the old scheme did', () => {
    // The bug: ids were `t${archive.length}-${role}`. The archive is capped at 2000, so from the
    // 2000th turn on every user turn was minted "t2000-user" — colliding for ever after.
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(mintTurnId());
    expect(ids.size).toBe(5000);
  });

  it('is independent of anything the archive knows: two mints in a row differ', () => {
    expect(mintTurnId()).not.toBe(mintTurnId());
  });

  it('mints something a DOM key and an archive lookup can both use', () => {
    const id = mintTurnId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
  });
});

describe('the archive holds the conversation the learner had (DESIGN.md §0.x)', () => {
  beforeAll(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new FakeStorage();
  });

  it('an ephemeral turn (the reply to a silent ask) is never archived', () => {
    writeArchive([]);
    appendToArchive({ id: 'e1', role: 'wobo', text: 'Try the other way round.', ephemeral: true });
    expect(readArchive()).toEqual([]);
    appendToArchive({ id: 'u1', role: 'user', text: 'why?' });
    expect(readArchive().map((t) => t.id)).toEqual(['u1']);
  });
});
