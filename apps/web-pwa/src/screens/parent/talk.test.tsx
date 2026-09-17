/**
 * The parent's ask and the parent's memory page (docs/TWO-MINDS.md), read as markup.
 *
 * What these hold: the thread is the parent's and Wobo's and nothing else; a fact Wobo hears is
 * offered to the parent first and passed on only on a yes, with the server's own note in between;
 * the memory page labels where every line came from and only offers what the parent said; a
 * screen with no child chosen says so in the server's words; and the words themselves keep the
 * register (docs/copy/voice.md 10a, DESIGN.md §0).
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { FORBIDDEN } from '../money-voice';
import { AskAboutChildView } from './AskAboutChild';
import { ParentMemoryView } from './ParentMemory';
import { TalkGate } from './TalkFrame';
import { TALK_COPY } from './talk-copy';

const noop = () => {};
const HERE = import.meta.dir;

function every(copy: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(copy)) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) out.push(...(v as string[]));
    else if (typeof v === 'function') {
      out.push((v as (n: string | null) => string)('Asha'));
      out.push((v as (n: string | null) => string)(null));
    }
  }
  return out;
}

const askBase = {
  childName: 'Asha',
  thread: [],
  draft: '',
  sending: false,
  line: null,
  flow: null,
  busy: false,
  onDraft: noop,
  onAsk: noop,
  onOfferPass: noop,
  onOfferNotNow: noop,
  onDecide: noop,
} as const;

describe('asking about the child', () => {
  it('offers three questions a parent actually asks when the thread is empty', () => {
    const html = renderToStaticMarkup(<AskAboutChildView {...askBase} />);
    expect(html).toContain('Ask about Asha');
    for (const q of TALK_COPY.askSuggestions) expect(html).toContain(q);
    expect(html).toContain('aria-label="Your question"');
  });

  it('shows the thread as the parent and Wobo, and nobody else', () => {
    const html = renderToStaticMarkup(
      <AskAboutChildView
        {...askBase}
        thread={[
          { role: 'parent', text: 'Is she ready for the test?', at: '' },
          { role: 'wobo', text: 'Asha worked on 4 of the last seven days.', at: '' },
        ]}
      />,
    );
    expect(html).toContain('Is she ready for the test?');
    expect(html).toContain('Asha worked on 4 of the last seven days.');
    expect(html.match(/data-role="parent"/g)?.length).toBe(1);
    expect(html.match(/data-role="wobo"/g)?.length).toBe(1);
    // With a thread, the suggestions step aside.
    expect(html).not.toContain(TALK_COPY.askSuggestions[0] as string);
  });

  it('asks the parent before passing anything on', () => {
    const html = renderToStaticMarkup(
      <AskAboutChildView
        {...askBase}
        flow={{ phase: 'suggested', body: 'she has a tutor on Tuesdays' }}
      />,
    );
    expect(html).toContain(TALK_COPY.offerAsk);
    expect(html).toContain('she has a tutor on Tuesdays');
    expect(html).toContain(TALK_COPY.offerPass);
    expect(html).toContain(TALK_COPY.offerNotNow);
    expect(html).not.toContain(TALK_COPY.offerYes);
  });

  it("puts the server's note in front of the yes", () => {
    const note =
      'If you pass this on, it goes into their own memory page marked as coming from you.';
    const html = renderToStaticMarkup(
      <AskAboutChildView
        {...askBase}
        flow={{ phase: 'staged', body: 'she has a tutor on Tuesdays', id: 'o1', note }}
      />,
    );
    expect(html).toContain(note);
    expect(html).toContain(TALK_COPY.offerYes);
    expect(html).toContain(TALK_COPY.offerKeep);
  });

  it('says plainly what happened after the yes or the no', () => {
    const passed = renderToStaticMarkup(
      <AskAboutChildView {...askBase} flow={{ phase: 'passed', body: 'x' }} />,
    );
    expect(passed).toContain(TALK_COPY.offerPassed('Asha'));
    const kept = renderToStaticMarkup(
      <AskAboutChildView {...askBase} flow={{ phase: 'kept', body: 'x' }} />,
    );
    expect(kept).toContain(TALK_COPY.offerKept);
  });

  it('carries a refusal line from the server as one calm line', () => {
    const html = renderToStaticMarkup(
      <AskAboutChildView {...askBase} line="I could not put that together just now." />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('I could not put that together just now.');
  });
});

const memBase = {
  childName: 'Asha',
  mind: {
    child: [
      { id: 'f1', body: 'she hates being rushed', source: 'parent' as const },
      { id: 'f2', body: 'fractions came up twice', source: 'report' as const },
    ],
    family: [{ id: 'f3', body: 'we move cities in the summer', source: 'parent' as const }],
  },
  offers: [],
  draft: '',
  scope: 'child' as const,
  sending: false,
  line: null,
  working: null,
  staged: null,
  onDraft: noop,
  onScope: noop,
  onRemember: noop,
  onForget: noop,
  onOfferFact: noop,
  onDecide: noop,
};

describe("the parent's memory page", () => {
  it('lists both layers and labels where each line came from', () => {
    const html = renderToStaticMarkup(<ParentMemoryView {...memBase} />);
    expect(html).toContain('About Asha');
    expect(html).toContain(TALK_COPY.aboutFamily);
    expect(html).toContain('she hates being rushed');
    expect(html).toContain('we move cities in the summer');
    expect(html).toContain(TALK_COPY.sourceParent);
    expect(html).toContain(TALK_COPY.sourceReport);
    expect(html.match(/>Forget</g)?.length).toBe(3);
  });

  it("offers only what the parent said about the child, never a report line or the family's", () => {
    const html = renderToStaticMarkup(<ParentMemoryView {...memBase} />);
    expect(html.match(/>Offer to Asha</g)?.length).toBe(1);
    expect(html).toMatch(/data-fact="f1"[\s\S]*?Offer to Asha/);
  });

  it('shows what was offered as a parent may know it', () => {
    const html = renderToStaticMarkup(
      <ParentMemoryView
        {...memBase}
        offers={[
          { id: 'o1', body: 'she has dyslexia', status: 'accepted' },
          { id: 'o2', body: 'she likes diagrams', status: 'withdrawn' },
        ]}
      />,
    );
    expect(html).toContain('Offered to Asha');
    expect(html).toContain(TALK_COPY.statusAccepted);
    expect(html).toContain(TALK_COPY.statusWithdrawn);
    expect([...html.matchAll(/data-status="([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      'accepted',
      'withdrawn',
    ]);
    const rows = [...html.matchAll(/<li class="pt-offer"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).not.toMatch(/removed|deleted|declined|rejected/i);
  });

  it('a staged offer waits for the yes, under the server note', () => {
    const html = renderToStaticMarkup(
      <ParentMemoryView
        {...memBase}
        offers={[{ id: 'o1', body: 'she has dyslexia', status: 'pending' }]}
        staged={{ id: 'o1', note: 'They can remove it whenever they like.' }}
      />,
    );
    expect(html).toContain('They can remove it whenever they like.');
    expect(html).toContain(TALK_COPY.offerYes);
    expect(html).toContain(TALK_COPY.offerKeep);
    expect(html).toContain(TALK_COPY.statusPending);
  });

  it('says so when there is nothing yet', () => {
    const html = renderToStaticMarkup(
      <ParentMemoryView {...memBase} mind={{ child: [], family: [] }} childName={null} />,
    );
    expect(html).toContain(TALK_COPY.emptyChild(null));
    expect(html).toContain(TALK_COPY.emptyFamily);
    expect(html).toContain('About your child');
  });
});

describe('the gate in front of both', () => {
  it("says why in the server's words and offers the way on", () => {
    const html = renderToStaticMarkup(
      <TalkGate
        code="no_child_selected"
        message="Choose which child this is about, and I will pick it up from there."
        onChoose={noop}
        onSignIn={noop}
      />,
    );
    expect(html).toContain('Choose which child this is about');
    expect(html).toContain(TALK_COPY.chooseChild);
    expect(html).not.toContain(TALK_COPY.signIn);
  });

  it('a signed-out visitor is sent to sign in', () => {
    const html = renderToStaticMarkup(
      <TalkGate code="sign_in_required" message="Sign in first." onChoose={noop} onSignIn={noop} />,
    );
    expect(html).toContain(TALK_COPY.signIn);
  });
});

describe('the words', () => {
  const lines = every(TALK_COPY as unknown as Record<string, unknown>);

  it('carry no dash a parent reads, no exclamation, and no late hour', () => {
    for (const line of lines) {
      expect([line, /[—–]/.test(line)]).toEqual([line, false]);
      expect([line, line.includes('!')]).toEqual([line, false]);
      expect([line, /\b(tonight|midnight|late at night|\d{1,2}\s?pm)\b/i.test(line)]).toEqual([
        line,
        false,
      ]);
    }
  });

  it('say nothing about money: that line lives in docs/copy/money.md and another screen', () => {
    for (const line of lines) {
      for (const word of [...FORBIDDEN, 'pay ', 'plan', '₹', 'price']) {
        expect([line, line.toLowerCase().includes(word.toLowerCase())]).toEqual([line, false]);
      }
    }
  });

  it('never invent a name for the child', () => {
    expect(TALK_COPY.askTitle(null)).toBe('Ask about your child');
    expect(TALK_COPY.offerPassed(null).startsWith('Passed on. Your child')).toBe(true);
  });
});

describe('the folder', () => {
  // This builder's files only: the parent shell's own files sit in the same folder and answer to
  // their own tests.
  const MINE = [
    'ask-wire.ts',
    'talk-copy.ts',
    'AskAboutChild.tsx',
    'ParentMemory.tsx',
    'TalkFrame.tsx',
  ];
  const sources = MINE.map((f) => [f, readFileSync(join(HERE, f), 'utf8')] as const);

  it('keeps nothing on the device: the record is the gateway (docs/MEMORY-LAW.md)', () => {
    for (const [file, text] of sources) {
      expect([file, /localStorage|sessionStorage|indexedDB/.test(text)]).toEqual([file, false]);
    }
  });

  it("never reaches for the child's side of anything", () => {
    for (const [file, text] of sources) {
      expect([file, /\/v1\/(me|mind|chat|threads?|boards?)\b/.test(text)]).toEqual([file, false]);
    }
  });

  it('owns its classes and paints no wash behind a surface (DESIGN.md §0)', () => {
    const css = readFileSync(join(HERE, 'parent-talk.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const classes = [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1] as string);
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) expect([c, c.startsWith('pt-')]).toEqual([c, true]);
    expect(css).not.toMatch(/var\(--[a-z]+-w\)/);
    expect(css).not.toMatch(/nowrap/);
  });
});

describe('the suggested questions fit any child', () => {
  // The first one was "How are they doing in fractions?" for every child, a Class 11 physics
  // learner included, and it showed before the server had said anything about their subjects.
  it('names no subject or topic', () => {
    for (const q of TALK_COPY.askSuggestions) {
      expect([
        q,
        /\b(fraction|algebra|physics|chemistry|biology|math|maths|science|english|history|geography)/i.test(
          q,
        ),
      ]).toEqual([q, false]);
    }
  });
});
