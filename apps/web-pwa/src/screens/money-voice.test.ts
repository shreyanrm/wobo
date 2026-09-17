/**
 * THE MONEY'S VOICE ON THE LEARNER'S SIDE, held to `docs/copy/money.md`.
 *
 * The gateway holds the same law over the inbox (`services/gateway/tests/test_money_voice.py`).
 * This file holds it over the three surfaces in the app that mention money: the plans page, the
 * checkout card, and the bar on You. Two rules, both mechanical and both the document's:
 *
 *  1. Each money surface carries EXACTLY ONE line from money.md. Never two on one screen.
 *  2. None of the forbidden words appears on a money surface.
 *
 * THE DOCUMENT IS READ OFF DISK, and `money-voice.ts` is held equal to it row by row. Nobody may
 * improve a line in a component: money.md is the source, and a drift is a second voice for the
 * same moment. That is why the constants are compared to the file rather than to themselves.
 *
 * WHAT THE APP CARRIES. money.md names ten surfaces; six are in this app. The plans page, the
 * checkout card and the bar on You (both its rows) were placed by the money's-voice wave; the
 * parent's pay screen and the donate screen by the parent-pay wave, which is when the test that
 * held them absent was turned into one that holds them present.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVERY_LINE,
  FORBIDDEN,
  forbiddenWordsIn,
  linesCarriedBy,
  MONEY_LINES,
  type MoneySurface,
  normalise,
} from './money-voice';
import { PAY_COPY } from './parent/pay-copy';
import { PLANS_PAGE } from './plans/copy';
import { moneyLine, type PanelView } from './you/plan';

const REPO = join(import.meta.dir, '..', '..', '..', '..');
const HERE = import.meta.dir;

/** money.md's table, as {surface: line}, read off disk. */
function documentRows(): Record<string, string> {
  const text = readFileSync(join(REPO, 'docs', 'copy', 'money.md'), 'utf8');
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (!row.startsWith('|') || row.startsWith('|---')) continue;
    const cells = row
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length !== 2) continue;
    const [surface, line] = cells as [string, string];
    if (surface === 'Surface' || !line) continue;
    out[surface] = line;
  }
  return out;
}

const ROWS = documentRows();

/** The document's row for each key in `MONEY_LINES`. The join between the two files. */
const ROW_FOR: Readonly<Record<MoneySurface, string>> = {
  plansPage: 'plans page, above the plans',
  checkout: 'checkout, beside the price',
  youBar: "the bar on You, under the day's allowance",
  receiptMail: 'receipt mail, first line after the amount',
  planOpenedMail: 'plan opened mail',
  renewalMail: 'renewal mail',
  failedPaymentMail: 'failed payment mail',
  parentPay: "parent's pay screen",
  donate: 'donate screen',
  freeLearnerYou: 'free learner, once, on You',
};

