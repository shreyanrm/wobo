'use client';

/**
 * The glass lab: a real component mounted on a real page so the glass reader can be measured on
 * it in a browser (tests/glass.spec.ts). Nothing here is a second copy of a component; it mounts
 * the app's own `DiagramView` inside the app's own bus provider, with a diagram of the shape the
 * course seeds (a title, two named circles, an arrow), and hands back the unmount.
 *
 * Dev only: reached by a spec through `import('/src/wobo/glass-lab.tsx')`; not in a production
 * bundle, which has exactly one input.
 */

import { WoboProvider } from '@wobo/wobo';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DiagramView } from '../engines/DiagramView';

/** The seeded card-three diagram, as the course draws it: predict, then check. */
export const PREDICT_THEN_CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 190" width="340" height="190">
  <text x="170" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#14142B">Predict, then check</text>
  <circle id="idea" cx="70" cy="110" r="36" fill="none" stroke="#2B45FF" stroke-width="3"/>
  <text x="70" y="115" text-anchor="middle" font-size="14" fill="#14142B">idea</text>
  <path id="arrow" d="M112 110 H222 l-10 -8 M222 110 l-10 8" fill="none" stroke="#14142B" stroke-width="3"/>
  <circle id="effect" cx="264" cy="110" r="36" fill="none" stroke="#2B45FF" stroke-width="3"/>
  <text x="264" y="115" text-anchor="middle" font-size="14" fill="#14142B">effect</text>
</svg>`;

/** Mount the diagram into `host`. Returns the unmount. */
export function mountDiagramLab(host: HTMLElement, id = 'c3'): () => void {
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <WoboProvider>
        <div style={{ width: 'min(100%, 520px)', margin: '24px auto' }}>
          <DiagramView
            id={id}
            svg={PREDICT_THEN_CHECK_SVG}
            label="diagram: Predict, then check"
            caption="A claimed answer must survive the original problem."
          />
        </div>
      </WoboProvider>
    </StrictMode>,
  );
  return () => root.unmount();
}
