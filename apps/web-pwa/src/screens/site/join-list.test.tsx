/**
 * THE INVITATION, READ THE WAY A STRANGER AND A CRAWLER READ IT.
 *
 * `docs/DOORS-CLOSED.md` §3: where "Start free" stood, a person is asked for one thing — an email
 * address, and optionally their class and board. Two fields at most, the second optional. It says
 * plainly that Wobo is not open yet and that they will hear the day it is, and it never shows a
 * queue position, a countdown or a scarcity of any kind.
 *
 * This renders the panel to static markup — no browser, no JavaScript, no state — because that is
 * exactly what the 438 pre-rendered pages carry and what an answer engine reads off disk. Anything
 * this test cannot see is something a crawler cannot see either.
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LIST, LIST_PATH, SOURCE_PATH } from './invitation';
import { JoinList } from './JoinList';

const html = renderToStaticMarkup(<JoinList source="sign-up" />);
/** The words a reader sees, with the markup taken out. */
const words = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ');

describe('the invitation that stands where the door was', () => {
  it('is a real form a crawler can read with nothing running', () => {
    expect(html).toContain('<form');
    expect(html).toContain('method="post"');
    expect(html).toContain('type="submit"');
  });

  it('asks for an email, and for nothing else that is required', () => {
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => !tag.includes('type="hidden"'));
    expect(inputs).toHaveLength(2);
    const [email, where] = inputs as [string, string];
    expect(email).toContain('type="email"');
    expect(email).toContain('required');
    expect(where).not.toContain('required');
  });

  it('says the second field is optional in the words, not only in the markup', () => {
    expect(words.toLowerCase()).toContain('optional');
  });

  it('says plainly that Wobo is not open yet, and what happens next', () => {
    expect(words).toContain(LIST.title);
    expect(words.toLowerCase()).toContain('not open yet');
    expect(words).toContain(LIST.promise);
  });

  it('says in one line what it will be, and never lets drawing stand for the whole product', () => {
    expect(words).toContain(LIST.what);
    // voice.md §8.5: wherever a line says Wobo draws, a neighbouring word names another form
    expect(LIST.what).toMatch(/draws/i);
    expect(LIST.what).toMatch(/films|speaks|practises|simulates/i);
  });

  it('shows no queue, no countdown and no scarcity', () => {
    expect(words).not.toMatch(
      /\byou are number\b|\bposition\b|\bqueue\b|\bspots?\b|\bplaces? left\b/i,
    );
    expect(words).not.toMatch(
      /\bcoming soon\b|\bcountdown\b|\bonly \d+\b|\bhurry\b|\blast chance\b/i,
    );
    // no invented urgency of any kind, and never an exclamation (voice.md §3)
    expect(words).not.toContain('!');
  });

  it('reads in the register: no em dash where a person reads', () => {
    expect(words).not.toContain('—');
    for (const line of Object.values(LIST)) expect(line).not.toContain('—');
  });

  it('never offers to create an account, and asks for no password', () => {
    expect(html).not.toContain('type="password"');
    expect(words.toLowerCase()).not.toMatch(/sign up|create an account|start free|continue with/);
  });

  it('leaves the sign-in door open for anyone who already has an account', () => {
    expect(html).toContain('href="/sign-in"');
  });

  it('tells a child under 13 to ask a parent, and takes no address from them', () => {
    expect(words.toLowerCase()).toContain('parent');
    expect(LIST.emailHint).toMatch(/parent|guardian/i);
  });

  it('names no class and no grade, which would be a gate', () => {
    expect(words).not.toMatch(/\bclass(?:es)? \d/i);
    expect(words).not.toMatch(/\bgrades? \d/i);
    expect(words).not.toMatch(/\bages? \d/i);
  });

  it('says where the address came from, without asking the reader', () => {
    // As a PATH, which is the only form the list will keep. A page NAME is refused by the
    // gateway's own shape check, so the row would never have been written.
    expect(html).toContain(`value="${SOURCE_PATH['sign-up']}"`);
    expect(html).toContain('name="page"');
  });

  it('never strands a reader with nothing running on a page that is not ours', () => {
    // The submit is a cross-origin native post the list would answer with a raw 422 on another
    // hostname, with no header, no footer and no way back. With nothing running it is not there
    // to be pressed, and one address stands in its place.
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '';
    expect(noscript).toContain(`mailto:${LIST.supportEmail}`);
    expect(noscript).toMatch(/\.jl-form\s*\{[^}]*display\s*:\s*none/);
  });

  it('posts to the one address the gateway serves', () => {
    expect(html).toContain(`action="${LIST_PATH}"`);
  });
});
