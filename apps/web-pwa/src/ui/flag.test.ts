/**
 * The quiet flag, held to the four things it promised.
 *
 * The failure this file exists to prevent is not a crash. It is a control that LOOKS like it
 * worked: a child taps "this upset me", reads a thank-you, and nothing ever left the device. So
 * every case below is about what the child is TOLD, and the honest failure is tested as carefully
 * as the success.
 *
 * The first block is the one that cannot drift: the six reason codes are read out of
 * `services/gateway/src/wobo_gateway/reports.py` at test time and compared to the six the control
 * sends. A seventh reason invented on either side of the wire fails here rather than at a child's
 * thumb, where it would arrive as "I do not know that reason" over a report nobody ever reads.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aboutOf, FLAG_COPY, FLAG_PATH, FLAG_REASONS, raiseFlag } from './flag';

const REPO = new URL('../../../../', import.meta.url).pathname;
const REPORTS_PY = join(REPO, 'services', 'gateway', 'src', 'wobo_gateway', 'reports.py');

/** One recorded call, and the answer it was given. */
function fakeGateway(answer: { status?: number; body?: unknown; throws?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (answer.throws) throw new TypeError('Failed to fetch');
    const status = answer.status ?? 200;
    return new Response(JSON.stringify(answer.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const bodyOf = (i = 0) => JSON.parse(String(calls[i]?.init.body ?? '{}'));
  return { calls, fetcher, bodyOf };
}

describe('the control and the desk agree about what a reason is', () => {
  it('sends exactly the six codes the gateway will accept', () => {
    const py = readFileSync(REPORTS_PY, 'utf8');
    const line = py.match(/"flag":\s*\(([^)]*)\)/);
    expect(
      line,
      'reports.REASONS["flag"] should still be a tuple of string literals',
    ).not.toBeNull();
    const codes = [...(line?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBe(6);
    expect(FLAG_REASONS.map((r) => r.code)).toEqual(codes as string[]);
  });

  it('gives every code a sentence a child would actually say, never the code itself', () => {
    for (const reason of FLAG_REASONS) {
      expect(reason.label.includes('_')).toBe(false);
      expect(reason.label.toLowerCase()).not.toBe(reason.code);
      expect(reason.label.length).toBeGreaterThan(8);
    }
  });
});

describe('a tap is enough', () => {
  it('posts the reason on its own when the child typed nothing', async () => {
    const gate = fakeGateway({ body: { id: 'r1', urgent: true, message: 'Thank you.' } });
    const out = await raiseFlag(
      { reason: 'upsetting' },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect(gate.calls[0]?.url).toBe(`https://brain.example${FLAG_PATH}`);
    expect(gate.calls[0]?.init.method).toBe('POST');
    expect(gate.bodyOf()).toEqual({ reason: 'upsetting' });
    expect(out).toEqual({ sent: true, message: 'Thank you.' });
  });

  it('never sends an empty note as if it were words', async () => {
    const gate = fakeGateway();
    await raiseFlag(
      { reason: 'wrong', note: '   \n  ' },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect('note' in gate.bodyOf()).toBe(false);
  });

  it('keeps the words exactly as the child typed them when there are some', async () => {
    const gate = fakeGateway();
    await raiseFlag(
      { reason: 'confusing', note: '  the second step is not explained  ' },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect(gate.bodyOf().note).toBe('the second step is not explained');
  });
});

describe('what rides along, and what cannot', () => {
  it('carries the pointers at what was on screen', () => {
    expect(aboutOf({ surface: 'lesson', content_id: 'math.frac.1', subject: 'math' })).toEqual({
      surface: 'lesson',
      content_id: 'math.frac.1',
      subject: 'math',
    });
  });

  it('repairs a pointer the desk would otherwise drop on the floor', () => {
    // The gateway refuses a value outside its character set, silently. A lesson id with a comma in
    // it would arrive as a row with no lesson on it, which is a flag nobody can act on.
    expect(aboutOf({ content_id: 'chapter 3, part 2' })).toEqual({
      content_id: 'chapter 3- part 2',
    });
  });

  it('drops a pointer the repair would turn into rubbish, rather than sending the rubbish', () => {
    // A board's own title: every superscript and the equals sign fall outside the desk's character
    // set, and "a- - b- - c-" points at nothing. Saying less beats filling a desk with noise.
    expect(aboutOf({ surface: 'board', content_id: 'a² + b² = c²' })).toEqual({ surface: 'board' });
    // A title that survives the repair still rides along.
    expect(aboutOf({ content_id: 'Fractions, part 2' })).toEqual({
      content_id: 'Fractions- part 2',
    });
  });

  it('drops anything that is not a pointer, so a learner’s work cannot ride along', () => {
    const about = { surface: 'board', answer: 'my working out', note: 'private' } as never;
    expect(aboutOf(about)).toEqual({ surface: 'board' });
  });

  it('sends no about at all rather than an empty one', async () => {
    const gate = fakeGateway();
    await raiseFlag(
      { reason: 'other', about: {} },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect('about' in gate.bodyOf()).toBe(false);
  });
});

describe('it never says thank you for a report nobody has', () => {
  it('passes the brain’s own refusal through, and says the report did not land', async () => {
    const gate = fakeGateway({
      status: 429,
      body: { detail: { code: 'enough_for_today', message: 'You have sent me a lot today.' } },
    });
    const out = await raiseFlag(
      { reason: 'wrong' },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect(out.sent).toBe(false);
    expect(out.message).toBe('You have sent me a lot today.');
  });

  it('says so plainly when the network is gone, and never throws at the child', async () => {
    const gate = fakeGateway({ throws: true });
    const out = await raiseFlag(
      { reason: 'unsafe' },
      { gatewayUrl: 'https://brain.example', fetcher: gate.fetcher },
    );
    expect(out).toEqual({ sent: false, message: FLAG_COPY.trouble });
    expect(out.message).toContain('support@heywobo.com');
  });

  it('says so when there is no brain configured at all, rather than swallowing the report', async () => {
    const gate = fakeGateway();
    const out = await raiseFlag({ reason: 'wrong' }, { gatewayUrl: '', fetcher: gate.fetcher });
    expect(out).toEqual({ sent: false, message: FLAG_COPY.trouble });
    expect(gate.calls).toHaveLength(0);
  });
});

describe('the words it says are only the ones that are true', () => {
  it('promises nothing that is not built: no number, no time, no message back, no score', () => {
    const all = Object.values(FLAG_COPY).join(' ').toLowerCase();
    for (const forbidden of [
      'case number',
      'reference',
      'ticket',
      'within',
      'hours',
      'we will get back',
      'priority',
      'score',
      'ranked',
      'filed',
    ]) {
      expect(all.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('never asks a child to justify themselves', () => {
    expect(FLAG_COPY.invite.toLowerCase()).toContain('do not have to');
    const all = Object.values(FLAG_COPY).join(' ').toLowerCase();
    expect(all.includes('why')).toBe(false);
    expect(all.includes('required')).toBe(false);
  });

  it('keeps the one mailbox and the house style', () => {
    const all = Object.values(FLAG_COPY).join(' ');
    expect(all).not.toContain('—');
    expect(all).not.toContain('!');
    expect([...all.matchAll(/[\w.]+@[\w.]+/g)].map((m) => m[0])).toEqual(['support@heywobo.com']);
  });
});
