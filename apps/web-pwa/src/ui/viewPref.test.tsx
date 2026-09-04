/**
 * THE ONE RULE THAT CANNOT BEND: the two vibes are one set of data.
 *
 * The owner's brief for this wave — "same content, same approach, but vibe depending on their
 * interests" — has exactly one failure mode worth building a test around: a learner switches look
 * and their curriculum quietly changes. So the first block below renders the SAME climb twice,
 * once in each vibe, and asserts that the node list, the order, the states, the gating and every
 * topic title come back identical, and that the only two strings that moved are the reward's and
 * the chapter test's.
 *
 * The second block closes the other door. A stylesheet can hide a node without any component
 * knowing, so `ui/vibe.css` is held to a property allow-list and to being the ONLY sheet in the
 * app that keys off `[data-vibe]`. A vibe rule may repaint a mark, retone a dot, change a face and
 * pull a corner in. It may not lay anything out, reorder anything, or make anything disappear.
 *
 * The rest is the preference itself: the default, persistence, the per-learner scope, and the
 * carry-forward from the 'list' | 'adventure' preference this replaces.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MasteryBand } from '@wobo/contracts';
import type { Chapter, Topic, TopicKind } from '../data/model';
import type { Vibe } from './viewPref';

// ── the environment these modules expect ──────────────────────────────────────────────────────
// A localStorage stand-in (the shape store/scope.ts talks to), and just enough of a document for
// the `data-vibe` stamp to land somewhere we can read back.
//
// Both are installed for the LIFE OF THIS FILE and taken away again. `bun test` runs every file in
// one process, and a `document` left lying around is read by every `typeof document === 'undefined'`
// guard in the app — leaving one behind failed six tests in three other files that have no idea
// this one exists.

class FakeStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new FakeStorage();

const root = {
  attrs: new Map<string, string>(),
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  },
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  },
};

type Globals = { document?: unknown; localStorage?: unknown };
const g = globalThis as Globals;
const realDocument = g.document;
const realStorage = g.localStorage;

beforeAll(() => {
  g.localStorage = storage;
  g.document = { documentElement: root };
});

afterAll(() => {
  if (realDocument === undefined) g.document = undefined;
  else g.document = realDocument;
  if (realStorage === undefined) g.localStorage = undefined;
  else g.localStorage = realStorage;
});

const { renderToStaticMarkup } = await import('react-dom/server');
const { applyScope } = await import('../store/scope');
const { VibeSwitch } = await import('./vibe');
const { DEFAULT_VIBE, getVibe, initVibe, isVibe, setVibe, VIBE_KEY, VIBES, vibeWords } =
  await import('./viewPref');

/** Put the module back where a fresh boot finds it: no storage, no scope, no cached value. */
function reboot(): void {
  storage.clear();
  applyScope(null);
  root.attrs.clear();
  initVibe();
}

beforeEach(reboot);

// ── the climb the app actually ships ──────────────────────────────────────────────────────────
// NOT a stand-in. `ClimbView` is the component `screens/learn/Climb.tsx` renders on the Learn tab
// of every subject, and the map under it is built by the real `buildClimb` from real topic shapes.
// A stub would keep passing while the shipped climb quietly learned to hide, reorder or relabel a
// node per vibe, which is the exact failure this block exists to prevent — so the shipped one is
// what is rendered, and the only thing the test supplies is a chapter.
//
// The chapter mirrors the drawing (design/prototypes/app-climb.html): topics behind them, one that
// slipped, one they added themselves (the reward), where they are, the ground under a later topic,
// and the gate the map appends. Every state the map can produce is on it, so "identical in both
// vibes" is a claim about the whole surface rather than about a happy path.

const UI_DIR = import.meta.dir;
const SRC = join(UI_DIR, '..');
const REPO = join(SRC, '..', '..', '..');

const { buildClimb } = await import('../screens/learn/climb-map');
const { ClimbView } = await import('../screens/learn/Climb');

const topic = (id: string, name: string, kind: TopicKind = 'syllabus'): Topic => ({
  id,
  chapterId: 'c4',
  name,
  blurb: '',
  prereqTopicIds: [],
  kind,
  xp: 120,
});

