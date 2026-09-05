/**
 * The drawing, measured with the product's own hand.
 *
 * A text-only harness would pass a board whose words are right and whose ink is a pile of
 * overlapping labels off the edge of the surface. This is the half that cannot be faked: it runs
 * `geometryOf` — the exact function the renderer paints from — over the objects that reached the
 * wire, with the real handwriting font loaded so the glyph metrics are the real ones, and reports
 * where the ink actually lands.
 *
 * Four questions, all in board units, all against BOARD.md section 3's own coordinate space: the
 * board is a 1000-unit square and an anchor outside it is refused by the grammar.
 *
 *   off-canvas    is any part of a mark outside the 1000-unit square? The grammar caps the
 *                 ANCHOR at 0..1000; nothing caps what the hand then writes from it, so a note
 *                 anchored at x=940 runs off the board and no code stops it.
 *   clipped       is a written line wider than the board, so the hand runs off the right edge?
 *   overlapping   do two pieces of WRITTEN TEXT sit on top of each other? Shapes may cross — a
 *                 tangent must touch its curve — but two labels in one place is a board a child
 *                 cannot read, and `notePlacement` does no collision avoidance at all for a note
 *                 anchored to a bare board coordinate.
 *   needs-camera  has the ink outgrown the resting view, so the board must pan or zoom to show
 *                 it? Legal, and worth knowing: it is reported, never failed.
 *
 * Reads one JSON object on stdin, writes one on stdout. It is a probe, not a test: it reports, and
 * the Python side decides what a report means.
 *
 * Run:  bun services/gateway/harness/geometry_probe.ts < plan.json
 */

import {
  type AnchorContext,
  type BoardRect,
  boxesOverlap,
  frameOf,
} from '../../../packages/wobo/src/board/anchors';
import { geometryOf } from '../../../packages/wobo/src/board/geometry';
import { blocksLayout } from '../../../packages/wobo/src/board/layout';
import { type HandFont, parseHandFont } from '../../../packages/wobo/src/board/handwriting';
import { BOARD_UNITS, type BoardObject } from '../../../packages/wobo/src/board/schema';

const FONT_PATH = new URL(
  '../../../apps/web-pwa/public/fonts/Caveat-Regular.ttf',
  import.meta.url,
).pathname;

/** The board's own coordinate space (BOARD.md section 3). */
const BOARD: BoardRect = { x: 0, y: 0, w: BOARD_UNITS, h: BOARD_UNITS };

/**
 * The resting view on a laptop-shaped surface: 1000 units across and this many down. Ink past it
 * is legal — the camera follows — so it is reported rather than failed.
 */
const RESTING = frameOf({ x: 0, y: 0, width: 1440, height: 760 });

/** Two written boxes may share this many board units before it counts as a collision. */
const TEXT_TOLERANCE = 2;

interface Probe {
  presentation?: string;
  objects: BoardObject[];
}

type IssueKind = 'off-canvas' | 'clipped' | 'overlapping' | 'needs-camera';

interface Issue {
  kind: IssueKind;
  object: string;
  detail: string;
  other?: string;
}

const r = (n: number) => Math.round(n * 100) / 100;
const show = (b: BoardRect) => `[${r(b.x)}, ${r(b.y)} ${r(b.w)}x${r(b.h)}]`;

function measure(objects: BoardObject[], font: HandFont | null): Issue[] {
  const boxes = new Map<string, BoardRect>();
  const occupied: BoardRect[] = [];
  const written: { id: string; box: BoardRect; text: string }[] = [];
  const issues: Issue[] = [];
  const restingHeight = (RESTING.height / RESTING.width) * BOARD_UNITS;

  const ctx: AnchorContext & { font: HandFont | null; occupied: BoardRect[] } = {
    frame: RESTING,
    // Nothing reaches the wire anchored to a target or a focus that does not exist: the planner
    // refuses a mark whose anchor is gone and re-anchors a shape into board space, so these two
    // are never consulted on a real transcript. They answer null so a probe of a hand-built plan
    // behaves exactly as the renderer would.
    targetRect: () => null,
    focusRect: () => null,
    objectBox: (id: string) => boxes.get(id) ?? null,
    font,
    occupied,
  };

  for (const object of objects) {
    const geometry = geometryOf(object, ctx);
    if (!geometry) continue;
    const box = geometry.box;
    boxes.set(object.id, box);
    // Exactly what `renderer.tsx` does: ground (a plotted grid) does not push a note aside.
    if (blocksLayout(String(object.kind))) occupied.push(box);

    if (
      box.x < -TEXT_TOLERANCE ||
      box.y < -TEXT_TOLERANCE ||
      box.x + box.w > BOARD.w + TEXT_TOLERANCE ||
      box.y + box.h > BOARD.h + TEXT_TOLERANCE
    ) {
      issues.push({
        kind: 'off-canvas',
        object: object.id,
        detail: `${object.kind} at ${show(box)} leaves the ${BOARD_UNITS}-unit board`,
      });
    } else if (box.y + box.h > restingHeight) {
      issues.push({
        kind: 'needs-camera',
        object: object.id,
        detail: `${object.kind} at ${show(box)} sits below the resting view (${r(restingHeight)})`,
      });
    }

    if (geometry.text) {
      const line = geometry.text.lines.join(' ');
      if (box.x >= 0 && box.x + box.w > BOARD.w + TEXT_TOLERANCE) {
        issues.push({
          kind: 'clipped',
          object: object.id,
          detail: `"${line}" runs ${Math.round(box.x + box.w - BOARD.w)} units past the right edge`,
        });
      }
      for (const earlier of written) {
        if (boxesOverlap(box, earlier.box, -TEXT_TOLERANCE)) {
          issues.push({
            kind: 'overlapping',
            object: object.id,
            other: earlier.id,
            detail: `"${line}" ${show(box)} sits on "${earlier.text}" ${show(earlier.box)}`,
          });
        }
      }
      written.push({ id: object.id, box, text: line });
    }
  }
  return issues;
}

async function main(): Promise<void> {
  const input = (await Bun.stdin.text()).trim();
  const probe: Probe = input ? JSON.parse(input) : { objects: [] };
  let font: HandFont | null = null;
  try {
    font = await parseHandFont(await Bun.file(FONT_PATH).arrayBuffer());
  } catch {
    // No font means estimated glyph widths (`notePlacement` falls back to a character count), so
    // the measurement is coarser rather than absent. The Python side is told which it got.
    font = null;
  }
  const objects = probe.objects ?? [];
  process.stdout.write(
    `${JSON.stringify({ font: font !== null, objects: objects.length, issues: measure(objects, font) }, null, 2)}\n`,
  );
}

await main();
