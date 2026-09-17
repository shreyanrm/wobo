/**
 * THE PARENT'S DOOR AND THE SWITCH, IN A REAL BROWSER, at 390 and 1440, light and dark.
 *
 * A parent signs up through their own door (Google, answered here), is made a parent account by
 * the gateway (answered here, to parent_api.py's contract), has a child link, then a second, and
 * switches between them; a link ends and the switch goes; the parent signs out and the phone keeps
 * nothing of theirs. Then a STUDENT signs in on the same phone and is shown none of it: a page
 * watcher records every heading the document ever carried and none of the parent's words appear.
 *
 * Every request to the auth service and the gateway is answered by this file. No key is live, no
 * model is called, and the browser is muted (tests/parent.config.ts).
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../shots/parent');
mkdirSync(SHOTS, { recursive: true });

const PORT = Number(process.env.WOBO_PARENT_PORT ?? 5331);
const AUTH = `http://127.0.0.1:${PORT + 1}`;
const GW = `http://localhost:${PORT}/gw`;

const PARENT = {
  subject: 'b0b0b0b0-0000-4000-8000-00000000b0b0',
  email: 'meera.parent@example.test',
  name: 'Meera Rao',
};
const STUDENT = {
  subject: '5d5d5d5d-0000-4000-8000-000000005d5d',
  phone: '+91 91234 56789',
};
const ASHA = { learner_id: 'kid-asha', name: 'Asha' };
const KABIR = { learner_id: 'kid-kabir', name: 'Kabir' };

/** Words only a parent's screen says. A student must never have any of them on their page. */
const PARENT_WORDS = [
  'The parent’s door',
  'Your children',
  'No child is linked',
  'Whose week are you looking at',
  'Ask Wobo about',
];

