/**
 * ONE LEARNER, ONE WOBO, IN A REAL BROWSER AT 390 WIDE (docs/ONE-LEARNER-ONE-WOBO.md).
 *
 * Two children share one phone. Asha signs in through the door, earns XP and a course star, tells
 * Wobo something to remember, links a parent. Asha signs out. Riya signs in on the same phone and
 * sees none of it: no star, no memory, no parent, a referral code of her own, and setup from the
 * start. Riya signs out. Asha signs back in and the account gives her back what it holds.
 *
 * The app runs against live auth and live persistence (`playwright.config.ts`, project
 * `isolation`), and this file answers every GoTrue and PostgREST request itself, in the page, from
 * one in-memory "database" that lives for the whole spec. Nothing leaves the machine, and the
 * database is the record exactly the way `docs/MEMORY-LAW.md` says it is.
 *
 * WHAT COMES BACK, AND WHAT DOES NOT. The account holds the profile (`profiles_cache`), the learner
 * state (`learner_state`: XP, streak, completed topics) and the threads. It does not yet hold the
 * course stars, the flashcard schedule, the activity ledger, the parent phone link or the mind
 * (the mind's sync is another wave's, and it rides the gateway, which this project has none of).
 * So after Asha's second sign-in the spec asserts what the account returns, and asserts, in
 * words, what it does not: those stores are the MEMORY-LAW backlog, not something this proof can
 * pretend about.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../shots/isolation');
mkdirSync(SHOTS, { recursive: true });

/** The same closed port `playwright.config.ts` names for the database. */
const DB_PORT = Number(process.env.WOBO_E2E_PORT ?? 5199) + 2;
const DB_ORIGIN = `http://127.0.0.1:${DB_PORT}`;

// Real subjects are auth.uid() values, and the event contract holds the app to that: an actor
// that is not a UUID is refused at record time. The two below are fixed so a key can be read.
const ASHA = {
  // E.164, because the door refuses a number with no country code in front of it: it cannot be
  // dialled, and a field that accepts what the app cannot send fails on submit
  // (`screens/auth/field.ts` hasCountryCode).
  phone: '+91 98765 43210',
  subject: 'a5aa0001-0000-4000-8000-00000000a5aa',
  name: 'Asha',
};
const RIYA = {
  phone: '+91 91234 56789',
  subject: '41a40002-0000-4000-8000-0000000041a4',
  name: 'Riya',
};

/*
 * THE DOOR LEAVES THE PAGE. Under live auth a code typed at the door ends in a full navigation to
 * /onboarding (`screens/auth/run.ts` landingAfterDoor), so the SDK is rebuilt on the session that
 * just landed; `throughTheDoor` below waits for that document, and everything it then reads goes
 * through providers keyed to the learner. Before that the door-time SDK, keyed to nobody, wrote
 * the plain `wobo-progress-v1` and the account never heard of the XP. This spec caught it.
 */
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

/** Rows by table, keyed by the upsert's conflict columns. Lives for the whole spec: the record. */
const db = new Map<string, Map<string, Record<string, unknown>>>();
let anonCount = 0;
/** Every request the account answered, in order: the diagnosis when an assertion below fails. */
const accountLog: string[] = [];

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
    accountLog.push(
      `${req.method()} ${url.pathname}${url.search} ${(req.postData() ?? '').slice(0, 160)}`,
    );
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
        const auth = req.headers().authorization ?? '';
        return json(200, session(auth.includes(ASHA.subject) ? ASHA.subject : RIYA.subject));
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

// --- the phone ------------------------------------------------------------------------------------

/** Sign in through the real door, with a code that the account above accepts. */
async function throughTheDoor(page: Page, who: typeof ASHA): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#au-who').fill(who.phone);
  const agree = page.locator('#au-agree');
  if (await agree.isVisible().catch(() => false)) await agree.check();
  await page.locator('form button[type=submit]').first().click();
  await expect(page.locator('#au-code')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `01-door-${who.name.toLowerCase()}.png`) });
  await page.locator('#au-code').fill('123456');
  await page.locator('form button[type=submit]').first().click();
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
}

