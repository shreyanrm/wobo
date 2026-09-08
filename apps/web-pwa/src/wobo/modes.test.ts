import { describe, expect, it } from 'bun:test';
import {
  availableModes,
  MODE_BY_ID,
  MODES,
  modeDraws,
  modeFromText,
  modePrompt,
  type WoboModeId,
} from './modes';

describe("Wobo's modes", () => {
  it('are the nine a learner asks a tutor for, each reachable by id', () => {
    expect(MODES).toHaveLength(9);
    for (const mode of MODES) expect(MODE_BY_ID[mode.id]).toBe(mode);
  });

  it('are named in sentence case, with no emoji and no exclamation marks', () => {
    for (const mode of MODES) {
      expect(mode.label).not.toMatch(/[!]/);
      expect(mode.hint).not.toMatch(/[!]/);
      // eslint-disable-next-line no-control-regex — the point is that only plain text is allowed
      expect(mode.label).toMatch(/^[A-Z][a-z]/);
      expect(mode.label.slice(1)).toBe(mode.label.slice(1).replace(/[A-Z]{2,}/g, ''));
    }
  });

  it('never narrate a role: no label or hint says what part Wobo plays (DESIGN.md §0.x)', () => {
    for (const mode of MODES) {
      for (const line of [mode.label, mode.hint]) {
        expect(line).not.toMatch(/\bWobo (?:is|plays) the\b/);
        expect(line).not.toMatch(/\bI(?:'ll| will) (?:draw|show|find|be)\b/);
        expect(line).not.toContain('—');
      }
    }
  });
});

describe('reading a mode out of what the learner said', () => {
  it('hears each mode in the words a child would use', () => {
    expect(modeFromText('why is this wrong')).toBe('why_wrong');
    expect(modeFromText('check my working please')).toBe('check_my_work');
    expect(modeFromText('quiz me on this')).toBe('quiz_me');
    expect(modeFromText('show me where the continue button is')).toBe('show_me');
    expect(modeFromText('just do it for me')).toBe('do_it');
    expect(modeFromText('say it in my world')).toBe('my_world');
    expect(modeFromText('read it out loud')).toBe('read_aloud');
    expect(modeFromText('let me teach it back')).toBe('teach_back');
    expect(modeFromText('explain this')).toBe('explain_this');
  });

  it('prefers the more specific mode when two could match', () => {
    // "check my work" also contains "do it"-ish words; the specific reading wins.
    expect(modeFromText('check my answer, is this right')).toBe('check_my_work');
    expect(modeFromText('why is my answer wrong')).toBe('why_wrong');
  });

  it('says nothing about an ordinary question', () => {
    expect(modeFromText('what is a mole')).toBeNull();
    expect(modeFromText('   ')).toBeNull();
  });
});

describe('the phrase a mode asks with', () => {
  it('names what is in hand for the modes that need it', () => {
    expect(modePrompt('explain_this', '2x + 3 = 11')).toBe('explain this: “2x + 3 = 11”');
  });
  it('leaves the modes that do not need a focus alone', () => {
    expect(modePrompt('quiz_me', '2x + 3 = 11')).toBe('quiz me on this');
  });
  it('clips a very long focus rather than sending the page', () => {
    const long = 'x'.repeat(400);
    const prompt = modePrompt('check_my_work', long);
    expect(prompt.length).toBeLessThan(200);
    expect(prompt.endsWith('…”')).toBe(true);
  });
  it('is unchanged when there is nothing in hand', () => {
    expect(modePrompt('explain_this')).toBe('explain this');
    expect(modePrompt('explain_this', '   ')).toBe('explain this');
  });
});

describe('which modes are worth offering', () => {
  it('hides the ones that cannot work with nothing in hand', () => {
    const ids = availableModes({ hasFocus: false, onLesson: true }).map((m) => m.id);
    expect(ids).not.toContain('explain_this');
    expect(ids).not.toContain('check_my_work');
    expect(ids).toContain('quiz_me');
  });
  it('offers them all once the learner has pointed at something in a lesson', () => {
    const ids = availableModes({ hasFocus: true, onLesson: true }).map((m) => m.id);
    expect(ids).toHaveLength(MODES.length);
  });
  it('does not offer teach-back where there is nothing to teach', () => {
    const ids = availableModes({ hasFocus: true, onLesson: false }).map((m) => m.id);
    expect(ids).not.toContain('teach_back');
  });
});

describe('can this mode draw on this turn (wave 29, board-7)', () => {
  const needsHand = (Object.keys(MODE_BY_ID) as WoboModeId[]).filter(
    (id) => MODE_BY_ID[id].draws && MODE_BY_ID[id].needsFocus,
  );
  const emptyHand = (Object.keys(MODE_BY_ID) as WoboModeId[]).filter(
    (id) => MODE_BY_ID[id].draws && !MODE_BY_ID[id].needsFocus,
  );
  it('quiz_me is the drawing mode offered with an empty hand, and it draws without one', () => {
    expect(emptyHand).toContain('quiz_me');
    expect(modeDraws('quiz_me', false)).toBe(true);
    expect(modeDraws('quiz_me', true)).toBe(true);
  });
  it('a mode that needs something in hand draws only with it', () => {
    expect(needsHand.length).toBeGreaterThan(0);
    for (const id of needsHand) {
      expect(modeDraws(id, false)).toBe(false);
      expect(modeDraws(id, true)).toBe(true);
    }
  });
  it('no mode is no drawing', () => {
    expect(modeDraws(null, true)).toBe(false);
    expect(modeDraws(undefined, true)).toBe(false);
  });
});
