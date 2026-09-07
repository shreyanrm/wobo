/**
 * The last voice: the device's own. The gateway speaks first, with a second voice behind its
 * first (/v1/voice/tts); when neither answers, the same words are read by the browser's speech
 * synthesis, so a line Wobo wrote is still a line Wobo says. Never instead of the gateway voice,
 * never while muted, and never a different sentence from the one on screen.
 *
 * The browser API is optional and uneven (Safari needs a gesture, some Androids ship no voice),
 * so every call answers honestly: `true` when the device spoke to the end, `false` when it could
 * not start, and the caller keeps the reading clock either way.
 */

interface Synth {
  speak: (u: SpeechSynthesisUtterance) => void;
  cancel: () => void;
  getVoices?: () => SpeechSynthesisVoice[];
}

type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

function synth(): Synth | null {
  const g = globalThis as unknown as { speechSynthesis?: Synth };
  return g.speechSynthesis && typeof g.speechSynthesis.speak === 'function'
    ? g.speechSynthesis
    : null;
}

function utteranceCtor(): UtteranceCtor | null {
  const g = globalThis as unknown as { SpeechSynthesisUtterance?: UtteranceCtor };
  return typeof g.SpeechSynthesisUtterance === 'function' ? g.SpeechSynthesisUtterance : null;
}

/** Can this device read a line on its own? */
export function deviceCanSpeak(): boolean {
  return synth() !== null && utteranceCtor() !== null;
}

/** The English the device should read in, from the learner's accent tag when the page has one. */
function preferredLang(): string {
  try {
    const tag = (globalThis as unknown as { document?: { documentElement?: { lang?: string } } })
      .document?.documentElement?.lang;
    return tag && tag.trim() ? tag.trim() : 'en-IN';
  } catch {
    return 'en-IN';
  }
}

let current: SpeechSynthesisUtterance | null = null;

/**
 * Read one line with the device's voice. Resolves `true` when the line finished, `false` when the
 * device could not speak it; either way it resolves, on the line's own clock at the latest, so a
 * gate waiting on the voice can never hang on a synthesis engine that never calls back.
 */
export function speakWithDevice(
  text: string,
  opts?: { lang?: string; timeoutMs?: number },
): Promise<boolean> {
  const line = text.trim();
  const engine = synth();
  const Utterance = utteranceCtor();
  if (!line || !engine || !Utterance) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (spoke: boolean) => {
      if (settled) return;
      settled = true;
      if (current === u) current = null;
      clearTimeout(timer);
      resolve(spoke);
    };
    let u: SpeechSynthesisUtterance;
    try {
      u = new Utterance(line);
    } catch {
      resolve(false);
      return;
    }
    u.lang = opts?.lang ?? preferredLang();
    u.rate = 1;
    u.onend = () => finish(true);
    u.onerror = () => finish(false);
    // Roughly the time the line takes at a reading pace, with a floor: a floor for one word, a
    // ceiling nobody should wait past even if the engine never reports the end.
    const budget = opts?.timeoutMs ?? Math.min(30000, 1500 + line.length * 80);
    const timer = setTimeout(() => finish(true), budget);
    current = u;
    try {
      engine.speak(u);
    } catch {
      finish(false);
    }
  });
}

/** Cut the device voice off mid-word, the way a new line cuts the gateway voice off. */
export function stopDeviceVoice(): void {
  const engine = synth();
  current = null;
  if (!engine) return;
  try {
    engine.cancel();
  } catch {
    // nothing was speaking
  }
}
