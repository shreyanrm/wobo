import { afterEach, describe, expect, it } from 'bun:test';
import { deviceCanSpeak, speakWithDevice, stopDeviceVoice } from './device-voice';

/** A browser speech engine that records what it was asked to say and ends each line at once. */
function installFakeEngine(opts?: { fail?: boolean; silent?: boolean }) {
  const spoken: { text: string; lang: string }[] = [];
  let cancelled = 0;
  class Utterance {
    text: string;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const engine = {
    speak(u: Utterance) {
      spoken.push({ text: u.text, lang: u.lang });
      if (opts?.silent) return; // an engine that never reports the end
      queueMicrotask(() => (opts?.fail ? u.onerror?.() : u.onend?.()));
    },
    cancel() {
      cancelled++;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.speechSynthesis = engine;
  g.SpeechSynthesisUtterance = Utterance;
  return { spoken, cancelled: () => cancelled };
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.speechSynthesis;
  delete g.SpeechSynthesisUtterance;
});

describe('the device voice, the last resort behind the gateway voices', () => {
  it('is absent on a device with no speech engine, and says so without throwing', async () => {
    expect(deviceCanSpeak()).toBe(false);
    expect(await speakWithDevice('Two x equals ten.')).toBe(false);
  });

  it('reads exactly the words it was given, in Indian English by default', async () => {
    const fake = installFakeEngine();
    expect(deviceCanSpeak()).toBe(true);
    expect(await speakWithDevice('  Two x equals ten.  ')).toBe(true);
    expect(fake.spoken).toEqual([{ text: 'Two x equals ten.', lang: 'en-IN' }]);
  });

  it('never speaks an empty line', async () => {
    const fake = installFakeEngine();
    expect(await speakWithDevice('   ')).toBe(false);
    expect(fake.spoken).toEqual([]);
  });

  it('reports an engine error as not spoken, so the caller keeps the reading clock', async () => {
    installFakeEngine({ fail: true });
    expect(await speakWithDevice('A line.')).toBe(false);
  });

  it('resolves on its own clock when the engine never reports the end', async () => {
    installFakeEngine({ silent: true });
    const started = Date.now();
    expect(await speakWithDevice('A line.', { timeoutMs: 30 })).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is cut off by stop, like the gateway voice', () => {
    const fake = installFakeEngine();
    stopDeviceVoice();
    expect(fake.cancelled()).toBe(1);
  });
});
