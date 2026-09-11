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

/**
 * THE WAKE, AND WHY IT IS NOT THE TURN'S TO PAY (the adversary, wave 53, finding 1;
 * docs/INK-FOUR.md, timing: "the pen is on the board inside a second").
 *
 * A browser starts its speech service on the FIRST touch of `speechSynthesis` in the whole
 * browser session, and the touch that starts it waits for it. Wobo's own first touch was the
 * opening of the turn's utterance — `startUtterance` -> `stopSpeaking` -> `stopDeviceVoice` —
 * which runs on the submit handler, BEFORE the ask leaves the page.
 *
 * MEASURED, keyless, at 390, on a gateway already warm: the first drawing turn of a fresh browser
 * session took 937, 946, 962 and 986 ms from Enter to the request being issued, against 187, 217,
 * 367 ms for every turn after it in the same browser; the gateway answered in 15-30 ms either way.
 * Reversing the boards moved the whole second with the SESSION and not with the board, and warming
 * the connection to the gateway did not touch it. Touching `speechSynthesis` once at document
 * start — 0.8 ms, and it returns an empty voice list — took the same first turn to 264, 265, 299
 * and 318 ms. That second belonged to a learner's first-ever ask, which is the one turn nobody
 * gets to make twice.
 *
 * So the engine is woken on an idle tick after the page is up, and the turn finds it awake. The
 * wake asks the engine for its voice list and nothing else: no `cancel`, which would cut off a
 * line that a cold-loaded course had already begun to read.
 */
const WAKE_IDLE_TIMEOUT_MS = 1500;

/** The engine this session has already woken — per engine, so a swapped-in engine is woken too. */
let woken: Synth | null = null;

/** Start the browser's speech service now, off any turn's clock. Cheap, idempotent, silent. */
export function wakeDeviceVoice(): void {
  const engine = synth();
  if (!engine || engine === woken) return;
  woken = engine;
  try {
    engine.getVoices?.();
  } catch {
    // An engine that will not list its voices can still speak one; it is awake either way.
  }
}

/**
 * Book the wake for the next idle tick, and never later than `WAKE_IDLE_TIMEOUT_MS` — a boot busy
 * enough to have no idle is exactly the boot where the learner asks first and soonest.
 */
export function scheduleDeviceVoiceWake(): void {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  const wake = () => wakeDeviceVoice();
  if (typeof g.requestIdleCallback === 'function') {
    g.requestIdleCallback(wake, { timeout: WAKE_IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(wake, 0);
}

// The module is loaded with the surfaces that speak, which is long before the first ask.
if (typeof window !== 'undefined') scheduleDeviceVoiceWake();

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
