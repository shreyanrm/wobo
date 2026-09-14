/**
 * THE BAR AND THE FIELD, ON REAL SCREENS.
 *
 * docs/ALLOWANCE.md §2 gives the learner one bar and no money, and §3 puts a promo field at the
 * checkout and on You. The unit tests hold the words and the states (`screens/you/today.test.ts`,
 * `screens/promo/promo.test.ts`); this run holds the things only a browser can answer:
 *
 *  · the bar draws the share the gateway actually sent, measured in pixels off the two boxes;
 *  · at 390 and at 1440, in both themes, nothing overflows, nothing clips, no control on the panel
 *    is under the 44px thumb floor and no text under the 13px floor (the shared proof harness does
 *    the measuring, so the thresholds are the product's, not this file's);
 *  · every colour the new sheet paints clears WCAG, computed from what the browser actually
 *    resolved rather than from the tokens this spec thinks are live;
 *  · no figure and no currency is anywhere on the panel, in any theme, at either width;
 *  · the promo field says the honest thing for a refusal, for an acceptance, and for a gateway
 *    that never answered, and the code it posts is the normalised one.
 *
 * The gateway is answered in the browser (`page.route` over the `/gw` origin this config points
 * the app at), so the real SDK, the real parser and the real components run and nothing leaves the
 * machine.
 */

import { expect, type Page, test } from '@playwright/test';
import { assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { applyTheme, auditViewport, settle, type Theme } from './helpers/proof';

/** The share of the day the fake brain reports. A third and a bit: visibly neither end. */
const USED = 0.37;

const PANEL = '.wk-card:has(.wp-today)';

type PromoAnswer = { status: number; body: unknown };

/** Answer the gateway as the brain would, and record the promo codes it was asked about. */
async function fakeBrain(
  page: Page,
  opts: { used?: number | null; spent?: boolean; promo?: PromoAnswer | 'dead' } = {},
): Promise<string[]> {
  const codes: string[] = [];
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });
    if (path === '/v1/me') {
      const allowance: Record<string, unknown> = { spent: opts.spent === true };
      if (opts.used !== null) allowance.used = opts.used ?? USED;
      return json(200, {
        subject: 'learner-1',
        anonymous: false,
        plan: 'pro',
        consent_tier: 'un_elevated',
        budget: { turns: { used: 3, limit: 200, remaining: 197 }, reset_at: null },
        allowance,
      });
    }
    if (path === '/v1/me/subscription') {
      return json(200, {
        status: 'active',
        plan: 'pro',
        period_end: '2027-09-11T00:00:00Z',
        renews: true,
        source: 'web',
        can_cancel: true,
      });
    }
    if (path === '/v1/me/promo') {
      const body = (req.postDataJSON() ?? {}) as { code?: string };
      codes.push(String(body.code));
      if (opts.promo === 'dead') return route.abort('failed');
      const answer = opts.promo ?? { status: 200, body: { applied: true } };
      return json(answer.status, answer.body);
    }
    // Everything else this screen may ask for: an empty, honest 200.
    return json(200, {});
  });
  return codes;
}

/** Open You with the brain installed, and wait for the plan card to have read itself. */
async function openYou(page: Page): Promise<void> {
  await seedOnboarded(page);
  await page.goto('/you');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('.wp-today')).toBeVisible();
  await settle(page);
}

test.describe('the day, under the plan', () => {
  test('draws the share the brain sent, and says the two lines', async ({ page }, info) => {
    const errors = watchConsole(page);
    await fakeBrain(page);
    await openYou(page);

    await expect(page.getByText('Today', { exact: true })).toBeVisible();
    // the caption names no hour (the clock law, docs/copy/voice.md §8.7; screens/site/hours.test.ts)
    await expect(page.getByText('Refills overnight.')).toBeVisible();

    // THE BAR IS THE READING. Measured off the two boxes rather than off the inline style, so this
    // fails if the fill is ever laid out differently from the width it was given.
    const drawn = await page.evaluate(() => {
      const track = document.querySelector('.wp-bar') as HTMLElement | null;
      const fill = document.querySelector('.wp-bar > i') as HTMLElement | null;
      if (!track || !fill) return null;
      return {
        track: track.getBoundingClientRect().width,
        fill: fill.getBoundingClientRect().width,
      };
    });
    expect(drawn).not.toBeNull();
    expect(
      (drawn as { fill: number; track: number }).fill / (drawn as { track: number }).track,
    ).toBeCloseTo(USED, 2);

    assertNoErrors(errors, info);
  });

  test('says the spent line, and fills the bar, when the day is gone', async ({ page }, info) => {
    const errors = watchConsole(page);
    await fakeBrain(page, { used: 1, spent: true });
    await openYou(page);
    await expect(
      page.getByText('We have talked a lot today. Tomorrow there is room for more.'),
    ).toBeVisible();
    const share = await page.evaluate(() => {
      const track = document.querySelector('.wp-bar') as HTMLElement;
      const fill = document.querySelector('.wp-bar > i') as HTMLElement;
      return fill.getBoundingClientRect().width / track.getBoundingClientRect().width;
    });
    expect(share).toBeCloseTo(1, 2);
    assertNoErrors(errors, info);
  });

  test('draws no bar at all where the brain has no meter to report', async ({ page }, info) => {
    const errors = watchConsole(page);
    // A gateway that has not shipped the allowance: the plan card is still there, the bar is not.
    await fakeBrain(page, { used: null });
    await seedOnboarded(page);
    await page.goto('/you');
    await expect(page.locator('.wk-tag', { hasText: 'Your plan' })).toBeVisible();
    await settle(page);
    await expect(page.locator('.wp-bar')).toHaveCount(0);
    assertNoErrors(errors, info);
  });
});