/** A source file's words, with its comments stripped: what it says, not what it says about itself. */
function spoken(...path: string[]): string {
  return readFileSync(join(HERE, ...path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// --- the document, and the copy of it this app holds ---------------------------------------------

describe('money.md is the source, and money-voice.ts is a copy of it', () => {
  it('names ten surfaces', () => {
    expect(Object.keys(ROWS)).toHaveLength(10);
  });

  it('gives every surface in money-voice.ts the document’s own line, word for word', () => {
    for (const [key, row] of Object.entries(ROW_FOR) as [MoneySurface, string][]) {
      expect([key, normalise(ROWS[row] ?? '')]).toEqual([key, normalise(MONEY_LINES[key])]);
    }
  });

  it('lists the forbidden words the document forbids', () => {
    const text = readFileSync(join(REPO, 'docs', 'copy', 'money.md'), 'utf8').toLowerCase();
    for (const word of FORBIDDEN) expect([word, text.includes(word)]).toEqual([word, true]);
  });

  it('holds no line that breaks the document’s own rule', () => {
    // The lines are the remedy, so none of them may carry the disease.
    for (const line of EVERY_LINE) expect([line, forbiddenWordsIn(line)]).toEqual([line, []]);
  });

  it('keeps the copy laws every other learner-facing line keeps', () => {
    for (const line of EVERY_LINE) {
      expect([line, line.includes('!')]).toEqual([line, false]);
      expect([line, line.includes('—')]).toEqual([line, false]);
      expect([line, /\p{Extended_Pictographic}/u.test(line)]).toEqual([line, false]);
    }
  });

  it('names no money anywhere, on any surface', () => {
    // docs/ALLOWANCE.md §2: the learner's side of this product shows no currency at all. These
    // lines say where the money went; none of them may say how much.
    for (const line of EVERY_LINE) {
      expect([line, /[₹$]|\bINR\b|\bUSD\b|rupee|paise/i.test(line)]).toEqual([line, false]);
      expect([line, /\d/.test(line)]).toEqual([line, false]);
    }
  });
});

// --- rule 1: one line per surface, and never two -------------------------------------------------

describe('each surface in this app carries exactly one line', () => {
  it('the plans page says where the money goes, above the plans', () => {
    expect(PLANS_PAGE.money).toBe(MONEY_LINES.plansPage);
    // and it is DRAWN, not merely declared: a constant nobody renders is not a surface.
    expect(spoken('plans', 'Plans.tsx')).toContain('PLANS_PAGE.money');
  });

  it('the checkout has its own line, beside the price', () => {
    expect(PLANS_PAGE.checkout.money).toBe(MONEY_LINES.checkout);
    expect(spoken('plans', 'Plans.tsx')).toContain('c.money');
  });

  it('the two are different sentences, so the page never says the same thing twice', () => {
    expect(PLANS_PAGE.money).not.toBe(PLANS_PAGE.checkout.money);
  });

  it('the bar on You carries the two lines money.md writes for it, and no others', () => {
    const source = spoken('you', 'plan.ts');
    const carried = (Object.keys(MONEY_LINES) as MoneySurface[]).filter((s) =>
      source.includes(`MONEY_LINES.${s}`),
    );
    expect(carried).toEqual(['youBar', 'freeLearnerYou']);
    // and they are DRAWN, not merely mapped: a constant nobody renders is not a surface.
    expect(spoken('you', 'PlanPanel.tsx')).toContain('moneyLine(');
  });

  it('gives each learner the one line that is true for them, and never both', () => {
    /*
     * THE TENTH ROW WAS ALREADY WRITTEN. The You bar showed the paid line only when the plan
     * pays — correct, because on free that sentence is untrue — and then showed a free learner
     * NOTHING, while money.md's tenth row ("free learner, once, on You") sat unused behind a
     * test that asserted its absence. The owner's line existed; the surface this wave owns is
     * the bar on You; so the free learner gets their own line rather than an empty space.
     */
    expect(moneyLine('active')).toBe(MONEY_LINES.youBar);
    // A cancelled plan is paid for until the period ends, which is what the sentence is about.
    expect(moneyLine('cancelled')).toBe(MONEY_LINES.youBar);
    expect(moneyLine('free')).toBe(MONEY_LINES.freeLearnerYou);
    // Never two on one screen (money.md's own rule), and never a claim made out of an outage:
    // a read that did not land is not evidence of either plan.
    for (const view of ['loading', 'unreadable'] as PanelView[]) {
      expect([view, moneyLine(view)]).toEqual([view, null]);
    }
    for (const view of ['active', 'cancelled', 'free', 'loading', 'unreadable'] as PanelView[]) {
      expect([view, linesCarriedBy(moneyLine(view) ?? '').length <= 1]).toEqual([view, true]);
    }
  });

  it('no single surface carries two of the document’s lines', () => {
    for (const [label, text] of [
      ['plans page', PLANS_PAGE.money],
      ['checkout', PLANS_PAGE.checkout.money],
    ] as const) {
      expect([label, linesCarriedBy(text)]).toEqual([
        label,
        [label === 'checkout' ? 'checkout' : 'plansPage'],
      ]);
    }
  });
});

// --- rule 2: the forbidden words, on every money surface -----------------------------------------

describe('nothing on a money surface sounds like a company', () => {
  const surfaces: [string, string][] = [
    ['the plans page line', PLANS_PAGE.money],
    ['the checkout line', PLANS_PAGE.checkout.money],
    ['the You bar line', MONEY_LINES.youBar],
  ];

  for (const [label, text] of surfaces) {
    it(`${label} says none of them`, () => {
      expect([label, forbiddenWordsIn(text)]).toEqual([label, []]);
    });
  }

  /**
   * THE PROMO FIELD is a money surface by the brief's own list, and money.md gives it NO row.
   * The document is the only place these sentences may be written, so this wave does not invent
   * one for it — inventing owner copy is the one thing the verbatim rule exists to stop. What
   * CAN be held today is the half of the law that needs no new sentence: the field says none of
   * the forbidden words. The missing row is reported, not papered over.
   */
  it('the promo field says none of them either', () => {
    const said = forbiddenWordsIn(spoken('promo', 'promo.ts'));
    expect(said).toEqual([]);
  });
});

// --- the parent's pay screen and the donate screen ------------------------------------------------

describe('the parent’s pay screen and the donate screen carry their own lines', () => {
  /*
   * These two sat here as "the surfaces another wave owns", asserted ABSENT until somebody built
   * them. The parent-pay wave built the parent's pay screen and the parent's door to giving, and
   * put the donate line on /donate beside the price of a place, which is where a parent's donate door leads. Each carries its one row, verbatim,
   * and never the other's.
   */
  it('the parent’s pay screen says the parentPay line, and only that one', () => {
    expect(PAY_COPY.money).toBe(MONEY_LINES.parentPay);
    const screen = spoken('parent', 'PayForChild.tsx');
    expect(screen).toContain('PAY_COPY.money');
    expect(screen).not.toContain('MONEY_LINES');
  });

  it('the donate screen says the donate line, and only that one', () => {
    // A parent's donate door is this page (screens/parent/actions.ts), so there is one screen.
    const page = spoken('donate', 'Donate.tsx');
    const carried = (Object.keys(MONEY_LINES) as MoneySurface[]).filter((s) =>
      page.includes(`MONEY_LINES.${s}`),
    );
    expect(carried).toEqual(['donate']);
  });

  it('neither line says a forbidden word', () => {
    for (const key of ['parentPay', 'donate'] as MoneySurface[]) {
      expect([key, forbiddenWordsIn(MONEY_LINES[key])]).toEqual([key, []]);
    }
  });
});
