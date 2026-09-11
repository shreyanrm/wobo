import { beforeEach, describe, expect, it } from 'bun:test';
import {
  acknowledge,
  claimNext,
  composeOutcome,
  enqueue,
  getDownload,
  getDownloads,
  markFailed,
  markReady,
  positionOf,
  READY_TOAST,
  readyLine,
  reconcilePlaceholder,
  SLIPPED_TOAST,
  settleCompose,
} from './downloads';

// The store is a module singleton (localStorage in the app, in-memory here). Between tests we
// settle any active work so nothing leaks the one-in-flight guard forward; each test uses its own
// topic ids so a prior test's ready entry never de-dupes a fresh enqueue.
beforeEach(() => {
  for (const d of [...getDownloads()]) {
    if (d.status === 'queued' || d.status === 'downloading') markReady(d.topicId);
    acknowledge(d.topicId);
  }
});

describe('download queue — the on-first-start generation store', () => {
  it('one in flight per learner: claimNext promotes exactly one, then holds', () => {
    enqueue('one-a', 'A');
    enqueue('one-b', 'B');
    const first = claimNext();
    expect(first?.topicId).toBe('one-a'); // FIFO — oldest first
    expect(getDownload('one-a')?.status).toBe('downloading');
    expect(claimNext()).toBeUndefined(); // refused while one is downloading
  });

  it('the next course is claimed only once the current one settles', () => {
    enqueue('nxt-a', 'A');
    enqueue('nxt-b', 'B');
    claimNext();
    markReady('nxt-a');
    expect(claimNext()?.topicId).toBe('nxt-b');
  });

  it('enqueue de-dupes an in-flight/queued topic but re-arms a failed one', () => {
    enqueue('dup-a', 'A');
    enqueue('dup-a', 'A'); // ignored — already in line
    expect(getDownloads().filter((d) => d.topicId === 'dup-a')).toHaveLength(1);
    claimNext();
    markFailed('dup-a');
    enqueue('dup-a', 'A'); // a slip can be retried
    expect(getDownload('dup-a')?.status).toBe('queued');
  });

  it('position reports the place in line; a settled course leaves it', () => {
    enqueue('pos-a', 'A');
    enqueue('pos-b', 'B');
    expect(positionOf('pos-a')).toBe(1);
    expect(positionOf('pos-b')).toBe(2);
    claimNext();
    markReady('pos-a');
    expect(positionOf('pos-a')).toBe(0); // ready — no longer waiting
    expect(positionOf('pos-b')).toBe(1); // moved up
  });

  it('ready surfaces once (seen=false), then acknowledge clears the toast, keeps the status', () => {
    enqueue('rdy-a', 'A');
    claimNext();
    markReady('rdy-a');
    expect(getDownload('rdy-a')?.seen).toBe(false);
    acknowledge('rdy-a');
    expect(getDownload('rdy-a')?.seen).toBe(true);
    expect(getDownload('rdy-a')?.status).toBe('ready');
  });
});

// --- wave 29 (#9 on the client): a placeholder is not a course, so it is never 'ready' ------------
describe('a compose that settled on the honest floor is not a ready course', () => {
  // The exact live envelope the gateway serves when it has nothing verified for a topic: named a
  // placeholder three ways (Composing.isPlaceholderEnvelope). The runner used to markReady on any
  // settled compose, so the toast read 'Your course is ready', Wobo said it aloud, and the tap
  // opened 'Still being made'. The row then stayed ready for ever.
  const placeholder = {
    verified: false,
    status: 'provisional',
    seeded: true,
    provenance: { engine: 'engine.compose', source: 'seed', placeholder: true },
    artifact: { topic: 'Algebra play', cards: [], workbook: [], boss: [] },
  };
  const real = {
    verified: true,
    status: 'canonical',
    provenance: { engine: 'engine.compose', source: 'model', placeholder: false },
    artifact: { topic: 'Algebra play', cards: [{}, {}, {}], workbook: [], boss: [] },
  };

  it('reads the envelope: a placeholder settles as failed, a verified course as ready', () => {
    expect(composeOutcome(placeholder)).toBe('failed');
    expect(composeOutcome({ seeded: true })).toBe('failed');
    expect(composeOutcome({ provenance: { source: 'seed' } })).toBe('failed');
    expect(composeOutcome(real)).toBe('ready');
  });

  it('settling a placeholder leaves the topic retryable, never presented as downloaded', () => {
    enqueue('ph-a', 'Algebra play');
    claimNext();
    settleCompose('ph-a', placeholder);
    expect(getDownload('ph-a')?.status).toBe('failed');
    // a failed row is the one state enqueue restarts from: the learner can ask again later
    enqueue('ph-a', 'Algebra play');
    expect(getDownload('ph-a')?.status).toBe('queued');
  });

  it('the lines a learner reads or hears carry no em dash', () => {
    for (const line of [readyLine('Algebra play'), READY_TOAST, SLIPPED_TOAST]) {
      expect(line).not.toContain('—');
    }
    expect(readyLine('Algebra play')).toContain('algebra play');
  });
});

