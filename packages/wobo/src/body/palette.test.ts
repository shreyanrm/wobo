import { describe, expect, it } from 'bun:test';
import { WOBO_TONES } from '../identity';
import { RIG_BODY_OPACITY, RIG_CLASS, RIG_CSS, RIG_DARK, RIG_LIGHT } from './palette';

/**
 * The rig's palette is Wobo's identity, so it is not allowed to hold hexes of its own — it reads
 * them from `identity.ts`. This is the test that keeps the two from drifting apart again.
 */
describe('the rig palette', () => {
  it('is the identity lock itself, not a second copy of it', () => {
    expect(RIG_LIGHT).toBe(WOBO_TONES.light);
    expect(RIG_DARK).toBe(WOBO_TONES.dark);
  });

  it('emits palette v4 on both grounds, and nothing warm', () => {
    expect(RIG_CSS).toContain(
      `.${RIG_CLASS}{--wr-body:#14142B;--wr-visor:#FFFFFF;--wr-eye:#2B45FF;`,
    );
    expect(RIG_CSS).toContain('--wr-body:#F4F4F7;--wr-visor:#0E0E16;--wr-eye:#7C8CFF;');
    for (const retired of ['#FF5A1F', '#1A1A1F', '#EDEDF1', '#1F35E0', '#7B8CFF']) {
      expect(RIG_CSS).not.toContain(retired);
    }
  });

  it('swaps on the attribute the app writes AND on the system preference', () => {
    expect(RIG_CSS).toContain(`[data-theme="dark"] .${RIG_CLASS}`);
    expect(RIG_CSS).toContain('@media (prefers-color-scheme:dark)');
    // An explicit light choice must beat the system preference, or a light-locked app goes dark.
    expect(RIG_CSS).toContain(':root:not([data-theme="light"])');
  });

  it("keeps Wobo's body 92% ink — never a hole punched through the page", () => {
    expect(RIG_BODY_OPACITY).toBe(0.92);
  });
});
