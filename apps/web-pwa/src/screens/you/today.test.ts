/**
 * THE BAR, AND THE ONE LAW IT EXISTS UNDER: money is internal.
 *
 * The owner, 2026-09-08 (docs/ALLOWANCE.md §2): *"it's not money based at the users' end; that is
 * only for internal purposes"*. So these tests are less about arithmetic than about what can reach
 * a screen. The panel is rendered to markup with every reading the bar can have, and the words it
 * produces are grepped for a currency symbol, a digit, the word "budget", the word "generosity"
 * and a percentage. A figure added to this bar later cannot ship quietly; it goes red here.
 *
 * The rest holds the readings honest: a gateway with no meter draws NO bar rather than an empty
 * one (an empty bar says "you have spent nothing today", which is a claim), a share is clamped,
 * and the spent line is the gateway's own sentence rather than a second voice for the same moment.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DayAllowance, Me } from '@wobo/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PlanPanel } from './PlanPanel';
import {
  RESETS_LINE,
  SPENT_LINE,
  TODAY_TITLE,
  type Today,
  readToday,
  todayFill,
  todayLines,
  todaySpoken,
  UNREAD,
} from './today';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');

const me = (allowance?: Partial<DayAllowance>): Me => ({
  subject: 'learner',
  anonymous: false,
  plan: 'pro',
  consentTier: null,
  budget: {
    turns: { used: null, limit: null, remaining: null },
    generations: { used: null, limit: null, remaining: null },
    resetAt: null,
  },
  ...(allowance ? { allowance: { used: null, resetsAt: null, spent: false, ...allowance } } : {}),
});

describe('reading today out of the brain', () => {
  it('reads the share the gateway sent', () => {
    expect(readToday(me({ used: 0.42 }))).toEqual({
      known: true,
      used: 0.42,
      spent: false,
      line: null,
    });
  });

  it('draws nothing at all where there is no meter to read', () => {
    // A gateway that has not shipped the allowance, a learner the brain has not met, no answer.
    expect(readToday(me())).toEqual(UNREAD);
    expect(readToday(null)).toEqual(UNREAD);
    expect(readToday(undefined)).toEqual(UNREAD);
    expect(todayFill(readToday(null))).toBeNull();
    expect(todayLines(readToday(null))).toEqual([]);
    expect(todaySpoken(readToday(null))).toBeNull();
  });

  it('is spent when the gateway says so, and when the share reaches the end', () => {
    expect(readToday(me({ used: 1 })).spent).toBe(true);
    expect(readToday(me({ used: 0.2, spent: true })).spent).toBe(true);
    // spent with no share at all is still a full bar: the day IS gone, and drawing it half full
    // would be the one wrong answer.
    expect(readToday(me({ spent: true }))).toEqual({
      known: true,
      used: 1,
      spent: true,
      line: null,
    });
  });

  it('clamps a share that arrived outside the bar', () => {
    expect(readToday(me({ used: 1.8 })).used).toBe(1);
    expect(readToday(me({ used: -3 })).used).toBe(0);
    expect(todayFill(readToday(me({ used: 0.5 })))).toBe(50);
  });
});

describe('what the bar says', () => {
  /**
   * THE CLOCK LAW ON THE CAPTION. docs/copy/voice.md §8.7 and §10 (the owner, 2026-09-04; DESIGN.md
   * §0; `screens/site/hours.test.ts`): no public surface names a late hour, and the word for the
   * hour the day turns over on is one of the four the law lists. docs/ALLOWANCE.md §2 spelled the
   * caption with that word when it paraphrased the owner's "resets every day in the learner's own
   * time zone"; the clock law is the higher law, so the caption drops the hour and keeps the fact.
   */
  it('says the reset line, and only that, while the day is running', () => {
    expect(todayLines(readToday(me({ used: 0.3 })))).toEqual([RESETS_LINE]);
    expect(RESETS_LINE).toBe('Refills overnight.');
    expect(RESETS_LINE).not.toMatch(/\bmidnight\b/i);
    expect(TODAY_TITLE).toBe('Today');
  });

  it('adds the spent line when the bar is full, under the caption rather than over it', () => {
    expect(todayLines(readToday(me({ used: 1 })))).toEqual([RESETS_LINE, SPENT_LINE]);
  });

  it("prefers the gateway's own line for a spent day", () => {
    const own: Today = { known: true, used: 1, spent: true, line: 'That is the day, for today.' };
    expect(todayLines(own)).toEqual([RESETS_LINE, 'That is the day, for today.']);
  });

  /**
   * ONE VOICE FOR ONE MOMENT. docs/ALLOWANCE.md §2: "Wobo says the same honest line the question
   * counter says today". The question counter is budget.py's `_EXHAUSTED[TURN]`, read here so the
   * two cannot drift into two sentences about the same thing.
   */
  it('says what the question counter already says, word for word', () => {
    const budget = readFileSync(
      join(REPO, 'services', 'gateway', 'src', 'wobo_gateway', 'budget.py'),
      'utf8',
    );
    const block = /_EXHAUSTED: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(budget)?.[1] ?? '';
    const turn = /TURN:\s*"([^"]+)"/.exec(block)?.[1];
    expect(turn).toBe(SPENT_LINE);
  });

  it('speaks the proportion in words for somebody who cannot see the bar', () => {
    expect(todaySpoken(readToday(me({ used: 0.1 })))).toBe('Most of today is still there.');
    expect(todaySpoken(readToday(me({ used: 0.5 })))).toBe('About half of today is left.');
    expect(todaySpoken(readToday(me({ used: 0.9 })))).toBe('Today is nearly used up.');
    expect(todaySpoken(readToday(me({ used: 1 })))).toBe('Today is used up.');
  });
});

