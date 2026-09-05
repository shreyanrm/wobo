/**
 * The control, as a screen reader and a keyboard meet it.
 *
 * There is no browser in this suite, so the panel is rendered to static markup and read as markup.
 * That is enough for everything a review of this control would actually check: that a child can
 * reach it without a pointer, that one tap finishes the job, that the words box is optional, and
 * that the panel never says a report was kept when it was not.
 *
 * The last block is the honesty law from the other side: the promise the help centre published is
 * "a quiet flag on every lesson, question, board and diagram", so the four surfaces are named here
 * and the mounting points are asserted against the real files. A control that exists but is
 * mounted on one screen keeps none of that sentence.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlagPanel } from './FlagControl';
import { FLAG_COPY, FLAG_REASONS } from './flag';

const HERE = import.meta.dir;
const noop = () => {};

const idle = () =>
  renderToStaticMarkup(
    <FlagPanel
      id="flag-panel"
      busy={false}
      outcome={null}
      note=""
      onNote={noop}
      onReason={noop}
      onClose={noop}
    />,
  );

describe('a child can reach it, and one tap is the whole job', () => {
  it('is a dialog with a name, so a screen reader says what opened', () => {
    const html = idle();
    expect(html).toContain('role="dialog"');
    expect(html).toContain(`aria-label="${FLAG_COPY.title}"`);
  });

  it('offers every reason as a real button, each of which sends on its own', () => {
    const html = idle();
    for (const reason of FLAG_REASONS) {
      expect(html).toContain(`data-flag-reason="${reason.code}"`);
      expect(html).toContain(reason.label.replace(/'/g, '&#x27;'));
    }
    // Six buttons and no seventh: no submit, no confirm, no "are you sure".
    expect([...html.matchAll(/<button/g)]).toHaveLength(FLAG_REASONS.length);
    expect(html.toLowerCase()).not.toContain('submit');
  });

  it('lets the words be left empty: no required, no minimum, nothing to fill in', () => {
    const html = idle();
    expect(html).toContain('<textarea');
    expect(html).not.toContain('required');
    expect(html).not.toContain('aria-required');
    expect(html).toContain(FLAG_COPY.invite.replace(/'/g, '&#x27;'));
  });

  it('never asks the child to explain themselves before it will listen', () => {
    expect(idle().toLowerCase()).not.toContain('why');
  });
});

describe('what it says once the desk has answered', () => {
  it('says thank you only over a report that actually landed', () => {
    const html = renderToStaticMarkup(
      <FlagPanel
        id="p"
        busy={false}
        outcome={{ sent: true, message: FLAG_COPY.thanks }}
        note=""
        onNote={noop}
        onReason={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('A person reads these.');
    expect(html).toContain('aria-live="polite"');
    // The reasons are gone: the child is not asked to report the same thing twice.
    expect(html).not.toContain('data-flag-reason');
  });

  it('says the failure in Wobo’s own words, and hands over the one mailbox', () => {
    const html = renderToStaticMarkup(
      <FlagPanel
        id="p"
        busy={false}
        outcome={{ sent: false, message: FLAG_COPY.trouble }}
        note=""
        onNote={noop}
        onReason={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('support@heywobo.com');
    expect(html.toLowerCase()).not.toContain('thank you');
  });

  it('holds the reasons still while one is in flight, so a double tap is not two reports', () => {
    const html = renderToStaticMarkup(
      <FlagPanel
        id="p"
        busy={true}
        outcome={null}
        note=""
        onNote={noop}
        onReason={noop}
        onClose={noop}
      />,
    );
    expect([...html.matchAll(/disabled/g)]).toHaveLength(FLAG_REASONS.length);
    expect(html).toContain(FLAG_COPY.sending);
  });
});

describe('the four surfaces the help centre named', () => {
  const read = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');

  it('is mounted in the frame every screen behind the door renders inside', () => {
    const frame = read('shell', 'AppFrame.tsx');
    expect(frame).toContain('<FlagControl');
    // Beside whatever the rail's bottom slot already holds, never instead of it: a lesson passes
    // its own `bottom`, and that must not take the flag away with it.
    expect(frame).toContain('bottom ?? (');
  });

  it('is mounted on the full board, which covers the frame', () => {
    expect(read('wobo', 'Stage.tsx')).toContain('placement="corner"');
  });

  it('learns which question is on screen from the practice screen itself', () => {
    const practice = read('screens', 'Practice.tsx');
    expect(practice).toContain("surface: 'question'");
    expect(practice).toContain('content_id: spec.id');
    // Through the frame's own prop rather than a wrapper, so the screen says it in one line and
    // the control stays in exactly one place.
    expect(practice).toMatch(/<AppFrame[^>]*about=/);
  });

  it('learns which lesson is on screen from the route, with no screen having to say so', async () => {
    const { aboutOfRoute } = await import('../shell/AppFrame');
    expect(aboutOfRoute({ name: 'course', topicId: 'math.frac.1' })).toEqual({
      surface: 'lesson',
      content_id: 'math.frac.1',
    });
    expect(aboutOfRoute({ name: 'home' })).toEqual({ surface: 'home' });
  });
});
