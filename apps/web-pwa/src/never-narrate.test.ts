/**
 * NEVER NARRATE (DESIGN.md §0.x, docs/copy/voice.md §10c; the owner, 2026-09-08, from one screenshot).
 *
 * A tutor at a whiteboard does not say "I'll draw now." They draw. The product does not describe
 * itself to the person using it, does not announce what it is about to do, and never captions a
 * thing that is not there. The test for every line a learner reads: if you removed it, would the
 * learner lose anything about the SUBJECT? If not, it goes.
 *
 * This scans every learner-facing source in the app and the Wobo package (comments stripped, tests
 * skipped) for the shapes the owner saw:
 *   - self-reference: "I'm Wobo", "your AI wobot", "I can see"
 *   - announcement of an action: "let me draw", "I'll show", "drawn for you", "here is the idea"
 *   - a mode or surface describing itself: "coach mode · I nudge, you move", "Wobo is the student"
 *   - a caption for an absence: "being redrawn", "this idea", "Thinking…", a bare "drawing" pill
 *   - a label naming the software or the learner: "Wobo · with Learner"
 *
 * Everything allowed carries a reason. An entry without one is the law being repealed quietly.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP = resolve(import.meta.dir);
const WOBO = resolve(import.meta.dir, '../../../packages/wobo/src');
// The SDK's providers speak too (the keyless fallbacks Wobo says on a page), and its defaults
// minted the placeholder name. Same law, same scan.
const SDK = resolve(import.meta.dir, '../../../packages/sdk/src');
const ROOTS = [APP, WOBO, SDK];

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isFile()) {
    if (/\.(ts|tsx|css)$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    walk(join(path, entry), out);
  }
  return out;
}

const FILES = ROOTS.flatMap((root) => walk(root));

/** Comments are the place a law is explained, so they are not the place it is enforced. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1 ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

interface Shape {
  name: string;
  re: RegExp;
}

const SHAPES: Shape[] = [
  // --- self-reference -----------------------------------------------------------------------------
  { name: 'Wobo introducing itself', re: /\bI(?:'m| am) Wobo\b/ },
  { name: 'Wobo describing what it is', re: /\byour AI wobot\b/i },
  { name: 'Wobo describing its senses', re: /\bI can see\b/ },
  { name: 'Wobo describing its senses', re: /\bI am watching\b/ },
  { name: 'Wobo describing its senses', re: /\bfrom where I sit\b/ },
  { name: 'Wobo describing its senses', re: /\byour page in view\b/ },
  { name: 'Wobo narrating the process step by step', re: /\bI say what I read\b/ },
  // --- announcing an action -----------------------------------------------------------------------
  {
    name: 'announcing an action',
    re: /\b[Ll]et me (?:draw|show|build|put this|come back|take you|walk you|explain)\b/,
  },
  {
    name: 'promising an action',
    re: /\bI(?:'ll| will) (?:draw|show|help|take you|build|label|work one|walk you|compose|find your|be here|be right here)\b/,
  },
  { name: 'the product describing its own demo', re: /\bin thirty seconds\b/ },
  { name: 'a caption about the drawing, not the idea', re: /\b[Dd]rawn for you\b/ },
  { name: 'a stage direction as page copy', re: /\bhere is the idea\b/i },
  { name: 'made for you', re: /\bmade this just for you\b/i },
  { name: 'the textbook "Let us" fallback', re: /\bLet us look at this together\b/ },
  // --- a mode describing itself -------------------------------------------------------------------
  {
    name: 'a mode narrating its philosophy',
    re: /\b(?:learn|coach|hint|work-with-me|check-my-work|challenge|assessment|teach-back) mode\b/i,
  },
  { name: 'a mode narrating its philosophy', re: /\bI nudge, you move\b/ },
  { name: 'Wobo narrating its role', re: /\bWobo (?:is|plays) the (?:student|teacher)\b/ },
  {
    name: 'Wobo narrating what it is doing',
    re: /\bWobo is (?:drawing|thinking|writing|composing|animating|reading|still)\b/,
  },
  {
    name: "the classifier's scaffolding shown to the learner",
    re: /confidence · (?:high|medium|low)/,
  },
  { name: 'a surface narrating what it holds', re: /\bwhat Wobo is drawing\b/ },
  // --- a caption for an absence -------------------------------------------------------------------
  { name: 'a caption for a missing drawing', re: /\bbeing redrawn\b/ },
  { name: 'a placeholder concept', re: /(['"`])this idea\1/ },
  { name: 'a caption for waiting', re: /\bThinking…|'Thinking\.\.\.'/ },
  { name: 'a caption for an absence', re: /\b[Ii]t will land here on its own\b/ },
  { name: 'a caption for an absence', re: /\bhas not finished this one yet\b/ },
  { name: 'the seed of a conversation', re: /\bAsk me anything\./ },
  {
    name: 'a bare activity word as a pill',
    re: /<i\s*\/>\s*(?:thinking|drawing|loading|writing)\s*</,
  },
  // --- a label naming the software or the learner -----------------------------------------------
  { name: 'a header naming who is in the room', re: /·\s*with\s*\$\{/ },
  { name: 'a placeholder name', re: /(['"`])Learner\1/ },
  // "You · {name}" with the name empty rendered "You · · Class 8": a separator that needs a name
  // is written only when there is one.
  { name: 'a separator that still needs a name', re: /·\s*\{[^}]*\|\|\s*profile\.name\}/ },
];

interface Allowed {
  /** Path relative to the repo's apps/web-pwa/src or packages/wobo/src. */
  file: string;
  /** The exact matched text this entry permits. */
  text: string;
  /** Why the line survives the test "would the learner lose anything about the subject?". */
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: 'screens/pitch/MeetWobo.tsx',
    text: "I'm Wobo",
    reason:
      'the public "Meet Wobo" page: a visitor who has not met Wobo yet, and Wobo IS the subject of that page',
  },
  {
    file: 'screens/auth/copy.ts',
    text: "I'm Wobo",
    reason:
      'the sign-up door, said once at the first meeting; the account form has no subject to lose',
  },
  {
    file: 'screens/Onboarding.tsx',
    text: "I'll build",
    reason:
      'a control explaining what pasting a syllabus does (voice.md §6 sanctions "show me yours and I will build it"); remove it and the learner does not know what the button is for',
  },
  {
    file: 'curriculum/labels.ts',
    text: 'I will build',
    reason:
      'the same syllabus promise in the SDK (voice.md §6, "show me yours and I will build it"): the honest answer when no official syllabus exists, and what the paste box is for',
  },
];