describe('a course that opens as a placeholder was never ready (DESIGN.md §0.x)', () => {
  it('reconcilePlaceholder settles a stale ready entry as failed, and raises no second toast', () => {
    // An entry settled ready by an earlier build, before placeholders counted as failures, kept
    // saying "Your course is ready" over a page that said "Still being made".
    enqueue('stale-a', 'Cells');
    claimNext();
    markReady('stale-a');
    expect(getDownload('stale-a')).toMatchObject({ status: 'ready', seen: false });
    reconcilePlaceholder('stale-a');
    expect(getDownload('stale-a')).toMatchObject({ status: 'failed', seen: true });
  });

  it('is a no-op for a topic with no download, or one already failed', () => {
    reconcilePlaceholder('never-queued');
    expect(getDownload('never-queued')).toBeUndefined();
    enqueue('stale-b', 'Light');
    claimNext();
    markFailed('stale-b');
    acknowledge('stale-b');
    reconcilePlaceholder('stale-b');
    expect(getDownload('stale-b')).toMatchObject({ status: 'failed', seen: true });
  });
});

/**
 * A BOUNCED TAP IS NEVER A SILENT ONE (the adversary, wave 47, finding 10).
 *
 * Wave 47 reported that tapping "A Square and A Cube" on /subject/Mathematics/learn never opens a
 * course. Reproduced keyless on 2026-09-11 (gateway 8163, web 5263, the lab's own saved learner):
 * the tap DOES navigate to /course/<id>; the download-first chokepoint in `screens/Course.tsx`
 * then finds no owned course, enqueues one and bounces back — which is the owner's law, not a
 * defect in the router. The compose that follows returns the gateway's seed envelope, which is not
 * a course, so the entry settles `failed`.
 *
 * The only way that becomes the silence wave 47 measured is if the settle leaves `seen` set, and
 * nothing surfaces. So the law is held here: a failed settle always surfaces, and the topic is
 * always retryable. A learner is bounced, and a learner is told.
 */
describe('a course that cannot be composed says so', () => {
  it('surfaces the slip even when the entry was already acknowledged', () => {
    enqueue('slip-a', 'A Square and A Cube');
    claimNext();
    markReady('slip-a');
    acknowledge('slip-a'); // the learner saw the ready toast on an older build
    // The course page opens, finds a placeholder behind that 'ready', and says it was never ready.
    reconcilePlaceholder('slip-a');
    expect(getDownload('slip-a')?.status).toBe('failed');
    // The next tap re-arms it, and the failure that follows is the one the learner reads.
    enqueue('slip-a', 'A Square and A Cube');
    claimNext();
    settleCompose('slip-a', { seeded: true });
    const after = getDownload('slip-a');
    expect(after?.status).toBe('failed');
    expect(after?.seen).toBe(false); // "That one slipped away. Tap to try again"
  });

  it('a seed envelope is never a course, however it names itself', () => {
    for (const seed of [
      { seeded: true },
      { provenance: { placeholder: true } },
      { provenance: { source: 'seed' } },
    ]) {
      expect(composeOutcome(seed)).toBe('failed');
    }
  });
});
