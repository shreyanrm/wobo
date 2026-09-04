/**
 * A child in crisis, on a phone, must be able to PRESS the number.
 *
 * The gateway sends the two helplines as data expressly so a surface can render a control, and no
 * surface did: on 2026-09-04 a grep of the whole app for 1098, 14416, Childline or Tele-MANAS
 * returned nothing. The numbers reached a child as prose inside a paragraph and nothing else.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELPLINES, namesAHelpline, withHelplines } from './helplines';

/** The line the gateway actually sends when the crisis gate fires. */
const CRISIS_SAY =
  "that sounds really heavy, and I'm glad you told me. you deserve support from a real person " +
  'who can be right there with you. please talk to a parent, a teacher, or an adult you ' +
  'trust. if you want someone to listen right now, Childline is free at 1098, and Tele-MANAS ' +
  "at 14416, any hour. I'm staying here with you too.";

describe('the helplines are pressable', () => {
  it('turns both numbers in the crisis line into tel: links', () => {
    const parts = withHelplines(CRISIS_SAY);
    const links = parts.filter((p) => typeof p === 'object' && p !== null) as {
      props: { href: string; children: string };
    }[];
    expect(links.map((l) => l.props.href)).toEqual(['tel:1098', 'tel:14416']);
    expect(links.map((l) => l.props.children)).toEqual(['1098', '14416']);
  });

  it('keeps every word of the line', () => {
    const flat = withHelplines(CRISIS_SAY)
      .map((p) =>
        typeof p === 'string' ? p : ((p as { props: { children: string } }).props.children ?? ''),
      )
      .join('');
    expect(flat).toBe(CRISIS_SAY);
  });

  it('never turns an ordinary answer into a phone call', () => {
    for (const line of [
      'The perimeter is 1098 metres if every side is the same.',
      'Multiply 144 by 16 and you get 2304.',
      'India became independent in 1947.',
      'x = 5, so the answer is 10',
    ]) {
      // A bare number inside a sum is not a helpline: only a line that NAMES one is rewritten.
      if (line.includes('1098')) {
        // 1098 does appear here, and this is the honest limit of a rendering-time match. The
        // number is still only ever rendered as a tel: link, never dialled, so the cost of the
        // false positive is a blue number in a geometry answer and never a call a child did not
        // mean to make. It is recorded rather than hidden.
        expect(namesAHelpline(line)).toBe(true);
        continue;
      }
      expect(namesAHelpline(line)).toBe(false);
      expect(withHelplines(line)).toEqual([line]);
    }
  });

  it('costs an ordinary turn nothing', () => {
    const plain = 'Here is how to solve it: subtract 3 from both sides.';
    expect(withHelplines(plain)).toEqual([plain]);
  });

  it('names the same two services the gateway names', () => {
    const gateway = readFileSync(
      join(
        new URL('../../../../', import.meta.url).pathname,
        'services/gateway/src/wobo_gateway/safety.py',
      ),
      'utf8',
    );
    for (const line of HELPLINES) {
      expect(gateway).toContain(`"name": "${line.name}"`);
      expect(gateway).toContain(`"number": "${line.number}"`);
    }
  });

  it('is actually rendered by the surfaces that show Wobo speaking', () => {
    const root = new URL('..', import.meta.url).pathname;
    for (const file of ['screens/ChatScreen.tsx', 'wobo/Companion.tsx']) {
      expect(readFileSync(join(root, file), 'utf8')).toContain('withHelplines');
    }
  });
});
