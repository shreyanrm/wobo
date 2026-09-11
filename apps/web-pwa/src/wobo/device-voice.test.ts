import { afterEach, describe, expect, it } from 'bun:test';
import {
  deviceCanSpeak,
  scheduleDeviceVoiceWake,
  speakWithDevice,
  stopDeviceVoice,
  wakeDeviceVoice,
} from './device-voice';

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

/**
 * An engine reached through a property, so a test can count who touched `speechSynthesis` at all —
 * which is the whole of the wake law: the browser starts its speech service on the FIRST touch.
 */
function installCountedEngine() {
  const engine = {
    speak() {},
    cancel() {},
    getVoices() {
      voices += 1;
      return [] as SpeechSynthesisVoice[];
    },
  };
  let reads = 0;
  let voices = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(g, 'speechSynthesis', {
    configurable: true,
    get() {
      reads += 1;
      return engine;
    },
  });
  return { reads: () => reads, voices: () => voices };
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.speechSynthesis;
  delete g.SpeechSynthesisUtterance;
  delete g.requestIdleCallback;
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

/**
 * THE WAKE (the adversary, wave 53, finding 1).
 *
 * Measured in the lab, keyless, on a warm gateway: the first drawing turn of a fresh browser
 * session took 937-986 ms from Enter to the request even leaving the page, against 187-367 ms for
 * every turn after it. The stall is the browser's speech service starting up on its FIRST touch of
 * `speechSynthesis` — and the turn's own opening (`startUtterance` -> `stopSpeaking` ->
 * `stopDeviceVoice`) was that first touch. Waking the engine at document start took the same first
 * turn to 264-318 ms in four separate runs.
 */
describe('waking the engine, so no turn pays for the wake', () => {
  it('touches the engine and asks for its voice list, once, however often it is woken', () => {
    const counted = installCountedEngine();
    wakeDeviceVoice();
    expect(counted.reads()).toBeGreaterThan(0);
    expect(counted.voices()).toBe(1);
    wakeDeviceVoice();
    wakeDeviceVoice();
    expect(counted.voices()).toBe(1);
  });

  it('says nothing and throws nothing on a device with no speech engine', () => {
    expect(() => wakeDeviceVoice()).not.toThrow();
    expect(deviceCanSpeak()).toBe(false);
  });

  it('is scheduled off the critical path, on idle, and never left to an idle that never comes', () => {
    const asked: { timeout?: number }[] = [];
    let run: (() => void) | null = null;
    const g = globalThis as unknown as Record<string, unknown>;
    g.requestIdleCallback = (cb: () => void, opts?: { timeout?: number }) => {
      asked.push(opts ?? {});
      run = cb;
      return 1;
    };
    const counted = installCountedEngine();
    scheduleDeviceVoiceWake();
    expect(asked).toHaveLength(1);
    // A bounded idle: a busy boot must not hold the wake past the moment a learner can ask.
    expect(asked[0]?.timeout).toBeGreaterThan(0);
    expect(asked[0]?.timeout).toBeLessThanOrEqual(2000);
    // Scheduling alone touches nothing; the wake happens when the idle comes.
    expect(counted.reads()).toBe(0);
    (run as unknown as () => void)();
    expect(counted.reads()).toBeGreaterThan(0);
  });
});
