import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dir, '..');
const REPO = join(APP, '..', '..');

const DOMAIN = 'heywobo.com';
const WEB = `https://${DOMAIN}`;
const API = `https://api.${DOMAIN}`;

const envProduction = readFileSync(join(APP, '.env.production'), 'utf8');
const vercel = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const csp = vercel.headers[0]?.headers.find((h) => h.key === 'Content-Security-Policy')
  ?.value as string;

const envValue = (name: string): string | undefined =>
  envProduction
    .split('\n')
    .filter((line) => line.startsWith(`${name}=`))
    .at(-1)
    ?.slice(name.length + 1)
    .trim();

/**
 * The domain is config, not code — which is exactly why it drifts. These pin the four places a
 * wrong value is invisible until production: the committed production env, the CSP, the database
 * rewrite, and the crawler files.
 */
describe('the production domain', () => {
  it('is the web origin and the gateway origin in the committed production env', () => {
    expect(envValue('VITE_APP_URL')).toBe(WEB);
    expect(envValue('VITE_GATEWAY_URL')).toBe(API);
    expect(envValue('VITE_APP_NAME')).toBe('Wobo');
  });

  it('leaves no host from a hosting provider in what the browser is handed', () => {
    for (const source of [envProduction, csp]) {
      expect(source).not.toContain('up.railway.app');
      expect(source).not.toContain('vercel.app');
    }
  });

  it('allows the gateway, over https and the voice WebSocket, and nothing else new', () => {
    expect(csp).toContain(`connect-src 'self' ${API} wss://api.${DOMAIN} `);
  });

  it('drops the database host from connect-src, because the proxy is on', () => {
    expect(envValue('VITE_SUPABASE_PROXY')).toBe('1');
    expect(csp).not.toContain('supabase.co');
  });

  it('forwards our /db path to the project, ahead of every address the app answers', () => {
    const [db, ...app] = vercel.rewrites;
    expect(db?.source).toBe('/db/:path*');
    expect(db?.destination).toBe(`${envValue('VITE_SUPABASE_URL')}/:path*`);
    // Order is the rule: a rewrite that reached /db first would swallow the database into the app
    // shell. There is no catch-all any more — the shell is served for the addresses the APP owns
    // and nothing else, so a path nobody owns is a real 404 rather than a page that says nothing
    // (docs/GROWTH-SEARCH.md §2, and test/addresses.test.ts holds the list to the router).
    expect(app.length).toBeGreaterThan(0);
    for (const rule of app) {
      expect(rule.destination).toBe('/app.html');
      expect(rule.source.startsWith('/db')).toBe(false);
    }
  });

  it('points crawlers at our sitemap and keeps them out of the database proxy', () => {
    const robots = readFileSync(join(APP, 'public', 'robots.txt'), 'utf8');
    expect(robots).toContain(`Sitemap: ${WEB}/sitemap.xml`);
    expect(robots).toContain('Disallow: /db/');
    const sitemap = readFileSync(join(APP, 'public', 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain(`<loc>${WEB}/</loc>`);
  });

  it('ships the sitemap in the build and keeps the installed app rooted at the origin', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    expect(config).toContain("'sitemap.xml'");
    expect(config).toContain("id: '/'");
    expect(config).toContain("start_url: '/'");
    expect(config).toContain("scope: '/'");
  });
});