const b64url = (s: string) => Buffer.from(s).toString('base64url');
function jwt(claims: Record<string, unknown>): string {
  const payload = { role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 36_000, ...claims };
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.sig`;
}
const parentToken = () =>
  jwt({
    sub: PARENT.subject,
    email: PARENT.email,
    is_anonymous: false,
    user_metadata: { full_name: PARENT.name, email_verified: true },
  });
const studentToken = () => jwt({ sub: STUDENT.subject, phone: STUDENT.phone, is_anonymous: false });
function subjectOf(auth: string | undefined): string | null {
  const token = (auth ?? '').replace(/^Bearer\s+/i, '');
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return (JSON.parse(Buffer.from(part, 'base64url').toString()) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/** The parent plane, as parent_api.py keeps it, for one run. */
interface Plane {
  parents: Set<string>;
  /** Children whose invite to the parent's address has been accepted. */
  accepted: { learner_id: string; name: string }[];
  /** Children this parent account has claimed. Consent is re-read from `accepted` every call. */
  claimed: Set<string>;
  selected: string | null;
  scopes: string[];
  log: string[];
}

function newPlane(): Plane {
  return {
    parents: new Set(),
    accepted: [],
    claimed: new Set(),
    selected: null,
    scopes: [],
    log: [],
  };
}

function live(plane: Plane) {
  return plane.accepted
    .filter((c) => plane.claimed.has(c.learner_id))
    .map((c) => ({ ...c, relationship: 'linked_parent', linked_at: '2026-09-16T08:00:00+00:00' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function install(page: Page, plane: Plane): Promise<void> {
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  // --- the auth service --------------------------------------------------------------------------
  await page.route(`${AUTH}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/auth/v1/', '');
    plane.log.push(`auth ${req.method()} ${path}`);
    if (path === 'authorize') {
      // Google, answered: straight back to where the door asked, with the session in the fragment.
      const back = url.searchParams.get('redirect_to') ?? '/';
      const hash = `access_token=${parentToken()}&refresh_token=r-parent&expires_in=36000&token_type=bearer`;
      return route.fulfill({ status: 302, headers: { location: `${back}#${hash}` } });
    }
    if (path === 'otp') return json(route, 200, {});
    if (path === 'verify') {
      return json(route, 200, {
        access_token: studentToken(),
        refresh_token: 'r-student',
        expires_in: 36_000,
        token_type: 'bearer',
        user: { id: STUDENT.subject },
      });
    }
    if (path === 'logout') return route.fulfill({ status: 204, body: '' });
    if (path === 'signup') {
      return json(route, 200, {
        access_token: jwt({ sub: 'anon-1', is_anonymous: true }),
        refresh_token: 'r-anon',
        expires_in: 36_000,
        user: { id: 'anon-1' },
      });
    }
    if (path.startsWith('token')) {
      const subject = subjectOf(req.headers().authorization);
      return json(route, 200, {
        access_token: subject === STUDENT.subject ? studentToken() : parentToken(),
        refresh_token: 'r',
        expires_in: 36_000,
      });
    }
    return json(route, 404, { message: `no auth route ${path}` });
  });
  // The learner runtime's own database calls, for the student half: an empty record.
  await page.route(`${AUTH}/rest/v1/**`, (route) =>
    route.request().method() === 'GET'
      ? json(route, 200, [])
      : route.fulfill({ status: 201, body: '' }),
  );

  // --- the gateway ------------------------------------------------------------------------------
  await page.route(`${GW}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/gw', '');
    const who = subjectOf(req.headers().authorization);
    plane.log.push(`gw ${req.method()} ${path} as ${who ?? 'nobody'}`);
    if (path === '/v1/doors') return json(route, 200, { doors_open: true });
    if (!path.startsWith('/v1/parent/')) return json(route, 200, {});
    if (!who) {
      return json(route, 401, { detail: { code: 'sign_in_required', message: 'Sign in.' } });
    }
    if (path === '/v1/parent/sign-up' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(body).filter((k) => k !== 'display_name')).toEqual([]);
      if (who === STUDENT.subject) {
        return json(route, 409, {
          detail: { code: 'already_a_learner', message: 'This account is already learning.' },
        });
      }
      plane.parents.add(who);
      for (const c of plane.accepted) plane.claimed.add(c.learner_id);
      return json(route, 200, {
        account: { display_name: body.display_name ?? null, kind: 'parent' },
        children: live(plane),
      });
    }
    if (!plane.parents.has(who)) {
      return json(route, 403, {
        detail: {
          code: 'not_a_parent_account',
          message: 'This is not a parent account. Sign in with the parent account to see a child.',
        },
      });
    }
    if (path === '/v1/parent/me') {
      return json(route, 200, {
        kind: 'parent',
        display_name: 'Meera',
        children: live(plane).length,
        actions: ['ask', 'pay', 'refer', 'donate'],
      });
    }
    if (path === '/v1/parent/children') {
      const list = live(plane);
      if (plane.selected && !list.some((c) => c.learner_id === plane.selected))
        plane.selected = null;
      return json(route, 200, { children: list, selected: plane.selected });
    }
    if (path === '/v1/parent/switch' && req.method() === 'POST') {
      const { learner_id } = req.postDataJSON() as { learner_id: string };
      const child = live(plane).find((c) => c.learner_id === learner_id);
      if (!child) {
        return json(route, 404, {
          detail: {
            code: 'no_such_child',
            message: 'I do not have a child by that name on this account.',
          },
        });
      }
      plane.selected = learner_id;
      const scope = `scope-${plane.scopes.length + 1}`;
      plane.scopes.push(scope);
      return json(route, 200, { child, scope });
    }
    return json(route, 404, { detail: { code: 'not_here', message: 'Not here.' } });
  });
}

/** Every heading and status line the document ever carried, recorded as it happens. */
async function watchWords(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    const note = () => {
      const text = document.body?.innerText ?? '';
      for (const line of text.split('\n')) if (line.trim()) seen.add(line.trim());
      seen.add(`title:${document.title}`);
    };
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

async function seenWords(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
}

async function storage(page: Page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
    session: Object.keys(sessionStorage),
  }));
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(client);
}

const RUNS = [
  { label: '390-light', width: 390, height: 844, scheme: 'light' as const },
  { label: '390-dark', width: 390, height: 844, scheme: 'dark' as const },
  { label: '1440-light', width: 1440, height: 900, scheme: 'light' as const },
  { label: '1440-dark', width: 1440, height: 900, scheme: 'dark' as const },
];

for (const run of RUNS) {
  test.describe(`at ${run.label}`, () => {
    test.use({ viewport: { width: run.width, height: run.height }, colorScheme: run.scheme });

    test('a parent signs up, links, switches and signs out; a student on the same phone sees none of it', async ({
      page,
    }) => {
      const plane = newPlane();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await install(page, plane);
      const shot = async (name: string) => {
        // the one boot scene (main.tsx) finishes before a picture is taken of what it covered
        await page.locator('#wobo-boot').waitFor({ state: 'detached' });
        await page.screenshot({ path: join(SHOTS, `${run.label}-${name}.png`), fullPage: true });
      };

      // --- the door ---------------------------------------------------------------------------------
      await page.goto('/parent');
      await expect(
        page.getByRole('heading', { level: 1, name: 'The parent’s door.' }),
      ).toBeVisible();
      const google = page.getByRole('button', { name: 'Continue with Google' });
      await expect(google).toBeVisible();
      // one way in, and no phone field that would end in a refusal
      await expect(page.locator('input')).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot('01-door');

      // --- Google, and the account becomes a parent's --------------------------------------------------
      await google.click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'No child is linked to this account yet.' }),
      ).toBeVisible();
      expect(page.url()).toBe(`http://localhost:${PORT}/parent`); // the session left the address bar
      expect(plane.parents.has(PARENT.subject)).toBe(true);
      const signUps = plane.log.filter((l) => l.includes('POST /v1/parent/sign-up'));
      expect(signUps.length).toBeGreaterThanOrEqual(1);
      await expect(page.getByText('Hello, Meera.')).toBeVisible();
      await noHorizontalScroll(page);
      await shot('02-no-child');

      // --- Asha accepts the invite; one child, so no switch ------------------------------------------
      plane.accepted.push(ASHA);
      await page.getByRole('button', { name: 'Look again' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Asha' })).toBeVisible();
      await expect(page.locator('.pa-switch')).toHaveCount(0);
      expect(plane.selected).toBe(ASHA.learner_id); // chosen for them: nothing to choose
      const doors = page.locator('.pa-doors [data-action]');
      await expect(doors).toHaveCount(4);
      await expect(page.locator('[data-action="ask"]')).toContainText('Ask Wobo about Asha');
      await expect(page.locator('[data-action="pay"]')).toContainText('Pay for Asha’s plan');
      await expect(page.locator('[data-action="donate"]')).toHaveAttribute('href', '/donate');
      await expect(
        page.getByText('You see how Asha is doing. You never see their conversations with me.'),
      ).toBeVisible();
      await noHorizontalScroll(page);
      await shot('03-one-child');

      // --- Kabir accepts too; now there is a switch --------------------------------------------------
      plane.accepted.push(KABIR);
      await page.getByRole('button', { name: 'Look again' }).click();
      const group = page.getByRole('group', { name: 'Whose week are you looking at?' });
      await expect(group).toBeVisible();
      await expect(group.getByRole('button', { name: 'Asha' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const before = plane.scopes.length;
      await group.getByRole('button', { name: 'Kabir' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Kabir' })).toBeVisible();
      await expect(group.getByRole('button', { name: 'Kabir' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(plane.selected).toBe(KABIR.learner_id);
      expect(plane.scopes.length).toBe(before + 1); // a fresh scope for the new child
      await expect(page.locator('[data-action="ask"]')).toContainText('Ask Wobo about Kabir');
      await noHorizontalScroll(page);
      await shot('04-switched');

      // the selection is the server's: a reload lands on Kabir, and the phone holds no child at all
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Kabir' })).toBeVisible();
      const held = await storage(page);
      const values = JSON.stringify(held.local);
      expect(values).not.toContain('kid-');
      expect(values).not.toContain('Kabir');
      expect(values).not.toContain('Asha');
      expect(held.local[`wobo-account-kind-v1::${PARENT.subject}`]).toBe('parent');

      // --- Kabir ends the link: the switch goes, and Asha is chosen again ----------------------------
      plane.accepted = plane.accepted.filter((c) => c.learner_id !== KABIR.learner_id);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Asha' })).toBeVisible();
      await expect(page.locator('.pa-switch')).toHaveCount(0);
      expect(plane.selected).toBe(ASHA.learner_id);

      // a door leads to its own address inside the parent's host, under the same sign-in, and
      // back comes home (the screens behind the doors are other builders'; this proves the door)
      await page.locator('[data-action="ask"]').click();
      await expect(page).toHaveURL(/\/parent\/ask$/);
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/parent$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Asha' })).toBeVisible();

      // a bare / on this phone is the parent's home now (the address stays the one published)
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Asha' })).toBeVisible();
      // and a learner address typed on it is not the learner's app
      await page.goto('/you');
      await expect(page).toHaveURL(/\/parent$/);

      // --- sign out -------------------------------------------------------------------------------
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(`http://localhost:${PORT}/`);
      await page.waitForLoadState('networkidle');
      const after = await storage(page);
      const leftovers = Object.keys(after.local).filter(
        (k) =>
          k.includes(PARENT.subject) ||
          k.startsWith('wobo-account-kind') ||
          k === 'wobo-auth-session-v1',
      );
      expect(leftovers).toEqual([]);
      expect(after.session).not.toContain('wobo-parent-door-v1');
      await shot('05-signed-out');

      // --- a student on the same phone -------------------------------------------------------------
      await watchWords(page);
      await page.goto('/sign-in');
      await expect(page.getByRole('link', { name: 'Your door is here' })).toBeVisible();
      await page.locator('#au-who').fill(STUDENT.phone);
      await page.locator('form button[type=submit]').first().click();
      await expect(page.locator('#au-code')).toBeVisible();
      await page.locator('#au-code').fill('123456');
      await page.locator('form button[type=submit]').first().click();
      await expect(page).not.toHaveURL(/sign-in/);
      await page.waitForLoadState('networkidle');

      // the student types the parent's address, and is sent back to their own app
      await page.goto('/parent');
      await expect(page).not.toHaveURL(/\/parent/);
      await page.waitForLoadState('networkidle');
      const seen = await seenWords(page);
      const leaked = seen.filter((line) => PARENT_WORDS.some((w) => line.includes(w)));
      expect(leaked).toEqual([]);
      expect(seen.some((l) => l === 'title:Parents · Wobo')).toBe(false);
      // and the student was never made a parent account
      expect(plane.parents.has(STUDENT.subject)).toBe(false);
      expect(plane.log.filter((l) => l.includes('sign-up') && l.includes(STUDENT.subject))).toEqual(
        [],
      );
      const studentHeld = await storage(page);
      expect(Object.keys(studentHeld.local).some((k) => k.startsWith('wobo-account-kind'))).toBe(
        false,
      );
      await shot('06-student');

      expect(errors).toEqual([]);
    });
  });
}
