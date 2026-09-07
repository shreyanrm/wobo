/**
 * EVERYTHING WOBO KNOWS COMES FROM THE ACCOUNT, IN A REAL BROWSER AT 390 WIDE
 * (docs/MEMORY-LAW.md, docs/MIND-SYNC-CONTRACT.md, docs/TWO-MINDS.md).
 *
 * The record for one learner already exists on the server before she ever touches this phone.
 * She signs in through the door and the memory page shows it, with the fact her parent offered
 * marked as such. A remove reaches the server before the row leaves. A fact told to Wobo while the
 * gateway is unreachable is on the screen at once, said to be waiting to save, and lands later
 * under the SAME write id. She signs out and the device holds nothing of hers. A second learner
 * signs in and sees nothing of hers. She signs back in and the account gives her memory back.
 *
 * The app runs against live auth and a gateway address (tests-mind/config.ts). This file answers
 * every GoTrue, PostgREST and gateway request itself, from one in-memory record that lives for the
 * whole spec, applying the gateway's write rule (mind.py): remember adds, forget tombstones, bump
 * adds, a write id counts once. The record is chosen by the SUBJECT IN THE BEARER TOKEN and by
 * nothing the device sends, which is what "the account is the key" means on the wire.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Request, test } from '@playwright/test';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const PORT = Number(process.env.WOBO_MIND_PORT ?? 5341);
const DB_ORIGIN = `http://127.0.0.1:${PORT + 1}`;
const GW = `http://localhost:${PORT}/gw`;

// Subjects are UUIDs, as auth.uid() is: the event outbox validates them, and a made-up id crashes
// the app on the sign-in event.
const ASHA = {
  phone: '98765 43210',
  subject: '11111111-1111-4111-8111-111111111111',
  name: 'Asha',
};
const RIYA = {
  phone: '91234 56789',
  subject: '22222222-2222-4222-8222-222222222222',
  name: 'Riya',
};

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 } });

// --- the account: GoTrue and PostgREST, answered here --------------------------------------------

const b64url = (s: string) => Buffer.from(s).toString('base64url');
function jwt(sub: string, anonymous: boolean): string {
  const payload = {
    sub,
    role: 'authenticated',
    is_anonymous: anonymous,
    exp: Math.floor(Date.now() / 1000) + 36_000,
  };
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.sig`;
}
function session(sub: string, anonymous = false) {
  return {
    access_token: jwt(sub, anonymous),
    refresh_token: `refresh-${sub}`,
    expires_in: 36_000,
    token_type: 'bearer',
    user: { id: sub, is_anonymous: anonymous },
  };
}
/** Who the bearer token names: the only key the gateway mock reads a record by. */
function subjectOf(req: Request): { sub: string; anonymous: boolean } | null {
  const auth = req.headers().authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const body = JSON.parse(Buffer.from(part, 'base64url').toString()) as {
      sub?: string;
      is_anonymous?: boolean;
    };
    return body.sub ? { sub: body.sub, anonymous: body.is_anonymous === true } : null;
  } catch {
    return null;
  }
}

const db = new Map<string, Map<string, Record<string, unknown>>>();
let anonCount = 0;
function table(name: string): Map<string, Record<string, unknown>> {
  let t = db.get(name);
  if (!t) {
    t = new Map();
    db.set(name, t);
  }
  return t;
}
function rowsWhere(name: string, params: URLSearchParams): Record<string, unknown>[] {
  const wanted: [string, string][] = [];
  for (const [k, v] of params) if (v.startsWith('eq.')) wanted.push([k, v.slice(3)]);
  return [...table(name).values()].filter((row) => wanted.every(([k, v]) => String(row[k]) === v));
}

