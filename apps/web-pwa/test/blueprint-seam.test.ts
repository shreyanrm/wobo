import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE POOL HAS TO REACH THE SCREEN (docs/LEARNING-MODEL.md).
 *
 * The architect builds a chapter's pool on the gateway; `curriculum/blueprint.ts` walks one on the
 * client; `curriculum/placement.ts` asks about the ground the architect declared — behind a
 * `sources.assumptions` parameter. On 2026-09-10 nothing passed that parameter, nothing fetched a
 * blueprint, and `grep -rn 'assumptions:' src` outside `src/curriculum` returned nothing at all:
 * the whole "THE ARCHITECT FIRST" branch of `planPlacement` was unreachable code, and so was
 * `groupFor`.
 *
 * These are wiring assertions, deliberately: what they check is that the seam is CONNECTED, which
 * is exactly what was missing. The behaviour of each end is tested where it lives
 * (`curriculum/blueprint.test.ts`, `curriculum/blueprint-placement.test.ts`, and the gateway's
 * `test_curriculum_blueprint_route.py`).
 */
const SRC = join(import.meta.dir, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

describe('a chapter pool travels from the gateway to the placement check', () => {
  it('the app has one place that fetches a pool, and it validates what comes back', () => {
    const source = read('curriculum', 'pool.ts');
    expect(source).toMatch(/curriculum\(\)\s*\.blueprint\(/);
    // A document the app cannot read is refused rather than half-used.
    expect(source).toContain('isBlueprint');
  });

  it('the placement gate is given the architect ground', () => {
    const gate = read('screens', 'onboarding', 'PlacementCheck.tsx');
    expect(gate).toContain('assumptions:');
    expect(gate).toContain('groundUnder');
  });

  it('the course hands the gate the chapter it is in', () => {
    const course = read('screens', 'Course.tsx');
    expect(course).toContain('usePool');
    expect(course).toMatch(/usePlacementGate\([^)]*pool/s);
  });

  it('what the learner answers is what chooses their group', () => {
    const pool = read('curriculum', 'pool.ts');
    expect(pool).toContain('unmetAssumptions');
    expect(pool).toContain('groupFor');
  });
});
