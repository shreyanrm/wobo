/**
 * PROVING THE DOMAIN IS OURS, WITHOUT SHIPPING A LINE OF SOURCE TO DO IT.
 *
 * Search Console is where the owner will read whether any of the 61 newly readable pages have been
 * crawled, what "wobo" ranks for in India, and whether a knowledge panel has appeared. Bing
 * Webmaster Tools is the same instrument for the index that ChatGPT's browsing sits on. Both
 * verify ownership the same way: they issue a token, and they ask for one file at the root of the
 * domain carrying it.
 *
 * That token is not a secret, but it is not source either. It is issued per property, it changes
 * if a property is deleted and re-made, and the owner should not have to open a pull request to
 * paste one in. So it is read from the build environment: `vercel env add GOOGLE_SITE_VERIFICATION`
 * (and `BING_SITE_VERIFICATION`), redeploy, and the file appears at the root. No token set means
 * no file written and nothing said about it, which is the correct behaviour on a preview build and
 * on a laptop.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT.
 *
 *  · The shape a token is pasted in. Search Console offers a file called `google<token>.html` for
 *    download, and the natural thing to paste is that whole filename. Both shapes are accepted and
 *    normalised to the token.
 *  · The characters in it. The Google token becomes part of a FILENAME, so a value carrying a
 *    slash or a `..` would let an environment variable choose where the build writes. Anything
 *    outside letters, digits, `_` and `-` is refused with the variable named, loudly, rather than
 *    quietly skipped: a malformed token means the owner is waiting on a verification that will
 *    never pass.
 *
 * No React and no app imports: the build script and the tests are the only readers.
 */

/** The environment variables the owner sets on the host. Named here so nothing else spells them. */
export const GOOGLE_ENV = 'GOOGLE_SITE_VERIFICATION';
export const BING_ENV = 'BING_SITE_VERIFICATION';

/** The one filename Bing asks for. Google's is named after its own token. */
export const BING_FILE = 'BingSiteAuth.xml';

/** A token may be letters, digits, underscore and hyphen, and nothing else. */
const TOKEN = /^[A-Za-z0-9_-]{4,128}$/;
/** Bing's are hexadecimal in practice; letters and digits is the honest bound. */
const BING_TOKEN = /^[A-Za-z0-9]{4,128}$/;

export interface VerificationFile {
  /** The name it is written under, at the root of the site. Never a path. */
  name: string;
  contents: string;
  /** What it is for, so a stray file in `dist` is never a mystery. */
  why: string;
}

/**
 * VALUES THAT ARE EXAMPLES RATHER THAN TOKENS.
 *
 * `dist` shipped `googletest0123abcdef.html` and a `BingSiteAuth.xml` holding
 * `<user>ABCDEF0123456789</user>`: the dummy values somebody exported while proving the mechanism
 * worked. Both are letters and digits, so both passed every check above. A file like that at the
 * root of the domain is not a harmless leftover — it tells a console the wrong thing, it never
 * verifies, and the owner waits on a verification that cannot pass. A build that would publish one
 * stops instead, and names the variable to fix, exactly as it does for a malformed value.
 *
 * The shapes are the ones a walkthrough actually hands you: a word that says it is a stand-in, and
 * a run of the alphabet or the digits in their own order.
 */
const PLACEHOLDERS: readonly RegExp[] = [
  /^(test|example|sample|dummy|placeholder|changeme|todo|your)\b/i,
  /^(test|example|sample|dummy|placeholder|changeme|todo|your)[-_]?/i,
  /abcdef/i,
  /^0*123456/,
  /^[0-9a-f]{0,4}0123456789/i,
];

/** Is this an example somebody pasted rather than a token a console issued? */
export function isPlaceholder(token: string): boolean {
  return PLACEHOLDERS.some((shape) => shape.test(token));
}

function refuse(variable: string, raw: string): never {
  throw new Error(
    `${variable} is set to a value that cannot be a verification token: ${JSON.stringify(
      raw.slice(0, 80),
    )}. Paste the token the console issued you, or the filename it offered you, and nothing else. A placeholder from a walkthrough never verifies, and publishing one at the root of the domain says the wrong thing to the console that reads it.`,
  );
}

/**
 * The Google token, from whatever the owner pasted.
 *
 * `googleabc123.html` (the downloadable file's name) and `abc123` (the token) both give `abc123`.
 * The `google` prefix is only stripped when the value came in as a filename, so a token that
 * happens to begin with those six letters survives intact.
 */
export function googleToken(raw?: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const wasFilename = /\.html$/i.test(value);
  let token = wasFilename ? value.slice(0, -'.html'.length) : value;
  if (wasFilename && token.toLowerCase().startsWith('google')) token = token.slice('google'.length);
  if (!TOKEN.test(token) || isPlaceholder(token)) refuse(GOOGLE_ENV, value);
  return token;
}

/** The Bing token. It goes inside XML rather than into a filename, and is checked just as hard. */
export function bingToken(raw?: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (!BING_TOKEN.test(value) || isPlaceholder(value)) refuse(BING_ENV, value);
  return value;
}

/**
 * The files this build should write to the root of the site, given the environment it is running
 * in. Empty when neither token is set, which is every build but a production one.
 */
export function verificationFiles(
  env: Record<string, string | undefined> = {},
): VerificationFile[] {
  const files: VerificationFile[] = [];
  const google = googleToken(env[GOOGLE_ENV]);
  if (google) {
    const name = `google${google}.html`;
    files.push({
      name,
      contents: `google-site-verification: ${name}\n`,
      why: `Proves the domain to Google Search Console. Written from ${GOOGLE_ENV}; delete the variable to stop publishing it.`,
    });
  }
  const bing = bingToken(env[BING_ENV]);
  if (bing) {
    files.push({
      name: BING_FILE,
      contents: `<?xml version="1.0"?>\n<users>\n  <user>${bing}</user>\n</users>\n`,
      why: `Proves the domain to Bing Webmaster Tools, which is the index ChatGPT's browsing reads. Written from ${BING_ENV}.`,
    });
  }
  return files;
}
