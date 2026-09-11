/**
 * The doubt solver's screen, held to its laws at source (the way screens/law-v5.test.ts holds
 * the app sheets): what the files SAY, before a browser renders any of it. The rendered proof at
 * 390, 834 and 1440 in both themes is the responsive suite (tests/responsive.spec.ts, which now
 * carries the `/doubt` row) and tests/doubt.spec.ts.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERASURE_REGISTER } from '@wobo/sdk';
import { resolveDestination } from '../../shell/destinations';
import { pathToRoute, routeToPath } from '../../shell/router';

const HERE = import.meta.dir;
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
/** A source with every space taken out: what the code says, not how the formatter wrapped it. */
const packed = (source: string) => source.replace(/\s+/g, '');

const SCREEN = read('DoubtScreen.tsx');
const ENTRY = read('DoubtEntry.tsx');
const STAGE = read('PhotoStage.tsx');
const MEMORY = read('DoubtMemory.tsx');
const CSS = read('doubt.css');
const FRAME = read('../../shell/AppFrame.tsx');
const YOU = read('../You.tsx');
const RUNTIME = read('../../AppRuntime.tsx');
const PROOF = read('../../../tests/helpers/proof.ts');
const OWN = [SCREEN, ENTRY, STAGE, MEMORY, CSS, read('flow.ts'), read('api.ts'), read('climb.ts')];

describe('the entry — one tap from wherever a learner is', () => {
  it('opens the camera on a phone: a real file input with capture=environment', () => {
    expect(ENTRY).toContain('type="file"');
    expect(ENTRY).toContain('accept="image/*"');
    expect(ENTRY).toContain('capture="environment"');
    // the screen's own camera control is the same shape, and its picker leaves capture off
    expect(SCREEN.match(/capture="environment"/g)).toHaveLength(1);
    expect(SCREEN).toContain('Choose a file');
  });

  it('is mounted by the frame every authenticated screen wears, and stands down on its own screen', () => {
    expect(FRAME).toContain('<DoubtEntry />');
    expect(FRAME).toContain("router.route.name !== 'doubt'");
  });

  it('has an address, and Wobo can be asked to go there', () => {
    expect(routeToPath({ name: 'doubt' })).toBe('/doubt');
    expect(pathToRoute('/doubt')).toEqual({ name: 'doubt' });
    expect(RUNTIME).toContain("route.name === 'doubt' && <DoubtScreen />");
    const nav = resolveDestination('take me to the doubt solver');
    expect(nav && 'route' in nav ? nav.route : null).toEqual({ name: 'doubt' });
  });

  it('a laptop gets drag-and-drop as well as the picker', () => {
    expect(SCREEN).toContain('onDrop=');
    expect(SCREEN).toContain('onDragOver=');
    expect(SCREEN).toContain('e.dataTransfer.files');
  });
});

describe('law 1 — the reading is shown before the answer', () => {
  it('the reading line is on screen with the text editable in place, and only then Explain', () => {
    expect(SCREEN).toContain('readingLine(reading)');
    // one input per line the gateway read, under the gateway's own line id
    expect(SCREEN).toContain('<ol className="db-lines">');
    expect(SCREEN).toContain("dispatch({ type: 'editLine', id: line.id, text: e.target.value })");
    // Explain is gated on the reducer's own gate, never on a local boolean
    expect(SCREEN).toContain('const canExplain = explainAllowed(state)');
    expect(SCREEN).toContain('disabled={!canExplain}');
  });

  it('the region a reading came from lights on the photo when tapped, in the text or on the page', () => {
    expect(STAGE).toContain("className={on ? 'db-region db-lit' : 'db-region'}");
    // read without whitespace: how deep the chip sits in the tree is the formatter's business, and
    // pinning one line wrapping made a layout change look like a broken law
    expect(packed(SCREEN)).toContain(
      packed("dispatch({ type: 'light', regionId: state.lit === r.id ? null : r.id"),
    );
  });
});