// --- measured, at both widths, in both themes ----------------------------------------------------

const WIDTHS = [390, 1440] as const;
const THEMES: readonly Theme[] = ['light', 'dark'];

/** WCAG relative luminance and contrast, from resolved `rgb()` strings the browser gave us. */
function ratio(a: string, b: string): number {
  const lum = (css: string): number => {
    const [r, g, bl] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number) as [
      number,
      number,
      number,
    ];
    const ch = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`the panel holds up at ${width} in ${theme}`, async ({ page }, info) => {
      const errors = watchConsole(page);
      await fakeBrain(page);
      await page.setViewportSize({ width, height: 900 });
      await openYou(page);
      await applyTheme(page, theme);
      await settle(page);

      // NOTHING OVERFLOWS, NOTHING CLIPS, NOTHING IS TOO SMALL. The shared harness owns the
      // thresholds (44px thumbs at phone width, a 13px type floor), so this spec cannot quietly
      // set its own. Findings are filtered to the plan card and the promo field: the rest of the
      // You screen is other people's, and responsive.spec.ts already walks it.
      const mine = (await auditViewport(page, width)).filter((f) =>
        /wp-|pm-|wobo-plan/.test(f.selector),
      );
      expect(mine, JSON.stringify(mine, null, 2)).toEqual([]);

      // THE COLOURS, AS THE BROWSER RESOLVED THEM.
      const measured = await page.evaluate(() => {
        const on = (el: Element | null): string => {
          let node: Element | null = el;
          while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
            node = node.parentElement;
          }
          return 'rgb(255, 255, 255)';
        };
        const out: { id: string; fg: string; bg: string; size: number; big: boolean }[] = [];
        const push = (id: string, sel: string, graphic = false) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const cs = getComputedStyle(el);
          const size = Number.parseFloat(cs.fontSize);
          out.push({
            id,
            fg: graphic ? cs.backgroundColor : cs.color,
            bg: on(graphic ? el.parentElement : el.parentElement),
            size,
            big: size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700),
          });
        };
        push('the bar fill on its track', '.wp-bar > i', true);
        push('the word Today', '.wp-today > b');
        push('the lines under the bar', '.wp-today > span:not(.wp-sr)');
        push('the promo label', '.pm > label');
        push('the promo field', '.pm-row > input');
        push('the promo button', '.pm-row > button');
        return out;
      });
      expect(measured.length).toBeGreaterThanOrEqual(5);
      for (const m of measured) {
        // The bar is meaningful non-text content (WCAG 1.4.11, 3:1); everything else is text.
        const floor = m.id.startsWith('the bar') ? 3 : m.big ? 3 : 4.5;
        const got = ratio(m.fg, m.bg);
        expect(
          [`${m.id} at ${width} in ${theme}`, got >= floor],
          `${m.id}: ${got.toFixed(2)}:1 against ${floor}:1 (${m.fg} on ${m.bg})`,
        ).toEqual([`${m.id} at ${width} in ${theme}`, true]);
      }

      // NO MONEY ON THE SCREEN, in either theme, at either width (docs/ALLOWANCE.md §2).
      const said = (await page.locator(PANEL).innerText()).replace(/\s+/g, ' ');
      for (const forbidden of ['₹', '$', '%', 'INR', 'USD', 'budget', 'generosity']) {
        expect([forbidden, said.toLowerCase().includes(forbidden.toLowerCase())]).toEqual([
          forbidden,
          false,
        ]);
      }
      // and not one digit in the bar's own block
      expect(await page.locator('.wp-today').innerText()).not.toMatch(/\d/);
      expect(said).not.toContain('—');

      assertNoErrors(errors, info);
    });
  }
}

