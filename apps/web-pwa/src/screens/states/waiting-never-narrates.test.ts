/**
 * NO WAITING STATE NARRATES (DESIGN.md §0.x; docs/EMAILS-AND-ANIMATIONS.md §3; the owner, 2026-09-09).
 *
 * "Never a percentage, never 'generating', never a sentence about what Wobo is doing." A tutor
 * fetching the next worksheet does not tell the room they are fetching the next worksheet. So the
 * product's waits show the orb doing the subject's thing and say NOTHING: no stage label, no
 * handwritten line about the pencil, no "reading the page, one moment", no bar with a number on it.
 *
 * This is the sibling of `never-narrate.test.ts` and works the same way, on the half of the law that
 * test does not reach: it reads every SENTENCE in the app (string literals of two words or more, and
 * the text between tags), because a one-word `'loading'` is a state name a machine reads and
 * `'Loading your lesson'` is a sentence a child reads.
 *
 * The second half asserts the replacement is actually mounted: the four surfaces where a lesson, a
 * course, a doubt or a board is waited for each draw `WaitScene`, so the law is kept by something on
 * the screen rather than by an empty box.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '../..');

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isFile()) {
    if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    walk(join(path, entry), out);
  }
  return out;
}

const FILES = walk(APP);

/** Comments explain a law; they do not break one. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1 ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

/**
 * Every sentence in a file: quoted strings and, in a component, the text between tags. A sentence is
 * something a person wrote for a person — two words or more, no code in it — so `'loading'` as a
 * state name is not one and "Loading your lesson" is.
 */
function sentences(source: string, isComponent: boolean): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.split(' ').length < 2) return;
    // code that happens to sit between two angle brackets, or inside a template literal
    if (/[;={}()[\]<>]|=>|\bconst\b|\buseState\b|\bfunction\b/.test(text)) return;
    if (text.startsWith('/') || text.startsWith('http')) return;
    // a class list or a token list: hyphenated words and nothing else
    if (/^[a-z0-9-]+( [a-z0-9-]+)*$/.test(text) && text.includes('-')) return;
    out.push(text);
  };
  for (const m of source.matchAll(/'([^'\\\n]{4,200})'/g)) push(m[1] as string);
  for (const m of source.matchAll(/"([^"\\\n]{4,200})"/g)) push(m[1] as string);
  for (const m of source.matchAll(/`([^`\\$]{4,200})`/g)) push(m[1] as string);
  // JSX text only in a component: in a .ts file the same shape is a generic, `useState<X>(null); …`
  if (isComponent) for (const m of source.matchAll(/>([^<>{}]{4,200})</g)) push(m[1] as string);
  return out;
}

interface Shape {
  name: string;
  re: RegExp;
}

const SHAPES: Shape[] = [
  // --- the stage of the work, reported --------------------------------------------------------
  { name: 'a stage of the making, reported', re: /\bwriting the lesson\b/i },
  { name: 'a stage of the making, reported', re: /\bdrawing the visuals\b/i },
  { name: 'a stage of the making, reported', re: /\bchecking every answer\b/i },
  { name: 'a wait telling the learner it is nearly over', re: /\balmost (?:ready|there)\b/i },
  { name: 'a wait naming itself', re: /\b(?:loading|generating|fetching)\b/i },
  { name: 'a wait naming itself', re: /\bstill (?:rendering|reading|being made)\b/i },
  { name: 'a caption for the wait', re: /\breading the page\b/i },
  // "one moment" as a caption, not as a moment in a sentence about a child's week
  { name: 'a caption for the wait', re: /(?:^|[,.]\s*)(?:one|just a) moment[.!]?$/i },
  { name: 'a caption for the wait', re: /\bplease wait\b/i },
  // --- the handwritten captions the boot screen used to rotate ---------------------------------
  {
    name: 'a handwritten caption for a wait',
    re: /\b(?:sharpening the pencil|warming up the ink|reading your syllabus|drawing your board|finding your place)\b/i,
  },
  {
    name: 'the board cold start narrating itself',
    re: /\b(?:opening your (?:shelf|world)|opening the .{1,40} shelf|laying your subjects|wiring the chapters|tidying the edges)\b/i,
  },
  // --- a number on a wait ----------------------------------------------------------------------
  { name: 'a percentage on a wait', re: /\b\d{1,3}\s?% (?:done|complete|ready)\b/i },
  { name: 'the software working, in the third person', re: /\bWobo is (?:making|building|preparing)\b/i },
];

/**
 * What survives, and why. An entry without a reason is the law being repealed quietly.
 * Nothing here may be a caption for a wait; each is a sentence about the SUBJECT or about what the
 * learner may do next, which is the test the law itself sets.
 */
const ALLOWED: { file: string; text: string; reason: string }[] = [];

function short(path: string): string {
  return relative(APP, path);
}

describe('no waiting state narrates', () => {
  it('scans a real set of files', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('finds no sentence anywhere that captions a wait', () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const name = short(file);
      for (const line of sentences(code(readFileSync(file, 'utf8')), file.endsWith('.tsx'))) {
        for (const shape of SHAPES) {
          const m = shape.re.exec(line);
          if (!m) continue;
          if (ALLOWED.some((a) => a.file === name && line.includes(a.text))) continue;
          hits.push(`${name}: [${shape.name}] "${line}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('what stands in the place of the words', () => {
  const mounts: [string, string][] = [
    ['screens/states/Scene.tsx', 'the long wait a learner chose to watch'],
    ['screens/course/Composing.tsx', 'a lesson, its picture and its film'],
    ['screens/doubt/DoubtScreen.tsx', 'a photographed page being read'],
    ['screens/FrameBuilding.tsx', 'the first learner on a board (docs/BOARD-COLD-START.md)'],
  ];

  for (const [file, what] of mounts) {
    it(`draws the orb doing the subject's thing while it waits for ${what}`, () => {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(source).toContain('WaitScene');
      expect(/<WaitScene\b/.test(source)).toBe(true);
    });
  }

  it('keeps the scene keyed to the subject rather than to one house animation', () => {
    for (const [file] of mounts) {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(/<WaitScene[\s\S]{0,200}?(subject=|scene=)/.test(source)).toBe(true);
    }
  });
});
