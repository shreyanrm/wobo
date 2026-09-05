/**
 * THE DOUBT SOLVER, RENDERED (screens/doubt): the whole flow in a real browser at a phone, a
 * tablet and a laptop width, in both themes, against a gateway answered in the browser.
 *
 * What is measured, and printed as it is measured:
 *   · the taps from "I have a doubt" to the first line of explanation;
 *   · LAW 1: the reading line is on screen, editable, with its regions, before Explain does anything,
 *     and a MISREAD DIGIT the learner fixes is what the answer is asked with (the fixture reads 8x,
 *     the page says 3x);
 *   · LAW 5: the order the explanation ARRIVES in — the sentence, then its stroke, then the next
 *     sentence, then its stroke — sampled from the DOM every 50 ms while the turn plays, so a turn
 *     that drew everything at once, or nothing until the words were over, would show in the samples;
 *     and the PRINTED caption grows sentence by sentence on the same clock, never the whole
 *     paragraph before the first stroke (the sound-off half of the law);
 *   · LAW 3: every stroke Wobo drew resolves onto the photo's box, none off the page;
 *   · LAW 2: the memory page lists the photo, and Remove sends the delete before the row leaves;
 *   · law v5: no horizontal overflow, nothing clipped, every control 44 px, both themes, no console
 *     errors — the responsive suite's own audit, plus a tap-target pass at every width.
 *
 * Run: `bunx playwright test --config tests/doubt.config.ts` from apps/web-pwa.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { seedOnboarded, watchConsole } from './helpers';
import { applyTheme, auditViewport, type Finding, settle, type Theme } from './helpers/proof';

const OUT = process.env.WOBO_PROOF_DIR ?? join(process.cwd(), 'shots', 'doubt');
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 834, height: 1194 },
  { width: 1440, height: 900 },
] as const;
const THEMES: readonly Theme[] = ['light', 'dark'];

// --- the gateway, answered in the browser ---------------------------------------------------------

const DOUBT_ID = 'd-e2e-01';
/** What the learner types beside the photo on the confirm step. */
const OWN_WORDS = 'I do not get how the 5 moves across';

/**
 * `POST /v1/doubt` as services/gateway doubt.py answers it (`Doubt.as_dict()` plus `say`): the
 * lines it read, each with a corner box in fractions of the page the spec draws below. The first
 * line is MISREAD on purpose (8x for the page's 3x; a 3 becomes an 8, the brief's own example), so
 * the proof has to change a digit and show the changed digit arriving in the answer body.
 */
const READ = {
  doubt: DOUBT_ID,
  created_at: '2026-09-05T09:00:00Z',
  status: 'read',
  words: '',
  say: 'I read this as: 8x + 5 = 20; 5; 20. Is that right? Fix anything I got wrong first.',
  reading: {
    subject: 'Mathematics',
    topic: 'linear equations',
    question: 'Solve 8x + 5 = 20 for x.',
    lines: [
      { id: 'r1', text: '8x + 5 = 20', box: [0.09, 0.2, 0.55, 0.275] },
      { id: 'r2', text: '5', box: [0.285, 0.2, 0.35, 0.275] },
      { id: 'r3', text: '20', box: [0.43, 0.2, 0.54, 0.275] },
    ],
    width: 900,
    height: 1200,
  },
  climb: { node_id: null, node_name: null, framework_id: null },
};

type Frame = Record<string, unknown>;
const say = (t: number, text: string, dur: number): Frame => ({ type: 'say', text, t, dur });
const circle = (id: string, target: string, t: number): Frame => ({
  type: 'ink',
  t,
  object: {
    id,
    kind: 'circle',
    anchor: { target },
    pad: 10,
    t: { start: t, dur: 500 },
  },
});

/** A conforming answer: each stroke inside the sentence about it, stroke by sentence. */
const TURN: Frame[] = [
  say(0, 'I read this as 3x plus 5 equals 20. Look at the five first.', 2400),
  circle('c-five', 'r2', 300),
  say(2400, 'It moves to the other side and becomes minus five.', 2400),
  circle('c-rhs', 'r3', 2700),
  say(4800, 'So three x is fifteen, and x is five.', 2200),
  circle('c-eq', 'r1', 5000),
  { type: 'done', t: 7000, objects: 3, presentation: 'screen' },
];

