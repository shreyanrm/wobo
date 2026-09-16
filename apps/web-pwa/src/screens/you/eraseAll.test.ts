/**
 * "Erase and start over", held to the promise the panel makes: this device, the account on our
 * servers, and it cannot be undone.
 *
 * THE BUG THESE EXIST FOR. The screen chained `eraseFromBrain()` and `eraseRemoteData()`, ignored
 * both answers, and wiped the device on every path. A gateway that answered 500, or a phone with
 * no signal, therefore lost the erase entirely: the retry marker (`wobo-brain-erase-v1`) was never
 * written, and even if it had been, `wipeDevice()` removes every key beginning with `wobo-`, so
 * writing it first would have destroyed it. The learner landed on a fresh onboarding while the
 * account kept their memory, their mail preferences and their parent link, with no record anywhere
 * that an erase had ever been asked for.
 *
 * So the order is the promise, and the order is what is tested: the device is emptied whatever the
 * network did, and the retry is queued AFTER the wipe, never before.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AccountErase, type BrainErase, eraseEverything } from './eraseAll';

/** A run of the erase, with every door recorded in the order it was opened. */
function run(over: {
  brain?: BrainErase | (() => Promise<BrainErase>);
  account?: AccountErase | 'throws' | null;
}) {
  const steps: string[] = [];
  const brain = over.brain ?? 'erased';
  const account = over.account === undefined ? { erased: ['x'], failed: [] } : over.account;
  return {
    steps,
    outcome: eraseEverything({
      eraseBrain: async () => {
        steps.push('brain');
        if (typeof brain === 'function') return brain();
        return brain;
      },
      eraseAccount:
        account === null
          ? null
          : async () => {
              steps.push('account');
              if (account === 'throws') throw new Error('no');
              return account;
            },
      // a block body on purpose: the door returns `void | Promise<void>` now, and `push` returns a
      // number, which is exactly the kind of accident the widened type should keep out
      wipeDevice: () => {
        steps.push('wipe');
      },
      queueRetry: () => steps.push('queue'),
      reload: () => steps.push('reload'),
    }),
  };
}

describe('erase and start over', () => {
  it('empties the device and reloads when everything landed, owing nothing', async () => {
    const walk = run({});
    const outcome = await walk.outcome;
    expect(outcome.owed).toBe(false);
    expect(walk.steps).toEqual(['brain', 'account', 'wipe', 'reload']);
  });

  it('QUEUES THE RETRY, AFTER THE WIPE, when the brain did not confirm', async () => {
    const walk = run({ brain: 'pending' });
    const outcome = await walk.outcome;
    expect(outcome.owed).toBe(true);
    expect(walk.steps).toEqual(['brain', 'account', 'wipe', 'queue', 'reload']);
    // the order is the whole fix: a marker written before the wipe is a marker the wipe takes
    expect(walk.steps.indexOf('queue')).toBeGreaterThan(walk.steps.indexOf('wipe'));
  });

  it('treats a thrown erase as owed, not as done', async () => {
    const walk = run({
      brain: async () => {
        throw new Error('offline');
      },
    });
    expect((await walk.outcome).owed).toBe(true);
    expect(walk.steps).toContain('queue');
  });

  it('owes the retry when the account kept a table, and names what it kept', async () => {
    const walk = run({ account: { erased: ['threads'], failed: ['attempts'] } });
    const outcome = await walk.outcome;
    expect(outcome.owed).toBe(true);
    expect(outcome.accountFailed).toEqual(['attempts']);
    expect(walk.steps).toEqual(['brain', 'account', 'wipe', 'queue', 'reload']);
  });

  it('owes nothing on a build with no brain and no account: the device WAS the whole record', async () => {
    const walk = run({ brain: 'local', account: null });
    expect((await walk.outcome).owed).toBe(false);
    expect(walk.steps).toEqual(['brain', 'wipe', 'reload']);
  });

  /**
   * THE WIPE IS WAITED FOR, because part of it cannot be synchronous.
   *
   * `wipeDevice` sweeps Cache Storage as well as the two Storages now (`store/scope.ts`), and
   * Cache Storage has no synchronous form. A delete still in flight when `reload` fires is a
   * delete that may never land, on the one call in the product whose whole promise is that it did.
   */
  it('waits for a wipe that needs a promise before it reloads', async () => {
    const steps: string[] = [];
    const outcome = await eraseEverything({
      eraseBrain: async () => 'erased',
      eraseAccount: null,
      wipeDevice: async () => {
        steps.push('wipe starts');
        await new Promise((r) => setTimeout(r, 5));
        steps.push('wipe done');
      },
      queueRetry: () => steps.push('queue'),
      reload: () => steps.push('reload'),
    });
    expect(outcome.owed).toBe(false);
    expect(steps).toEqual(['wipe starts', 'wipe done', 'reload']);
  });

  it('reloads anyway when a Cache refused to be opened: the keys already went', async () => {
    const steps: string[] = [];
    await eraseEverything({
      eraseBrain: async () => 'erased',
      eraseAccount: null,
      wipeDevice: () => {
        steps.push('wipe');
        return Promise.reject(new Error('site data is switched off'));
      },
      queueRetry: () => steps.push('queue'),
      reload: () => steps.push('reload'),
    });
    expect(steps).toEqual(['wipe', 'reload']);
  });

  it('empties the device even when nothing upstream answered at all', async () => {
    const walk = run({ brain: 'pending', account: 'throws' });
    await walk.outcome;
    expect(walk.steps).toContain('wipe');
    expect(walk.steps).toContain('reload');
  });
});

describe('the You screen hands over exactly those four doors', () => {
  const YOU = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');

  it('calls the sequence, and keeps no chain of its own', () => {
    expect(YOU).toContain('eraseEverything({');
    expect(YOU).toContain('queueRetry: queueBrainErase');
    // the old chain, which swallowed both answers, is gone
    expect(YOU).not.toContain('.catch(() => 0');
    expect(YOU).not.toMatch(/eraseFromBrain\(\)\s*\n?\s*\.catch/);
  });
});
