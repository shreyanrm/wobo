import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = join(import.meta.dir, '..');

/**
 * THE PAYMENT SECRET NEVER REACHES THE BROWSER.
 *
 * The provider's key SECRET signs webhooks and creates subscriptions, and it lives on the gateway
 * alone (`RAZORPAY_KEY_SECRET`, server-side). The browser is handed a subscription id and the
 * public key id by `POST /v1/billing/checkout`, and nothing else. A `VITE_` variable is inlined
 * into the bundle, so the one way the secret could leak is somebody naming it in one, or writing
 * a key literal into source. This greps for both shapes, in source and in whatever `dist` holds.
 *
 * `rzp_live_…` and `rzp_test_…` are the provider's key-id shapes. The id is public by design, but
 * it belongs to the deploy's environment and the gateway's answer, never to a source file or the
 * committed env, so the literal is forbidden here too.
 */
const SHAPES: [string, RegExp][] = [
  ['the secret variable', /RAZORPAY_KEY_SECRET/],
  ['a key secret field', /key_secret/i],
  ['a key literal', /rzp_(live|test)_[A-Za-z0-9]{10,}/],
];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.html', '.css', '.json']);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if ([...SOURCE_EXT].some((ext) => name.endsWith(ext))) yield path;
  }
}

function offenders(root: string): string[] {
  const found: string[] = [];
  if (!existsSync(root)) return found;
  for (const file of walk(root)) {
    // this test and the checkout tests name the shapes on purpose
    if (/\.test\.tsx?$/.test(file) || /\.spec\.ts$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const [what, shape] of SHAPES) {
      if (shape.test(text)) found.push(`${relative(APP, file)}: ${what}`);
    }
  }
  return found;
}

describe('the payment secret never reaches the bundle', () => {
  it('names no secret and no key literal anywhere in source', () => {
    expect(offenders(join(APP, 'src'))).toEqual([]);
    expect(offenders(join(APP, 'public'))).toEqual([]);
  });

  it('ships none in the built bundle, when there is one', () => {
    expect(offenders(join(APP, 'dist'))).toEqual([]);
  });

  it('declares no payment variable in the committed env files, public or not', () => {
    for (const name of ['.env.production', '.env.example', '.env.development']) {
      const path = join(APP, name);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => /^\s*VITE_[A-Z_]*RAZORPAY/i.test(l));
      expect([name, lines]).toEqual([name, []]);
    }
  });
});
