import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_TROUBLE_COPY, saveTroubleLine } from './SaveTrouble';

const DIR = import.meta.dir;
/** The rules only. Comments explain the traps by name, and would match every check below. */
const CSS = readFileSync(join(DIR, 'SaveTrouble.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TSX = readFileSync(join(DIR, 'SaveTrouble.tsx'), 'utf8');

/**
 * The line a child reads when their work is not reaching their account. It is the one place the
 * product admits the boot loader's "Your place is saved" was not the whole story, so what it says
 * matters more than most copy in the app.
 */
describe('the save-trouble line is kind, honest and never a wall', () => {
  it('tells the learner their work is safe here, because it is', () => {
    for (const offline of [true, false]) {
      expect(saveTroubleLine(offline).toLowerCase()).toContain('safe on this device');
    }
  });

  it('never blames the learner and never says anything is lost', () => {
    const lines = [saveTroubleLine(true), saveTroubleLine(false), SAVE_TROUBLE_COPY.retry];
    for (const line of lines) {
      expect(line).not.toMatch(/\byou (did|broke|caused)\b/i);
      expect(line).not.toMatch(/\bfailed\b|\berror\b|\bcrash\b|\bwarning\b/i);
      // "Nothing is lost" is allowed; a bare "lost" claiming their work is gone is not.
      expect(line).not.toMatch(/\bwork (is|was) lost\b|\blost your\b/i);
    }
  });

  it('shows no status code, no stack trace and no provider name', () => {
    for (const line of [saveTroubleLine(true), saveTroubleLine(false)]) {
      expect(line).not.toMatch(/\b[45]\d\d\b/);
      expect(line).not.toMatch(/supabase|postgrest|pgrst|fetch|http/i);
    }
  });

  it('says something different when the learner is simply offline', () => {
    expect(saveTroubleLine(true)).not.toBe(saveTroubleLine(false));
    // The offline line names the connection, not a fault, and promises what happens next.
    expect(saveTroubleLine(true).toLowerCase()).toContain('back online');
  });

  it('names no late hour (hours.test.ts holds the same law for every surface)', () => {
    for (const line of [saveTroubleLine(true), saveTroubleLine(false)]) {
      expect(line).not.toMatch(/\b\d{1,2}\s?(am|pm)\b|tonight|midnight|late at night/i);
    }
  });

  it('offers a way out, and says so while it is trying', () => {
    expect(SAVE_TROUBLE_COPY.retry.length).toBeGreaterThan(0);
    expect(SAVE_TROUBLE_COPY.retrying).not.toBe(SAVE_TROUBLE_COPY.retry);
  });
});

/**
 * DESIGN.md §0. Trap 1 in particular: a short class name that means two things has printed a stray
 * box in this repo more than once, so every class this file adds is namespaced and greppable.
 */
describe('the strip obeys the design law', () => {
  const classes = [...CSS.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] as string);

  it('namespaces every class it adds', () => {
    for (const name of classes) expect(name.startsWith('wst-')).toBe(true);
  });

  it('uses only palette tokens, never a hard-coded colour', () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/\brgba?\(/);
  });

  it('never sets nowrap, which has forced this page wide before (trap 4)', () => {
    expect(CSS).not.toContain('nowrap');
  });

  it('carries min-width:0 so it can never widen the page', () => {
    expect(CSS).toContain('min-width: 0');
  });

  it('is a note, not an alarm: it takes no focus and blocks nothing', () => {
    expect(TSX).toContain('aria-live="polite"');
    expect(TSX).toContain('role="status"');
    expect(CSS).not.toContain('position: absolute');
    // A dialog, an overlay or a backdrop would be a wall. There is none.
    expect(TSX).not.toMatch(/role="(dialog|alertdialog)"/);
    expect(CSS).not.toMatch(/\bbackdrop\b/);
  });

  it('renders nothing at all until something is actually wrong', () => {
    expect(TSX).toContain('if (!showing) return null;');
    expect(TSX).toContain('const showing = status.troubled || deviceFull;');
  });

  /**
   * THE CONTROL IT USED TO COVER.
   *
   * Under 900px the navigation IS a fixed bottom bar (`ui/primitives/ui.css`: `.wk-rail` at
   * left:0; right:0; bottom:0, opaque, z-index 10). The strip was fixed at the same coordinates
   * with z-index 60 and an opaque fill, so whenever a save was troubled it hid the phone's entire
   * navigation — and it stays up for as long as the trouble lasts.
   */
  it('sits above the phone tab bar rather than on top of it', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 900px)'));
    expect(phone).toContain('.wst-bar');
    expect(phone).toMatch(/bottom:\s*calc\(var\(--rail-h/);

    const railCss = readFileSync(join(DIR, '..', 'ui', 'primitives', 'ui.css'), 'utf8');
    expect(railCss).toMatch(/--rail-h:\s*\d+px/);
  });

  it('moves the flag control up by its own measured height, not by a guess', () => {
    const flag = readFileSync(join(DIR, '..', 'ui', 'FlagControl.tsx'), 'utf8');
    expect(flag).toContain('var(--wst-height,0px)');
    expect(TSX).toContain("setProperty('--wst-height'");
  });
});

/**
 * THE DEVICE ITSELF REFUSING THE WORK.
 *
 * `scoped.setItem` used to catch `QuotaExceededError` and drop it, and `sync-health.ts` counts only
 * REMOTE failures, so on a full device the strip said "Your work is safe on this device" at the
 * exact moment the write was being thrown away. Both halves of that sentence were false and nothing
 * anywhere noticed.
 */
describe('when the device is the thing refusing to save', () => {
  it('says something true instead of repeating that the work is safe here', () => {
    const line = saveTroubleLine(false, true);
    expect(line).not.toContain('safe on this device');
    expect(line).not.toBe(saveTroubleLine(false));
    expect(saveTroubleLine(true, true)).toBe(line); // offline or not, the device is the problem
  });

  it('is still kind: no blame, no alarm, no status code', () => {
    const line = saveTroubleLine(false, true);
    expect(line).not.toMatch(/\byou (did|broke|caused)\b/i);
    expect(line).not.toMatch(/\bfailed\b|\berror\b|\bcrash\b|\bwarning\b/i);
    expect(line).not.toMatch(/\b[45]\d\d\b/);
    expect(line).not.toMatch(/\b\d{1,2}\s?(am|pm)\b|tonight|midnight|late at night/i);
  });

  it('notices a write the device threw away', async () => {
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {},
      clear() {},
    };
    const scope = await import('./scope');
    try {
      expect(scope.scoped.setItem('wobo-archive-v1', 'a lesson')).toBe(false);
      expect(scope.deviceRefusingWrites()).toBe(true);
      expect(saveTroubleLine(false, scope.deviceRefusingWrites())).toBe(SAVE_TROUBLE_COPY.device);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  });
});