describe('law 2 — the photo obeys the memory law', () => {
  it('the memory page lists the photos with a remove, and the erasure register names the store', () => {
    expect(YOU).toContain('<DoubtMemory />');
    expect(MEMORY).toContain('removeDoubt(id, { gatewayUrl: GATEWAY_URL })');
    expect(MEMORY).toContain('drainDoubtErasures');
    // the pictures come from the gateway; the device keeps no bytes
    expect(MEMORY).toContain('doubtPhotoUrl(GATEWAY_URL, d.id)');
    const entry = ERASURE_REGISTER.find((e) => e.store.includes('learner.doubts'));
    expect(entry?.reach).toBe('gateway');
    expect(entry?.why).toContain('DELETE /v1/doubt/{id}');
    expect(entry?.why).toContain('/v1/me/erase');
  });

  it('a refusal keeps the line the gateway wrote, and nothing is kept before it was explained', () => {
    expect(SCREEN).toContain('err instanceof DoubtUnreadable');
    // saveDoubt is called only in the keep() that runs after the explanation ends
    expect(SCREEN.match(/saveDoubt\(/g)).toHaveLength(1);
    expect(SCREEN.indexOf('saveDoubt(')).toBeGreaterThan(
      SCREEN.indexOf("dispatch({ type: 'explained' })"),
    );
  });
});

describe('law 3 and law 5 — the photo is a surface, and the ink rides the same wire', () => {
  it('the stage registers the regions through the registry hook, and edits nothing of the registry', () => {
    expect(STAGE).toContain("import { useSurface } from '@wobo/wobo'");
    expect(STAGE).toContain('useSurface(');
    expect(STAGE).toContain('photoSurface(photoId, regions, frame');
  });

  it('the explanation is asked through the one conversation with the doubt packet on it', () => {
    expect(SCREEN).toContain('await ask(explainPrompt(state), { doubt: packet })');
    expect(RUNTIME).toContain('if (options.doubt) {');
    expect(RUNTIME).toContain(
      "await askBoard(text, { board: true }, context, 'explain_this', options.doubt)",
    );
    // the answer streams from the doubt's own door with the corrections as the body
    expect(RUNTIME).toContain('endpoint: doubtAnswerPath(doubt.id)');
    expect(RUNTIME).toContain('body: answerBody(doubt.lines, doubt.words)');
  });

  it('scroll holds during a stroke and releases: the hold is wired to the screen store', () => {
    expect(SCREEN).toContain('strokeHold(');
    expect(SCREEN).toContain('screenStore.subscribe(');
    expect(SCREEN).toContain("root.style.overflow = 'hidden'");
    expect(CSS).toContain('.db-photo.db-held{touch-action:none}');
  });
});

describe('law 4 — a doubt joins the climb', () => {
  it('places the doubt under a topic, on the map, and on the scheduler', () => {
    expect(SCREEN).toContain('joinClimb(itemId.current, topic.id');
    expect(SCREEN).toContain('reportProgress: progress.reportProgress');
    expect(SCREEN).toContain('nodeId: state.result?.climb.nodeId');
    expect(SCREEN).toContain('Where does this belong?');
  });
});

describe('law v5 and the six traps, at source', () => {
  it('every class the feature adds is namespaced db- (trap 1)', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = [...rules.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] as string);
    const foreign = classes.filter((c) => !c.startsWith('db-') && c !== 'wk-btn');
    expect(foreign).toEqual([]);
  });

  it('nothing long is nowrap (trap 4), no descendant selector reaches past a child (trap 3)', () => {
    expect(CSS).not.toContain('nowrap');
    // every compound selector uses `>`; a bare descendant space would be `.a .b`
    const descendant = [...CSS.matchAll(/\.[a-z0-9-]+ \.[a-z0-9-]+/g)].map((m) => m[0]);
    expect(descendant).toEqual([]);
  });

  it('no transition rides transform or opacity (motion law), no pigment washes a surface', () => {
    expect(CSS.match(/transition\s*:[^;}]*\b(transform|opacity|all)\b/)).toBeNull();
    expect(CSS).not.toMatch(/var\(--[a-z]+-w\)/);
    expect(CSS).not.toContain('border:1px');
  });

  it('every control the feature draws is at least 44px', () => {
    for (const rule of [
      '.db-entry{',
      '.db-region',
      '.db-tools > .wk-btn',
      '.db-row > .wk-btn',
      '.db-parts > button',
      '.db-mem-row > .wk-btn',
    ]) {
      expect(CSS).toContain(rule);
    }
    expect(CSS).toContain('width:52px;height:52px');
    expect(STAGE).toContain('const MIN_HIT = 44');
    expect(CSS.match(/min-height:44px/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('the one pointer per view is the primary action', () => {
    // capture: Take a photo (or, signed out, Sign in); confirm: Explain; placed: Another doubt.
    // One pig per view; the signed-out capture view is its own view.
    expect(SCREEN.match(/wk-pig|tone="pig"/g)).toHaveLength(4);
  });

  it('the copy law: no em dash, no late hour, no name, sentence case', () => {
    for (const source of OWN) {
      // the strings a learner can read, not the comments a developer does
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const strings = code.match(/['"`][^'"`\n]*['"`]/g) ?? [];
      for (const s of strings) {
        expect(s, s).not.toContain('—');
        expect(s, s).not.toMatch(/\b(10 ?pm|midnight|tonight|late at night|before bed)\b/i);
      }
    }
  });

  it('the whole flow is keyboard reachable: real inputs, real buttons, Escape on a region', () => {
    expect(ENTRY).toContain('<input');
    expect(CSS).toContain('.db-entry:focus-within{outline:3px solid var(--pig)');
    expect(CSS).toContain('.db-region:focus-visible');
    expect(CSS).toContain('.db-text:focus-visible');
    expect(SCREEN).toContain('lineInputs.current.get(id)?.focus()');
    expect(STAGE).toContain("if (e.key === 'Escape') props.onLight(null)");
    expect(STAGE).toContain('type="button"');
  });

  it('the responsive proof measures the screen at every width and theme', () => {
    expect(PROOF).toContain("path: '/doubt'");
  });
});

/**
 * THE PANE ENDS WHERE WOBO'S OWN FURNITURE BEGINS (the adversary, wave 42 re-judge, finding 1;
 * docs/INK-FOUR.md, craft "nothing under a panel, sheet, toast or pill" and experience "after the
 * turn the learner can act on what they see").
 *
 * Wave 49's finding 8 closed the CAPTURE step and nothing else. One step on, at 390x844 with a
 * photo read, the reading sat under the fixed Tell Wobo pill, the instruction under the tab bar,
 * and EXPLAIN at y 1302 in an 844 px viewport — 458 px below a fold nothing scrolled to.
 *
 * The rendered proof is `tests/doubt-confirm.spec.ts`, which measures the painted boxes and the
 * hit test at both widths, both themes and with motion reduced. These are the two laws that file
 * cannot see: that the height is MEASURED rather than copied from another sheet, and that the
 * laptop layout is left exactly as it was.
 */
describe('the confirm step is whole on the glass (INK-FOUR, craft and experience)', () => {
  it('the pane is measured against the live chrome, never against a number copied from it', () => {
    expect(SCREEN).toContain('function bottomChrome()');
    expect(SCREEN).toContain("style.position !== 'fixed'");
    expect(SCREEN).toContain("setProperty('--db-pane'");
    // and the main column's own bottom padding, which clears the same tab bar, is cancelled so the
    // page does not scroll to nothing underneath the pane
    expect(SCREEN).toContain("setProperty('--db-tail'");
    expect(CSS).toContain('var(--db-pane,auto)');
    expect(CSS).toContain('var(--db-tail,0px)');
  });

  it('the phone pane scrolls the reading inside itself and docks what comes next at its foot', () => {
    // three rows: the photo keeps the top, the reading scrolls, the action is docked
    expect(CSS).toContain('grid-template-rows:auto minmax(0,1fr) auto');
    expect(CSS).toMatch(/\.db-read\{[^}]*overflow-y:auto/);
    // and it fades over its last 20px, because the corrections are below the fold of that scroller
    expect(CSS).toMatch(/\.db-read\{[^}]*mask-image:linear-gradient/);
    // a grid with a definite height sizes a row to that row's minimum, which for the printed
    // caption is one line of the four it holds: max-content rows are never shrunk under their words
    expect(CSS).toMatch(/\.db-read\{[^}]*grid-auto-rows:max-content/);
    expect(SCREEN).toContain('ref={readRef}');
    expect(packed(SCREEN)).toContain(
      packed('{phone && nextStep ? <div className="db-act">{nextStep}</div> : null}'),
    );
    // written once and put in one of two places, so a laptop keeps the action inside the reading
    expect(SCREEN.match(/\{phone \? null : nextStep\}/g)).toHaveLength(2);
  });

  it('the photo keeps its place, so a line tapped in the reading lights somewhere the eye is', () => {
    expect(STAGE).toContain("regionEls.current.get(lit)?.scrollIntoView?.({ block: 'nearest'");
    expect(CSS).toContain('--db-photo-vh:26vh');
    expect(STAGE).toContain('var(--db-photo-vh,');
  });

  it('the page holds still under the pen, and so does the one thing that scrolls', () => {
    expect(SCREEN).toContain("scroller.style.overflowY = 'hidden'");
    expect(SCREEN).toContain('scroller.style.overflowY = scrolledBefore');
  });

  it('the rendered proof measures the step a learner reaches with a photo', () => {
    const spec = read('../../../tests/doubt-confirm.spec.ts');
    expect(spec).toContain('elementsFromPoint');
    expect(spec).toContain('there is nothing below the fold to reach');
    expect(spec).toContain("{ name: '390', width: 390, height: 844 }");
    expect(spec).toContain("{ name: '1440', width: 1440, height: 900 }");
  });
});

describe("the fixer's pass, 2026-09-05, at source", () => {
  it('the door asks an anonymous session to sign in BEFORE any shutter, on the entry and on the screen', () => {
    expect(ENTRY).toContain('const door = doorFor(sdk.account)');
    expect(ENTRY).toContain("if (door === 'sign-in') {");
    expect(ENTRY).toContain("router.navigate({ name: 'sign-in' })");
    expect(SCREEN).toContain("state.phase === 'capture' && door === 'sign-in'");
    expect(SCREEN).toContain("state.phase === 'capture' && door === 'camera'");
  });

  it('the learner has a place for their own words, and a line input carries the one ceiling', () => {
    expect(SCREEN).toContain("dispatch({ type: 'words', text: e.target.value })");
    expect(SCREEN).toContain('maxLength={MAX_LINE_CHARS}');
    expect(SCREEN).toContain('const packet = doubtPacket(state)');
    expect(SCREEN).not.toContain('doubtPacket(state, explainPrompt(state))');
  });

  it('the chips are ranked for this doubt, not the first eight of the world', () => {
    expect(SCREEN).not.toContain('loadedTopics().slice(0, 8)');
    expect(SCREEN).toContain(
      'suggestTopics(reading, state.result?.reading.topic, loadedTopics(), progress.topicProgress)',
    );
  });

  it('the printed caption follows the beat: the runtime feeds say frames with their time, the screen prints what is due', () => {
    expect(RUNTIME).toContain('if (doubt) doubtCaption.begin();');
    expect(RUNTIME).toContain('if (doubt) doubtCaption.say(said, t ?? 0, dur);');
    expect(RUNTIME).toContain('if (doubt) doubtCaption.end();');
    expect(SCREEN).toContain('setCaption(doubtCaption.visible())');
    expect(SCREEN).toContain("{state.phase === 'explaining' ? caption || 'One moment.' : said}");
  });
});

/**
 * A REFUSAL THE LEARNER NEVER SEES IS NOT A REFUSAL (the adversary, wave 49, finding 8).
 *
 * Measured on a real screen at 1440x900: the sentence "I cannot see the page on this device..."
 * sat at top 1382 with the page 1520 tall and scrollY 0 — 482 px below the fold, and the page did
 * not scroll to it. The cause was the hero camera: a `<svg>` with a viewBox and no size is a
 * replaced element with an intrinsic ratio, so it took the whole column's width and 1:1 of its
 * height (1072 px at 1440), and the panel it sits in grew to 1390 px with the refusal at its foot.
 *
 * Two rules, so no future layout can bury one: the hero icon carries its own size, and a refusal
 * that appears off the fold brings itself into view.
 */
describe('a refusal is in view (INK-FOUR, experience)', () => {
  it('the hero camera carries its own size, so the panel cannot grow to the height of its column', () => {
    const rule = CSS.split('\n').find((l) => /^\.db-drop\s*>\s*svg\{/.test(l));
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/width:\d+px/);
    expect(rule).toMatch(/height:\d+px/);
  });

  it('the refusal brings itself into view, and honours reduce motion when it does', () => {
    expect(SCREEN).toContain('refusalRef');
    expect(SCREEN).toContain('scrollIntoView');
    expect(SCREEN).toContain("'(prefers-reduced-motion: reduce)'");
    // both places a refusal can be printed carry the ref — the capture panel and the confirm step
    expect(SCREEN.match(/ref=\{refusalRef\}/g)).toHaveLength(2);
    expect(SCREEN.match(/className="db-error"/g)).toHaveLength(2);
  });
});
