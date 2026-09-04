import { afterAll, describe, expect, it } from 'bun:test';

/** A localStorage stand-in — the mind writes through it, so the wipe is observable here. */
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
// A brain to erase from. Set before the mind store is imported so the erase seam has a door to knock on.
process.env.VITE_GATEWAY_URL = 'http://brain.test';

const { capabilityById, forgetAllOffer } = await import('./capabilities');
const { brainErasePending, drainBrainErase, loadMind, rememberFact } = await import(
  '../store/mind'
);

/** Every erase the client asked the brain for, and what the brain said back. */
const erases: string[] = [];
let answer = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  erases.push(`${init?.method ?? 'GET'} ${String(url)}`);
  return new Response(null, { status: answer });
}) as typeof globalThis.fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  // The gateway was set for this file alone; other suites run against a keyless build.
  process.env.VITE_GATEWAY_URL = undefined;
});

describe("forget everything — Wobo asks before Wobo wipes the learner's memory", () => {
  it('is a capability on the permission ladder, not something a model reply can just do', () => {
    const capability = capabilityById('forget_all');
    expect(capability).toBeDefined();
    // execute_with_permission is what renders the approve / not now card in the thread.
    expect(capability?.rung).toBe('execute_with_permission');
  });

  it('offers it as a card the learner has to approve, with the cost stated on it', () => {
    const offer = forgetAllOffer('offer-1');
    expect(offer.capability).toBe('forget_all');
    expect(offer.status).toBe('offered'); // offered, not taken — nothing has happened yet
    expect(offer.offerId).toBe('offer-1');
    expect(offer.evidence.join(' ')).toContain('cannot be undone');
    expect(capabilityById(offer.capability)?.rung).toBe('execute_with_permission');
  });

  it('leaves the memory untouched until the card is approved, then clears it', async () => {
    rememberFact('exam on Friday');
    expect(loadMind().facts).toContain('exam on Friday');

    // Minting the offer is what a turn does; the mind must survive it intact.
    forgetAllOffer('offer-2');
    expect(loadMind().facts).toContain('exam on Friday');

    // Approving the card is the only thing that runs the capability.
    const capability = capabilityById('forget_all');
    const said = await capability?.run(
      {} as Parameters<NonNullable<typeof capability>['run']>[0],
      {},
    );
    expect(loadMind().facts).toEqual([]);
    // The line was "cleared everything" until the copy grew honest about WHAT it clears: the
    // memory goes, here and on the server, and the progress record is a separate erase in
    // Settings. What this asserts is the promise, not the sentence it was once made in.
    expect(said).toContain('cleared what I remember about you');
    expect(said).toContain('Your progress record is separate');
  });
});

/**
 * "Erasure propagates to the brain" (WOBO-TASKS §5.7). Clearing the device is the visible half; the
 * half that matters is the one the learner cannot see, so it is asserted here — including what Wobo
 * is allowed to SAY while the brain has not confirmed it.
 */
describe('the erase reaches the brain, and is honest until it does', () => {
  it('asks the gateway to forget the learner too, not just this device', async () => {
    erases.length = 0;
    answer = 200;
    rememberFact('exam on Friday');
    const said = await capabilityById('forget_all')?.run(
      {} as Parameters<NonNullable<ReturnType<typeof capabilityById>>['run']>[0],
      {},
    );
    // The route the gateway actually serves (`POST /v1/me/erase`). A client knocking on a path
    // nobody serves gets a 404, reads it as "not confirmed", and queues an erase that can never
    // land — the learner is told they are still owed a wipe for the life of the install.
    expect(erases).toEqual(['POST http://brain.test/v1/me/erase']);
    expect(loadMind().facts).toEqual([]);
    expect(brainErasePending()).toBe(false); // nothing is owed once the brain confirms
    expect(said).toContain('on my side');
  });

  it('never claims the brain forgot when the brain never answered — and finishes it later', async () => {
    erases.length = 0;
    answer = 503;
    const said = await capabilityById('forget_all')?.run(
      {} as Parameters<NonNullable<ReturnType<typeof capabilityById>>['run']>[0],
      {},
    );
    expect(said).toContain('Done on this device');
    expect(said).not.toContain('on my side');
    expect(brainErasePending()).toBe(true); // still owed, and honestly so

    // The next pulse retries what is owed, and the queue clears only on a real confirmation.
    answer = 200;
    await drainBrainErase();
    expect(erases).toHaveLength(2);
    expect(brainErasePending()).toBe(false);
    // Nothing is owed any more, so a later pulse asks for nothing.
    await drainBrainErase();
    expect(erases).toHaveLength(2);
  });
});
