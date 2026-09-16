/**
 * PUSH, WHICH IS NOT BUILT (docs/SUGGESTIONS-AND-NOTICES.md §3).
 *
 * *"Push notifications do not exist and are not built. When they are, they inherit the inbox law
 * exactly, plus four rules of their own, because a push is more intrusive than mail and the same
 * cadence would be a different thing."*
 *
 * This wave deliberately ships no push. What it ships instead is the DESIGN of one, as four rules
 * written down as executable decisions, so the day somebody wires a permission prompt to a service
 * worker the rules are already standing there and the wiring has to pass them. The last test in
 * this file is the one that keeps the promise: it reads `push.ts` and fails if anything in it could
 * actually reach a phone.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIAL_FOR,
  inboxLawAllows,
  isAPushKind,
  isReminder,
  MAIL_MAX_PER_24H,
  mayAskToTurnOn,
  mayPushAt,
  oneMessage,
  PUSH_BUILT,
  PUSH_KINDS,
  PUSH_MAX_PER_24H,
} from './push';

// --- rule 1: off until asked for ------------------------------------------------------------------

describe('rule 1: off until asked for', () => {
  it('asks nothing of somebody who has just arrived', () => {
    expect(mayAskToTurnOn({ selfDirectedReturns: 0, offered: false, declined: false })).toBe(false);
  });

  it('still asks nothing after one or two returns of their own', () => {
    expect(mayAskToTurnOn({ selfDirectedReturns: 1, offered: false, declined: false })).toBe(false);
    expect(mayAskToTurnOn({ selfDirectedReturns: 2, offered: false, declined: false })).toBe(false);
  });

  it('asks once, after they have come back on their own three times', () => {
    expect(mayAskToTurnOn({ selfDirectedReturns: 3, offered: false, declined: false })).toBe(true);
  });

  it('never asks a second time, whether or not they said yes', () => {
    expect(mayAskToTurnOn({ selfDirectedReturns: 9, offered: true, declined: false })).toBe(false);
  });

  it('never asks again once it has been declined, at any number of returns', () => {
    for (const returns of [3, 10, 100]) {
      expect(mayAskToTurnOn({ selfDirectedReturns: returns, offered: false, declined: true })).toBe(
        false,
      );
    }
  });
});

// --- rule 2: fewer than mail, never more -----------------------------------------------------------

describe('rule 2: fewer than mail, never more, and one thing is one message', () => {
  it('never allows push a wider cadence than mail has', () => {
    expect(PUSH_MAX_PER_24H).toBeLessThanOrEqual(MAIL_MAX_PER_24H);
  });

  it('collapses a push and a mail about the same thing into one message', () => {
    const out = oneMessage({
      push: [{ kind: 'left_half_done', about: 'linear-equations' }],
      mail: [{ kind: 'left_half_done', about: 'linear-equations' }],
    });
    expect(out.push.length + out.mail.length).toBe(1);
  });

  it('and the push wins it, because it is the lighter one', () => {
    const out = oneMessage({
      push: [{ kind: 'left_half_done', about: 'linear-equations' }],
      mail: [{ kind: 'left_half_done', about: 'linear-equations' }],
    });
    expect(out.push.length).toBe(1);
    expect(out.mail).toEqual([]);
  });

  it('leaves a mail about a different thing alone', () => {
    const out = oneMessage({
      push: [{ kind: 'left_half_done', about: 'linear-equations' }],
      mail: [{ kind: 'doubt_answered', about: 'a-photographed-page' }],
    });
    expect(out.push.length).toBe(1);
    expect(out.mail.length).toBe(1);
  });

  it('never sends more than one push in twenty-four hours, whatever is queued', () => {
    const out = oneMessage({
      push: [
        { kind: 'left_half_done', about: 'a' },
        { kind: 'streak_ends_today', about: 'b' },
        { kind: 'doubt_answered', about: 'c' },
      ],
      mail: [],
    });
    expect(out.push.length).toBeLessThanOrEqual(PUSH_MAX_PER_24H);
  });
});

// --- rule 3: never at a late hour, and never during school ------------------------------------------

describe('rule 3: never at a late hour, never during school on a school day', () => {
  const day = { schoolDay: false, localityKnown: true };

  it('never reaches a phone before the day starts', () => {
    for (const hourLocal of [0, 3, 6, 7]) expect(mayPushAt({ ...day, hourLocal })).toBe(false);
  });

  it('never reaches a phone after eight in the evening', () => {
    for (const hourLocal of [20, 21, 23]) expect(mayPushAt({ ...day, hourLocal })).toBe(false);
  });

  it('reaches it in the hours between', () => {
    for (const hourLocal of [8, 12, 16, 19]) expect(mayPushAt({ ...day, hourLocal })).toBe(true);
  });

  it('goes quiet through school hours on a school day', () => {
    for (const hourLocal of [9, 11, 14]) {
      expect(mayPushAt({ hourLocal, schoolDay: true, localityKnown: true })).toBe(false);
    }
    expect(mayPushAt({ hourLocal: 16, schoolDay: true, localityKnown: true })).toBe(true);
  });

  it('sends nothing at all when we do not know where the learner is', () => {
    for (const hourLocal of [8, 12, 16, 19]) {
      expect(mayPushAt({ hourLocal, schoolDay: false, localityKnown: false })).toBe(false);
    }
  });
});

// --- rule 4: only three kinds, ever ----------------------------------------------------------------

describe('rule 4: only three kinds ever', () => {
  it('is exactly the three the law names', () => {
    expect([...PUSH_KINDS].sort()).toEqual([
      'doubt_answered',
      'left_half_done',
      'streak_ends_today',
    ]);
  });

  it('refuses everything the law forbids by name', () => {
    for (const never of [
      'product_news',
      'offer',
      'we_miss_you',
      'reengagement',
      'plan_upgrade',
      'streak_started',
    ]) {
      expect(isAPushKind(never)).toBe(false);
    }
  });

  it('knows the streak is the only reminder, and the other two are results', () => {
    expect(isReminder('streak_ends_today')).toBe(true);
    expect(isReminder('left_half_done')).toBe(false);
    expect(isReminder('doubt_answered')).toBe(false);
  });

  it('gives every kind its own dial, so a learner can switch one off without switching all off', () => {
    const dials = PUSH_KINDS.map((k) => DIAL_FOR[k]);
    expect(dials.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    expect(new Set(dials).size).toBe(PUSH_KINDS.length);
  });
});

// --- the inbox law it inherits ----------------------------------------------------------------------

describe('the inbox law is inherited exactly, and nothing here loosens it', () => {
  it('holds anything at all within twenty-four hours of the last message', () => {
    for (const kind of PUSH_KINDS) {
      expect(inboxLawAllows(kind, { messagedWithin24h: true, cameToday: false })).toBe(false);
    }
  });

  it('holds the one reminder on a day the learner came', () => {
    expect(inboxLawAllows('streak_ends_today', { messagedWithin24h: false, cameToday: true })).toBe(
      false,
    );
  });

  it('still delivers a result of the learner’s own asking on a day they came', () => {
    expect(inboxLawAllows('doubt_answered', { messagedWithin24h: false, cameToday: true })).toBe(
      true,
    );
  });
});

// --- the promise this wave actually keeps -------------------------------------------------------------

describe('push is not built, and this file is why it cannot ship by accident', () => {
  it('says so in one constant that everything else can read', () => {
    expect(PUSH_BUILT).toBe(false);
  });

  it('reaches no phone: nothing in it can request a permission or post a notification', () => {
    const source = readFileSync(join(import.meta.dir, 'push.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1 ');
    for (const wiring of [
      'Notification',
      'requestPermission',
      'serviceWorker',
      'showNotification',
      'PushManager',
      'pushManager',
      'getSubscription',
      'applicationServerKey',
      'fetch(',
    ]) {
      expect(source.includes(wiring), `push.ts must not reach for ${wiring}`).toBe(false);
    }
  });
});
