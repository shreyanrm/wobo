import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CANCEL, NEVER REFUND (DESIGN.md §0, owner, 2026-09-04): no product surface may promise money
 * back. The plan panel and the checkout are the two surfaces that talk about money the learner
 * has paid, so their SOURCE is grepped with the comments stripped, and any string that mentions a
 * refund fails. The one line allowed to carry the word is the name of the legal document, which
 * lives in `plans/copy.ts` and is held by `plans/copy.test.ts`.
 */
const FILES = [
  ['you/plan.ts', join(import.meta.dir, 'plan.ts')],
  ['you/billing.ts', join(import.meta.dir, 'billing.ts')],
  ['you/PlanPanel.tsx', join(import.meta.dir, 'PlanPanel.tsx')],
  ['plans/checkout-flow.ts', join(import.meta.dir, '..', 'plans', 'checkout-flow.ts')],
  ['plans/Plans.tsx', join(import.meta.dir, '..', 'plans', 'Plans.tsx')],
] as const;

/** The file with every comment taken out, so a rule explained in a comment is not a promise. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the money surfaces promise no refund', () => {
  for (const [label, path] of FILES) {
    it(`${label} says refund nowhere a learner reads`, () => {
      const code = withoutComments(readFileSync(path, 'utf8'));
      expect([label, /refund|money back/i.test(code)]).toEqual([label, false]);
    });
  }

  it('the cancelled line says what the day after the period is: free', () => {
    const code = readFileSync(join(import.meta.dir, 'plan.ts'), 'utf8');
    expect(code).toContain('then free.');
  });
});
