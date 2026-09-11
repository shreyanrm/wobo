/**
 * The blueprint contract cannot drift between the brain and the client.
 *
 * The source of truth is the Pydantic in
 * services/gateway/src/wobo_gateway/plexus/blueprint_spec.py, which emits
 * packages/contracts/schemas/blueprint.schema.json. `curriculum/blueprint.ts` declares the same
 * shapes for the client. This reads the emitted schema and fails if a field exists on one side and
 * not the other, which is the only way a hand-written mirror stays honest.
 *
 * Regenerate the schema with `uv run python -m wobo_gateway.plexus.blueprint_spec`.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA = resolve(
  import.meta.dir,
  '../../../../packages/contracts/schemas/blueprint.schema.json',
);
const SOURCE = resolve(import.meta.dir, 'blueprint.ts');

interface Def {
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
}

const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as { $defs: Record<string, Def> };
const source = readFileSync(SOURCE, 'utf-8');

describe('the client mirrors the brain’s blueprint contract', () => {
  test('the schema is really there, with every model in it', () => {
    const names = Object.keys(schema.$defs);
    expect(names).toContain('Blueprint');
    expect(names).toContain('BlueprintModule');
    expect(names).toContain('MechanicCandidate');
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  test('every field the brain declares is declared on the client too', () => {
    const missing: string[] = [];
    for (const [model, def] of Object.entries(schema.$defs)) {
      for (const property of Object.keys(def.properties ?? {})) {
        // A property is declared if the interface names it. Cheap and exact enough: a field the
        // client never names cannot be read by any screen, which is the failure this catches.
        if (!new RegExp(`^\\s*${property}\\??:`, 'm').test(source)) {
          missing.push(`${model}.${property}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every blueprint model forbids what it does not declare', () => {
    for (const [model, def] of Object.entries(schema.$defs)) {
      expect([model, def.additionalProperties]).toEqual([model, false]);
    }
  });

  test('the mechanic vocabulary the client renders is the vocabulary the brain may propose', () => {
    const primitives = (
      schema.$defs.MechanicCandidate?.properties?.primitives as { items?: { enum?: string[] } }
    )?.items?.enum;
    expect(Array.isArray(primitives)).toBe(true);
    for (const kind of primitives ?? []) {
      expect(source).toContain(`| '${kind}'`);
    }
  });
});