const sse = (frames: Frame[]): string =>
  frames.map((f, i) => `id: turn:${i}\ndata: ${JSON.stringify(f)}\n\n`).join('');

interface Hit {
  method: string;
  path: string;
  accept: string;
  doubt?: unknown;
}

async function fakeGateway(page: Page, log: Hit[], photo: () => Buffer | null): Promise<void> {
  let kept = false;
  // the record as the gateway holds it: the corrections the answer carried are written into it
  let record: typeof READ = READ;
  await page.route('**/gw/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/gw/, '');
    const method = req.method();
    const hit: Hit = { method, path, accept: req.headers().accept ?? '' };
    let body: Record<string, unknown> = {};
    try {
      body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    } catch {
      // no body
    }
    const json = (status: number, content: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(content) });
    if (path === '/v1/doubt' && method === 'POST') {
      log.push(hit);
      // the reading is asked for with the bytes and their type, nothing about the learner
      const image = body.image as Record<string, unknown> | undefined;
      expect(Object.keys(image ?? {}).sort()).toEqual(['data', 'mediaType']);
      expect(Object.keys(body).every((k) => ['image', 'words', 'framework_id'].includes(k))).toBe(
        true,
      );
      kept = true;
      return json(200, READ);
    }
    if (path === `/v1/doubt/${DOUBT_ID}/answer` && method === 'POST') {
      hit.doubt = body;
      log.push(hit);
      const fixes = new Map(
        ((body.lines as { id: string; text: string }[] | undefined) ?? []).map((l) => [
          l.id,
          l.text,
        ]),
      );
      record = {
        ...record,
        words: typeof body.words === 'string' ? body.words : record.words,
        reading: {
          ...record.reading,
          lines: record.reading.lines.map((l) => ({ ...l, text: fixes.get(l.id) ?? l.text })),
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: sse(TURN),
      });
    }
    if (path === '/v1/doubt' && method === 'GET') {
      log.push(hit);
      return json(200, { doubts: kept ? [{ ...record, status: 'answered' }] : [] });
    }
    if (path === `/v1/doubt/${DOUBT_ID}/photo` && method === 'GET') {
      log.push(hit);
      const bytes = photo();
      if (!kept || !bytes) return json(404, { code: 'not_found' });
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: bytes });
    }
    if (path.startsWith('/v1/doubt/') && method === 'DELETE') {
      log.push(hit);
      kept = false;
      return json(200, { erased: { doubts: 1, photos: 1 } });
    }
    // everything else the app asks the gateway at boot (me, flags, voice): not here, honestly
    return json(404, { code: 'not_found' });
  });
}

// --- the page the learner photographs -----------------------------------------------------------

/** A textbook page drawn on a canvas: the equation sits where READING says it does. */
async function pageImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#14142B';
    g.font = '500 32px sans-serif';
    g.fillText('Exercise 4.2', 80, 160);
    g.font = '600 64px sans-serif';
    g.fillText('3x + 5 = 20', 90, 300);
    g.font = '400 30px sans-serif';
    g.fillText('Solve for x. Show each step.', 90, 380);
    g.fillStyle = '#8A8A9E';
    for (let y = 460; y < 1100; y += 56) g.fillRect(90, y, 720, 2);
    return c.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

// --- measurements ---------------------------------------------------------------------------------

