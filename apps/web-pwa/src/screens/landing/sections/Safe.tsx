'use client';

/**
 * "Safe by design" — six decisions, each one visible in the product and each one checkable.
 *
 * The prototype ends each item with a proof link. Here every one of those is a REAL address: the
 * security page, the privacy policy, the children's privacy page. A claim about safety that ends in
 * a link going nowhere is worse than no claim at all.
 *
 * THE "ASK SOMEONE YOU TRUST" ROW IS NOT HERE ANY MORE. It sat at the tail of this section with
 * five outbound links on it — 526px above the page's one and only close. Five doors out of the
 * funnel, immediately above the conversion, handing a reader who is 92% of the way through the
 * argument to the exact product category the previous twenty screens differentiated from. It is a
 * good trust device and it was in the worst possible place; it lives in `Teaches` now, where the
 * doubt it answers ("is this just a chatbot with a logo") is actually being raised, and anywhere
 * above the price it costs nothing (docs/SELL.md §8).
 */

import { SafeIcon } from '../art';
import { LandingLink } from '../link';
import { SAFE } from '../page-copy';

export function Safe() {
  return (
    <section id="safe">
      <div className="wrap">
        <div className="eyebrow reveal">{SAFE.eyebrow}</div>
        <h2 className="t reveal">
          {SAFE.title.lead}
          <span className="hl">{SAFE.title.mark}</span>
        </h2>
        <p className="lede reveal">{SAFE.lede}</p>
        <div className="safe">
          {SAFE.items.map((item, i) => (
            <div className="item reveal" key={item.title}>
              <SafeIcon index={i} />
              <div>
                <b>{item.title}</b>
                <p>{item.body}</p>
                <LandingLink className="proof" href={item.href}>
                  {item.proof}
                </LandingLink>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
