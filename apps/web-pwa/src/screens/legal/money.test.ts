/**
 * The money documents, read off disk, against the owner's ruling of 4 September 2026: we do not do
 * refunds, a subscriber cancels instead (DESIGN.md §0, "cancel, never refund").
 *
 * Two things have to hold at once and they pull in opposite directions, which is why this is a test
 * rather than a note. Every DISCRETIONARY refund promise must be gone: no goodwill, no "we do not
 * argue about small amounts", no window a reader could hold us to. And every STATUTORY one must
 * survive, because those are not ours to drop: a charge after cancelling, a duplicate charge, an
 * unauthorised charge, a service we did not supply, and the fourteen day withdrawal right in the
 * EU, the EEA and the UK. A blanket "no refunds" would be both unenforceable and a compliance
 * problem, so the document says no goodwill and lists the law.
 *
 * It also holds the cross-document pair `README.md` names: the terms and the cancellation document
 * must not contradict each other, and the README's own tag counts must match the files.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_TIERS } from '../plans/prices';

const DIR = new URL('../../../../../docs/legal/', import.meta.url).pathname;
const read = (file: string): string => readFileSync(join(DIR, file), 'utf8');
const MONEY = read('refund-and-cancellation.md');
const TERMS = read('terms-of-service.md');
const README = read('README.md');

describe('the cancellation document', () => {
  it('leads with cancelling, in its title and in its plain words', () => {
    const [title] = MONEY.split('\n');
    expect(title).toBe('# Cancelling, renewals and refunds');
    const plain = MONEY.slice(0, MONEY.indexOf('\n---'));
    expect(plain).toContain('Cancelling is the answer');
    expect(plain).toContain('nothing renews after that');
    expect(plain).toContain('everything you learnt stays');
  });

  it('keeps the filename every other surface points at', () => {
    expect(readdirSync(DIR)).toContain('refund-and-cancellation.md');
  });

  it('says the cancel is two taps, and offers nothing on the way out', () => {
    // It names the route the product HAS. There is no screen, route or nav item called Settings:
    // the four doors are Home, Learn, Practice and You (ui/primitives/AppShell.tsx), and Your plan
    // is a card on You. "Settings, then your plan" named a container and a nesting that were not
    // there, in the one document a subscriber is sent to when they want out.
    expect(MONEY).toContain('Open You');
    expect(MONEY).toContain('the card called Your plan');
    expect(MONEY).not.toContain('Settings, then your plan');
    expect(MONEY).toContain('Two taps');
    for (const dark of [
      'no survey',
      'no discount to stay',
      'no pause offered instead',
      'no second screen asking whether you are sure',
    ]) {
      expect([dark, MONEY.includes(dark)]).toEqual([dark, true]);
    }
    // the save flow it used to sanction is gone
    expect(MONEY).not.toContain('offering a pause or a smaller plan');
  });

  it('promises the plan to the end of the period, a resume, and an honest failure', () => {
    expect(MONEY).toContain('until the end of the period you have already paid for');
    expect(MONEY).toContain('moves to the free allowance by itself');
    expect(MONEY).toContain('one tap puts the plan back');
    expect(MONEY).toContain('We never show a cancellation that did not happen');
  });

  it('drops every goodwill refund', () => {
    for (const goodwill of [
      'We do not argue about small amounts',
      'we lean towards saying yes',
      'Refunds within 14 days of a charge, on request',
      'A gift can be refunded before it has been redeemed',
    ]) {
      expect([goodwill, MONEY.includes(goodwill)]).toEqual([goodwill, false]);
    }
    expect(MONEY).toContain('We do not refund as a gesture of goodwill');
  });

  it('keeps every refund that is statutory rather than goodwill', () => {
    for (const statutory of [
      'A charge taken after you cancelled',
      'A charge taken twice for the same period',
      'A charge you did not authorise',
      'A service we did not supply',
      'You have 14 days from the day the contract is made to withdraw',
      'This right is not ours to remove',
    ]) {
      expect([statutory, MONEY.includes(statutory)]).toEqual([statutory, true]);
    }
    // and the stores refund their own purchases whatever we write
    expect(MONEY).toContain('which apply whatever this document says');
  });

  it('sells the plans the product sells, and no others', () => {
    // The contract's own table of what you can buy named Plus monthly, Plus annual and Family —
    // three plans that do not exist — and omitted the two that do. It is read off the same list
    // the plans page renders, so the two cannot drift again without this failing.
    const table = MONEY.slice(MONEY.indexOf('## 1. What you can buy'), MONEY.indexOf('## 2.'));
    for (const tier of PLAN_TIERS) {
      expect([tier.name, table.includes(`| ${tier.name}`)]).toEqual([tier.name, true]);
    }
    for (const absent of ['Plus, monthly', 'Plus, annual', '| Family']) {
      expect([absent, table.includes(absent)]).toEqual([absent, false]);
    }
    // and nothing anywhere in the document sells a cadence the price list does not
    expect(MONEY).not.toContain('an annual renewal');
    expect(MONEY).toContain('There is no annual plan and no family plan');
  });

  it('promises no control that is not in the product', () => {
    // Section 8 replaced a retention line with a NEW promise — that upgrade and downgrade "live in
    // settings, next to the plan" — in a document that forms part of the terms. They do not: the
    // Your plan card's controls are a closed list of six in screens/you/plan.ts, and none of them
    // changes a tier.
    expect(MONEY).not.toContain('They live in settings, next to the plan');
    expect(MONEY).not.toContain('for whenever you want them');
    expect(MONEY).toContain('there is no upgrade or downgrade control in the product today');
  });

  it('leaves the India duties in place, because they are duties', () => {
    expect(MONEY).toContain('Consumer Protection Act 2019');
    expect(MONEY).toContain('grievance officer');
  });
});

describe('the terms do not contradict it', () => {
  it('sends every money rule to the one document', () => {
    expect(TERMS).toContain('We do not give money back as a gesture of goodwill');
    expect(TERMS).toContain('`refund-and-cancellation.md` section 5');
    expect(TERMS).not.toContain(
      'The rules on renewals, cancellations, refunds and the cooling-off period',
    );
  });

  it('still returns the unused term where we ended it, which is not goodwill', () => {
    expect(TERMS).toContain('we return the unused part unless the closure was for serious misuse');
  });
});

describe('the README stays in step', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');

  it('describes the document as cancelling first', () => {
    expect(README).toContain(
      '| `refund-and-cancellation.md` | cancelling, renewals, and the refunds the law requires |',
    );
  });

  it('counts the questions for counsel exactly, file by file and in total', () => {
    let total = 0;
    for (const file of files) {
      const count = (read(file).match(/\[REVIEW/g) ?? []).length;
      total += count;
      // the row reads "| `file.md` | 12 |", and one of them annotates its number, so read the digits
      const stated = new RegExp(`\\|\\s*\`${file}\`\\s*\\|\\s*(\\d+)`).exec(README)?.[1];
      expect([file, stated]).toEqual([file, String(count)]);
    }
    expect(README).toContain(`There are ${total} of them`);
    expect(README).toContain(`${total} tags across the ten documents`);
  });

  it('asks counsel whether the ruling is lawful, rather than assuming it', () => {
    expect(README).toContain("The owner's ruling is that we do not do refunds");
  });
});
