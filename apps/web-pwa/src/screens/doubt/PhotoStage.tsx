'use client';

/**
 * The photo on screen, registered — LAW 3 made visible.
 *
 * The photo sits in a box sized to its (rotated) aspect; each line the gateway read is a button
 * over the pixels it names, and the SAME box is what the registry target's live rect reads through
 * (`photoSurface`, wobo/doubt-surface.ts). So a tap on a line, the marigold that lights it, and the
 * circle Wobo draws around it all resolve through one measurement, taken at the moment it is
 * needed and never cached: turn the photo, resize the window, zoom the page, and the target is
 * still where the ink lands. The target ids are the gateway's line ids, untouched, because that is
 * what its ink frames anchor to.
 *
 * THE BUTTON IS THE LINE, AND THE THUMB GETS A BAND AROUND IT. A region's hit area is never under
 * the thumb's 44 px, but the hit area is not the line: the button's own box is the line as
 * `regionRect` resolves it, because that box is what the glass walk reads for this target and
 * therefore what Wobo's ink anchors to. The reach past it is painted by `.db-region::after`, which
 * has no box on the glass of its own (`wobo/doubt-surface.ts`, `placeRegions`; the adversary,
 * wave 57, finding 1 — a 44 px slab on a 7 px line drew one ellipse across three lines at once).
 *
 * Wobo's ink itself is not drawn here. The stage's fixed screen surface (wobo/Stage.tsx) paints
 * `screenStore` over the whole viewport, anchored to `surfaceRegistry.getTargets()` — which now
 * includes these lines. This component consumes the registry; it edits nothing in it.
 */

import { useSurface } from '@wobo/wobo';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/primitives';
import {
  type DoubtRegion,
  MIN_HIT_PX,
  type PhotoFrame,
  photoSurface,
  placeRegions,
  type Rotation,
} from '../../wobo/doubt-surface';
import type { Capture } from './api';
import { captureUrl } from './capture';

/**
 * The photo never takes more than this much of the viewport's height; the reading needs room.
 * On a phone the sheet cuts it further still (`doubt.css`, `--db-photo-vh`): there the reading and
 * its corrections share one pane with the photo, and three fifths of the screen was the reason the
 * learner had to scroll past the fold to reach Explain at all.
 */
const MAX_VH = 0.7;

/** A region that has not been measured yet reaches nowhere. */
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 } as const;

export interface PhotoStageProps {
  /** The gateway's doubt id: the surface is `doubt:<id>`. */
  photoId: string;
  capture: Capture;
  /** The lines that have a place on the page. */
  regions: readonly DoubtRegion[];
  reading: string;
  rotation: Rotation;
  onRotate: (next: Rotation) => void;
  /** The line lit right now, and the tap that lights one. */
  lit: string | null;
  onLight: (regionId: string | null) => void;
  /** True while a stroke is landing: the page holds still under the pen. */
  held: boolean;
  /** Retake, when there is somewhere to go back to. */
  onRetake?: () => void;
}

export function PhotoStage(props: PhotoStageProps) {
  const { photoId, capture, regions, reading, rotation, lit, held } = props;
  const box = useRef<HTMLDivElement | null>(null);
  const regionEls = useRef(new Map<string, HTMLButtonElement>());
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const [size, setSize] = useState({ width: 0, height: 0 });

  const turned = rotation === 90 || rotation === 270;
  const ratio = turned ? capture.height / capture.width : capture.width / capture.height;

  // The box's own size, so the rotated image and the region buttons are laid out in pixels.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5
          ? s
          : { width: r.width, height: r.height },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The live frame: the box's rect NOW and the rotation NOW, read at resolve time.
  const frame = useMemo(
    () => (): PhotoFrame | null => {
      const el = box.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        rotation: rotationRef.current,
      };
    },
    [],
  );

  useSurface(
    photoSurface(photoId, regions, frame, {
      reading,
      element: (id) => regionEls.current.get(id) ?? null,
    }),
  );

  useEffect(() => {
    if (!lit) return;
    regionEls.current.get(lit)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [lit]);

  const local: PhotoFrame = {
    rect: { x: 0, y: 0, width: size.width, height: size.height },
    rotation,
  };
  const placed = placeRegions(regions, local, {
    minHit: MIN_HIT_PX,
    bounds: local.rect,
  });

  const turn = (by: 90 | -90) => props.onRotate(((rotation + by + 360) % 360) as Rotation);

  return (
    <section className="db-stage" aria-label="Your photo">
      <div
        ref={box}
        className={held ? 'db-photo db-held' : 'db-photo'}
        data-testid="doubt-photo"
        style={{
          aspectRatio: `${ratio}`,
          width: `min(100%, calc(var(--db-photo-vh, ${MAX_VH * 100}vh) * ${ratio}))`,
        }}
      >
        <img
          src={captureUrl(capture)}
          alt={reading ? `The page, which reads: ${reading}` : 'The page you photographed'}
          style={{
            width: turned ? size.height : size.width,
            height: turned ? size.width : size.height,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        />
        {size.width > 0 &&
          regions.map((region, index) => {
            const on = region.id === lit;
            const at = placed[index] ?? { box: { x: 0, y: 0, width: 0, height: 0 }, reach: ZERO };
            return (
              <button
                key={region.id}
                ref={(el) => {
                  if (el) regionEls.current.set(region.id, el);
                  else regionEls.current.delete(region.id);
                }}
                type="button"
                className={on ? 'db-region db-lit' : 'db-region'}
                aria-label={region.text ? `${region.label}: ${region.text}` : region.label}
                aria-pressed={on}
                data-region={region.id}
                style={
                  {
                    left: at.box.x,
                    top: at.box.y,
                    width: at.box.width,
                    height: at.box.height,
                    '--db-reach-t': `${at.reach.top}px`,
                    '--db-reach-r': `${at.reach.right}px`,
                    '--db-reach-b': `${at.reach.bottom}px`,
                    '--db-reach-l': `${at.reach.left}px`,
                  } as CSSProperties
                }
                onClick={() => props.onLight(on ? null : region.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') props.onLight(null);
                }}
              >
                {region.label}
              </button>
            );
          })}
      </div>
      <div className="db-tools">
        <Button size="sm" tone="quiet" onClick={() => turn(-90)} aria-label="Turn the photo left">
          Turn left
        </Button>
        <Button size="sm" tone="quiet" onClick={() => turn(90)} aria-label="Turn the photo right">
          Turn right
        </Button>
        {props.onRetake ? (
          <Button size="sm" tone="quiet" onClick={props.onRetake}>
            Another photo
          </Button>
        ) : null}
      </div>
    </section>
  );
}
