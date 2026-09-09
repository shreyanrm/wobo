'use client';

/**
 * The structured data one blog page carries, written into the page's own body.
 *
 * It is in the BODY and not the head on purpose. `scripts/prerender.ts` writes a real HTML file
 * per address by inlining what the app rendered into `#root`, and it writes the head itself from
 * `shell/head.ts`. A `<script type="application/ld+json">` rendered by the page therefore survives
 * into the emitted file with no change to the head machinery, which belongs to another wave, and
 * an engine reads it in the body exactly as it reads it in the head.
 *
 * The JSON is escaped by `jsonLd` before it gets here, so a `</script>` inside any string cannot
 * end the element. That is the only reason `dangerouslySetInnerHTML` appears anywhere near this
 * codebase's copy, and it is why the escaping lives in a tested pure function rather than here.
 */

import { DEFAULT_ORIGIN, normaliseOrigin } from '../../../shell/head';
import { jsonLd } from './post';

/** The origin this build's absolute addresses are written at, the way `canonicalUrl` reads it. */
export function siteBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return normaliseOrigin(env.VITE_APP_URL ?? DEFAULT_ORIGIN);
}

export function Schema({ data }: { data: readonly unknown[] }) {
  return (
    <>
      {data.map((one, i) => (
        <script
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per page and never reorders
          key={`ld-${i}`}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has no other rendering, and `jsonLd` escapes < > & so nothing here can close the element
          dangerouslySetInnerHTML={{ __html: jsonLd(one) }}
        />
      ))}
    </>
  );
}