interface Sample {
  at: number;
  said: number;
  strokes: number;
  objects: string[];
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** One stroke, measured the moment it landed: screen ink fades six seconds later by its own law. */
interface Stroke {
  id: string;
  at: number;
  onPage: boolean;
  box: Box;
}
interface Timeline {
  samples: Sample[];
  strokes: Stroke[];
}

/**
 * Sample the DOM every 50 ms: how much Wobo has said, and which strokes are on the photo. Each
 * stroke is measured against the photo's box the first time it is seen (LAW 3), because the screen
 * surface fades its ink after the sentence and a measurement taken after the turn would find the
 * first strokes gone.
 */
function timeline(page: Page, ms: number): Promise<Timeline> {
  return page.evaluate(
    (duration) =>
      new Promise<Timeline>((resolve) => {
        const start = performance.now();
        const samples: Sample[] = [];
        const strokes: Stroke[] = [];
        const seen = new Set<string>();
        let lastSaid = -1;
        let lastStrokes = -1;
        const tick = () => {
          const said = (
            document.querySelector('[data-testid="doubt-said"]')?.textContent ?? ''
          ).trim().length;
          const svg = document.querySelector(
            '[data-wobo-surface][aria-label="Wobo\'s ink on this screen"]',
          );
          const photo = document
            .querySelector('[data-testid="doubt-photo"]')
            ?.getBoundingClientRect();
          const groups = svg ? [...svg.querySelectorAll('[data-wobo-object]')] : [];
          const objects = groups.map((g) =>
            // the renderer suffixes an id with its redraw generation (`r-five#0`)
            (g.getAttribute('data-wobo-object') ?? '').replace(/#\d+$/, ''),
          );
          const now = Math.round(performance.now() - start);
          groups.forEach((g, i) => {
            const id = objects[i] ?? '';
            if (seen.has(id)) return;
            seen.add(id);
            const b = (g as SVGGElement).getBBox();
            const m = (g as SVGGElement).getScreenCTM();
            const box = m
              ? {
                  x: m.a * b.x + m.e,
                  y: m.d * b.y + m.f,
                  width: m.a * b.width,
                  height: m.d * b.height,
                }
              : { x: 0, y: 0, width: 0, height: 0 };
            const onPage =
              !!photo &&
              box.x >= photo.left - 1 &&
              box.y >= photo.top - 1 &&
              box.x + box.width <= photo.right + 1 &&
              box.y + box.height <= photo.bottom + 1;
            strokes.push({ id, at: now, onPage, box });
          });
          if (said !== lastSaid || objects.length !== lastStrokes) {
            samples.push({ at: now, said, strokes: objects.length, objects });
            lastSaid = said;
            lastStrokes = objects.length;
          }
          if (performance.now() - start < duration) setTimeout(tick, 50);
          else resolve({ samples, strokes });
        };
        tick();
      }),
    ms,
  );
}

/** Every visible control the feature draws, with its size. */
async function tapTargets(page: Page): Promise<{ name: string; w: number; h: number }[]> {
  return page.evaluate(() => {
    const out: { name: string; w: number; h: number }[] = [];
    const nodes = document.querySelectorAll(
      '.db-wrap button, .db-wrap label.db-take, .db-wrap textarea, .db-wrap input[type="file"], .db-entry, .db-mem button',
    );
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden
      if (el instanceof HTMLInputElement) continue; // the visually hidden input lives inside its label
      out.push({
        name: (el.getAttribute('aria-label') ?? el.textContent ?? el.className).trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    return out;
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
}

async function bothThemes(
  page: Page,
  width: number,
  state: string,
  findings: Finding[],
  small: { name: string; w: number; h: number }[],
): Promise<void> {
  for (const theme of THEMES) {
    await applyTheme(page, theme);
    await settle(page, 400);
    await shoot(page, `doubt-${state}-${width}-${theme}`);
    findings.push(
      ...(await auditViewport(page, width)).map((f) => ({
        ...f,
        detail: `${state}/${theme}: ${f.detail}`,
      })),
    );
    for (const t of await tapTargets(page))
      if (t.w < 44 || t.h < 44) small.push({ ...t, name: `${state}/${theme}: ${t.name}` });
  }
  await applyTheme(page, 'light');
}

test.describe.configure({ mode: 'serial' });

for (const size of WIDTHS) {
  test(`the whole doubt at ${size.width}px: camera, reading, ink on the photo, the climb, the memory page`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await seedOnboarded(page);
    const noise = watchConsole(page);
    // The stub answers the boot paths it does not carry (me, flags, voice) with 404, and Chromium
    // logs each as "Failed to load resource" on the page's behalf. That is the harness talking, not
    // the app; every other console error stays fatal.
    const errors = {
      get list() {
        return noise.filter((e) => !/Failed to load resource: .* 404/.test(e));
      },
    };
    const hits: Hit[] = [];
    let taken: Buffer | null = null;
    await fakeGateway(page, hits, () => taken);
    await page.setViewportSize(size);
    const findings: Finding[] = [];
    const small: { name: string; w: number; h: number }[] = [];
    let taps = 0;

    // --- the entry: the capture screen, then the camera --------------------------------------------
    await page.goto('/doubt');
    await expect(page.getByText('Take a photo of the doubt')).toBeVisible();
    await bothThemes(page, size.width, 'capture', findings, small);

    const photo = await pageImage(page);
    taken = photo;
    // TAP 1: the camera. On a phone `capture="environment"` opens the back camera; the OS shutter
    // and its "Use photo" happen inside the camera and are not the app's taps.
    await page
      .locator('.db-wrap input[capture="environment"]')
      .setInputFiles({ name: 'page.jpg', mimeType: 'image/jpeg', buffer: photo });
    taps += 1;

    // --- LAW 1: the reading is shown before the answer ---------------------------------------------
    const line = page.getByTestId('doubt-reading-line');
    await expect(line).toHaveText('I read this as 8x + 5 = 20; 5; 20. Is that right?');
    await expect(page.locator('[data-region]')).toHaveCount(3);
    const explain = page.getByRole('button', { name: 'Explain', exact: true });
    await expect(explain).toBeEnabled();
    expect(hits.filter((h) => h.path.endsWith('/answer'))).toHaveLength(0); // nothing computed yet
    // the line a reading came from lights on the photo when tapped (not counted: optional)
    await page.locator('[data-region="r2"]').click();
    await expect(page.locator('[data-region="r2"]')).toHaveClass(/db-lit/);
    await bothThemes(page, size.width, 'confirm', findings, small);
    // the learner corrects the misread digit in place (8x on the reading, 3x on the page), and
    // the CHANGED digit is what the answer is asked with, by id; then says in their own words
    // what they do not get
    const first = page.getByRole('textbox', { name: /Line 1 as I read it/ });
    await first.fill('3x + 5 = 20');
    await expect(line).toHaveText('I read this as 3x + 5 = 20; 5; 20. Is that right?');
    await page.getByRole('textbox', { name: /Your own words about this doubt/ }).fill(OWN_WORDS);

    // --- LAW 5: it explains while it draws --------------------------------------------------------
    const run = timeline(page, 8500);
    // TAP 2: Explain.
    await explain.click();
    taps += 1;
    const firstLine = page.getByTestId('doubt-said');
    await expect(firstLine).toContainText('Look at the five first');
    const tapsToFirstLine = taps;
    await page.waitForTimeout(3000);
    await shoot(page, `doubt-explaining-${size.width}-light`);
    const tl = await run;
    const turn = hits.find((h) => h.path.endsWith('/answer'));
    expect(turn?.path).toBe(`/v1/doubt/${DOUBT_ID}/answer`);
    expect(turn?.accept).toContain('text/event-stream');
    const asked = turn?.doubt as { lines?: { id: string; text: string }[]; words?: string };
    expect(asked?.lines).toEqual([
      { id: 'r1', text: '3x + 5 = 20' },
      { id: 'r2', text: '5' },
      { id: 'r3', text: '20' },
    ]);
    expect(asked?.words).toBe(OWN_WORDS);
    // the reader's own question (which still says 8x) travelled nowhere
    expect(JSON.stringify(asked)).not.toContain('8x');

    const arrivals = tl.strokes.map((s) => [s.id, s.at] as const).sort((a, b) => a[1] - b[1]);
    const firstSaid = tl.samples.find((s) => s.said > 0)?.at ?? -1;
    console.log(
      `\n[${size.width}px] taps to the first line of explanation: ${tapsToFirstLine}` +
        `\n[${size.width}px] first words on screen at ${firstSaid} ms; strokes landed: ${arrivals
          .map(([id, at]) => `${id}@${at}ms`)
          .join(', ')}`,
    );
    // the words are there before the first stroke, and the strokes come one by one with the
    // sentences (seconds apart), never all at once and never after the words are over
    expect(arrivals.map(([id]) => id)).toEqual(['c-five', 'c-rhs', 'c-eq']);
    expect(firstSaid).toBeGreaterThanOrEqual(0);
    expect(firstSaid).toBeLessThanOrEqual(arrivals[0]?.[1] ?? 0);
    expect((arrivals[1]?.[1] ?? 0) - (arrivals[0]?.[1] ?? 0)).toBeGreaterThan(1200);
    expect((arrivals[2]?.[1] ?? 0) - (arrivals[1]?.[1] ?? 0)).toBeGreaterThan(1200);
    // and the PRINTED caption follows the same beat: it grows in steps, and at the first stroke it
    // is still short of the whole paragraph (with the sound off, words and strokes arrive together)
    const captionSteps = [...new Set(tl.samples.map((s) => s.said).filter((n) => n > 0))];
    const finalCaption = Math.max(...captionSteps);
    const atFirstStroke =
      tl.samples.filter((s) => s.at <= (arrivals[0]?.[1] ?? 0)).at(-1)?.said ?? 0;
    console.log(
      `[${size.width}px] caption grew in ${captionSteps.length} steps (${captionSteps.join(' > ')} chars); ` +
        `${atFirstStroke} of ${finalCaption} chars on screen at the first stroke`,
    );
    expect(captionSteps.length).toBeGreaterThanOrEqual(3);
    expect(atFirstStroke).toBeLessThan(finalCaption);

    // --- LAW 3: every stroke on the page ----------------------------------------------------------
    const strokes = tl.strokes;
    console.log(
      `[${size.width}px] strokes on the photo: ${strokes
        .map(
          (s) =>
            `${s.id}:${s.onPage ? 'on page' : 'OFF PAGE'} ${Math.round(s.box.width)}x${Math.round(s.box.height)}`,
        )
        .join(', ')}`,
    );
    expect(strokes.length).toBeGreaterThanOrEqual(3);
    expect(strokes.filter((s) => !s.onPage)).toEqual([]);

    // --- LAW 4: it joins the climb ----------------------------------------------------------------
    await expect(
      page.getByText(/Filed under|Where does this belong\?|Kept with your doubts/),
    ).toBeVisible({
      timeout: 20_000,
    });
    await bothThemes(page, size.width, 'placed', findings, small);

    // --- LAW 2: the memory page, and a remove that reaches the server -----------------------------
    await page.getByRole('button', { name: 'See my doubts' }).click();
    const memory = page.getByTestId('doubt-memory');
    await expect(memory).toContainText('3x + 5 = 20');
    await memory.getByRole('button', { name: /Remove this photo/ }).click();
    await expect(memory).toContainText('No photos yet');
    const erased = hits.find((h) => h.method === 'DELETE');
    expect(erased?.path).toBe(`/v1/doubt/${DOUBT_ID}`);
    // the picture on the memory page came from the gateway, not from the device
    expect(hits.some((h) => h.path === `/v1/doubt/${DOUBT_ID}/photo`)).toBe(true);
    console.log(
      `[${size.width}px] remove sent ${erased?.method} ${erased?.path} before the row left`,
    );

    // --- law v5 -----------------------------------------------------------------------------------
    console.log(
      `[${size.width}px] audit findings: ${findings.length === 0 ? 'none' : findings.map((f) => `${f.check} ${f.selector} (${f.detail})`).join('; ')}` +
        `\n[${size.width}px] controls under 44px: ${small.length === 0 ? 'none' : small.map((s) => `${s.name} ${s.w}x${s.h}`).join('; ')}` +
        `\n[${size.width}px] console errors: ${errors.list.length === 0 ? 'none' : errors.list.join(' | ')}`,
    );
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, `doubt-${size.width}.json`),
      JSON.stringify(
        {
          width: size.width,
          taps: tapsToFirstLine,
          timeline: tl,
          strokes,
          findings,
          small,
          errors,
          hits,
        },
        null,
        2,
      ),
    );
    expect(findings).toEqual([]);
    expect(small).toEqual([]);
    expect(errors.list).toEqual([]);
  });
}
