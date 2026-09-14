/**
 * THE LINK THAT LANDS (docs/EMAILS-AND-ANIMATIONS.md §4), walked at 390.
 *
 * A mail's one button carries `/course/<course>/card/<card>?k=<token>`. The unit tests hold the
 * pure parts — the address (`src/shell/router.test.ts`), the token and its single use
 * (`services/gateway/tests/test_mail_arrival.py`), which card a player will open on
 * (`src/screens/course/open-at.test.ts`), and what is held across the door
 * (`src/shell/arrival.test.ts`). Only a real browser can prove the thing the learner actually
 * experiences:
 *
 *   · a link PASTED COLD into the bar, on a phone, opens the course ON that card — not at the top
 *     of it, and not on the card they happened to leave,
 *   · the token does not stay in the address once it has been read, and
 *   · nothing errors on the way.
 *
 * 390 because that is the width the design is measured at, and because a mail is read on a phone.
 * The suite's browsers are muted (`playwright.config.ts`): a lab is silent.
 *
 * Keyless, like journey.spec.ts: the atom world is pinned before boot and its brain installed
 * after the navigation, so no request leaves the machine and no mail is involved at any point.
 */

import { expect, type Page, test } from '@playwright/test';
import { ATOM_TARGET_NODE_ID } from '@wobo/sdk';
import { actionBarButton, assertNoErrors, seedOnboarded, watchConsole } from './helpers';
import { installAtomBrain, seedAtomWorld } from './helpers/brain';

/** The phone the design is measured at. */
const PHONE = { width: 390, height: 844 };

/** The atom's own course, and one card inside it that is neither its first nor its last. */
const COURSE = 'm2-1';
const CARD = 'whatif';
const CARD_LINE = 'Every number here is yours to drag';

/** A link the way it arrives from an inbox: the address, and a token on it. */
function mailLink(card: string): string {
  return `/course/${COURSE}/card/${card}?k=a-signed-token-the-gateway-minted`;
}

async function coldOpen(page: Page, path: string): Promise<void> {
  await page.setViewportSize(PHONE);
  await seedOnboarded(page);
  await seedAtomWorld(page);
  await page.goto(path);
  await installAtomBrain(page, ATOM_TARGET_NODE_ID);
}

test('a pasted mail link opens the course on the exact card, at 390', async ({ page }, info) => {
  const errors = watchConsole(page);
  await coldOpen(page, mailLink(CARD));

  // The card the link named, on screen, cold — no Learn, no subject, no chapter, no Begin.
  await expect(page.getByText(CARD_LINE, { exact: true })).toBeVisible({ timeout: 20_000 });
  // …and it really is the middle of the lesson: the course's own opening card is not what is up.
  await expect(actionBarButton(page, 'begin')).toBeHidden();

  // THE TOKEN IS NOT IN THE ADDRESS. It is a credential minted for one inbox; left in the bar it
  // would be in the history of a shared phone and in every screenshot of this screen.
  const url = new URL(page.url());
  expect(url.pathname).toBe(`/course/${COURSE}/card/${CARD}`);
  expect(url.search).toBe('');

  assertNoErrors(errors, info);
});

test('the same course with no card in the link opens the way it always did', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  await coldOpen(page, `/course/${COURSE}`);

  // The arrival card, with its one action — the address without a card is untouched by all of
  // this, so every link already in an inbox, a bookmark or a share still means what it meant.
  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(CARD_LINE, { exact: true })).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(`/course/${COURSE}`);

  assertNoErrors(errors, info);
});

test('a card this lesson does not have lands the course, never a dead end', async ({
  page,
}, info) => {
  const errors = watchConsole(page);
  // A link cut short by a mail client, a bookmark from a course that has changed, a guess.
  await coldOpen(page, `/course/${COURSE}/card/not-a-card-in-this-lesson`);

  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 20_000 });

  assertNoErrors(errors, info);
});

test('a link to the end of a course does not hand over the end of it', async ({ page }, info) => {
  const errors = watchConsole(page);
  // The greeting is what the lesson PAYS OUT. Guessing its address must not pay it.
  await coldOpen(page, `/course/${COURSE}/card/greeting`);

  await expect(actionBarButton(page, 'begin')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('You did it', { exact: false })).toBeHidden();

  assertNoErrors(errors, info);
});