const CHAPTER: Chapter = {
  id: 'c4',
  subjectId: 'Mathematics',
  index: 4,
  name: 'Fractions that are not whole',
  topics: [
    topic('t1', 'What the bottom number counts'),
    topic('t2', 'Halves, thirds, quarters'),
    topic('t3', 'Same size, different name'),
    topic('t4', 'Adding when the bottoms match'),
    topic('t5', 'Why a fraction of a fraction shrinks', 'custom'),
    topic('t6', 'Adding when the bottoms do not match'),
    topic('t7', 'Taking one fraction from another'),
    topic('t8', 'A fraction of a fraction'),
    topic('t9', 'Dividing by a fraction'),
  ],
};

const BANDS: Record<string, MasteryBand> = {
  t1: 'secure',
  t2: 'independent',
  t3: 'emerging', // completed, then it slipped — the debt
  t4: 'secure',
  t5: 'secure',
};

/** The map, built once, exactly as the Learn tab builds it. */
const MAP = buildClimb(CHAPTER, {
  completed: new Set(['t1', 't2', 't3', 't4', 't5']),
  bandOf: (t) => BANDS[t.id] ?? 'not_started',
  groundOf: (t) =>
    t.id === 't8' ? [{ topicId: 't7', name: 'Taking one fraction from another' }] : [],
  checkOf: () => null,
  waysOf: (t) => (t.id === 't6' ? 2 : 0),
  topicProgress: {},
});

/** Every `<attr>="value"` in document order — the list the two vibes have to agree on. */
function attr(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1] as string);
}

function climbIn(vibe: Vibe): string {
  setVibe(vibe);
  expect(getVibe()).toBe(vibe);
  return renderToStaticMarkup(<ClimbView map={MAP} open={() => {}} />);
}

/** The class list of every node on the spine — its side, its state and its kind, in order. */
const nodeClasses = (html: string): string[] =>
  attr(html, 'class').filter((c) => c.startsWith('cl-n '));

/**
 * Every card's accessible name, keyed by the node it belongs to. Each one is
 * `${title}. ${index} of ${total}. ${status}`, so one map holds the titles, the order, the
 * positions and the status lines at once — everything the vibe is forbidden to move.
 */
function cards(html: string): Map<string, string> {
  const labels = attr(html, 'aria-label').filter((l) => / \d+ of \d+\. /.test(l));
  return new Map(labels.map((l) => [l.match(/ (\d+) of \d+\. /)?.[1] as string, l]));
}

