import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chosenNames, parseMailPrefs } from './mailPrefs';
import {
  END_FAILED,
  endParentLink,
  inviteParent,
  looksLikeEmail,
  PHONE_LINK_LINE,
  parseStatus,
  phoneLink,
  readParentLink,
  refusalMessage,
} from './parentLink';

const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as never;

describe('the parent link seam', () => {
  it('reads the status the server wrote, line and all', async () => {
    const got = await readParentLink(
      'https://brain',
      reply(200, { status: 'invited', parent_email: 'a***@x.in', line: 'Invite sent.' }),
    );
    expect(got).toEqual({
      status: 'invited',
      parent_email: 'a***@x.in',
      revoked_by: null,
      line: 'Invite sent.',
    });
  });
  it('answers null with no gateway, and on a body that is not a status', async () => {
    expect(await readParentLink(undefined)).toBeNull();
    expect(await readParentLink('https://brain', reply(200, { hello: 1 }))).toBeNull();
    expect(parseStatus({ status: 'odd', line: 'x' })).toBeNull();
  });
  it('carries a refusal in the server’s own words', async () => {
    const got = await inviteParent(
      { email: 'p@x.in' },
      'https://brain',
      reply(409, { detail: { code: 'link_active', message: 'A parent is already linked.' } }),
    );
    expect(got).toEqual({ ok: false, message: 'A parent is already linked.' });
    expect(refusalMessage({ detail: [{ loc: ['email'] }] })).toBe(
      'I could not send that just now. Try again in a moment.',
    );
  });
  it('reports a sent invite', async () => {
    const got = await inviteParent(
      { email: 'p@x.in', learnerName: 'the learner' },
      'https://brain',
      reply(200, { status: 'invited', line: 'Invite sent to p***@x.in.', sent: true }),
    );
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.status.status).toBe('invited');
  });
  it('tells an email from a phone number', () => {
    expect(looksLikeEmail('mum@example.com')).toBe(true);
    expect(looksLikeEmail('+91 98765 43210')).toBe(false);
  });
});

/**
 * ENDING A LINK THAT WAS NOT ENDED.
 *
 * `endParentLink` answered `null` for a refusal, for a network that never replied and for a build
 * with no gateway alike, and the You screen read every one of them as "gone": the card went
 * straight from "Linked to a***@example.com" to "not linked yet" while the server still held the
 * link and still sent that address the Sunday note every week. A write is a thing a learner is
 * told happened, so it answers an outcome now, and only `{ ok: true }` may move the card.
 */
describe('ending the link says what actually happened', () => {
  it('is a refusal, in the server’s own words, on a 503', async () => {
    const got = await endParentLink(
      'https://brain',
      reply(503, { detail: { code: 'store_unavailable', message: 'I could not reach that.' } }),
    );
    expect(got).toEqual({ ok: false, message: 'I could not reach that.' });
  });

  it('is a refusal with no gateway, and on a refusal that carried no words of ours', async () => {
    expect(await endParentLink(undefined)).toEqual({ ok: false, message: END_FAILED });
    expect(await endParentLink('https://brain', reply(500, { oops: 1 }))).toEqual({
      ok: false,
      message: END_FAILED,
    });
  });

  it('is only gone when the server said so, and carries the state it said', async () => {
    const got = await endParentLink(
      'https://brain',
      reply(200, { status: 'none', line: 'No parent linked.' }),
    );
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.status?.status).toBe('none');
  });

  it('the screen keeps the card, and says one line, on anything but ok', () => {
    // The panel two cards below has always done this ("That did not go through, so your plan has
    // not changed"); the parent card is held to the same shape here, in the source it renders.
    const you = readFileSync(join(import.meta.dir, '..', 'You.tsx'), 'utf8');
    expect(you).toContain('if (!got.ok) {');
    expect(you).toContain('setLinkNote(got.message);');
    // and the removal of the device key is INSIDE the success branch, never beside the call
    expect(you).toMatch(/setLink\(got\.status[\s\S]{0,120}scoped\.removeItem\(PARENT_KEY\)/);
  });
});

/**
 * THE PHONE LINK PROMISES NOTHING NOBODY SENDS. It used to read "they'll receive the weekly note
 * on WhatsApp when we go live": no code in the repository sends a WhatsApp message — the gateway's
 * only parent channel is email — and "when we go live" dates the product to a launch that has
 * already happened.
 */
describe('the device-only phone link', () => {
  it('says the note goes by email, promises no other channel, and dates nothing', () => {
    const status = phoneLink('+91 98765 43210');
    expect(status.local).toBe(true);
    expect(status.line).toContain('+91 98765 43210');
    expect(status.line).toContain(PHONE_LINK_LINE);
    expect(status.line).not.toMatch(/whatsapp|go live/i);
    expect(status.line).not.toContain('\u2014');
  });

  it('is written once, and read by both the invite form and the You screen', () => {
    const here = import.meta.dir;
    const invite = readFileSync(join(here, 'ParentInvite.tsx'), 'utf8');
    const you = readFileSync(join(here, '..', 'You.tsx'), 'utf8');
    expect(invite).toContain('onDone(phoneLink(raw))');
    expect(you).toContain('phoneLink(phone)');
    // Neither screen builds a line of its own any more, and the promise both used to carry is
    // gone from both. (The analytics event still records `channel: 'whatsapp'`; that enum lives
    // in `packages/contracts` and nobody reads it out loud.)
    for (const source of [invite, you]) {
      expect(source).not.toContain('weekly note on WhatsApp');
      expect(source).not.toContain('when we go live');
    }
  });
});

describe('the festival calendars', () => {
  it('reads the chosen calendars by name', () => {
    const view = parseMailPrefs({
      preferences: { festival_calendar: ['hindu', 'tamil'] },
      calendars: [
        { id: 'hindu', name: 'Hindu festivals' },
        { id: 'tamil', name: 'Tamil festivals', community: true },
      ],
      about_calendars: 'One line.',
    });
    expect(chosenNames(view)).toBe('Hindu festivals, Tamil festivals');
    expect(view?.calendars[1]?.community).toBe(true);
    expect(chosenNames(parseMailPrefs({ preferences: {}, calendars: [] }))).toBeNull();
  });
});