/** An allow-list path is relative to whichever root holds it. */
function allowedPath(file: string): string {
  for (const root of ROOTS) {
    const p = join(root, file);
    if (existsSync(p)) return p;
  }
  return join(APP, file);
}

function short(path: string): string {
  for (const root of ROOTS) {
    if (path.startsWith(root)) return relative(root, path);
  }
  return path;
}

describe('never narrate: nothing a learner reads describes the software, announces an action, or captions an absence', () => {
  it('scans a real set of files', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('every allow-list entry carries a reason and still matches something', () => {
    for (const a of ALLOWED) {
      expect(a.reason.trim().length).toBeGreaterThan(20);
      const source = code(readFileSync(allowedPath(a.file), 'utf8'));
      expect(
        source.includes(a.text) ? null : `${a.file}: "${a.text}" no longer present`,
      ).toBeNull();
    }
  });

  it('finds no narrating line outside the allow-list', () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const source = code(readFileSync(file, 'utf8'));
      const name = short(file);
      for (const shape of SHAPES) {
        const m = source.match(shape.re);
        if (!m) continue;
        const allowed = ALLOWED.some((a) => a.file === name && m[0].includes(a.text));
        if (!allowed) hits.push(`${name}: [${shape.name}] "${m[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the seed of a conversation is the learner’s own words', () => {
    // No turn exists before the learner speaks: no "seed" bubble, no greeting.
    const runtime = code(readFileSync(join(APP, 'AppRuntime.tsx'), 'utf8'));
    expect(/id:\s*'seed'/.test(runtime)).toBe(false);
    expect(/Ask me anything\./.test(runtime)).toBe(false);
    // Wobo's answer to its own silent ask (the re-teach rung) is said in the drawer and never
    // archived: an archive that opens on a Wobo bubble with no learner turn before it is a
    // conversation nobody started. The reply is minted ephemeral, and the thread cache skips it.
    expect(/ephemeral:\s*true/.test(runtime)).toBe(true);
    expect(/saveThread\('wobo',\s*turns\.filter\(/.test(runtime)).toBe(true);
  });

  it('a reply on its way is announced to assistive tech, not captioned on screen', () => {
    // The drawer lost "Thinking…" and must carry aria-busy in its place, as the chat page does.
    const drawer = code(readFileSync(join(APP, 'wobo/Companion.tsx'), 'utf8'));
    expect(/aria-busy=\{busy/.test(drawer)).toBe(true);
  });
});
