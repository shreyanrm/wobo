import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const palette = read('shell', 'CommandPalette.tsx');
const companion = read('wobo', 'Companion.tsx');
const home = read('screens', 'Home.tsx');

/**
 * main.tsx defines exactly one focus ring for the whole app (`:focus-visible`). A component that
 * sets `outline: none` on a text field opts out of it silently — the field is then focusable with
 * no visible focus at all, which is the primary input on that surface for a keyboard learner.
 */
describe('the global focus ring is never cancelled on an input', () => {
  const INPUT_SURFACES = [
    ['screens', 'ChatScreen.tsx'],
    ['screens', 'Home.tsx'],
    ['shell', 'CommandPalette.tsx'],
    ['wobo', 'Companion.tsx'],
    ['wobo', 'paths', 'cards.tsx'],
    ['engines', 'MiniWorkbook.tsx'],
  ];

  it('the composers and the quiz input keep the ring', () => {
    for (const path of INPUT_SURFACES) {
      expect(read(...path)).not.toContain("outline: 'none'");
    }
  });

  it('the one ring is still defined, so this is a check and not a hole', () => {
    expect(read('main.tsx')).toContain(':focus-visible');
  });
});

/** A modal surface owes: a dialog role, focus in on open, Escape out, and focus back on close. */
describe('the Wobo drawer is a real dialog', () => {
  it('announces itself as a modal dialog with a name', () => {
    expect(companion).toContain('role="dialog"');
    // modal, except while the glass is held and the sheet has folded to a strip beside the page
    // Wobo is drawing on (docs/INK-FREEZE-PLAN-TRACE.md §3)
    expect(companion).toContain("aria-modal={folded ? undefined : 'true'}");
    expect(companion).toContain('aria-label="Wobo"');
  });

  it('focuses the composer on open', () => {
    expect(companion).toContain('composerRef.current?.focus()');
    expect(companion).toContain('ref={composerRef}');
  });

  it('closes on Escape', () => {
    expect(companion).toMatch(/if \(e\.key !== 'Escape'\) return;/);
  });

  it('restores focus to whatever opened it', () => {
    expect(companion).toContain('returnFocusRef');
    expect(companion).toMatch(/back\?\.focus\?\.\(\)/);
  });
});

/**
 * ARIA roles describe the element that has focus. The palette's focus lives in the input, so the
 * combobox contract belongs there; the panel around it is the dialog.
 */
describe('the command palette names its parts correctly', () => {
  it('puts the combobox contract on the input', () => {
    const input = palette.slice(palette.indexOf('<input'), palette.indexOf('id="cmdk-list"'));
    for (const attr of [
      'role="combobox"',
      'aria-expanded',
      'aria-controls="cmdk-list"',
      'aria-activedescendant={activeId}',
    ]) {
      expect(input).toContain(attr);
    }
  });

  it('marks the wrapper a dialog, not a combobox', () => {
    const wrapper = palette.slice(palette.indexOf('ref={panelRef}'), palette.indexOf('<input'));
    expect(wrapper).toContain('role="dialog"');
    expect(wrapper).toContain('aria-modal="true"');
    expect(wrapper).not.toContain('role="combobox"');
  });

  it('still has one listbox for the options to live in', () => {
    expect(palette).toContain('role="listbox"');
    expect(palette).toContain('role="option"');
  });
});

/**
 * ⌘K cannot be pressed on a phone or in the installed PWA. The palette reaches every screen, every
 * subject and every action in the app — leaving it keyboard-only made all of that unreachable on
 * the device most learners actually hold.
 *
 * The home built on design/prototypes/app-v1.html has no palette button: on a phone the four doors
 * are the bottom tab bar (AppShell) and anything else is said to Wobo in the ask box, which the app
 * resolves to a destination before it ever asks the brain (resolveDestination). The opener stays
 * exported for the next surface that wants it.
 */
describe('the command palette has a touch entry point', () => {
  it('exports an opener that does not depend on a keyboard', () => {
    expect(palette).toContain('export function openCommandPalette');
    expect(palette).toContain("export const OPEN_PALETTE_EVENT = 'wobo-open-palette'");
    expect(palette).toContain('window.addEventListener(OPEN_PALETTE_EVENT, onOpen)');
    expect(palette).toContain('window.removeEventListener(OPEN_PALETTE_EVENT, onOpen)');
  });

  it('the home reaches everywhere by touch: the four doors and the ask box', () => {
    expect(home).toContain('<AppFrame active="home">');
    // The box's words live in one place (screens/home/today.ts), because the card that stands in
    // for "Wobo noticed" when there is nothing to notice says them too.
    expect(home).toContain('placeholder={ASK_PLACEHOLDER}');
    expect(read('screens', 'home', 'today.ts')).toContain(
      "export const ASK_PLACEHOLDER = 'Ask anything from your syllabus, or paste question 7'",
    );
    expect(read('AppRuntime.tsx')).toContain('resolveDestination(text)');
  });
});
