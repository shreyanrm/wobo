/**
 * Renders the eight moves FROM THE APP'S OWN ORB (docs/EMAILS-AND-ANIMATIONS.md §2).
 *
 *   node tools/orb/render.mjs            all eight
 *   node tools/orb/render.mjs wave spark just those
 *
 * What it does, in order: bundles `harness.tsx` (which mounts the real `WoboBody`) with the app's
 * own Vite, opens it in a headless Chromium WITH SOUND OFF, hands the rig a clock it drives itself,
 * photographs every frame, reads the transform the rig wrote on its own SVG, and writes
 *
 *   content/brand/orb/<move>.gif    the move, looping for ever, under 600 KB
 *   content/brand/orb/<move>.png    the first frame: the resting orb, for clients that freeze it
 *   content/brand/orb/motion.json   what the rig computed, frame by frame
 *   apps/web-pwa/src/ui/orb-moves.css   the same eight moves in CSS, generated from that record
 *
 * Nothing in this file draws Wobo, and nothing in it may. If a move needs a shape the rig does not
 * have, that shape belongs in the move table (tools/orb/moves.ts) where the stylesheet reads it too
 * — one source, which is rule 1 of the library.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { orbMovesCss } from './css.ts';
import { encodeGif } from './gif.ts';
import {
  MAX_GIF_BYTES,
  MOVE_NAMES,
  MOVES,
  ORB_SIZE,
  propSvg,
  RIG_SIZE,
  stagePercent,
  svgDataUri,
} from './moves.ts';
import { decodePng } from './png.ts';
import { WOBO_TONES } from '../../packages/wobo/src/identity.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const WEB = join(ROOT, 'apps/web-pwa');
const OUT = join(ROOT, 'content/brand/orb');
const CSS_OUT = join(WEB, 'src/ui/orb-moves.css');

/** How long the springs are given to settle before the first frame is taken. */
const SETTLE_MS = 960;
/** How long the idle clock runs before `sleeping` is filmed: past dozing, which the rig sets at 35 s. */
const DOZE_MS = 34_000;

const require = createRequire(join(WEB, 'package.json'));
/** Load a package out of the app's own node_modules, ESM or CommonJS, from up here. */
const load = async (name) => {
  const module = await import(pathToFileURL(require.resolve(name)).href);
  return module.default && !module.build && !module.chromium ? module.default : module;
};

async function bundleHarness() {
  const vite = await load('vite');
  const react = (await load('@vitejs/plugin-react')).default;
  const node = (path) => join(WEB, 'node_modules', path);
  const result = await vite.build({
    configFile: false,
    logLevel: 'error',
    // The harness lives outside the app, so the four packages it shares with the app are pointed at
    // by hand. Everything else it touches is a relative import of the rig's own source.
    resolve: {
      alias: {
        react: node('react'),
        'react-dom': node('react-dom'),
        // The rig reads one hook from the motion package; the barrel would drag in the whole kit.
        '@wobo/motion': join(ROOT, 'packages/motion/src/use-reduced-motion.ts'),
      },
      dedupe: ['react', 'react-dom'],
    },
    plugins: [react()],
    // React reads this; without it the bundle asks a browser for `process`.
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      target: 'chrome120',
      lib: {
        entry: join(HERE, 'harness.tsx'),
        formats: ['iife'],
        name: 'orbHarness',
        fileName: () => 'harness.js',
      },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  const chunk = output.find((part) => part.type === 'chunk');
  if (!chunk) throw new Error('the harness did not bundle');
  return chunk.code;
}

/** The props of a move, as the browser needs them: a data URI, an origin and keyframes. */
function dressing(name) {
  const props = MOVES[name].props ?? [];
  return props.map((prop) => ({
    layer: prop.layer,
    uri: svgDataUri(propSvg(prop, WOBO_TONES.light)),
    origin: prop.origin ? stagePercent(prop.origin) : undefined,
    keyframes: prop.keyframes.map((frame) => ({ ...frame })),
  }));
}

/** The pose that starts the move, in the rig's own vocabulary. */
function pose(name) {
  const spec = MOVES[name];
  return {
    mood: spec.mood,
    scene: spec.scene ?? null,
    sceneKey: 1,
    behaviour: spec.behaviour ?? null,
    behaviourKey: 1,
    gaze: spec.gaze,
    awake: spec.idle === 'awake',
  };
}

async function film(page, harness, name) {
  const spec = MOVES[name];
  const duration = spec.frames * spec.frameMs;
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: harness });
  await page.evaluate(
    ([stage, rig]) => {
      window.orb.mount(stage, rig);
    },
    [ORB_SIZE, RIG_SIZE],
  );
  // The springs settle at rest, and the first frame is taken there, on a bare bench: every move
  // opens on the same orb, which is what makes eight moves one character. The props are dressed
  // only after that frame is taken, because a prop layer under the rig changes how the browser
  // composites the rig itself (by a few levels per channel, but enough that the eight stills were
  // no longer one picture), and a prop is invisible at the start of every move anyway.
  await page.evaluate((ms) => window.orb.step(ms), SETTLE_MS);

  const clip = { x: 0, y: 0, width: ORB_SIZE, height: ORB_SIZE };
  const shots = [];
  const track = [];
  shots.push(await page.screenshot({ clip }));
  track.push(await page.evaluate(() => window.orb.read()));

  await page.evaluate((props) => {
    window.orb.dress(props);
    window.orb.propAt(0);
  }, dressing(name));
  await page.evaluate((next) => window.orb.set(next), pose(name));
  if (spec.idle === 'dozing') {
    // Wobo is not told to sleep. The idle clock is let out and the rig falls asleep by its own
    // rules — which is how the z's are earned (idle.ts: dozing at 35 s).
    await page.evaluate((ms) => window.orb.step(ms), DOZE_MS);
  }
  for (let i = 1; i < spec.frames; i += 1) {
    if (spec.restAt !== undefined && i === spec.restAt) {
      await page.evaluate(() =>
        window.orb.set({ mood: 'idle', scene: null, behaviour: null, gaze: null, awake: true }),
      );
    }
    await page.evaluate(
      ([ms, fraction]) => {
        window.orb.step(ms);
        window.orb.propAt(fraction);
      },
      [spec.frameMs, ((i * spec.frameMs) % duration) / duration],
    );
    shots.push(await page.screenshot({ clip }));
    track.push(await page.evaluate(() => window.orb.read()));
  }
  return { shots, track };
}

