/**
 * NEVER THE LOUDEST THING ON THE PAGE (docs/SUGGESTIONS-AND-NOTICES.md §2).
 *
 * A suggestion that outshouts the lesson it sits beside has stopped being a suggestion. The rule is
 * held in two places: the tokens it is allowed to paint with, and the one component that paints
 * them. Nothing here is a matter of taste — every assertion is "this is quieter than the thing it
 * sits beside", measured against DESIGN.md §0's own palette.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENTS, QUIET } from './quiet';

const COMPONENT = readFileSync(join(import.meta.dir, 'Suggestion.tsx'), 'utf8');
const HOST = readFileSync(join(import.meta.dir, 'Suggestions.tsx'), 'utf8');

describe('a suggestion is quieter than what it sits beside', () => {
  it('sits on a surface, never on an accent', () => {
    expect(QUIET.surface).toBe('var(--paper-2)');
    for (const accent of ACCENTS) expect(QUIET.surface).not.toContain(accent);
  });

  it('never fills its action with the pointer colour, which belongs to the primary thing', () => {
    for (const accent of ACCENTS) {
      expect(QUIET.actionBackground).not.toContain(accent);
      expect(QUIET.surface).not.toContain(accent);
    }
  });

  it('sets its title at body size, so no heading on the page is smaller than it', () => {
    expect(Number.parseFloat(QUIET.titleSize)).toBeLessThanOrEqual(1);
  });

  it('spends its one accent on a dot, and nothing larger', () => {
    expect(QUIET.dot).toBeLessThanOrEqual(8);
  });

  it('paints no wash behind itself, which law v5 reserves for a pill, a tick or a selected row', () => {
    expect(/--[a-z]+-w\b/.test(COMPONENT)).toBe(false);
  });
});

describe('it is off the flow, and declining is as easy as taking it', () => {
  it('renders as an aside, outside whatever counts the learner’s progress', () => {
    expect(COMPONENT).toContain('<motion.aside');
  });

  it('offers a decline beside the action, every time, with no reason asked for', () => {
    expect(COMPONENT).toContain('data-testid="suggestion-decline"');
    expect(COMPONENT).not.toMatch(/why did you|tell us why|reason for|what went wrong/i);
  });

  it('honours reduced motion, because a suggestion is the last thing that should move', () => {
    expect(COMPONENT).toContain('useReducedMotion');
  });

  it('reaches the arbiter rather than rendering whatever it is handed', () => {
    expect(HOST).toContain('choose(');
  });

  it('lets a kind bring its own card without bringing its own gate', () => {
    // the slot replaces the card; `choose` still runs above it, and the no still sits under it
    const gate = HOST.indexOf('choose(');
    const slot = HOST.indexOf('slotFor?.(');
    expect(gate).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(gate);
    expect(HOST).toContain('<DeclineButton');
  });

  it('writes the no to the session ledger itself, so no screen has to remember to', () => {
    expect(HOST).toContain('decline(offer.id)');
  });
});
