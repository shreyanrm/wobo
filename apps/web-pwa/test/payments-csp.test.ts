import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..', '..');
const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const csp = vercel.headers[0]?.headers.find((h) => h.key === 'Content-Security-Policy')
  ?.value as string;

/** The sources one directive allows, in order. Empty when the directive is not set. */
function sources(directive: string): string[] {
  const found = csp
    .split(';')
    .map((s) => s.trim())
    .find((s) => s === directive || s.startsWith(`${directive} `));
  return found ? found.slice(directive.length).trim().split(/\s+/).filter(Boolean) : [];
}

/**
 * WHAT THE PROVIDER'S CHECKOUT NEEDS FROM THE CSP, AND NOTHING MORE.
 *
 * `screens/plans/checkout-flow.ts` loads https://checkout.razorpay.com/v1/checkout.js when a reader
 * chooses a plan (Razorpay Docs, razorpay.com/docs/payments/payment-gateway/web-integration/
 * standard/build-integration/, read 2026-09-07: the script tag is that URL, and the hosts the
 * checkout talks to are api.razorpay.com, checkout.razorpay.com and lumberjack.razorpay.com; nothing
 * else is loaded by us). The script draws its modal in an iframe served from the API and checkout
 * hosts, talks to the API host, and reports to its own telemetry host. Razorpay publishes no
 * per-directive CSP list, so each directive here names the hosts it needs and no wildcard reaches
 * a script, a frame or a connection; images alone take the provider's wildcard, because the modal's
 * own assets (bank and wallet logos) come from more than one of its hosts. `test/domain.test.ts`
 * keeps the shape of the rest of the header.
 */
describe('the CSP lets the checkout open, and no wider', () => {
  const HOSTS = {
    script: 'https://checkout.razorpay.com',
    /**
     * checkout.js itself (fetched 2026-09-07, 188,761 bytes) appends a second script to OUR
     * document.head: https://cdn.razorpay.com/static/cx/razorpay-risk-detection/bundle.js. A
     * script-src that names the checkout host alone blocks it silently on every checkout.
     */
    cdn: 'https://cdn.razorpay.com',
    api: 'https://api.razorpay.com',
    telemetry: 'https://lumberjack.razorpay.com',
    /** The same file sendBeacons to these two; blocked, they are console noise on every checkout. */
    telemetryCx: 'https://lumberjack-cx.razorpay.com',
    telemetryMetrics: 'https://lumberjack-metrics.razorpay.com',
    images: 'https://*.razorpay.com',
  };

  it('lets the provider script load, and the risk bundle it appends from its cdn', () => {
    expect(sources('script-src')).toContain(HOSTS.script);
    expect(sources('script-src')).toContain(HOSTS.cdn);
  });

  it('lets the modal frame in from the two hosts it is served from', () => {
    const frames = sources('frame-src');
    expect(frames).toContain(HOSTS.api);
    expect(frames).toContain(HOSTS.script);
  });

  it('lets the script talk to the provider, and to its telemetry, and nothing else new', () => {
    const connect = sources('connect-src');
    expect(connect).toContain(HOSTS.api);
    expect(connect).toContain(HOSTS.telemetry);
    expect(connect).toContain(HOSTS.telemetryCx);
    expect(connect).toContain(HOSTS.telemetryMetrics);
  });

  it('does not deny the Payment Request API to the checkout frame', () => {
    // Permissions-Policy `payment=()` denies the API to this document and to every nested frame,
    // and a parent cannot delegate a feature it has disabled. The modal is an iframe on the API
    // host, so that host is the one delegate.
    const policy = vercel.headers[0]?.headers.find((h) => h.key === 'Permissions-Policy')
      ?.value as string;
    const payment = policy
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.startsWith('payment='));
    expect(payment).toBe('payment=(self "https://api.razorpay.com")');
  });

  it('lets the provider draw its own images', () => {
    expect(sources('img-src')).toContain(HOSTS.images);
  });

  it('gives no script, frame or connection a wildcard, and keeps the frame-ancestors lock', () => {
    for (const directive of ['script-src', 'frame-src', 'connect-src']) {
      for (const source of sources(directive)) {
        expect([directive, source, source.includes('*')]).toEqual([directive, source, false]);
      }
    }
    expect(sources('frame-ancestors')).toEqual(["'none'"]);
    expect(sources('script-src')).not.toContain("'unsafe-inline'");
  });

  it('names the provider in exactly those four directives, and nowhere else', () => {
    const named = csp
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.includes('razorpay'))
      .map((s) => s.split(/\s+/)[0]);
    expect(named.sort()).toEqual(['connect-src', 'frame-src', 'img-src', 'script-src']);
    // and each directive carries only the hosts named above
    const allowed = new Set(Object.values(HOSTS));
    for (const directive of named) {
      for (const source of sources(directive as string).filter((s) => s.includes('razorpay'))) {
        expect([directive, source, allowed.has(source)]).toEqual([directive, source, true]);
      }
    }
  });
});
