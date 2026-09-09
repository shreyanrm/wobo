/**
 * The hermetic bench page (`/board-bench.html`).
 *
 * Nothing but the design tokens and the hand: no router, no account, no scene bus, no companion.
 * A golden-board test that had to boot the whole app would be measuring the app, not the board —
 * and the latency budget in BOARD.md §10 is a budget on the hand.
 *
 * Dev only. Vite's production build has exactly one input (`index.html`), so this entry and the
 * fixtures it pulls in never reach a bundle a learner downloads.
 */

import '@fontsource-variable/caveat';
import '@fontsource-variable/plus-jakarta-sans';
import { fontFamily } from '@wobo/config';
import { cssVariables } from '@wobo/config/css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardBench } from './board-bench';
import { GlassBench, wantsGlassBench } from './glass-bench';

const STYLE_ID = 'wobo-tokens';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${cssVariables()}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--wobo-page); color: var(--wobo-ink-900); }
body { font-family: ${fontFamily.system}; }
`;
  document.head.appendChild(style);
}

// The theme is a plain attribute so a test can screenshot both without touching app state.
const theme = new URLSearchParams(window.location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

// `#glass/<scene>` is the other bench: the same hand on a real page, over the glass (glass-bench.tsx).
createRoot(root).render(
  <StrictMode>
    {wantsGlassBench(window.location.hash) ? <GlassBench /> : <BoardBench />}
  </StrictMode>,
);