// --- the law, on the rendered screen -------------------------------------------------------------

/** The panel as it renders, with one reading of the day. Effects do not run, so this is the card. */
function panel(today: Today): string {
  return renderToStaticMarkup(
    createElement(PlanPanel, { planId: 'pro', today, onSeePlans: () => {} }),
  );
}

/** Only the words: markup, attributes and inline styles stripped out. */
function words(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const READINGS: readonly Today[] = [
  UNREAD,
  { known: true, used: 0, spent: false, line: null },
  { known: true, used: 0.37, spent: false, line: null },
  { known: true, used: 0.84, spent: false, line: null },
  { known: true, used: 1, spent: true, line: null },
];

describe('money is internal, and the rendered card proves it', () => {
  for (const reading of READINGS) {
    const label = reading.known ? `${reading.used} of the day spent` : 'nothing read';
    it(`names no money at ${label}`, () => {
      const said = words(panel(reading));
      for (const forbidden of ['₹', '$', 'INR', 'USD', 'paise', 'rupee', 'Rupee', '%']) {
        expect([forbidden, said.includes(forbidden)]).toEqual([forbidden, false]);
      }
    });

    it(`prints no figure at ${label}`, () => {
      // Not one digit anywhere in the words: no share, no count, no month, no amount. The bar's
      // own proportion lives in an inline width, which is markup and not something anyone reads.
      expect(words(panel(reading))).not.toMatch(/\d/);
    });

    it(`never says budget or generosity at ${label}`, () => {
      const said = words(panel(reading)).toLowerCase();
      for (const forbidden of ['budget', 'generosity', 'monthly', 'per month']) {
        expect([forbidden, said.includes(forbidden)]).toEqual([forbidden, false]);
      }
    });

    it(`writes no em dash at ${label}`, () => {
      expect(words(panel(reading))).not.toContain('—');
    });
  }

  it('draws a bar only where there is a reading, and fills it by the share', () => {
    expect(panel(UNREAD)).not.toContain('wp-bar');
    const drawn = panel({ known: true, used: 0.37, spent: false, line: null });
    expect(drawn).toContain('wp-bar');
    expect(drawn).toContain('width:37%');
    // and the drawing itself is hidden from a screen reader, which gets the sentence instead
    expect(drawn).toContain('aria-hidden="true"');
    expect(words(drawn)).toContain('About half of today is left.');
  });

  it('puts the day under the plan, named Today, with the reset line', () => {
    const said = words(panel({ known: true, used: 0.2, spent: false, line: null }));
    expect(said).toContain('Today');
    expect(said).toContain('Refills overnight.');
  });

  it('says the spent line on a full bar', () => {
    expect(words(panel({ known: true, used: 1, spent: true, line: null }))).toContain(SPENT_LINE);
  });
});
