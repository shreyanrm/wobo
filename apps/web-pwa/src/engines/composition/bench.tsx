/**
 * The composer bench (`/compose-bench.html`).
 *
 * Every interaction the composer can render — the three designed compositions and the seven template
 * floors — on one page, in either theme, at whatever width the browser is. Two things it exists to
 * prove that a screenshot of the app could not:
 *
 *   1. ONE renderer takes a designed interaction and a template floor without a branch between them;
 *   2. every control is a hit area a finger can use at 390, measured off the live page rather than
 *      trusted from a comment (`tests/composition.spec.ts` reads these rects).
 *
 * Dev only. Vite's production build has exactly one input (`index.html`), so nothing here reaches a
 * bundle a learner downloads.
 */

import '@fontsource-variable/caveat';
import '@fontsource-variable/plus-jakarta-sans';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BarState } from '../../screens/course/shared';
import '../../ui/tokens.css';
import { Composer } from './Composer';
import { DESIGNED } from './fixtures';
import { FLOORS, ROWS } from './floors';
import { type Design, parseDesign } from './parse';

const STYLE_ID = 'cx-bench';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); }
body { font-family: var(--sans, system-ui, sans-serif); }
.cxb-list { display: flex; flex-direction: column; gap: 28px; padding: 20px 16px 120px; margin: 0 auto; max-width: 1180px; }
.cxb-item { border-radius: 20px; background: var(--paper); }
.cxb-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 0 4px 10px; }
.cxb-head > h2 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--ink); }
.cxb-head > span { font-size: .78rem; color: var(--ink-3); }
.cxb-bar { display: flex; gap: 10px; align-items: center; padding: 12px 4px 0; }
.cxb-next { appearance: none; font: inherit; font-size: .92rem; min-height: 48px; padding: 12px 22px;
  border: 0; border-radius: 12px; background: var(--pig); color: #fff; cursor: pointer; }
.cxb-next:disabled { opacity: .45; cursor: default; }
.cxb-done { font-size: .8rem; color: var(--mint); }
`;
  document.head.appendChild(style);
}

/** The theme is a plain attribute so a screenshot can be taken of either without app state. */
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

/** Every design the bench shows: the designer's three, then the floors in §2's order. */
const ALL: { design: Design; note: string }[] = [
  ...DESIGNED.map((d) => ({ design: d, note: 'designed' })),
  ...ROWS.map((row) => ({ design: FLOORS[row], note: `floor · ${row}` })),
];

const only = params.get('design');
const SHOWN = only ? ALL.filter((x) => x.design.id === only) : ALL;

/** One design, with the host's own advance button beside it — the action bar the lesson would own. */
function Item({ design, note }: { design: Design; note: string }) {
  const [bar, setBar] = useState<BarState | null>(null);
  const [done, setDone] = useState(false);
  // Through the same door the app uses. A design the door refuses renders nothing, silently.
  const parsed = parseDesign(design);
  if (!parsed) return null;
  const acts = parsed.steps.filter((s) => !['timer', 'score', 'reveal'].includes(s.primitive.kind));

  return (
    <section className="cxb-item" data-bench-design={parsed.id} aria-label={parsed.concept}>
      <div className="cxb-head">
        <h2>{parsed.concept}</h2>
        <span>
          {note} · {parsed.kind} · {acts.map((a) => a.primitive.kind).join(', ')}
        </span>
      </div>
      {done ? null : (
        <Composer design={parsed} hue="var(--pig)" setBar={setBar} onDone={() => setDone(true)} />
      )}
      <div className="cxb-bar">
        {bar && !done && (
          <button
            type="button"
            className="cxb-next"
            data-bench="advance"
            disabled={bar.primary.disabled}
            onClick={bar.primary.onClick}
          >
            {bar.primary.label}
          </button>
        )}
        {done && (
          <span className="cxb-done" data-bench="finished">
            finished
          </span>
        )}
      </div>
    </section>
  );
}

function Bench() {
  return (
    <div className="cxb-list">
      {SHOWN.map((x) => (
        <Item key={x.design.id} design={x.design} note={x.note} />
      ))}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Bench />
    </StrictMode>,
  );
}