// --- the promo field ------------------------------------------------------------------------------

test.describe('Have a code?', () => {
  test('posts the normalised code and says what the server said', async ({ page }, info) => {
    const errors = watchConsole(page);
    const codes = await fakeBrain(page, {
      promo: { status: 200, body: { applied: true, message: 'That code is on your account.' } },
    });
    await openYou(page);
    const field = page.getByLabel('Have a code?');
    await field.fill(' back to school ');
    await page.locator('.pm-row > button').click();
    await expect(page.getByText('That code is on your account.')).toBeVisible();
    expect(codes).toEqual(['BACKTOSCHOOL']);
    assertNoErrors(errors, info);
  });

  test('refuses honestly, and never claims a code that was refused', async ({ page }, info) => {
    const errors = watchConsole(page);
    await fakeBrain(page, {
      promo: { status: 404, body: { detail: { code: 'promo_not_found' } } },
    });
    await openYou(page);
    await page.getByLabel('Have a code?').fill('NOPE');
    await page.locator('.pm-row > button').click();
    await expect(page.getByText('I could not find that code. Check it once more.')).toBeVisible();
    await expect(page.getByLabel('Have a code?')).toHaveAttribute('aria-invalid', 'true');
    // The 404 this test asked the fake brain for is logged by the browser as a resource error. It
    // is the scenario, not a defect, so it is filtered and everything else still has to be clean.
    assertNoErrors(
      errors.filter((e) => !/Failed to load resource/.test(e)),
      info,
    );
  });

  test('says nothing has changed when the request never landed', async ({ page }, info) => {
    const errors = watchConsole(page);
    await fakeBrain(page, { promo: 'dead' });
    await openYou(page);
    await page.getByLabel('Have a code?').fill('WOBO');
    await page.locator('.pm-row > button').click();
    await expect(
      page.getByText('That did not go through, so nothing has changed. Try again in a moment.'),
    ).toBeVisible();
    // The aborted request is the scenario; the browser logs it as a resource error either way.
    assertNoErrors(
      errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e)),
      info,
    );
  });

  test('asks for a code before it asks the gateway', async ({ page }, info) => {
    const errors = watchConsole(page);
    const codes = await fakeBrain(page);
    await openYou(page);
    await page.locator('.pm-row > button').click();
    await expect(page.getByText('Type the code first and I will check it.')).toBeVisible();
    expect(codes).toEqual([]);
    assertNoErrors(errors, info);
  });
});

// --- the same field, on the checkout card ---------------------------------------------------------

/**
 * ONE FIELD, TWO SURFACES (docs/ALLOWANCE.md §3). The plans page is a public site page with its own
 * stylesheet, so the thing worth measuring here is that the component carries its own look onto it:
 * the same label, the same control, and the same contrast in both themes against the checkout
 * card's ground rather than the kit's.
 */
for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`the checkout card carries the same field at ${width} in ${theme}`, async ({
      page,
    }, info) => {
      const errors = watchConsole(page);
      await fakeBrain(page);
      await page.setViewportSize({ width, height: 900 });
      await seedOnboarded(page);
      await page.goto('/plans');
      await expect(page.locator('.pl-checkout .pm')).toBeVisible();
      await applyTheme(page, theme);
      await settle(page);

      await expect(page.locator('.pl-checkout').getByLabel('Have a code?')).toBeVisible();
      const mine = (await auditViewport(page, width)).filter((f) => /pm-|\.pm\b/.test(f.selector));
      expect(mine, JSON.stringify(mine, null, 2)).toEqual([]);

      const measured = await page.evaluate(() => {
        const on = (el: Element | null): string => {
          let node: Element | null = el;
          while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
            node = node.parentElement;
          }
          return 'rgb(255, 255, 255)';
        };
        const out: { id: string; fg: string; bg: string }[] = [];
        for (const [id, sel] of [
          ['the label', '.pl-checkout .pm > label'],
          ['the field', '.pl-checkout .pm-row > input'],
          ['the button', '.pl-checkout .pm-row > button'],
        ] as const) {
          const el = document.querySelector(sel);
          if (!el) continue;
          out.push({ id, fg: getComputedStyle(el).color, bg: on(el.parentElement) });
        }
        return out;
      });
      expect(measured).toHaveLength(3);
      for (const m of measured) {
        const got = ratio(m.fg, m.bg);
        expect(
          [`${m.id} at ${width} in ${theme}`, got >= 4.5],
          `${m.id}: ${got.toFixed(2)}:1 against 4.5:1 (${m.fg} on ${m.bg})`,
        ).toEqual([`${m.id} at ${width} in ${theme}`, true]);
      }
      assertNoErrors(errors, info);
    });
  }
}
