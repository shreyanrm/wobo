import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDestination } from '../src/shell/destinations';

/** Extract the resolved route name (or a tag) so a table stays readable. */
function outcome(text: string): string {
  const r = resolveDestination(text);
  if (r === null) return 'none';
  if ('unknown' in r) return 'unknown';
  const route = r.route;
  if (route.name === 'subject') return `subject:${route.subjectId}`;
  if (route.name === 'course') return `course:${route.topicId}`;
  return route.name;
}

describe('resolveDestination — Wobo navigates on command', () => {
  // Every one of these MUST navigate (a real Route), none is an approval-gated action card.
  const navigates: [string, string][] = [
    ['take me to practice', 'practice'],
    ['practice', 'practice'],
    ["let's practice", 'practice'],
    ['show me practice', 'practice'],
    ['navigate to practice', 'practice'],
    ['open practice', 'practice'],
    ['go home', 'home'],
    ['home screen', 'home'],
    ['take me home', 'home'],
    ['show my progress', 'progress'],
    ['my progress', 'progress'],
    ['bring me to progress', 'progress'],
    ['open my profile', 'you'],
    ['settings', 'you'],
    ['go to the library', 'learn'],
    ['open conversation', 'chat'],
    ['open the atom', 'course:m2-1'],
    ['open chemistry', 'subject:chemistry'],
    ['chemistry chapter', 'subject:chemistry'],
    ['take me to physics', 'subject:physics'],
  ];
  for (const [text, want] of navigates) {
    it(`navigates: "${text}" -> ${want}`, () => {
      expect(outcome(text)).toBe(want);
    });
  }

  // These are NOT navigation — they must fall through (null) so the classifier can make the
  // component/action/inline it deserves. A false navigation here would eat a quiz or a parent note.
  const notNav = [
    'explain chemistry bonding',
    'quiz me',
    'make me a sim',
    'prepare a parent note',
    'what is 2x + 3 = 7',
    'how does photosynthesis work',
  ];
  for (const text of notNav) {
    it(`not navigation: "${text}"`, () => {
      expect(outcome(text)).toBe('none');
    });
  }

  // A clear "take me to <somewhere>" that resolves to nothing — Wobo says so, never silence.
  it('unknown destination is spoken, never silent', () => {
    const r = resolveDestination('take me to narnia');
    expect(r && 'unknown' in r).toBe(true);
  });
});

/**
 * A nav intent must be answered from the device, before anything is asked of the gateway. On a 2G
 * link "take me to practice" spent a whole model round-trip reaching a route this table already
 * knew — and cost tokens to do it.
 */
describe('nav intents are resolved before the gateway round-trip', () => {
  // The turn lives in the app RUNTIME (src/AppRuntime.tsx) — the root above it is the public
  // site's door and holds no conversation at all.
  const app = readFileSync(join(import.meta.dir, '..', 'src', 'AppRuntime.tsx'), 'utf8');
  // The anchor is the signature's opening, not its whole parameter list: `ask` takes options now
  // (wobo/chat.tsx AskOptions), and a scan pinned to the old arity silently sliced to nothing.
  const askBody = app.slice(app.indexOf('const ask = async (text: string'));

  it('resolves the destination above the llm.invoke call in ask()', () => {
    const nav = askBody.indexOf('resolveDestination(text)');
    const invoke = askBody.indexOf("sdk.llm.invoke('wobo.turn'");
    expect(nav).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(-1);
    expect(nav).toBeLessThan(invoke);
  });

  it('returns early on a hit, so the turn never reaches the model', () => {
    const nav = askBody.indexOf('const nav = resolveDestination(text);');
    const invoke = askBody.indexOf("sdk.llm.invoke('wobo.turn'");
    expect(askBody.slice(nav, invoke)).toContain('return;');
  });

  it('resolves exactly one nav path — there is no second, later copy', () => {
    expect(app.split('resolveDestination(text)')).toHaveLength(2);
  });
});
