import { describe, expect, it } from 'bun:test';
import { atomCardFromLink, composedCardFromLink, OPENABLE_ATOM_CARDS } from './open-at';

describe('the card a link opens a course at — the atom', () => {
  it('opens on a card of the lesson', () => {
    expect(atomCardFromLink('scale')).toBe('scale');
    expect(atomCardFromLink('boss')).toBe('boss');
    for (const card of OPENABLE_ATOM_CARDS) expect(atomCardFromLink(card)).toBe(card);
  });

  it('never opens on the end of a course a learner has not walked', () => {
    // The greeting, the tease and the mystery are what a course PAYS OUT. A link that landed on
    // one would hand over the finish of a lesson nobody did, and the stars with it.
    for (const end of ['greeting', 'tease', 'mystery']) {
      expect(atomCardFromLink(end)).toBeNull();
    }
  });

  it('ignores a card that is not in this lesson at all, and lands the course normally', () => {
    for (const nonsense of [undefined, '', '  ', 'pendulum', '3', 'SCALE', '../boss', 'bridge']) {
      expect(atomCardFromLink(nonsense)).toBeNull();
    }
  });
});

describe('the card a link opens a course at — the composed player', () => {
  it('opens on a numbered card inside the course', () => {
    expect(composedCardFromLink('1', 8)).toBe(1);
    expect(composedCardFromLink('4', 8)).toBe(4);
    // The workbook sits one past the last card, and is a real place to land.
    expect(composedCardFromLink('9', 8)).toBe(9);
  });

  it('refuses a card the course does not have, rather than landing on a blank', () => {
    for (const outside of ['0', '-1', '10', '999']) {
      expect(composedCardFromLink(outside, 8)).toBeNull();
    }
  });

  it('refuses anything that is not a whole card number', () => {
    for (const bad of [undefined, '', 'scale', '2.5', '1e3', ' 2 ', '0x2', 'NaN', 'Infinity']) {
      expect(composedCardFromLink(bad, 8)).toBeNull();
    }
  });

  it('refuses every card while the course has none yet', () => {
    expect(composedCardFromLink('1', 0)).toBeNull();
  });
});
