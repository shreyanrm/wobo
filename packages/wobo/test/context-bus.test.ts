import { describe, expect, it } from 'bun:test';
import {
  type AnnotatableTarget,
  createTargetStore,
  hasSceneSeam,
  resolveCanvasSlot,
} from '../src/context-bus';

const t = (id: string): AnnotatableTarget => ({
  id,
  kind: 'step',
  label: id,
  getRect: () => null,
});

describe('the bus carries scenes, and the glass carries the page (INK §4)', () => {
  it('a thing with no seam is a label on the element, never a bus registration', () => {
    expect(hasSceneSeam({ hasState: false, hasValidActions: false, hasDrive: false })).toBe(false);
  });
  it('any seam makes it a scene Wobo reads or drives', () => {
    expect(hasSceneSeam({ hasState: true, hasValidActions: false, hasDrive: false })).toBe(true);
    expect(hasSceneSeam({ hasState: false, hasValidActions: true, hasDrive: false })).toBe(true);
    expect(hasSceneSeam({ hasState: false, hasValidActions: false, hasDrive: true })).toBe(true);
  });
});

describe('the canvas slot is owned by the surface that published it', () => {
  const canvas = (nodeId: string) => ({ nodeId, steps: [] });

  it('publishing takes ownership', () => {
    const slot = resolveCanvasSlot({}, canvas('a'), 'MathScene');
    expect(slot).toEqual({ canvas: canvas('a'), owner: 'MathScene' });
  });

  it('a leaving screen cannot clear the canvas the arriving one already published', () => {
    const arrived = resolveCanvasSlot({ canvas: canvas('a'), owner: 'BalanceScale' }, undefined);
    expect(arrived).toEqual({}); // ownerless clear still clears (unmigrated caller)

    const after = resolveCanvasSlot({ canvas: canvas('b'), owner: 'MathScene' }, undefined, 'Boss');
    expect(after).toEqual({ canvas: canvas('b'), owner: 'MathScene' }); // not Boss's to clear
  });

  it('the owner can clear its own canvas', () => {
    const slot = resolveCanvasSlot(
      { canvas: canvas('b'), owner: 'MathScene' },
      undefined,
      'MathScene',
    );
    expect(slot).toEqual({});
  });
});

describe('registration is a subscription, not bus state', () => {
  it('notifies subscribers and bumps a version on mount and unmount', () => {
    const store = createTargetStore();
    const seen: number[] = [];
    const stop = store.subscribe(() => seen.push(store.getVersion()));

    const drop = store.register(t('step-1'));
    expect(store.getTargets().map((x) => x.id)).toEqual(['step-1']);
    drop();
    expect(store.getTargets()).toHaveLength(0);
    expect(seen).toEqual([1, 2]);

    stop();
    store.register(t('step-2'));
    expect(seen).toEqual([1, 2]); // an unsubscribed consumer no longer wakes up
    expect(store.getVersion()).toBe(3);
  });

  it('an unmount cleanup is idempotent and never evicts the target that replaced it', () => {
    const store = createTargetStore();
    const drop = store.register(t('card'));
    const replacement = t('card'); // a remount registers before the old cleanup runs
    store.register(replacement);
    drop();
    drop();
    expect(store.getTargets()).toEqual([replacement]);
    expect(store.get('card')).toBe(replacement);
  });

  it('lets a listener unsubscribe itself while being notified', () => {
    const store = createTargetStore();
    let hits = 0;
    const stop = store.subscribe(() => {
      hits += 1;
      stop();
    });
    store.register(t('a'));
    store.register(t('b'));
    expect(hits).toBe(1);
  });
});
