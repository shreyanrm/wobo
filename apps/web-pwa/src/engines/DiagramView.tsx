'use client';

/**
 * DiagramView — renders a generated SVG diagram after sanitization (the trust boundary between
 * model output and the DOM), registered on the Wobo bus so Wobo can annotate it like any other
 * surface. SVG is the diagram medium of record (DESIGN.md §9, §10).
 *
 * The sanitized DOM tree is inserted directly (importNode) — never serialized back to a string
 * and re-parsed as HTML, so there is no innerHTML/mXSS surface at all.
 */

import { useRegisterTarget } from '@wobo/wobo';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { whisper } from '../screens/course/shared';

/**
 * Parses and sanitizes a generated SVG string: strips script-capable elements, event handlers,
 * external references, and style escapes, then makes the root responsive. Returns null when the
 * input is not a clean, parseable SVG — callers treat null as a refusal and fall back.
 */
export function sanitizeSvgElement(raw: string): SVGSVGElement | null {
  if (typeof raw !== 'string' || !raw.includes('<svg')) return null;
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  if (!(svg instanceof SVGSVGElement)) return null;

  for (const el of Array.from(
    svg.querySelectorAll('script, foreignObject, iframe, embed, object'),
  )) {
    el.remove();
  }
  // SMIL animation is welcome (animated SVG is a design requirement) unless it rewrites hrefs
  for (const el of Array.from(
    svg.querySelectorAll('animate, animateTransform, animateMotion, set'),
  )) {
    const attr = (el.getAttribute('attributeName') ?? '').toLowerCase();
    if (el.tagName.toLowerCase() === 'set' || attr.includes('href')) el.remove();
  }
  // Every <style> goes, unconditionally. Blocking only the `url(` token still let `@import` pull a
  // remote stylesheet in, and a style element can reposition or hide anything on the page besides.
  // A generated diagram has no legitimate need for one: presentation belongs on the elements.
  for (const el of Array.from(svg.querySelectorAll('style'))) el.remove();

  // Fragments and raster data images only — data:image/svg+xml is a sanitizer bypass, not an image.
  const RASTER = ['data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,'];
  const scrub = (el: Element): void => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      const external = !value.startsWith('#') && !RASTER.some((p) => value.startsWith(p));
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href' || name === 'src') && external) ||
        (name === 'style' && value.includes('url('))
      ) {
        el.removeAttribute(attr.name);
      }
    }
    for (const child of Array.from(el.children)) scrub(child);
  };
  scrub(svg);

  // responsive: keep the aspect via viewBox, scale to the container
  if (!svg.getAttribute('viewBox')) {
    const w = Number.parseFloat(svg.getAttribute('width') ?? '');
    const h = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }
  svg.removeAttribute('height');
  svg.setAttribute('width', '100%');
  return svg;
}

/** True when the string parses and survives sanitization — the serve gate for generated SVG. */
export function svgIsClean(raw: string): boolean {
  return sanitizeSvgElement(raw) !== null;
}

/** Mounts a sanitized SVG as a live DOM subtree. Renders nothing when the SVG is refused. */
export function SafeSvg({
  svg,
  label,
  style,
}: {
  svg: string;
  label: string;
  style?: CSSProperties;
}) {
  const el = useMemo(() => sanitizeSvgElement(svg), [svg]);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = host.current;
    if (!target || !el) return;
    target.replaceChildren(document.importNode(el, true));
    return () => target.replaceChildren();
  }, [el]);

  if (!el) return null;
  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      style={{ width: '100%', lineHeight: 0, ...style }}
    />
  );
}

export function DiagramView({
  id,
  svg,
  label,
  caption,
}: {
  id: string;
  svg: string;
  /** Plain description for Wobo and assistive tech. */
  label: string;
  caption?: string;
}) {
  const clean = useMemo(() => svgIsClean(svg), [svg]);
  const ref = useRegisterTarget<HTMLDivElement>(`diagram-${id}`, { kind: 'diagram', label });

  // A drawing that did not pass is not there. Nothing captions its absence (DESIGN.md §0.x): no
  // box, no "being redrawn", no caption under an empty frame.
  if (!clean) return null;

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div ref={ref} style={{ width: '100%' }}>
        <SafeSvg svg={svg} label={label} />
      </div>
      {caption && <figcaption style={{ ...whisper, textAlign: 'center' }}>{caption}</figcaption>}
    </figure>
  );
}