async function installAccount(page: Page): Promise<void> {
  await page.route(`${DB_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) {
      const path = url.pathname.slice('/auth/v1/'.length);
      if (path === 'signup') {
        anonCount += 1;
        return json(200, session(`anon-${anonCount}`, true));
      }
      if (path === 'otp') return json(200, {});
      if (path === 'verify') {
        const body = req.postDataJSON() as { phone?: string };
        const digits = (body.phone ?? '').replace(/\D/g, '');
        const who = digits.endsWith(ASHA.phone.replace(/\D/g, '')) ? ASHA : RIYA;
        return json(200, session(who.subject));
      }
      if (path === 'logout') return route.fulfill({ status: 204, body: '' });
      if (path === 'token') {
        const body = (req.postDataJSON() ?? {}) as { refresh_token?: string };
        const sub = (body.refresh_token ?? '').replace(/^refresh-/, '');
        return json(200, session(sub === RIYA.subject ? RIYA.subject : ASHA.subject));
      }
      return json(404, { message: `no such auth route: ${path}` });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const name = url.pathname.slice('/rest/v1/'.length);
      if (name.startsWith('rpc/')) return json(200, null);
      if (req.method() === 'GET') return json(200, rowsWhere(name, url.searchParams));
      if (req.method() === 'DELETE') {
        for (const [key, row] of [...table(name)]) {
          if (rowsWhere(name, url.searchParams).includes(row)) table(name).delete(key);
        }
        return route.fulfill({ status: 204, body: '' });
      }
      if (req.method() === 'POST') {
        const conflict = (url.searchParams.get('on_conflict') ?? 'subject_id').split(',');
        const body = req.postDataJSON() as Record<string, unknown> | Record<string, unknown>[];
        for (const row of Array.isArray(body) ? body : [body]) {
          const key = conflict.map((c) => String(row[c])).join('|');
          table(name).set(key, { ...(table(name).get(key) ?? {}), ...row });
        }
        return route.fulfill({ status: 201, body: '' });
      }
    }
    return json(404, { message: `unhandled ${req.method()} ${url.pathname}` });
  });
}

// --- the gateway: the record, answered here by the gateway's own write rule ----------------------

interface Mind {
  latenciesMs: number[];
  slips: unknown[];
  dwellSec: Record<string, number>;
  sessionDays: string[];
  interests: string[];
  facts: string[];
  days: Record<string, Record<string, number | boolean>>;
  helpedAt: null;
}
interface Row {
  mind: Mind;
  dead: Set<string>;
  recent: string[];
  updated_at: string;
  erased_at: null;
}
const blank = (): Mind => ({
  latenciesMs: [],
  slips: [],
  dwellSec: {},
  sessionDays: [],
  interests: [],
  facts: [],
  days: {},
  helpedAt: null,
});
const record = new Map<string, Row>();
const offered = new Map<string, { id: string; body: string; created_at: string }[]>();
const lower = (s: string) => s.toLowerCase();
type GwCall = {
  method: string;
  path: string;
  sub: string | null;
  body: Record<string, unknown> | null;
  at: number;
  rowsOnScreen?: string[];
};
const gwCalls: GwCall[] = [];
const gw = { down: false };

function stored(row: Row | undefined): boolean {
  return Boolean(
    row &&
      (row.mind.facts.length || row.mind.interests.length || Object.keys(row.mind.days).length),
  );
}
function view(sub: string, extra: Record<string, unknown> = {}) {
  const row = record.get(sub);
  return {
    mind: row ? row.mind : blank(),
    stored: stored(row),
    updated_at: row?.updated_at ?? null,
    erased_at: row?.erased_at ?? null,
    ...extra,
  };
}
/** mind.py's write rule, small: seed once, confirm after, remember adds, forget tombstones, bump adds. */
function applyWrite(sub: string, body: Record<string, unknown>) {
  const id = typeof body.write_id === 'string' ? body.write_id : null;
  let row = record.get(sub);
  if (row && id && row.recent.includes(id)) {
    return view(sub, { applied: false, ignored: 'duplicate', dropped: [] });
  }
  const snap = (body.mind ?? {}) as Partial<Mind>;
  if (!row) {
    row = {
      mind: { ...blank(), ...structuredClone(snap) } as Mind,
      dead: new Set(),
      recent: [],
      updated_at: '',
      erased_at: null,
    };
    record.set(sub, row);
  } else {
    row.mind.sessionDays = [...new Set([...row.mind.sessionDays, ...(snap.sessionDays ?? [])])];
  }
  const rem = (body.remember ?? {}) as { facts?: string[]; interests?: string[] };
  for (const f of rem.facts ?? []) {
    row.dead.delete(lower(f));
    if (!row.mind.facts.some((x) => lower(x) === lower(f)))
      row.mind.facts = [...row.mind.facts, f].slice(-12);
  }
  for (const i of rem.interests ?? []) {
    row.dead.delete(lower(i));
    if (!row.mind.interests.some((x) => lower(x) === lower(i)) && row.mind.interests.length < 8)
      row.mind.interests.push(i);
  }
  const bump = (body.bump ?? {}) as {
    days?: Record<string, Record<string, number | boolean>>;
    dwell?: Record<string, number>;
  };
  for (const [day, led] of Object.entries(bump.days ?? {})) {
    const mine = row.mind.days[day] ?? {
      answered: 0,
      wrong: 0,
      asked: 0,
      helped: 0,
      kept: 0,
      entered: 0,
      seconds: 0,
      evening: false,
    };
    for (const [k, v] of Object.entries(led)) {
      if (typeof v === 'number') mine[k] = Number(mine[k] ?? 0) + v;
      else if (k === 'evening' && v === true) mine.evening = true;
    }
    row.mind.days[day] = mine;
  }
  for (const [s, n] of Object.entries(bump.dwell ?? {}))
    row.mind.dwellSec[s] = (row.mind.dwellSec[s] ?? 0) + n;
  const gone = (body.forget ?? {}) as { facts?: string[]; interests?: string[] };
  for (const f of [...(gone.facts ?? []), ...(gone.interests ?? [])]) row.dead.add(lower(f));
  row.mind.facts = row.mind.facts.filter((f) => !row?.dead.has(lower(f)));
  row.mind.interests = row.mind.interests.filter((i) => !row?.dead.has(lower(i)));
  if (id) row.recent = [...row.recent, id].slice(-16);
  row.updated_at = new Date().toISOString();
  return view(sub, { applied: true, ignored: null, dropped: [] });
}

async function installGateway(page: Page): Promise<void> {
  await page.route(`${GW}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.slice('/gw'.length);
    const method = req.method();
    const who = subjectOf(req);
    const body =
      method === 'GET' || method === 'DELETE'
        ? null
        : (req.postDataJSON() as Record<string, unknown> | null);
    const call: GwCall = { method, path, sub: who?.sub ?? null, body, at: Date.now() };
    gwCalls.push(call);
    const json = (status: number, v: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (path.startsWith('/v1/me/mind') || path.startsWith('/v1/me/parent-offered')) {
      // What the memory page was showing at the moment this request ARRIVED: the order proof.
      // The page is not blocked on its own fetch, so it can be asked.
      call.rowsOnScreen = await Promise.race([
        page
          .locator('[data-testid=mind-memory] .wm-text')
          .allTextContents()
          .catch(() => []),
        new Promise<string[]>((r) => setTimeout(() => r([]), 1_500)),
      ]);
      if (gw.down) return route.abort('connectionfailed');
    }
    if (!who || who.anonymous) {
      if (path === '/v1/me/mind' && method === 'GET') return json(200, view(''));
      return json(403, { detail: { code: 'sign_in_required', message: 'Sign in first.' } });
    }
    if (path === '/v1/me/mind' && method === 'GET') return json(200, view(who.sub));
    if (path === '/v1/me/mind' && method === 'PUT' && body)
      return json(200, applyWrite(who.sub, body));
    if (path === '/v1/me/mind/forget' && method === 'POST' && body) {
      const needle = lower(String(body.contains));
      const row = record.get(who.sub);
      const facts = row ? row.mind.facts.filter((f) => lower(f).includes(needle)) : [];
      const interests = row ? row.mind.interests.filter((i) => lower(i).includes(needle)) : [];
      applyWrite(who.sub, { forget: { facts, interests } });
      return json(200, view(who.sub, { forgot: { facts, interests } }));
    }
    if (path === '/v1/me/parent-offered' && method === 'GET')
      return json(200, { facts: offered.get(who.sub) ?? [] });
    if (path.startsWith('/v1/me/parent-offered/') && method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/v1/me/parent-offered/'.length));
      const mine = offered.get(who.sub) ?? [];
      const had = mine.some((o) => o.id === id);
      offered.set(
        who.sub,
        mine.filter((o) => o.id !== id),
      );
      return json(200, { removed: had, final: true });
    }
    // Everything else the app asks the brain for on the way is not this proof's business.
    return json(404, { detail: { code: 'not_found', message: `unhandled ${method} ${path}` } });
  });
}

