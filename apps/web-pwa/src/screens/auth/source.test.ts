import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rememberSignInSource, SIGNIN_SOURCE_KEY, signInSourceOf } from './source';

describe('how somebody signed in is written down', () => {
  it('uses the very key the root reads on the next boot', () => {
    const app = readFileSync(join(import.meta.dir, '..', '..', 'App.tsx'), 'utf8');
    expect(app).toContain(`export const SIGNIN_SOURCE_KEY = '${SIGNIN_SOURCE_KEY}';`);
  });

  it('names the sources the boot understands', () => {
    expect(signInSourceOf('google')).toBe('google');
    expect(signInSourceOf('phone')).toBe('phone');
    expect(signInSourceOf('magicLink')).toBe('email');
  });

  it('writes Apple down as Apple, never as Google', () => {
    // Apple is a `soon` chip today, so this never fired; the day it is wired, every Apple sign-in
    // was going to be recorded as a Google one.
    expect(signInSourceOf('apple')).toBe('apple');
    // and the boot that reads it counts a provider, whichever one, as a linked identity
    const runtime = readFileSync(join(import.meta.dir, '..', '..', 'AppRuntime.tsx'), 'utf8');
    expect(runtime).toContain("source === 'google' || source === 'apple' ? 'linked'");
  });

  it('writes the source, and swallows a storage that throws', () => {
    const data = new Map<string, string>();
    rememberSignInSource('phone', { setItem: (k, v) => void data.set(k, v) });
    expect(data.get(SIGNIN_SOURCE_KEY)).toBe('phone');
    expect(() =>
      rememberSignInSource('google', {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
    expect(() => rememberSignInSource('google', null)).not.toThrow();
  });
});
