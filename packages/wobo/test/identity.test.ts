import { describe, expect, it } from 'bun:test';
import { RIG_CSS, RIG_DARK, RIG_LIGHT } from '../src/body/palette';
import * as identity from '../src/identity';
import { WOBO_BLUE, WOBO_BLUE_NIGHT, WOBO_IDENTITY, WOBO_TONES } from '../src/identity';

describe('Wobo identity is locked', () => {
  it('is the ink-visor wobot — palette v4, cream and night (DESIGN.md §2/§4)', () => {
    expect(WOBO_TONES.light).toEqual({
      body: '#14142B',
      visor: '#FFFFFF',
      eye: '#2B45FF',
      hairline: 'rgba(255,255,255,0.55)',
    });
    expect(WOBO_TONES.dark).toEqual({
      body: '#F4F4F7',
      visor: '#0E0E16',
      eye: '#7C8CFF',
      hairline: 'rgba(14,14,22,0.40)',
    });
    expect(WOBO_BLUE).toBe('#2B45FF');
    expect(WOBO_BLUE_NIGHT).toBe('#7C8CFF');
    expect(WOBO_IDENTITY.color).toBe(WOBO_BLUE);
    expect(WOBO_IDENTITY.colorFamily).toBe('ink_visor');
  });

  it('inverts cleanly: the visor is always the tone the body is not', () => {
    expect(WOBO_TONES.light.body).not.toBe(WOBO_TONES.light.visor);
    // The night body is the light visor's family (cream) and vice versa — the tones swap.
    expect(WOBO_TONES.dark.body).not.toBe(WOBO_TONES.light.body);
    expect(WOBO_TONES.dark.visor).not.toBe(WOBO_TONES.light.visor);
  });

  it('carries no trace of the retired molten body colour or the jelly-orb vocabulary', () => {
    const source = JSON.stringify(identity) + Object.keys(identity).join(' ');
    expect(source).not.toContain('#FF5A1F');
    for (const dead of ['molten', 'MOLTEN', 'jelly', 'orb', 'flame', 'Flame']) {
      expect(source).not.toContain(dead);
    }
    // The whole jelly-orb export surface is gone, not merely renamed.
    for (const dead of ['MOLTEN', 'flameForMood']) {
      expect(Object.hasOwn(identity, dead)).toBe(false);
    }
  });

  it('is one round ink body with a visor, two eyes, a pen and the hairline rim', () => {
    expect(WOBO_IDENTITY.form).toBe('ink_visor_wobot');
    expect(WOBO_IDENTITY.surface).toBe('matte');
    expect(WOBO_IDENTITY.eyes).toBe(2);
    expect(WOBO_IDENTITY.visor).toBe('always');
    expect(WOBO_IDENTITY.pen).toBe('always');
    expect(WOBO_IDENTITY.hairline).toBe('always');
  });

  it('is frozen — identity cannot be mutated at runtime', () => {
    expect(Object.isFrozen(WOBO_IDENTITY)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES.light)).toBe(true);
    expect(Object.isFrozen(WOBO_TONES.dark)).toBe(true);
  });

  it("the rig's default colours read from the identity, never their own hexes", () => {
    expect(RIG_LIGHT).toBe(WOBO_TONES.light);
    expect(RIG_DARK).toBe(WOBO_TONES.dark);
    // …and the emitted token layer carries exactly those tones.
    expect(RIG_CSS).toContain('--wr-body:#14142B');
    expect(RIG_CSS).toContain('--wr-visor:#FFFFFF');
    expect(RIG_CSS).toContain('--wr-eye:#2B45FF');
    expect(RIG_CSS).toContain('--wr-body:#F4F4F7');
    expect(RIG_CSS).toContain('--wr-eye:#7C8CFF');
    expect(RIG_CSS).not.toContain('#FF5A1F');
  });
});