// --- the phone ------------------------------------------------------------------------------------

async function throughTheDoor(page: Page, who: typeof ASHA): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#au-who').fill(who.phone);
  const agree = page.locator('#au-agree');
  if (await agree.isVisible().catch(() => false)) await agree.check();
  await page.locator('form button[type=submit]').first().click();
  await expect(page.locator('#au-code')).toBeVisible();
  await page.locator('#au-code').fill('123456');
  await page.locator('form button[type=submit]').first().click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 15_000 });
}

async function finishSetup(page: Page, name: string): Promise<void> {
  await page.evaluate(async (n) => {
    const { scoped } = await import('/src/store/scope.ts');
    const { loadProfile, saveProfile } = await import('/src/screens/you/profile.ts');
    saveProfile({ ...loadProfile(), name: n, grade: 'Class 8', boardId: 'cbse' });
    scoped.setItem('wobo-onboarded-v1', '1');
  }, name);
}

async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('wobo-open-palette')));
  const ask = page.getByPlaceholder('Where to, or what…');
  await expect(ask).toBeVisible();
  await ask.fill('sign out');
  await page
    .getByRole('option', { name: /sign out/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
}

const memory = (page: Page) => page.locator('[data-testid=mind-memory]');
const puts = () => gwCalls.filter((c) => c.method === 'PUT' && c.path === '/v1/me/mind');

const diagnostics: string[] = [];
test.beforeEach(async ({ page }) => {
  diagnostics.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      diagnostics.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => diagnostics.push(`pageerror: ${e.message}`));
  await installAccount(page);
  await installGateway(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const html = await page
    .locator('main, body')
    .first()
    .innerText()
    .catch(() => '(no body)');
  console.log(
    `\n--- where the page was: ${page.url()}\n${html.slice(0, 1200)}\n--- diagnostics:\n${diagnostics.join('\n')}\n--- gateway calls:\n${gwCalls.map((c) => `${c.method} ${c.path} as ${c.sub ?? 'anon'}`).join('\n')}`,
  );
});

test('the memory page is the account: sign in and it is there, sign out and it is gone', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // The record exists before this phone has ever seen her: a laptop wrote it last week.
  record.set(ASHA.subject, {
    mind: { ...blank(), facts: ['exam on friday'], interests: ['cricket'] },
    dead: new Set(),
    recent: [],
    updated_at: '2026-09-01T09:00:00+00:00',
    erased_at: null,
  });
  offered.set(ASHA.subject, [
    { id: 'o1', body: 'she has dyslexia', created_at: '2026-09-02T00:00:00Z' },
  ]);

  // --- Asha, on a fresh phone -----------------------------------------------------------------------
  await throughTheDoor(page, ASHA);
  await finishSetup(page, ASHA.name);
  await page.goto('/you');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/you/);

  const list = memory(page);
  await expect(list).toContainText('exam on friday');
  await expect(list).toContainText('cricket');
  await expect(list).toContainText('she has dyslexia');
  await expect(list.locator('[data-source=parent]')).toContainText('from your parent');
  await expect(list).toContainText('This is what your account holds.');
  await page.screenshot({ path: join(SHOTS, '01-asha-fresh-phone.png'), fullPage: true });
  // The read was made as her, by her token, before the device held anything.
  const firstRead = gwCalls.find(
    (c) => c.method === 'GET' && c.path === '/v1/me/mind' && c.sub === ASHA.subject,
  );
  expect(firstRead, 'the record was read with her bearer token').toBeTruthy();

  // --- a remove reaches the server before the row leaves --------------------------------------------
  await list.getByRole('button', { name: 'Remove: exam on friday' }).click();
  await expect(list).not.toContainText('exam on friday');
  const forgetPut = puts().find((c) =>
    (c.body?.forget as { facts?: string[] } | undefined)?.facts?.includes('exam on friday'),
  );
  expect(forgetPut, 'a PUT with the forget verb').toBeTruthy();
  expect(forgetPut?.sub).toBe(ASHA.subject);
  const onScreen = (rows: string[] | undefined, text: string) =>
    (rows ?? []).some((r) => r.includes(text));
  expect(
    onScreen(forgetPut?.rowsOnScreen, 'exam on friday'),
    'the row was still on screen when the server was told',
  ).toBe(true);
  expect(record.get(ASHA.subject)?.mind.facts).toEqual([]);
  expect(record.get(ASHA.subject)?.dead.has('exam on friday')).toBe(true);

  await list.getByRole('button', { name: 'Remove, for good: she has dyslexia' }).click();
  await expect(list).not.toContainText('she has dyslexia');
  const del = gwCalls.find((c) => c.method === 'DELETE' && c.path === '/v1/me/parent-offered/o1');
  expect(
    onScreen(del?.rowsOnScreen, 'she has dyslexia'),
    'the parent line was still on screen when the server was told',
  ).toBe(true);
  expect(offered.get(ASHA.subject)).toEqual([]);

  // --- the gateway goes away: instant on the device, honest on the page, lands later once ------------
  gw.down = true;
  await page.evaluate(async () => {
    const { rememberFact } = await import('/src/store/mind.ts');
    rememberFact('wants to be a pilot');
  });
  await expect(list).toContainText('wants to be a pilot');
  await expect(list.getByRole('status')).toContainText('waiting to save');
  await page.screenshot({ path: join(SHOTS, '02-waiting-to-save.png'), fullPage: true });
  const attempted = puts().filter((c) =>
    (c.body?.remember as { facts?: string[] } | undefined)?.facts?.includes('wants to be a pilot'),
  );
  expect(attempted.length, 'the write was tried while the gateway was down').toBeGreaterThan(0);
  const writeId = attempted[0]?.body?.write_id;
  expect(typeof writeId).toBe('string');
  expect(record.get(ASHA.subject)?.mind.facts).toEqual([]);

  gw.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => record.get(ASHA.subject)?.mind.facts ?? [], { timeout: 20_000 })
    .toEqual(['wants to be a pilot']);
  await expect(list.getByRole('status')).toHaveCount(0);
  const landed = puts().filter((c) =>
    (c.body?.remember as { facts?: string[] } | undefined)?.facts?.includes('wants to be a pilot'),
  );
  expect(
    new Set(landed.map((c) => c.body?.write_id)).size,
    'every attempt carried the same write id',
  ).toBe(1);
  // (d) the turn's context packet, as the bus assembles it on this device
  const packet = await page.evaluate(async () => {
    const { lifetimeSnapshot } = await import('/src/store/mind.ts');
    return lifetimeSnapshot().facts;
  });
  expect(packet).toContain('wants to be a pilot');
  expect(packet).not.toContain('exam on friday');
  await page.screenshot({ path: join(SHOTS, '03-saved.png'), fullPage: true });

  // --- she signs out: nothing of hers stays on the phone --------------------------------------------
  await signOut(page);
  const afterSignOut = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(afterSignOut.filter((k) => k.includes(ASHA.subject))).toEqual([]);
  expect(afterSignOut.filter((k) => k.startsWith('wobo-mind'))).toEqual([]);
  await page.screenshot({ path: join(SHOTS, '04-signed-out.png') });
  info.attach('keys-after-sign-out', {
    body: afterSignOut.join('\n') || '(none)',
    contentType: 'text/plain',
  });

  // --- Riya, on the same phone ----------------------------------------------------------------------
  await throughTheDoor(page, RIYA);
  await finishSetup(page, RIYA.name);
  await page.goto('/you');
  await page.waitForLoadState('networkidle');
  await expect(memory(page)).toContainText('Nothing yet.');
  await expect(memory(page)).not.toContainText('wants to be a pilot');
  await expect(memory(page)).not.toContainText('cricket');
  expect(
    gwCalls.some((c) => c.method === 'GET' && c.path === '/v1/me/mind' && c.sub === RIYA.subject),
  ).toBe(true);
  await page.screenshot({ path: join(SHOTS, '05-riya-you.png'), fullPage: true });
  await signOut(page);

  // --- Asha, back: the account gives her memory back ------------------------------------------------
  await throughTheDoor(page, ASHA);
  await expect(page.getByRole('heading', { level: 1, name: /Hey Asha/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/you');
  await page.waitForLoadState('networkidle');
  await expect(memory(page)).toContainText('wants to be a pilot');
  await expect(memory(page)).toContainText('cricket');
  await expect(memory(page)).not.toContainText('exam on friday');
  await expect(memory(page)).not.toContainText('she has dyslexia');
  await page.screenshot({ path: join(SHOTS, '06-asha-back.png'), fullPage: true });

  info.attach('gateway-calls', {
    body: gwCalls
      .map(
        (c) =>
          `${c.method} ${c.path} as ${c.sub ?? 'anon'} ${c.body ? JSON.stringify(c.body).slice(0, 160) : ''}`,
      )
      .join('\n'),
    contentType: 'text/plain',
  });
  info.attach('page-errors', { body: errors.join('\n') || '(none)', contentType: 'text/plain' });
});
