/**
 * "Nothing pre-ticked." — the lead over the two consent boxes, four lines above them.
 *
 * THE BUG. Ticking "I understand I am paying for a year, and I can cancel in Settings, in two taps"
 * and then pressing Monthly left the tick exactly where it was and rewrote the sentence underneath
 * it: the buyer arrived at a pre-ticked affirmation of a statement they had never read. The same
 * happened switching Pro to Max, because `terms` and `renewal` were two plain booleans that
 * `setPeriod` and `choose` never touched.
 *
 * THE FIX IS STRUCTURAL, not a reset somebody has to remember. A tick is stored with the OFFER it
 * was given for — the plan and the period — and an answer given to another offer is simply not
 * read. There is no code path that can forget to clear it, because there is nothing to clear.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bothTicked, NO_CONSENT, offerKey, tick, ticked } from './consent';

const YEARLY = offerKey('pro', 'yearly');
const MONTHLY = offerKey('pro', 'monthly');
const MAX = offerKey('max', 'yearly');

describe('the two consent boxes', () => {
  it('start unticked', () => {
    expect(ticked(NO_CONSENT, YEARLY)).toEqual({ terms: false, renewal: false });
    expect(bothTicked(NO_CONSENT, YEARLY)).toBe(false);
  });

  it('hold both answers for the offer they were given for', () => {
    let state = tick(NO_CONSENT, YEARLY, 'terms', true);
    state = tick(state, YEARLY, 'renewal', true);
    expect(ticked(state, YEARLY)).toEqual({ terms: true, renewal: true });
    expect(bothTicked(state, YEARLY)).toBe(true);
  });

  it('UNTICK THEMSELVES when the period changes, because the sentence changed', () => {
    let state = tick(NO_CONSENT, YEARLY, 'terms', true);
    state = tick(state, YEARLY, 'renewal', true);
    expect(ticked(state, MONTHLY)).toEqual({ terms: false, renewal: false });
    expect(bothTicked(state, MONTHLY)).toBe(false);
  });

  it('untick themselves when the plan changes too', () => {
    let state = tick(NO_CONSENT, YEARLY, 'terms', true);
    state = tick(state, YEARLY, 'renewal', true);
    expect(bothTicked(state, MAX)).toBe(false);
  });

  it('do not come back when the reader switches away and back', () => {
    // A tick is an answer to a question that was on the screen. Going to monthly and returning is
    // not the same as never having left: the sentence was replaced twice in between.
    let state = tick(NO_CONSENT, YEARLY, 'terms', true);
    state = tick(state, MONTHLY, 'terms', false);
    expect(ticked(state, YEARLY)).toEqual({ terms: false, renewal: false });
  });

  it('never lets one box carry the other one across an offer', () => {
    const state = tick(tick(NO_CONSENT, YEARLY, 'terms', true), MONTHLY, 'renewal', true);
    expect(ticked(state, MONTHLY)).toEqual({ terms: false, renewal: true });
  });
});

describe('the page reads them and nothing else', () => {
  const PAGE = readFileSync(join(import.meta.dir, 'Plans.tsx'), 'utf8');

  it('keeps no boolean of its own for either box, and gates the door on the offer', () => {
    expect(PAGE).toContain('const [consent, setConsent] = useState<ConsentState>(NO_CONSENT);');
    expect(PAGE).toContain('const boxes = ticked(consent, offer);');
    expect(PAGE).toContain('bothTicked(consent, offer)');
    expect(PAGE).toContain('checked={boxes.terms}');
    expect(PAGE).toContain('checked={boxes.renewal}');
    for (const gone of ['setTerms(', 'setRenewal(', 'checked={terms}', 'checked={renewal}']) {
      expect([gone, PAGE.includes(gone)]).toEqual([gone, false]);
    }
  });

  it('builds the offer from the plan on the card and the period the page is on', () => {
    expect(PAGE).toContain('const offer = offerKey(preview.id, period);');
  });
});
