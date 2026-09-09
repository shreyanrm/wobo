/**
 * THE DIAL: the web reads the same switch the gateway refuses on.
 *
 * `docs/DOORS-CLOSED.md` §4 is a dial, not a deploy: `doors_open` lives in `ops.settings`, the
 * gateway refuses account creation while it is false, and the web app reads the same value so the
 * copy follows the switch within a minute and without a release.
 *
 * Three properties are load-bearing, and each is a test below.
 *
 *  1. **Closed is the default, and every failure is closed.** No gateway configured, a network
 *     that is down, a 500, a body in a shape nobody expected: all of them read as closed. A dial
 *     that opens the door because a request timed out is worse than no dial, because the copy
 *     would invite a stranger through a door the gateway is still refusing at.
 *  2. **Only the word yes opens it.** `{ doors_open: true }` and nothing else.
 *  3. **A change reaches every reader.** The subscription is what re-renders the nineteen doors,
 *     so it is asserted rather than assumed.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  DIAL_EVERY_MS,
  DIAL_PATH,
  doorsOpen,
  readDial,
  setDoorsOpen,
  subscribeDoors,
} from './dial';

function reply(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

beforeEach(() => {
  setDoorsOpen(false);
});

describe('the dial the web reads', () => {
  it('asks the gateway for the same switch the gateway refuses on', async () => {
    let asked = '';
    const seen: typeof fetch = (async (url: string) => {
      asked = String(url);
      return { ok: true, status: 200, json: async () => ({ doors_open: true }) } as Response;
    }) as unknown as typeof fetch;
    await readDial('https://brain.example.com/', seen);
    expect(asked).toBe(`https://brain.example.com${DIAL_PATH}`);
  });

  it('opens only when the gateway says the word', async () => {
    expect(await readDial('https://b', reply({ doors_open: true }))).toBe(true);
    expect(await readDial('https://b', reply({ doors_open: false }))).toBe(false);
  });

  it('reads anything else as closed', async () => {
    expect(await readDial('https://b', reply({ doors_open: 'true' }))).toBe(false);
    expect(await readDial('https://b', reply({}))).toBe(false);
    expect(await readDial('https://b', reply(null))).toBe(false);
    expect(await readDial('https://b', reply({ doors_open: true }, false))).toBe(false);
  });

  it('reads a gateway that is not there, or not answering, as closed', async () => {
    const down: typeof fetch = (() =>
      Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await readDial('https://b', down)).toBe(false);
    expect(await readDial('', reply({ doors_open: true }))).toBe(false);
  });

  it('starts closed', () => {
    expect(doorsOpen()).toBe(false);
  });

  it('tells every reader when the owner turns it', () => {
    let told = 0;
    const stop = subscribeDoors(() => {
      told += 1;
    });
    setDoorsOpen(true);
    expect([told, doorsOpen()]).toEqual([1, true]);
    // the same value twice is not a change, and must not repaint nineteen doors
    setDoorsOpen(true);
    expect(told).toBe(1);
    setDoorsOpen(false);
    expect([told, doorsOpen()]).toEqual([2, false]);
    stop();
    setDoorsOpen(true);
    expect(told).toBe(2);
  });

  it('re-reads inside the minute the law promises', () => {
    expect(DIAL_EVERY_MS).toBeLessThanOrEqual(60_000);
  });
});
