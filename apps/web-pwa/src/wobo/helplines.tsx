/**
 * The helplines, pressable.
 *
 * When the safety screen stops a turn, Wobo's reply names two free national services: Childline on
 * 1098 and Tele-MANAS on 14416. The gateway also sends them as DATA — `safety.support` in the
 * verdict block, deliberately structured "so a surface can put it somewhere a child can actually
 * press it" (`services/gateway/src/wobo_gateway/safety.py`, SUPPORT).
 *
 * NO SURFACE READ IT. A grep of the whole app for 1098, 14416, Childline or Tele-MANAS returned
 * nothing on 2026-09-04: the numbers reached a child only as prose inside a paragraph. A child in
 * distress, on a phone, was being asked to memorise a number out of a sentence and dial it by hand.
 * That is the gap that remained after the classifier was fixed, and it is the last few centimetres
 * of the whole safety path.
 *
 * This module closes those centimetres without waiting for the `safety.support` block to be plumbed
 * through the turn model: wherever Wobo's own words are rendered, the numbers in them become `tel:`
 * links. It is deliberately a rendering concern and not a parser — it matches the two numbers this
 * product names and nothing else, so it cannot turn a maths answer into a phone call.
 *
 * WHEN THE SUPPORT BLOCK IS PLUMBED THROUGH, this becomes the fallback rather than the mechanism,
 * and the list below should be read off the verdict instead of held here. Until then the two lists
 * have to agree, and `helplines.test.ts` is what makes them.
 */

import type { ReactNode } from 'react';

export interface Helpline {
  name: string;
  /** Dialled as-is. Indian short codes, so no country prefix. */
  number: string;
  note: string;
}

/**
 * The same two the gateway names, in the same order. India only, and that is a real limitation
 * rather than an oversight: `docs/legal/safety-and-content.md` §3 says in as many words that this
 * is the whole list today and that it is wrong for a learner outside India.
 */
export const HELPLINES: readonly Helpline[] = [
  { name: 'Childline', number: '1098', note: 'free, any hour, for anyone under 18' },
  { name: 'Tele-MANAS', number: '14416', note: 'free, any hour, mental health support' },
];

/** Longest first, so 14416 is never matched as 1441 followed by a 6. */
const NUMBERS = [...HELPLINES].map((h) => h.number).sort((a, b) => b.length - a.length);
const PATTERN = new RegExp(`\\b(${NUMBERS.join('|')})\\b`, 'g');

/** Is this a line where a helpline number should be pressable? */
export function namesAHelpline(text: string): boolean {
  return NUMBERS.some((n) => new RegExp(`\\b${n}\\b`).test(text));
}

/**
 * Wobo's line, with the helpline numbers in it turned into things a thumb can hit.
 *
 * Returns the text unchanged (as a single string in an array) when no helpline is named, so every
 * ordinary turn costs one regex test and renders exactly as it did.
 */
export function withHelplines(text: string): ReactNode[] {
  if (!namesAHelpline(text)) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(text);
  while (match !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const number = match[1] ?? '';
    const line = HELPLINES.find((h) => h.number === number);
    out.push(
      <a
        // biome-ignore lint/suspicious/noArrayIndexKey: the segments are one fixed sentence
        key={`tel-${key++}`}
        className="wobo-helpline"
        href={`tel:${number}`}
        aria-label={line ? `Call ${line.name} on ${number}, ${line.note}` : `Call ${number}`}
      >
        {number}
      </a>,
    );
    last = match.index + number.length;
    match = PATTERN.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