describe('the two vibes are one set of data', () => {
  it('builds a climb with every state on it, so the comparison below is worth making', () => {
    // if this ever thins out, the identity assertions after it stop proving anything
    const states = MAP.nodes.map((n) => `${n.kind}:${n.state}`);
    expect(states).toEqual([
      'topic:learnt',
      'topic:learnt',
      'topic:debt',
      'topic:learnt',
      'reward:learnt',
      'topic:now',
      'topic:ahead',
      'topic:ahead',
      'topic:ahead',
      'gate:ahead',
    ]);
    expect(MAP.nodes.filter((n) => n.slipped)).toHaveLength(1);
    expect(MAP.nodes.filter((n) => n.bridge)).not.toHaveLength(0);
  });

  it('renders the same nodes, in the same order, with the same states and the same gating', () => {
    const quest = nodeClasses(climbIn('quest'));
    const focused = nodeClasses(climbIn('focused'));
    expect(quest).toHaveLength(MAP.nodes.length);
    // the class list carries the side, the state and the kind of every node — everything a
    // stylesheet or a component could use to paint one differently
    expect(focused).toEqual(quest);
  });

  it('changes two words and no others', () => {
    const quest = cards(climbIn('quest'));
    const focused = cards(climbIn('focused'));
    expect(quest.size).toBe(MAP.nodes.length);
    const moved = [...quest.keys()].filter((k) => quest.get(k) !== focused.get(k));
    // the reward at position 5 and the chapter end at position 10, nothing else in the whole map
    expect(moved).toEqual(['5', '10']);
    expect(quest.get('5')).toStartWith('A chest. 5 of 10.');
    expect(focused.get('5')).toStartWith('Unlocked. 5 of 10.');
    expect(quest.get('10')).toStartWith('The summit. 10 of 10.');
    expect(focused.get('10')).toStartWith('Chapter complete. 10 of 10.');
  });

  it('keeps the reward’s own topic name in both looks, so only the costume moved', () => {
    for (const vibe of VIBES) {
      expect(cards(climbIn(vibe)).get('5')).toContain('Why a fraction of a fraction shrinks');
    }
  });

  it('says the same thing about every other node, word for word', () => {
    const quest = cards(climbIn('quest'));
    const focused = cards(climbIn('focused'));
    for (const [at, label] of quest) {
      if (at === '5' || at === '10') continue;
      expect({ at, label: focused.get(at) }).toEqual({ at, label });
    }
  });

  it('draws the same arc, the same bridge and the same chips either way', () => {
    const parts = (html: string) => ({
      arcs: html.split('cl-loop').length - 1,
      bridges: html.split('cl-bridge').length - 1,
      chips: [...html.matchAll(/aria-label="Open ([^"]+) first"/g)].map((m) => m[1]),
      spine: html.match(/--reached:([^;"]+)/)?.[1],
      stats: [...html.matchAll(/<div class="cl-stat"><b>(\d+)<\/b><span>([^<]*)</g)].map(
        (m) => `${m[1]} ${m[2]}`,
      ),
    });
    expect(parts(climbIn('focused'))).toEqual(parts(climbIn('quest')));
    expect(parts(climbIn('quest')).arcs).toBeGreaterThan(0);
    expect(parts(climbIn('quest')).bridges).toBeGreaterThan(0);
  });

  it('carries both marks in both vibes, so the switch is a repaint and never a remount', () => {
    // The stylesheet picks which of the pair is visible. If a component chose instead, a toggle
    // would unmount a subtree — and an unmounted node is a node that can fail to come back.
    for (const vibe of VIBES) {
      const html = climbIn(vibe);
      expect(html.split('cl-i-q').length - 1).toBe(2);
      expect(html.split('cl-i-f').length - 1).toBe(2);
    }
  });

  it('has the same two words for every learner, whatever they are called', () => {
    expect(vibeWords('quest')).toEqual({ reward: 'A chest', chapterEnd: 'The summit' });
    expect(vibeWords('focused')).toEqual({ reward: 'Unlocked', chapterEnd: 'Chapter complete' });
  });

  it('reaches the vibe from exactly one place in the climb, and asks it for nothing else', () => {
    // The seam itself: `Climb.tsx` may call `vibeWords`, and may read nothing else off the look.
    const source = readFileSync(join(SRC, 'screens', 'learn', 'Climb.tsx'), 'utf8');
    expect([...source.matchAll(/useVibe\(\)/g)]).toHaveLength(1);
    expect([...source.matchAll(/words\.[a-zA-Z]+/g)].map((m) => m[0]).sort()).toEqual([
      'words.chapterEnd',
      'words.reward',
    ]);
    // and the derivation below it never hears about the look at all — it names the seam in a
    // comment, which is the point, so this asks about IMPORTS rather than about prose
    const map = readFileSync(join(SRC, 'screens', 'learn', 'climb-map.ts'), 'utf8');
    const imports = [...map.matchAll(/^import .*?from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.filter((i) => (i as string).includes('viewPref'))).toEqual([]);
    expect(imports.filter((i) => (i as string).includes('vibe'))).toEqual([]);
  });
});

// ── the stylesheet cannot change the climb either ─────────────────────────────────────────────

const VIBE_CSS = readFileSync(join(UI_DIR, 'vibe.css'), 'utf8');
const PROTOTYPE = readFileSync(join(REPO, 'design', 'prototypes', 'app-climb.html'), 'utf8');

/**
 * Every `selector{declarations}`, one entry per selector (a comma-separated rule is split, so a
 * declaration written once for two selectors is compared under each of them), comments dropped.
 */
function rules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = (m[1] as string).replace(/\s+/g, ' ').replace(/"/g, "'").trim();
    const decls = (m[2] as string)
      .split(';')
      .map((d) =>
        d
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\s*:\s*/, ':')
          // `13px/1.4` and `13px / 1.4` are the same shorthand; Biome writes one, the prototype
          // the other. Normalising here keeps the comparison about values, not about formatters.
          .replace(/\s*\/\s*/g, '/')
          .replace(/"/g, "'"),
      )
      .filter(Boolean);
    if (!head || head.startsWith('@')) continue;
    for (const selector of head.split(',').map((s) => s.trim())) {
      if (selector) out.set(selector, [...(out.get(selector) ?? []), ...decls]);
    }
  }
  return out;
}

/**
 * The same stylesheet with every `@media` block removed outright, rather than flattened into the
 * rules above it. The phone floor legitimately re-declares what the desktop rule said, so a
 * flattened sheet would report two values for one property and no comparison could hold.
 */
function withoutMedia(css: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = css.indexOf('@media', i);
    if (at === -1) return out + css.slice(i);
    out += css.slice(i, at);
    let j = css.indexOf('{', at);
    if (j === -1) return out;
    let depth = 0;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    i = j;
  }
}

/** Every stylesheet the app ships, by path relative to src. */
function sheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sheets(full, found);
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

describe('ui/vibe.css is the whole surface a vibe can act through', () => {
  it('is the only stylesheet in the app that keys off the vibe', () => {
    // Rules, not raw text: the climb's own sheet names this seam in a comment, which is the point.
    const elsewhere = sheets(SRC)
      .filter((f) => f !== join(UI_DIR, 'vibe.css'))
      .filter((f) =>
        [...rules(readFileSync(f, 'utf8')).keys()].some((s) => s.includes('data-vibe')),
      )
      .map((f) => f.slice(SRC.length + 1));
    expect(elsewhere).toEqual([]);
  });

  it('knows only the two vibes', () => {
    const stamped = new Set(
      [...VIBE_CSS.matchAll(/\[data-vibe=['"]([^'"]+)['"]\]/g)].map((m) => m[1] as string),
    );
    expect([...stamped].every(isVibe)).toBe(true);
  });

  it('never lays anything out, reorders anything, or hides a node', () => {
    // The allow-list IS the brief: a mark, a tone, a shape, a face, a corner. Nothing else.
    const ALLOWED = new Set([
      'background',
      'color',
      'width',
      'height',
      'border-radius',
      'font',
      'stroke-dasharray',
      'display',
    ]);
    for (const [selector, decls] of rules(VIBE_CSS)) {
      if (!selector.includes('[data-vibe')) continue;
      for (const d of decls) {
        const prop = d.split(':')[0] as string;
        expect({ selector, prop, allowed: ALLOWED.has(prop) }).toEqual({
          selector,
          prop,
          allowed: true,
        });
        // `display` is how one mark of a pair is shown and the other put away. On anything else it
        // would be how a node disappears, which is the failure this whole file exists to prevent.
        if (prop === 'display') {
          expect(selector.includes('.cl-i-q') || selector.includes('.cl-i-f')).toBe(true);
        }
      }
    }
  });

  it('anchors every vibe rule to the document root', () => {
    // DESIGN.md §0 trap 1: a short name that means two things. `data-vibe` already means something
    // else in this app — screens/landing/art.tsx puts it on two illustrations and
    // landing/engine/motion.ts selects on it. A bare `[data-vibe=…]` here would one day match one
    // of those. app-climb.html is one page and can afford the bare form; this sheet cannot.
    for (const selector of rules(VIBE_CSS).keys()) {
      if (!selector.includes('[data-vibe')) continue;
      expect({ selector, anchored: selector.startsWith(':root') }).toEqual({
        selector,
        anchored: true,
      });
    }
  });

  /**
   * The one rule that is deliberately NOT the prototype's, and why. Adding a second entry here
   * means having a reason as good as this one.
   *
   * The prototype's `.cl-i-f{display:none}` is (0,1,0) and its own `.cl-dot svg{…display:block…}`
   * is (0,1,1), so app-climb.html in Quest actually paints both marks inside the reward dot —
   * measured in Chromium against the file, `getComputedStyle` returns `block` for each. The port
   * states the resting state as what it means, at a specificity nothing else can outrank.
   */
  const DIVERGENCES: Record<string, string> = {
    ":root:not([data-vibe='focused']) .cl-i-f":
      'the prototype hides the focused mark at a specificity its own .cl-dot svg outranks',
  };

  it('is Fable’s hand, not a second opinion — every rule is app-climb.html’s, verbatim', () => {
    const proto = rules(withoutMedia(PROTOTYPE));
    const mine = rules(withoutMedia(VIBE_CSS));
    expect(mine.size).toBeGreaterThan(10);
    for (const [selector, decls] of mine) {
      if (DIVERGENCES[selector]) continue;
      // The `:root` anchor above is the one difference, and it changes no declaration.
      const source = proto.get(selector.replace(/^:root\[data-vibe/, '[data-vibe'));
      expect({ selector, decls }).toEqual({ selector, decls: source ?? [] });
    }
    // Every divergence is a real rule; none is a stale exemption for something that moved on.
    for (const selector of Object.keys(DIVERGENCES)) expect(mine.has(selector)).toBe(true);
  });

  it('hides the resting mark at a specificity no other sheet can outrank', () => {
    // (0,3,0) against the (0,1,1) of a `.cl-dot svg` — the climb's sheet is then free to style its
    // marks however it likes, and the vibe still shows exactly one of each pair.
    const resting = rules(VIBE_CSS).get(":root:not([data-vibe='focused']) .cl-i-f");
    expect(resting).toEqual(['display:none']);
  });

  it('animates nothing, so a vibe can never be a cause of jitter', () => {
    // DESIGN.md §0: one owner per animated property. This sheet owns none — a toggle is a repaint.
    for (const decls of rules(VIBE_CSS).values()) {
      for (const d of decls) {
        expect(d.startsWith('transition') || d.startsWith('animation')).toBe(false);
      }
    }
    expect(VIBE_CSS).not.toContain('@keyframes');
  });

  it('gives the switch the 44px touch floor a phone needs', () => {
    const phone = VIBE_CSS.slice(VIBE_CSS.indexOf('@media (max-width: 640px)'));
    expect(phone).toContain('min-height: 44px');
  });
});

// ── the switch ────────────────────────────────────────────────────────────────────────────────

describe('the vibe switch', () => {
  it('is a labelled group of two buttons that each say whether they are on', () => {
    setVibe('quest');
    const html = renderToStaticMarkup(<VibeSwitch />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="How the climb looks"');
    expect(attr(html, 'aria-pressed')).toEqual(['true', 'false']);
    expect(html).toContain('>Quest<');
    expect(html).toContain('>Focused<');
    // Native buttons: reachable by Tab, pressable with Enter and Space, nothing re-implemented.
    expect(html.split('<button type="button"').length - 1).toBe(2);
  });

  it('follows the learner’s choice', () => {
    setVibe('focused');
    expect(attr(renderToStaticMarkup(<VibeSwitch />), 'aria-pressed')).toEqual(['false', 'true']);
  });

  it('nothing it writes exclaims, and nothing it writes is a name', () => {
    const copy = [...VIBES.map((v) => vibeWords(v)), { a: 'Quest', b: 'Focused' }]
      .flatMap((o) => Object.values(o))
      .join(' ');
    expect(copy).not.toContain('!');
  });
});

// ── the preference ────────────────────────────────────────────────────────────────────────────

describe('the vibe preference', () => {
  it('opens on Quest, because the map is a climb', () => {
    expect(getVibe()).toBe(DEFAULT_VIBE);
    expect(DEFAULT_VIBE).toBe('quest');
  });

  it('is stamped on the document root, so a stylesheet can read it before anything renders', () => {
    initVibe();
    expect(root.getAttribute('data-vibe')).toBe('quest');
    setVibe('focused');
    expect(root.getAttribute('data-vibe')).toBe('focused');
  });

  it('is remembered', () => {
    setVibe('focused');
    expect(storage.getItem(VIBE_KEY)).toBe('focused');
  });

  it('refuses anything that is not a vibe', () => {
    setVibe('focused');
    setVibe('adventure' as Vibe);
    expect(getVibe()).toBe('focused');
  });

  it('belongs to the learner, not the tablet', () => {
    applyScope('learner-a');
    setVibe('focused');
    // The sibling picks the phone up. They get the default, not the look somebody else chose.
    applyScope('learner-b');
    expect(getVibe()).toBe('quest');
    expect(root.getAttribute('data-vibe')).toBe('quest');
    applyScope('learner-a');
    expect(getVibe()).toBe('focused');
    expect(root.getAttribute('data-vibe')).toBe('focused');
    expect(storage.getItem(`${VIBE_KEY}::learner-a`)).toBe('focused');
    expect(storage.getItem(`${VIBE_KEY}::learner-b`)).toBeNull();
  });

  it('carries the deleted list / adventure preference forward, then drops it', () => {
    storage.setItem('wobo-view-pref-v1', 'list');
    initVibe();
    expect(getVibe()).toBe('focused');
    expect(storage.getItem(VIBE_KEY)).toBe('focused');
    expect(storage.getItem('wobo-view-pref-v1')).toBeNull();
  });

  it('reads adventure as the quest it became', () => {
    storage.setItem('wobo-view-pref-v1', 'adventure');
    storage.setItem(VIBE_KEY, 'focused');
    initVibe();
    // An explicit new choice always wins: the old key is only ever a fallback.
    expect(getVibe()).toBe('focused');
    storage.removeItem(VIBE_KEY);
    storage.setItem('wobo-view-pref-v1', 'adventure');
    initVibe();
    expect(getVibe()).toBe('quest');
  });
});
