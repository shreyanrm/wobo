/**
 * "The console shows only what a person holds. A panel they cannot read is not greyed out, it is
 * not there" (docs/CONSOLE-ROLES-AND-BOARD.md §2).
 *
 * The gateway already refuses a panel's routes to a seat that does not hold it. These tests hold
 * the console to the other half: the rail draws only held desks, the controls draw only on held
 * ACTs, and the console never asks for a desk it does not hold (a refusal there used to read as
 * "this session has ended" and closed the console on a perfectly live seat).
 *
 * The desk-to-panel map is checked against the gateway's own map, read from
 * services/gateway/src/wobo_gateway/console_panels.py, so the two cannot drift.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINT } from './contract';
import { DESKS } from './desks';
import {
  DESK_PANEL,
  ENDPOINT_PANEL,
  firstDesk,
  holdsEndpoint,
  mayAct,
  mayRead,
  PANEL_IDS,
  visibleDesks,
} from './seats';

const GATEWAY_PANELS = readFileSync(
  join(import.meta.dir, '../../../../services/gateway/src/wobo_gateway/console_panels.py'),
  'utf8',
);

/** The gateway's own map: panel id to the route prefixes it owns. */
function gatewayRoutes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const block = /Panel\(\s*id="([a-z]+)"[\s\S]*?routes=\(([^)]*)\)/g;
  for (const match of GATEWAY_PANELS.matchAll(block)) {
    const routes = [...(match[2] ?? '').matchAll(/"([^"]+)"/g)].map((one) => one[1] ?? '');
    found.set(match[1] ?? '', routes);
  }
  return found;
}

function gatewayPanelFor(path: string): string | null {
  const rest = path.replace(/^\/v1\/admin/, '');
  let best: { id: string; length: number } | null = null;
  for (const [id, routes] of gatewayRoutes()) {
    for (const route of routes) {
      if ((rest === route || rest.startsWith(`${route}/`)) && route.length > (best?.length ?? -1)) {
        best = { id, length: route.length };
      }
    }
  }
  return best?.id ?? null;
}

const IDENTITY = new Set(['session', 'sessionEnd', 'whoami', 'panels', 'audit']);

describe('the console and the gateway name the same panels', () => {
  it('has every panel the gateway has, and no other', () => {
    expect(([...PANEL_IDS] as string[]).sort()).toEqual([...gatewayRoutes().keys()].sort());
  });

  it('files every endpoint it calls under the panel the gateway guards it with', () => {
    for (const [name, path] of Object.entries(ENDPOINT)) {
      if (IDENTITY.has(name)) {
        expect(ENDPOINT_PANEL[name as keyof typeof ENDPOINT]).toBeNull();
        continue;
      }
      expect({
        name,
        panel: ENDPOINT_PANEL[name as keyof typeof ENDPOINT] as string | null,
      }).toEqual({
        name,
        panel: gatewayPanelFor(path),
      });
    }
  });

  it('puts every desk under a panel', () => {
    for (const desk of DESKS) expect(PANEL_IDS as readonly string[]).toContain(DESK_PANEL[desk.id]);
  });
});

describe('a desk a seat cannot read is not there', () => {
  const viewer = ['panel.money.read', 'panel.support.read', 'panel.platform.read'];

  it('draws only the desks whose panel the seat reads', () => {
    const ids = visibleDesks(viewer).map((desk) => desk.id);
    expect(ids).toContain('spend');
    expect(ids).toContain('flag');
    expect(ids).toContain('health');
    expect(ids).not.toContain('models');
    expect(ids).not.toContain('register');
    expect(ids).not.toContain('activity');
  });

  it('draws nothing at all for a seat that holds nothing', () => {
    expect(visibleDesks([])).toEqual([]);
    expect(firstDesk([], 'spend')).toBeNull();
  });

  it('never opens on a desk the seat cannot read', () => {
    expect(firstDesk(['panel.support.read'], 'spend')).toBe('flag');
    expect(firstDesk(viewer, 'health')).toBe('health');
  });

  it('reads and acts separately', () => {
    expect(mayRead(['panel.support.read'], 'refund')).toBe(true);
    expect(mayAct(['panel.support.read'], 'refund')).toBe(false);
    expect(mayAct(['panel.support.read', 'panel.support.act'], 'refund')).toBe(true);
    // An act without the read is not a control on a desk that is not drawn.
    expect(mayAct(['panel.support.act'], 'refund')).toBe(false);
  });

  it('asks the gateway only for what the seat holds', () => {
    expect(holdsEndpoint(viewer, 'usage')).toBe(true);
    expect(holdsEndpoint(viewer, 'models')).toBe(false);
    expect(holdsEndpoint(viewer, 'admins')).toBe(false);
    expect(holdsEndpoint([], 'whoami')).toBe(true);
    expect(holdsEndpoint([], 'panels')).toBe(true);
  });

  it('ignores a capability the console does not know', () => {
    expect(visibleDesks(['panel.everything.read', 'admin'])).toEqual([]);
  });
});
