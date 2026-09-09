/**
 * ONE PEN, ONE PLAN GRAMMAR (docs/INK-FREEZE-PLAN-TRACE.md §4, "What goes").
 *
 * The law removed a whole second way of drawing: the overlay pipeline (highlight, annotate and
 * point as tutor actions, anchored to a registry id), the bus-to-registry bridge that mirrored
 * every screen into a second registry, and the action timeline that played those marks against
 * Wobo's speech. What replaced it is one plan of marks by glass id, streamed on the board wire,
 * traced by one hand on one fixed surface.
 *
 * The tests that encoded the old behaviour are gone with the code they described; this is that law
 * in their place, so the removal cannot quietly grow back. The bridge's own contract — a live rect,
 * a component mid-unmount that never breaks the packet, scene state as a target's value — is the
 * glass reader's now, and packages/wobo/test/glass-read.test.ts and registry.test.ts hold it.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dir;
const SRC = join(HERE, '..');
const PACKAGE = join(HERE, '..', '..', '..', '..', 'packages', 'wobo', 'src');

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

describe('the second drawing pipeline is gone', () => {
  it('has no bus-to-registry bridge on disk, and nothing that imports one', async () => {
    expect(existsSync(join(HERE, 'bus-bridge.ts'))).toBe(false);
    expect(existsSync(join(HERE, 'bus-bridge.test.ts'))).toBe(false);
    const files = await Array.fromAsync(
      new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: SRC, absolute: true }),
    );
    const offenders = files.filter((file) => {
      if (file === import.meta.path) return false; // this file names what it forbids
      const source = readFileSync(file, 'utf8');
      return source.includes('bus-bridge') || source.includes('ROUTE_SURFACE_PREFIX');
    });
    expect(offenders).toEqual([]);
  });

  it('mounts no overlay and plays no action timeline', () => {
    const runtime = read(SRC, 'AppRuntime.tsx');
    for (const dead of ['WoboOverlay', 'hasSyncAnchor', 'registerPerformance', 'clearMarks']) {
      expect(runtime.includes(dead)).toBe(false);
    }
    const speech = read(HERE, 'speech.tsx');
    for (const dead of ['hasSyncAnchor', 'registerPerformance', 'anchored']) {
      expect(speech.includes(dead)).toBe(false);
    }
  });

  it('leaves one pen over the screen: the fixed board surface, and no other', () => {
    const stage = read(HERE, 'Stage.tsx');
    expect(stage.includes('label="Wobo\'s ink on this screen"')).toBe(true);
    // `fixed` is what makes a surface the screen's pen; a board in a note is a board, not a pen.
    expect(stage.split('<BoardSurface')).toHaveLength(2);
  });

  it('keeps no mark verbs in the tutor action grammar — a mark is a plan, not an action', () => {
    const actions = read(PACKAGE, 'actions.ts');
    for (const verb of ['highlight', 'annotate', 'point']) {
      expect(actions.includes(`z.literal('${verb}')`)).toBe(false);
    }
  });
});
