/**
 * The memory page shows the RECORD, says honestly what is still waiting to save, marks what a
 * parent offered, and never disguises it (docs/MEMORY-LAW.md, docs/TWO-MINDS.md).
 *
 * No browser in this suite: the list renders to static markup from props and is read as markup,
 * which is enough for what a review would check: the rows, the mark, the remove per row, and the
 * one calm line when a write has not landed.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

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
(globalThis as { localStorage?: unknown }).localStorage = new FakeStorage();

const { MIND_MEMORY_COPY, MindMemoryList } = await import('./MindMemory');
const { MIND_SYNC_COPY } = await import('../../store/mind-sync');
type Status = import('../../store/mind-sync').MindSyncStatus;

const noop = () => {};
const synced: Status = {
  gate: 'ready',
  waiting: 0,
  refused: 0,
  syncedAt: '2026-09-05T10:00:00.000Z',
  stored: true,
  busy: false,
  line: null,
  last: 'synced',
};

const render = (over: Partial<Parameters<typeof MindMemoryList>[0]> = {}) =>
  renderToStaticMarkup(
    <MindMemoryList
      items={[
        { kind: 'interest', text: 'cricket' },
        { kind: 'fact', text: 'exam on friday' },
      ]}
      offered={[{ id: 'o1', body: 'she has dyslexia', createdAt: '2026-09-01T00:00:00Z' }]}
      noticed={['you showed up 3 of the last 7 days']}
      status={synced}
      wired
      reading={false}
      removing={null}
      offeredLine={null}
      onRemove={noop}
      onRemoveOffered={noop}
      onRetry={noop}
      {...over}
    />,
  );

describe('the memory page', () => {
  it('lists every remembered thing with its own remove, and says the account is the source', () => {
    const html = render();
    expect(html).toContain('cricket');
    expect(html).toContain('exam on friday');
    expect(html).toContain('aria-label="Remove: cricket"');
    expect(html).toContain('aria-label="Remove: exam on friday"');
    expect(html).toContain(MIND_MEMORY_COPY.account);
  });

  it('marks a parent-offered fact as from their parent, in the same list, removable for good', () => {
    const html = render();
    expect(html).toContain('she has dyslexia');
    expect(html).toContain('data-source="parent"');
    expect(html).toContain(MIND_MEMORY_COPY.parentTag);
    expect(html).toContain('aria-label="Remove, for good: she has dyslexia"');
    expect(html).toContain(MIND_MEMORY_COPY.parentNote);
    // and never when nothing was offered: the note would be a claim about a parent who said nothing
    expect(render({ offered: [] })).not.toContain(MIND_MEMORY_COPY.parentNote);
  });

  it('leaves a real gap between the fact and the mark, so the two are not one word', () => {
    // The mark was pushed across by `margin-left: 8px` and nothing else, so the row was one run in
    // the accessibility tree: a screen reader read "she has dyslexiafrom your parent", gluing the
    // provenance to the fact it is there to qualify. The Remove button's own label always had a
    // separator; the row itself did not.
    const html = render();
    expect(html).not.toContain(`dyslexia<em class="wm-tag">${MIND_MEMORY_COPY.parentTag}`);
    expect(html).toMatch(
      new RegExp(`dyslexia[^<]*\\s<em class="wm-tag">${MIND_MEMORY_COPY.parentTag}`),
    );
  });

  it('says what is waiting to save, as the wire reports it, and nothing else when nothing is', () => {
    const owed = render({
      status: { ...synced, waiting: 2, line: MIND_SYNC_COPY.trouble(2), last: 'trouble' },
    });
    expect(owed).toContain(MIND_SYNC_COPY.trouble(2));
    expect(owed).toContain('role="status"');
    expect(owed).not.toContain(MIND_MEMORY_COPY.account);
    expect(render()).not.toContain('waiting to save');
  });

  it('offers a retry only when the store refused, with the support address in the line', () => {
    const refused = render({
      status: { ...synced, refused: 1, line: MIND_SYNC_COPY.refused(1), last: 'refused' },
    });
    expect(refused).toContain('support@heywobo.com');
    expect(refused).toContain(MIND_MEMORY_COPY.retry);
    expect(render()).not.toContain(`>${MIND_MEMORY_COPY.retry}<`);
  });

  it('shows the empty line, the reading line and the device line at the right moments', () => {
    expect(render({ items: [], offered: [] })).toContain(MIND_MEMORY_COPY.empty);
    expect(render({ items: [], offered: [], reading: true })).toContain(MIND_MEMORY_COPY.reading);
    expect(render({ wired: false })).toContain(MIND_MEMORY_COPY.device);
    expect(render({ wired: false })).not.toContain(MIND_MEMORY_COPY.account);
  });

  it('keeps what Wobo noticed read-only, under its own line', () => {
    const html = render();
    expect(html).toContain(MIND_MEMORY_COPY.noticed);
    expect(html).toContain('you showed up 3 of the last 7 days');
    expect(html).not.toContain('Remove: you showed up');
  });
});

describe('the page is on the You screen, where the law says a learner can see it', () => {
  // A memory page nobody can reach is not a memory page. `removeFact` and `removableItems` had
  // no caller at all before this: the list existed as a store and as a promise, and as no screen.
  const you = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');
  it('imports and renders MindMemory under its own row', () => {
    expect(you).toContain("from './you/MindMemory'");
    expect(you).toContain('<MindMemory />');
    expect(you).toContain('title="What Wobo remembers"');
  });
});

describe('the words obey the register (docs/copy/voice.md 10a)', () => {
  const lines: readonly string[] = [...Object.values(MIND_MEMORY_COPY), MIND_SYNC_COPY.signIn];
  const made = [
    MIND_SYNC_COPY.offline(1),
    MIND_SYNC_COPY.offline(3),
    MIND_SYNC_COPY.trouble(1),
    MIND_SYNC_COPY.refused(2),
  ];
  it('no em dash, no exclamation mark, no emoji', () => {
    for (const line of [...lines, ...made]) {
      expect(line).not.toContain('—');
      expect(line).not.toContain('!');
      expect(/\p{Extended_Pictographic}/u.test(line)).toBe(false);
    }
  });
  it('the sheet is namespaced wm- and uses tokens, never a colour of its own', () => {
    const css = readFileSync(join(import.meta.dir, 'mind-memory.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const m of css.matchAll(/\.([a-z][\w-]*)/g)) {
      expect(m[1]?.startsWith('wm-') || m[1] === 'wk-btn').toBe(true);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
