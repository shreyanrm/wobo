/**
 * PROVING THE SITE IS OURS WITHOUT SHIPPING A LINE OF SOURCE.
 *
 * Search Console and Bing Webmaster Tools both verify ownership by asking for one file at the root
 * of the domain. The token in that file is not a secret, but it is not source either: it is issued
 * per property, it changes if the property is re-created, and the owner should not need a pull
 * request to paste one in. So the build reads both tokens out of the environment (`vercel env add`,
 * then redeploy) and writes the files itself.
 *
 * The tests below are mostly about the two ways this goes wrong: a token pasted in the wrong shape
 * (the whole filename, or the whole meta tag), and a token carrying characters that would let an
 * environment variable choose a path rather than a filename.
 */

import { describe, expect, it } from 'bun:test';
import {
  BING_ENV,
  BING_FILE,
  bingToken,
  GOOGLE_ENV,
  googleToken,
  verificationFiles,
} from './verification';

describe('the Google token, whatever shape it is pasted in', () => {
  it('takes the bare token', () => {
    expect(googleToken('abc123DEF456')).toBe('abc123DEF456');
  });

  it('takes the whole filename Search Console offers to download', () => {
    expect(googleToken('googleabc123DEF456.html')).toBe('abc123DEF456');
  });

  it('takes it with the surrounding whitespace a paste brings', () => {
    expect(googleToken('  googleabc123DEF456.html \n')).toBe('abc123DEF456');
  });

  it('is nothing at all when nothing is set', () => {
    expect(googleToken(undefined)).toBeNull();
    expect(googleToken('')).toBeNull();
    expect(googleToken('   ')).toBeNull();
  });

  it('refuses anything that could name a path rather than a file', () => {
    for (const bad of [
      '../../etc/passwd',
      'a/b',
      'tok en',
      'tok.en',
      '<meta name="x">',
      'a'.repeat(200),
    ])
      expect(() => googleToken(bad)).toThrow(/GOOGLE_SITE_VERIFICATION/);
  });
});

describe('the Bing token', () => {
  it('takes the bare token', () => {
    expect(bingToken('9F1B2C3D4E5F60718293A4B5C6D7E8F9')).toBe('9F1B2C3D4E5F60718293A4B5C6D7E8F9');
  });

  it('is nothing at all when nothing is set', () => {
    expect(bingToken(undefined)).toBeNull();
  });

  it('refuses a token carrying anything but letters and digits', () => {
    expect(() => bingToken('<user>x</user>')).toThrow(/BING_SITE_VERIFICATION/);
    expect(() => bingToken('a b')).toThrow(/BING_SITE_VERIFICATION/);
  });
});

describe('the files the build writes', () => {
  it('writes nothing when neither token is set, and says nothing about it', () => {
    expect(verificationFiles({})).toEqual([]);
  });

  it('writes the file Search Console asks for, named after its own token', () => {
    const files = verificationFiles({ [GOOGLE_ENV]: 'abc123DEF456' });
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('googleabc123DEF456.html');
    expect(files[0]?.contents.trim()).toBe('google-site-verification: googleabc123DEF456.html');
  });

  it('writes the file Bing asks for, with the token inside it', () => {
    const files = verificationFiles({ [BING_ENV]: 'ABC123' });
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe(BING_FILE);
    expect(files[0]?.contents).toContain('<user>ABC123</user>');
    expect(files[0]?.contents.startsWith('<?xml')).toBe(true);
  });

  it('writes both when both are set, each one file', () => {
    const files = verificationFiles({ [GOOGLE_ENV]: 'abc123', [BING_ENV]: 'ABC123' });
    expect(files.map((f) => f.name).sort()).toEqual(['BingSiteAuth.xml', 'googleabc123.html']);
    expect(new Set(files.map((f) => f.name)).size).toBe(2);
  });

  it('never writes a name with a slash in it', () => {
    for (const file of verificationFiles({ [GOOGLE_ENV]: 'abc123', [BING_ENV]: 'ABC123' })) {
      expect(file.name).not.toContain('/');
      expect(file.name).not.toContain('..');
    }
  });

  it('says what each file is for, so a stray file in dist is never a mystery', () => {
    for (const file of verificationFiles({ [GOOGLE_ENV]: 'abc123', [BING_ENV]: 'ABC123' })) {
      expect(file.why.length).toBeGreaterThan(20);
    }
  });
});

/**
 * A TOKEN THAT IS OBVIOUSLY AN EXAMPLE PROVES NOTHING, AND PUBLISHING IT IS WORSE THAN SILENCE.
 *
 * `dist` shipped `googletest0123abcdef.html` and a `BingSiteAuth.xml` reading
 * `<user>ABCDEF0123456789</user>` — the dummy values somebody exported while proving the mechanism
 * worked. Both passed every check here, because both are letters and digits. A file like that at
 * the root of the domain tells a console the wrong thing, never verifies, and leaves the owner
 * waiting on a verification that cannot pass. The build should stop and name the variable, which
 * is what it already does for a malformed one.
 */
describe('a placeholder is not a token', () => {
  it('refuses the values a walkthrough hands you, and says which variable to fix', () => {
    for (const raw of [
      'test0123abcdef',
      'googletest0123abcdef.html',
      'ABCDEF0123456789',
      'abcdef123456',
      'example-token',
      'your-token-here',
      'changeme',
    ]) {
      expect(() => verificationFiles({ [GOOGLE_ENV]: raw })).toThrow(GOOGLE_ENV);
    }
  });

  it('leaves a real token alone', () => {
    const files = verificationFiles({
      [GOOGLE_ENV]: 'HkP2qv9XmR4tLb7Zc1Nw',
      [BING_ENV]: '9F3A71C0D48E2B65',
    });
    expect(files.map((f) => f.name)).toEqual(['googleHkP2qv9XmR4tLb7Zc1Nw.html', BING_FILE]);
  });
});
