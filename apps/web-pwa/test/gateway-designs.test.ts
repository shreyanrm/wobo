import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDesign } from '../src/engines/composition/parse';
import type { Refusal } from '../src/engines/composition/parse';

/**
 * THE GATEWAY'S OWN DESIGNS, THROUGH THE CLIENT'S OWN PARSER.
 *
 * The wave's browser proof played `/compose-bench.html` against `fixtures.ts`, whose own docstring
 * says those are "here as DATA, not as content the product serves". So the eight template floors
 * were proved renderable in a shape nobody had ever emitted, and what the gateway actually built
 * was never put through `parseDesign` at all.
 *
 * `test/fixtures/gateway-designs.json` is the other half: it is `interaction_floor(kind, core)` for
 * every one of the eight rows of docs/CONTENT-INTERACTION.md section 2, filled from a real concept
 * core, serialised exactly as `engines.attach_interaction` puts it on a served card. If the two
 * sides ever drift — a field renamed, a hit box shrunk, a primitive spelled differently — this goes
 * red here rather than silently on a learner's screen, where a refused design falls to a floor and
 * nothing anywhere says why.
 *
 * Regenerate after changing `interaction_floor` or the design schema: the command is in the
 * fixture's own `_` field.
 */
const FIXTURE = join(import.meta.dir, 'fixtures', 'gateway-designs.json');
const floors = JSON.parse(readFileSync(FIXTURE, 'utf8')).floors as Record<string, unknown>;

const ROWS = [
  'classify',
  'order',
  'match',
  'vary',
  'construct',
  'discriminate',
  'drill',
  'watch',
] as const;

describe('every template floor the gateway builds renders on the client', () => {
  it('the fixture carries all eight rows of section 2', () => {
    expect(Object.keys(floors).sort()).toEqual([...ROWS].sort());
  });

  for (const row of ROWS) {
    it(`${row} is accepted by the client's own parser`, () => {
      const refusals: Refusal[] = [];
      const design = parseDesign(floors[row], refusals);
      expect(refusals).toEqual([]);
      expect(design).not.toBeNull();
      expect(design?.kind).toBe(row);
      // A design of nothing but modifiers is a quiz with a skin; the parser refuses those, and a
      // floor must never be one. Every floor also has to say what it is and why it is that.
      expect(design?.mechanic?.trim().length ?? 0).toBeGreaterThan(0);
      expect(design?.why?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }

  it('every floor teaches the concept it was filled from', () => {
    const blob = JSON.stringify(floors).toLowerCase();
    expect(blob).toContain('cell wall');
  });
});