/**
 * The palette ladder. 255 colours is right for a flat orb on paper; if a move lands over the
 * design's ceiling the palette is narrowed rather than the move being shortened, because the
 * length of a move is a design decision and the number of greys in an antialiased edge is not.
 */
const PALETTES = [255, 192, 128, 96, 64];

function assemble(frames, name) {
  for (const maxColors of PALETTES) {
    const bytes = encodeGif(ORB_SIZE, ORB_SIZE, frames, { maxColors });
    if (bytes.length < MAX_GIF_BYTES) return { bytes, maxColors };
  }
  throw new Error(`${name} will not fit under ${MAX_GIF_BYTES} bytes`);
}

async function main() {
  const asked = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const names = asked.length > 0 ? asked : MOVE_NAMES;
  for (const name of names) {
    if (!MOVE_NAMES.includes(name)) throw new Error(`${name} is not one of the eight`);
  }
  mkdirSync(OUT, { recursive: true });

  const harness = await bundleHarness();
  const { chromium } = await load('@playwright/test');
  // THE LAB IS MUTED. An agent's browser plays through the owner's speakers; nothing here has any
  // sound to make, and it stays that way by instruction rather than by luck.
  const browser = await chromium.launch({ args: ['--mute-audio', '--force-color-profile=srgb'] });
  const page = await browser.newPage({
    viewport: { width: ORB_SIZE, height: ORB_SIZE },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });

  // A bench that fails silently is worse than no bench: anything the page throws is ours.
  page.on('pageerror', (error) => {
    process.stderr.write(`the bench threw: ${error.message}\n`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`the bench said: ${message.text()}\n`);
  });

  const tracks = {};
  try {
    for (const name of names) {
      const started = Date.now();
      const { shots, track } = await film(page, harness, name);
      const frames = shots.map((png, index) => ({
        rgba: decodePng(png).rgba,
        delayMs: MOVES[name].frameMs,
        index,
      }));
      const { bytes, maxColors } = assemble(frames, name);
      writeFileSync(join(OUT, `${name}.gif`), bytes);
      writeFileSync(join(OUT, `${name}.png`), shots[0]);
      tracks[name] = track;
      const kb = (bytes.length / 1024).toFixed(1);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(
        `${name}: ${shots.length} frames, ${kb} KB, ${maxColors} colours, ${seconds}s\n`,
      );
    }

    // The mark a still keeps: the rig's own spark, drawn by the rig with motion reduced.
    await page.evaluate(() => window.orb.reduce(true));
    await page.evaluate(() => window.orb.set({ mood: 'aha' }));
    await page.evaluate(() => window.orb.step(16));
    const spark = await page.evaluate(() => window.orb.spark());
    if (!spark) throw new Error('the rig drew no spark to take');

    if (names.length === MOVE_NAMES.length) {
      const geometry = await page.evaluate(() => window.orb.geometry());
      const motion = {
        renderedBy: 'tools/orb/render.mjs',
        rig: {
          viewBox: geometry.viewBox,
          size: RIG_SIZE,
          stage: ORB_SIZE,
          pivot: geometry.pivot,
        },
        spark,
        tracks,
      };
      writeFileSync(join(OUT, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
      writeFileSync(CSS_OUT, orbMovesCss(motion));
      process.stdout.write(`motion.json and orb-moves.css written\n`);
    } else {
      process.stdout.write('a partial run: motion.json and the stylesheet were left alone\n');
    }
  } finally {
    await browser.close();
  }
}

await main();
