/**
 * The campaign a visitor arrived by: read once, kept a while, handed over once, then gone
 * (docs/GROWTH-DESK.md §4.4). Neutral ids only.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARRIVAL_PATH,
  CAMPAIGN_DAYS,
  CAMPAIGN_KEY,
  campaignFrom,
  isCampaign,
  rememberCampaign,
  sendCampaign,
  takeCampaign,
  withoutCampaign,
} from './campaign';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 16);
const PAGE = 'https://heywobo.com/blog/probability';

describe('the campaign grammar', () => {
  it('matches the gateway, one-letter channels included', () => {
    expect(isCampaign('x-202609-probability-01')).toBe(true);
    expect(isCampaign('business-profile-202609-motion-and-time-12')).toBe(true);
    for (const bad of [
      '',
      'x-2026-a-01',
      'X-202609-a-01',
      'x-202609-a-1',
      'x-202609-a-01&b=1',
      `x-202609-${'a'.repeat(90)}-01`,
    ]) {
      expect(isCampaign(bad)).toBe(false);
    }
  });

  it('reads the first utm_id and only one of ours', () => {
    expect(campaignFrom(`${PAGE}?utm_id=x-202609-probability-01&utm_id=blog-202609-p-01`)).toBe(
      'x-202609-probability-01',
    );
    expect(campaignFrom(`${PAGE}?utm_id=%3Cscript%3E`)).toBeNull();
    expect(campaignFrom('not a url')).toBeNull();
  });

  it('takes the campaign out of the address and nothing else', () => {
    expect(withoutCampaign(`${PAGE}?utm_id=x-202609-probability-01`)).toBe(PAGE);
    expect(withoutCampaign(`${PAGE}?a=1&utm_id=x-202609-probability-01#top`)).toBe(
      `${PAGE}?a=1#top`,
    );
    expect(withoutCampaign(PAGE)).toBe(PAGE);
  });
});

describe('holding it', () => {
  it('keeps the first fresh one, and a second link does not overwrite it', () => {
    const store = memory();
    expect(rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0)).toBe(
      'x-202609-probability-01',
    );
    expect(rememberCampaign(`${PAGE}?utm_id=telegram-202609-probability-01`, store, T0 + DAY)).toBe(
      'x-202609-probability-01',
    );
  });

  it('lets an old one go after the window', () => {
    const store = memory();
    rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0);
    const later = T0 + (CAMPAIGN_DAYS + 1) * DAY;
    expect(rememberCampaign(`${PAGE}?utm_id=blog-202610-motion-01`, store, later)).toBe(
      'blog-202610-motion-01',
    );
    expect(takeCampaign(memory(), later)).toBeNull();
  });

  it('is taken once, and gone even when it was stale', () => {
    const store = memory();
    rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0);
    expect(takeCampaign(store, T0 + DAY)).toBe('x-202609-probability-01');
    expect(store.map.has(CAMPAIGN_KEY)).toBe(false);
    expect(takeCampaign(store, T0 + DAY)).toBeNull();
    rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0);
    expect(takeCampaign(store, T0 + 40 * DAY)).toBeNull();
    expect(store.map.has(CAMPAIGN_KEY)).toBe(false);
  });

  it('ignores a value that was tampered with on the device', () => {
    const store = memory();
    store.setItem(CAMPAIGN_KEY, JSON.stringify({ id: 'javascript:alert(1)', at: T0 }));
    expect(takeCampaign(store, T0)).toBeNull();
    store.setItem(CAMPAIGN_KEY, '{not json');
    expect(takeCampaign(store, T0)).toBeNull();
  });
});

describe('handing it over', () => {
  it('posts it once to the arrival door and forgets it whatever the answer', async () => {
    const store = memory();
    rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0);
    const calls: { url: string; body: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      return Response.json({ written: true });
    }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
    expect(await sendCampaign('https://gw.example/', { fetcher, store, now: T0 })).toBe(true);
    expect(calls).toEqual([
      {
        url: `https://gw.example${ARRIVAL_PATH}`,
        body: JSON.stringify({ utm_id: 'x-202609-probability-01' }),
      },
    ]);
    expect(await sendCampaign('https://gw.example', { fetcher, store, now: T0 })).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('never throws, and a refusal still forgets it', async () => {
    const store = memory();
    rememberCampaign(`${PAGE}?utm_id=x-202609-probability-01`, store, T0);
    const fetcher = (async () => {
      throw new Error('offline');
    }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
    expect(await sendCampaign('https://gw.example', { fetcher, store, now: T0 })).toBe(false);
    expect(store.map.has(CAMPAIGN_KEY)).toBe(false);
  });

  it('sends nothing with no gateway and nothing kept', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof import('@wobo/sdk').gatewayFetch;
    expect(await sendCampaign('https://gw.example', { fetcher, store: memory(), now: T0 })).toBe(
      false,
    );
    expect(called).toBe(false);
  });
});

describe('where it is wired', () => {
  const src = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8');

  it('is captured at boot, on every page, before anything renders', () => {
    const main = src('main.tsx');
    expect(main).toContain('captureCampaign()');
    expect(main.indexOf('captureCampaign()')).toBeLessThan(main.indexOf('createRoot('));
  });

  it('is handed over only after the new profile row is written', () => {
    const onboarding = src('screens/Onboarding.tsx');
    const send = onboarding.indexOf('sendCampaign(gatewayUrl())');
    expect(send).toBeGreaterThan(-1);
    const before = onboarding.slice(Math.max(0, send - 900), send);
    expect(before).toContain('?.syncProfile({');
    expect(before.slice(before.indexOf('?.syncProfile({'))).toContain('.then(');
  });
});
