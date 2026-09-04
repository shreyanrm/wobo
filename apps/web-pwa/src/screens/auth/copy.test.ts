import { describe, expect, it } from 'bun:test';
import * as copy from './copy';

/** Every string on these pages, flattened, with the key it came from for a readable failure. */
function everyLine(): [string, string][] {
  const lines: [string, string][] = [];
  const walk = (path: string, value: unknown) => {
    if (typeof value === 'string') lines.push([path, value]);
    else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        walk(`${path}[${i}]`, v);
      });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(path ? `${path}.${k}` : k, v);
    }
  };
  walk('', copy);
  // Hrefs are addresses, not prose, and are asserted separately below.
  return lines.filter(([path]) => !path.endsWith('Href'));
}

const LINES = everyLine();

describe('the voice laws, over every word on these pages', () => {
  it('never raises its voice', () => {
    for (const [path, line] of LINES) {
      expect([path, line.includes('!')]).toEqual([path, false]);
    }
  });

  it('carries no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [path, line] of LINES) {
      expect([path, emoji.test(line)]).toEqual([path, false]);
    }
  });

  it('never gives Wobo a gender', () => {
    // WOBO-PLAN §19, and the CI gate that enforces it: no gendered pronoun near the name.
    const gendered = /\b(she|her|hers|herself|he|him|his|himself)\b/i;
    for (const [path, line] of LINES) {
      if (!/wobo/i.test(line)) continue;
      expect([path, gendered.test(line)]).toEqual([path, false]);
    }
  });

  it('names no vendor, no model and no framework', () => {
    // voice.md §7. Google and Apple are the ACCOUNT a learner already has, which is why the two
    // door labels are the only place either word may appear.
    const vendors = /\b(openai|gpt|gemini|claude|anthropic|supabase|vercel|railway|llm|model)\b/i;
    for (const [path, line] of LINES) {
      expect([path, vendors.test(line)]).toEqual([path, false]);
    }
    const providerWords = LINES.filter(([, line]) => /\b(google|apple)\b/i.test(line));
    expect(providerWords.map(([path]) => path).sort()).toEqual(['METHODS.apple', 'METHODS.google']);
  });

  it('is written in sentence case, not title case', () => {
    const NAMES = ['Wobo', 'Google', 'Apple'];
    for (const [path, line] of LINES) {
      // Each sentence gets its own first word; anything else capitalised is either a name or the
      // title case DESIGN.md forbids.
      const stray = line
        .split(/(?<=[.?])\s+/)
        .flatMap((sentence) =>
          sentence
            .split(/\s+/)
            .filter((w) => /^[A-Za-z]{4,}$/.test(w))
            .slice(1),
        )
        .filter((w) => /^[A-Z]/.test(w) && !NAMES.includes(w));
      expect([path, stray]).toEqual([path, []]);
    }
  });

  it('avoids the words voice.md rules out', () => {
    const banned = /\b(oops|uh-oh|seamless|supercharge|unlock your potential|leverage|users)\b/i;
    for (const [path, line] of LINES) {
      expect([path, banned.test(line)]).toEqual([path, false]);
    }
  });
});

describe('the promises these pages make', () => {
  it('links the two legal pages it names, and links them by address', () => {
    expect(copy.CONSENT.termsHref.startsWith('/legal/')).toBe(true);
    expect(copy.CONSENT.privacyHref.startsWith('/legal/')).toBe(true);
    expect(copy.CONSENT.terms).toBe('terms of service');
    expect(copy.CONSENT.privacy).toBe('privacy policy');
  });

  it('tells a learner that lessons work with or without a parent’s consent', () => {
    // parental-consent.md, in plain words: consent switches on memory, voice, photographs and
    // sharing, not the teaching.
    expect(copy.PARENT.learning).toMatch(/lessons work either way/i);
    expect(copy.PARENT.body).toMatch(/nothing is ticked already/i);
  });

  it('says an unwired door is unwired, in one line, without alarm', () => {
    expect(copy.NOT_WIRED.split('.').filter(Boolean).length).toBe(1);
    expect(copy.NOT_WIRED).not.toMatch(/error|failed|sorry/i);
  });

  it('greets a new visitor on the door that makes an account, instead of sending them away', () => {
    // The sign-up headline briefly read "Sign in so everything stays with you." — the instruction
    // the OTHER door exists for, on the largest line of this one, two inches from a bar link that
    // already says "Already have an account? Sign in".
    expect(copy.SIGN_UP.title.toLowerCase()).not.toContain('sign in');
    expect(copy.SIGN_UP.title).not.toBe(copy.SIGN_IN.title);
    // and the headline still says what the door is for
    expect(copy.SIGN_UP.title.length > 15).toBe(true);
  });

  it('gives the contact page a real address rather than a form that goes nowhere', () => {
    expect(copy.CONTACT.address).toContain('@');
    expect(copy.CONTACT.mailtoNote).toMatch(/your own email app/i);
  });

  it('has one honest line for every failure a learner can meet here', () => {
    for (const [key, line] of Object.entries(copy.ERRORS)) {
      expect([key, line.length > 20]).toEqual([key, true]);
      expect([key, /^[A-Z]/.test(line)]).toEqual([key, true]);
      expect([key, line.trimEnd().endsWith('.')]).toEqual([key, true]);
    }
  });
});