/** Everything this device holds, by store, for the report and the assertions. */
async function deviceKeys(page: Page): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));
}

/** The account's own view of who is signed in, through the app's SDK. */
async function signedInAs(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const { appSdk } = await import('/src/store/app-sdk.ts');
    return appSdk().account?.subjectId() ?? null;
  });
}

async function signOut(page: Page): Promise<void> {
  // The palette is the only place a sign-out lives. Opened the way Cmd+K opens it, then asked for.
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

/** What the page said while it ran: the diagnosis when a step below stops short. */
const pageLog: string[] = [];

test.beforeEach(async ({ page }) => {
  page.on('console', (m) => pageLog.push(`${m.type()} ${m.text()}`));
  page.on('pageerror', (e) => pageLog.push(`pageerror ${e.message}`));
  await installAccount(page);
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  info.attach('where-it-stopped', {
    body: `${page.url()}\n\n${pageLog.join('\n')}`,
    contentType: 'text/plain',
  });
  info.attach('account-log', { body: accountLog.join('\n'), contentType: 'text/plain' });
});

test('two learners on one phone never see each other, and the account brings Asha back', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // --- Asha ---------------------------------------------------------------------------------------
  await throughTheDoor(page, ASHA);
  expect(await signedInAs(page)).toBe(ASHA.subject);

  // Setup, written exactly the way the onboarding screens write it: through the learner's door.
  await page.evaluate(async (name) => {
    const { scoped } = await import('/src/store/scope.ts');
    const { loadProfile, saveProfile } = await import('/src/screens/you/profile.ts');
    saveProfile({ ...loadProfile(), name, grade: 'Class 8', boardId: 'cbse' });
    scoped.setItem('wobo-onboarded-v1', '1');
  }, ASHA.name);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Asha's afternoon: XP, a course star, a fact for Wobo to remember, a parent on WhatsApp. Each
  // write goes through the store the screen itself uses, so it lands where the screen would put it.
  await page.evaluate(async () => {
    const { appSdk } = await import('/src/store/app-sdk.ts');
    const { writeCourseStars } = await import('/src/screens/course/shared.tsx');
    const { rememberFact } = await import('/src/store/mind.ts');
    const { scoped } = await import('/src/store/scope.ts');
    const { PARENT_KEY } = await import('/src/screens/you/profile.ts');
    const { referralCode } = await import('/src/store/referral.ts');
    const sdk = appSdk();
    sdk.state.save({ ...sdk.state.loadCache(), xp: 120, streakDays: 3 });
    writeCourseStars('demo-topic', 3);
    rememberFact('wants to be a pilot');
    scoped.setItem(PARENT_KEY, JSON.stringify({ phone: '99887 76655', linkedAt: '2026-09-05' }));
    referralCode();
  });
  await page.waitForTimeout(2_500); // the state push is debounced 1.5s: let the account take it
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(SHOTS, '02-asha-home.png'), fullPage: false });

  const ashaRead = await page.evaluate(async () => {
    const { readCourseStars } = await import('/src/screens/course/shared.tsx');
    const { loadMind } = await import('/src/store/mind.ts');
    const { referralCode } = await import('/src/store/referral.ts');
    const { scoped } = await import('/src/store/scope.ts');
    const { PARENT_KEY, loadProfile } = await import('/src/screens/you/profile.ts');
    const { appSdk } = await import('/src/store/app-sdk.ts');
    return {
      xp: appSdk().state.loadCache().xp,
      star: readCourseStars('demo-topic'),
      facts: loadMind().facts,
      parent: scoped.getItem(PARENT_KEY),
      referral: referralCode(),
      name: loadProfile().name,
    };
  });
  expect(ashaRead.xp).toBe(120);
  expect(ashaRead.star).toBe(3);
  expect(ashaRead.facts).toContain('wants to be a pilot');
  expect(ashaRead.parent).toContain('99887 76655');
  expect(ashaRead.name).toBe(ASHA.name);
  const ashaReferral = ashaRead.referral;

  // Everything per-learner on the device carries her id; everything else is on the device list.
  const withAsha = await deviceKeys(page);
  const strays = await page.evaluate(
    async ({ keys, subject }) => {
      const { DEVICE_KEYS } = await import('/src/store/scope.ts');
      const device = new Set(DEVICE_KEYS.map((d: { key: string }) => d.key));
      return keys.filter((k) => !k.endsWith(`:${subject}`) && !device.has(k));
    },
    { keys: withAsha.local, subject: ASHA.subject },
  );
  expect(strays, 'keys on the device that are neither Asha’s nor the device’s').toEqual([]);
  info.attach('asha-device-keys', { body: withAsha.local.join('\n'), contentType: 'text/plain' });

  await page.goto('/you');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(SHOTS, '03-asha-you.png'), fullPage: true });

  // --- she signs out -------------------------------------------------------------------------------
  await signOut(page);
  await page.screenshot({ path: join(SHOTS, '04-signed-out.png') });
  const afterSignOut = await deviceKeys(page);
  expect(afterSignOut.local.filter((k) => k.includes(ASHA.subject))).toEqual([]);
  expect(afterSignOut.session.filter((k) => k.includes(ASHA.subject))).toEqual([]);
  // Nothing under a plain name either: the next person would read that as their own.
  const plainLeaks = await page.evaluate(async () => {
    const { SCOPED_KEYS } = await import('/src/store/scope.ts');
    return (SCOPED_KEYS as readonly string[]).filter((k) => localStorage.getItem(k) !== null);
  });
  expect(plainLeaks).toEqual([]);
  expect(await signedInAs(page)).toBeNull();
  info.attach('after-sign-out-keys', {
    body: afterSignOut.local.join('\n'),
    contentType: 'text/plain',
  });

  // --- Riya ---------------------------------------------------------------------------------------
  await throughTheDoor(page, RIYA);
  expect(await signedInAs(page)).toBe(RIYA.subject);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(SHOTS, '05-riya-first-screen.png') });

  const riyaRead = await page.evaluate(async () => {
    const { readCourseStars } = await import('/src/screens/course/shared.tsx');
    const { loadMind } = await import('/src/store/mind.ts');
    const { referralCode } = await import('/src/store/referral.ts');
    const { scoped } = await import('/src/store/scope.ts');
    const { PARENT_KEY, loadProfile } = await import('/src/screens/you/profile.ts');
    const { appSdk } = await import('/src/store/app-sdk.ts');
    const { XP_AWARDS } = await import('/src/store/progress.tsx');
    const cache = appSdk().state.loadCache();
    return {
      xp: cache.xp,
      awarded: [...(cache.awardedOnce ?? [])],
      dayAward: XP_AWARDS.streak,
      star: readCourseStars('demo-topic'),
      facts: loadMind().facts,
      parent: scoped.getItem(PARENT_KEY),
      referral: referralCode(),
      name: loadProfile().name,
      onboarded: scoped.getItem('wobo-onboarded-v1'),
      firstTurn: scoped.getItem('wobo-first-turn-v1'),
    };
  });
  // Riya starts from nothing but her OWN first day: the daily streak award (XP_AWARDS.streak) is
  // written on her first active day, on her own row, with its key in her own awarded list. The
  // spec predates that award and expected a flat 0; none of Asha's 120 may be here.
  expect(riyaRead.awarded.every((k: string) => k.startsWith('streak:'))).toBe(true);
  expect(riyaRead.xp).toBe(riyaRead.awarded.length * riyaRead.dayAward);
  expect(riyaRead.xp).toBeLessThan(ashaRead.xp);
  expect(riyaRead.star).toBeUndefined();
  expect(riyaRead.facts).toEqual([]);
  expect(riyaRead.parent).toBeNull();
  expect(riyaRead.referral).not.toBe(ashaReferral);
  expect(riyaRead.name).not.toBe(ASHA.name);
  expect(riyaRead.onboarded).toBeNull(); // setup from the start: the door, not Asha's home
  expect(riyaRead.firstTurn).toBeNull(); // Wobo has not met Riya: Riya gets a first introduction
  const riyaKeys = await deviceKeys(page);
  expect(riyaKeys.local.filter((k) => k.includes(ASHA.subject))).toEqual([]);
  // The same strays check for her: the door-time SDK used to write the PLAIN progress, thread and
  // mastery keys between the door and the next reload (the door now leaves the page instead).
  const riyaStrays = await page.evaluate(
    async ({ keys, subject }) => {
      const { DEVICE_KEYS } = await import('/src/store/scope.ts');
      const device = new Set(DEVICE_KEYS.map((d: { key: string }) => d.key));
      return keys.filter((k) => !k.endsWith(`:${subject}`) && !device.has(k));
    },
    { keys: riyaKeys.local, subject: RIYA.subject },
  );
  expect(riyaStrays, 'keys on the device that are neither Riya’s nor the device’s').toEqual([]);
  info.attach('riya-device-keys', { body: riyaKeys.local.join('\n'), contentType: 'text/plain' });

  await page.goto('/you');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(SHOTS, '06-riya-you.png'), fullPage: true });
  await signOut(page);

  // --- Asha, back ---------------------------------------------------------------------------------
  // The device holds nothing of hers now, so the door sends her through setup, where the account
  // is read back; an account that has finished setup lands home without a question asked.
  await throughTheDoor(page, ASHA);
  expect(await signedInAs(page)).toBe(ASHA.subject);
  await expect(page.getByRole('heading', { level: 1, name: /Hey Asha/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(2_000); // the boot hydrate: the account's learner_state and profile
  await page.screenshot({ path: join(SHOTS, '07-asha-back.png') });
  expect(
    await page.evaluate(async () => {
      const { scoped } = await import('/src/store/scope.ts');
      return scoped.getItem('wobo-onboarded-v1');
    }),
  ).toBe('1');

  const ashaBack = await page.evaluate(async () => {
    const { appSdk } = await import('/src/store/app-sdk.ts');
    const { readCourseStars } = await import('/src/screens/course/shared.tsx');
    const { loadMind } = await import('/src/store/mind.ts');
    const { scoped } = await import('/src/store/scope.ts');
    const { PARENT_KEY } = await import('/src/screens/you/profile.ts');
    const sdk = appSdk();
    const state = await sdk.state.hydrate();
    const profile = await sdk.account?.fetchProfile();
    return {
      xp: state.xp,
      streak: state.streakDays,
      profile,
      star: readCourseStars('demo-topic'),
      facts: loadMind().facts,
      parent: scoped.getItem(PARENT_KEY),
    };
  });
  info.attach('account-log', { body: accountLog.join('\n'), contentType: 'text/plain' });
  info.attach('account-tables', {
    body: [...db]
      .map(
        ([t, rows]) =>
          `${t}: ${[...rows].map(([k, r]) => `${k}=${JSON.stringify(r).slice(0, 200)}`).join(' | ')}`,
      )
      .join('\n'),
    contentType: 'text/plain',
  });
  // What the account holds comes back.
  expect(ashaBack.xp).toBe(120);
  expect(ashaBack.streak).toBe(3);
  expect(ashaBack.profile?.display_name).toBe(ASHA.name);
  expect(ashaBack.profile?.archetype_slot).toBe('onboarded');
  // What the account does not hold yet does not, and this spec says so rather than hiding it:
  // course stars, the mind and the parent phone link have no server record (MEMORY-LAW backlog).
  expect(ashaBack.star).toBeUndefined();
  expect(ashaBack.facts).toEqual([]);
  expect(ashaBack.parent).toBeNull();
  const backKeys = await deviceKeys(page);
  expect(backKeys.local.filter((k) => k.includes(RIYA.subject))).toEqual([]);

  info.attach('page-errors', { body: errors.join('\n') || '(none)', contentType: 'text/plain' });
});
