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
 * Wobo's ink itself is not drawn here. The stage's fixed screen surface (wobo/Stage.tsx) paints
 * `screenStore` over the whole viewport, anchored to `surfaceRegistry.getTargets()` — which now
 * includes these lines. This component consumes the registry; it edits nothing in it.
 */

import { useSurface } from '@wobo/wobo';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/primitives';
import {
  type DoubtRegion,
  type PhotoFrame,
  photoSurface,
  type Rotation,
  regionRect,
} from '../../wobo/doubt-surface';
import type { Capture } from './api';
import { captureUrl } from './capture';

/** A region's hit area is never under the thumb's 44px, whatever the brain read. */
const MIN_HIT = 44;
/**
 * The photo never takes more than this much of the viewport's height; the reading needs room.
 * On a phone the sheet cuts it further still (`doubt.css`, `--db-photo-vh`): there the reading and
 * its corrections share one pane with the photo, and three fifths of the screen was the reason the
 * learner had to scroll past the fold to reach Explain at all.
 */
const MAX_VH = 0.7;

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
  const hit = (region: DoubtRegion) => {
    const r = regionRect(region, local);
    const width = Math.max(r.width, MIN_HIT);
    const height = Math.max(r.height, MIN_HIT);
    return {
      left: r.x + r.width / 2 - width / 2,
      top: r.y + r.height / 2 - height / 2,
      width,
      height,
    };
  };

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
          regions.map((region) => {
            const on = region.id === lit;
            const at = hit(region);
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
                style={{ left: at.left, top: at.top, width: at.width, height: at.height }}
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
