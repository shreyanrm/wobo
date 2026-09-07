// The bundled fallback faces — still imported so a screen that has not moved to the kit yet keeps
// the face it was built on. Poppins and Caveat, the two faces DESIGN.md allows, are declared by
// src/ui/tokens.css out of public/fonts. Nothing reaches a font CDN.
import '@fontsource-variable/caveat';
import '@fontsource-variable/plus-jakarta-sans';
import { cssVariables } from '@wobo/config/css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootIsPublic } from './shell/public-routes';
import { migrateLegacyKeys } from './store/legacy-keys';
import { bootScope } from './store/scope';
import { initAccess } from './ui/access';
import { initMotion } from './ui/motion';
import { initTheme } from './ui/theme';
import { initVibe } from './ui/viewPref';
// Palette v4 — the paper, the inks, the pigments, the two faces, and the page's base (DESIGN.md §2).
import './ui/tokens.css';
import { LEGACY_TOKEN_BRIDGE } from './ui/tokens';

// FIRST, before any store reads: an already-installed device still has its world under the
// pre-rename key names. Move it forward, once, or the rename would read as a wipe.
migrateLegacyKeys();
// THEN, still before any store reads: key the device to the learner it was last keyed to, so the
// one sentinel the boot reads (has this learner finished setup?) is read under their name.
bootScope();

// The older `--wobo-*` token layer, then the bridge that lays it onto palette v4 — the bridge comes
// second on purpose, so a screen not yet rebuilt reads the new paper without a specificity fight.
// The page's own base (body, headings, the faces) lives in src/ui/tokens.css.
const STYLE_ID = 'wobo-tokens';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${cssVariables()}
${LEGACY_TOKEN_BRIDGE}
/* No interpolate-size: Chrome implements it, Safari ignores it — any effect it ever has is a
   Chrome-only divergence (auto-size transitions animating in Chrome, snapping in Safari).
   All auto-height choreography is framer-motion, which never needs it. */
html { scroll-behavior: smooth; }
body { text-rendering: optimizeLegibility; }
h1, h2, h3, h4 { text-wrap: balance; }
p, li { text-wrap: pretty; }
/* Wobo blue is the brand's pigment — selection and focus carry it; the ring is as bold as any line Wobo draws. */
::selection { background: var(--pig-w); color: var(--ink); }
:focus-visible { outline: 3px solid var(--pig); outline-offset: 2px; }
/* One scrollbar: the page's own, thin and quiet. Inner scroll areas scroll invisibly. */
html { scrollbar-width: none; }
::-webkit-scrollbar { display: none; width: 0; height: 0; }
* { scrollbar-width: none; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
`;
  document.head.appendChild(style);
}

initTheme();
initMotion();
initAccess();
// How the climb looks — Quest or Focused. Stamped on the root HERE, before the first render, so
// the map's first paint is already the learner's own vibe rather than a default it flips out of.
initVibe();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

/**
 * The boot loader IS the character (docs/WOBO-PLAN.md §16), and the whole scene is the one the
 * owner directed: the pen crosses the page and draws the first hairline the product will show, the
 * line loops into the orb, Wobo settles, a handwritten line arrives underneath, and the last word
 * is always "Your place is saved". Under a second, and then it is gone — no spinner, no skeleton,
 * no progress bar anywhere in the product.
 *
 * There is exactly ONE of these in the app. The long wait for a generation shows the same scene
 * (`screens/states/Scene.tsx`), and so does the wait for the runtime's chunk (`App.tsx`), so a
 * learner never meets two different loaders in one session.
 *
 * It covers the APP's boot. The public site is not the app: the landing page and the document
 * pages behind it have their own opening, they need no runtime to be readable, and a curtain over
 * a page that is already there would only be a second of somebody's time spent on nothing.
 *
 * It lives in its own root above the app so it is not held up by anything the app is doing, and it
 * carries its own dismissal so a slow or failed mount can never leave a learner staring at it.
 */
if (!bootIsPublic()) {
  const boot = document.createElement('div');
  boot.id = 'wobo-boot';
  boot.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--wobo-page);transition:opacity 180ms ease';
  document.body.appendChild(boot);
  const bootRoot = createRoot(boot);
  let bootGone = false;
  const dismissBoot = () => {
    if (bootGone) return;
    bootGone = true;
    boot.style.opacity = '0';
    boot.style.pointerEvents = 'none';
    setTimeout(() => {
      bootRoot.unmount();
      boot.remove();
    }, 200);
  };
  // The scene is fetched rather than bundled into the entry: it is Wobo's real rig, and a document
  // page on the public site must not carry the character's whole body to show a paragraph. The
  // request goes out on the same beat as the app's, so on the app's own boot it costs nothing.
  void import('./screens/states/Scene').then(({ LoadingScene }) => {
    if (bootGone) return;
    bootRoot.render(<LoadingScene width={264} onDone={dismissBoot} />);
  });
  // A backstop: whatever happens to the loader, the app is never behind a curtain for long.
  setTimeout(dismissBoot, 2500);
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
