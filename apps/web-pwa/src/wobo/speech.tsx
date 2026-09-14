'use client';

/**
 * Wobo speaks what Wobo writes. Every reply plays aloud through the gateway's TTS (the same
 * voice as the live relay), starting as Wobo's ink starts — one performance, sound and hand
 * together. Mute silences the sound only, never the words; the mic conversation always speaks
 * back and ignores this switch entirely.
 */

import { gatewayFetch, mintVoiceToken, voiceSocketUrl } from '@wobo/sdk';
import type { WoboAction, WoboMood } from '@wobo/wobo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { currentFidelity, isOffline } from '../shell/resilience';
import { type ChatTurn, useWoboChat } from './chat';
import { deviceCanSpeak, speakWithDevice, stopDeviceVoice } from './device-voice';
import { base64ToFloat32 } from './voice';

// Family N: a stalled 2G link must never leave the narration gate hanging on a fetch that never
// resolves. Bound every TTS request; on timeout it aborts → synth returns null → the words already
// on screen carry the turn and any gate waiting on us releases on its own clock.
//
// TWELVE SECONDS ON THE SENTENCE THAT DECIDES THE TURN'S VOICE, eight on every one after it.
// The gateway decides a turn's voice once and holds it, and when its first voice will not speak it
// re-decides the whole turn silently — which costs its own short deadline (six seconds) and then
// the second voice's two-to-four. Measured live on 2026-09-11 with Google's text-to-speech hanging
// on a majority of calls: at eight seconds flat this file gave up on the FIRST sentence a second or
// two before that re-decision landed, so the phone's own voice took a turn Wobo was about to speak
// — and, by the one-voice law below, then had to finish it. A learner who waits ten seconds and
// hears Wobo is better served than one who hears a stranger at eight. Every sentence AFTER the
// first should be a disk read of milliseconds (the whole plan is bought when its words are
// decided), so their budget stays where it was: past it, something is wrong and silence is kinder.
const TTS_TIMEOUT_MS = 8000;
const FIRST_TTS_TIMEOUT_MS = 12000;

/** Read at the moment a line is spoken (Vite inlines it; a test can stand its own gateway in). */
function gatewayUrl(): string | undefined {
  return import.meta.env.VITE_GATEWAY_URL;
}
const MUTE_KEY = 'wobo-voice-muted-v1';
const MUTE_EVENT = 'wobo-mute-changed';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // session-only preference
  }
  if (muted) stopSpeaking();
  window.dispatchEvent(new Event(MUTE_EVENT));
}

// One voice at a time — a new line stops the previous one mid-word, like a person would.
let playing: { source: AudioBufferSourceNode } | null = null;
// The streaming path schedules many short chunks ahead on the shared context; tracked here so a
// new utterance (stopSpeaking) can cut them all off mid-word, exactly like the buffered `playing`.
const streamSources = new Set<AudioBufferSourceNode>();
// Bumped on every stop/new-utterance so a running sentence pipeline knows it was superseded.
let speechGen = 0;

// ONE shared AudioContext for all Wobo's speech, lazily created (mirrors ui/sound.ts). A fresh
// context per sentence starts 'suspended' on Safari/iOS — and always when narration auto-fires
// before any gesture (cold reload / deep-link into a course) — so source.start() is silent and
// onended never fires. Sharing one context lets us unlock it on the first user gesture below.
let sharedCtx: AudioContext | null = null;
function speechCtx(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      sharedCtx = new Ctor();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

// Belt-and-suspenders unlock: a context created outside a user gesture (auto-narration on a course
// cold-load) stays suspended and cannot resume until the learner touches the page. Resume it on the
// first pointer/key — any already-scheduled narration then becomes audible.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = speechCtx();
    if (c && c.state === 'suspended') void c.resume();
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
}

export function stopSpeaking(): void {
  speechGen++; // abort any in-flight sentence sequence
  stopDeviceVoice(); // the device voice, when it was the one reading
  // A sentence being read on the clock (muted, low-fi) ends now: an interruption is one tick,
  // and the turn's promise used to wait out the sentence's whole reading time.
  for (const wake of [...readingWaits]) wake();
  // Cut off any streamed chunks scheduled ahead on the shared context.
  for (const node of streamSources) {
    try {
      node.stop();
    } catch {
      // already ended
    }
  }
  streamSources.clear();
  if (!playing) return;
  const p = playing;
  playing = null;
  try {
    p.source.stop();
  } catch {
    // already ended
  }
  // The context is shared and reused — stop the source, never tear the context down.
}

// Words whose period never ends a sentence. A small, high-traffic list — a tutor's narration
// splitter, not a tokenizer. Single letters ("e.g.", "U.S.", "Ph.D.") are handled as initials below.
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'eg',
  'ie',
  'approx',
  'fig',
  'no',
  'al',
  'dept',
  'est',
  'inc',
  'ltd',
  'min',
  'max',
  'cf',
]);

const isUpperChar = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase();

/** The word (letters/digits) immediately before position `i`, lowercased. */
function wordBefore(text: string, i: number): string {
  let start = i;
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1] as string)) start--;
  return text.slice(start, i).toLowerCase();
}

/**
 * Does the ender run text[i..end] actually close a sentence? `!` and `?` always do. A period only
 * does when what follows is the end of the line, or whitespace and then a capital — so "3.14",
 * "e.g." and "Dr. Rao" stay in one breath instead of shattering the beat (each fragment would
 * otherwise get its own synth request and its own ink beat, drifting the choreography).
 */
function endsSegment(text: string, i: number, end: number): boolean {
  const run = text.slice(i, end + 1);
  if (run.includes('!') || run.includes('?')) return true;
  const word = wordBefore(text, i);
  if (word.length === 1 && /[A-Za-z]/.test(word)) return false; // an initial: e.g., U.S., Ph.D.
  if (ABBREVIATIONS.has(word)) return false;
  const rest = text.slice(end + 1);
  if (rest.trim() === '') return true; // end of the line
  if (!/^[\s]/.test(rest)) return false; // "3.14", "v1.2" — glued to what follows
  const head = rest.trimStart().replace(/^["'“‘([]+/, '')[0];
  return head !== undefined && isUpperChar(head);
}

/**
 * Split into speakable sentences so we can synth+play the first while the rest queues. Newlines and
 * `!`/`?` always break; a period breaks only where it really ends a sentence (see endsSegment).
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '\n') {
      const seg = text.slice(start, i).trim();
      if (seg) out.push(seg);
      start = i + 1;
      continue;
    }
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let end = i; // swallow a run of enders ("...", "?!") into one break
    while (end + 1 < text.length && '.!?'.includes(text[end + 1] as string)) end++;
    if (endsSegment(text, i, end)) {
      const seg = text.slice(start, end + 1).trim();
      if (seg) out.push(seg);
      start = end + 1;
    }
    i = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.length > 0 ? out : [text.trim()];
}

// --- THE BEAT (docs/copy/voice.md 10b): the emotion follows the beat, and it is small ------------
//
// The gateway's voice used to read every line in one flat register, so "you got it" and "not quite"
// sounded identical. The tutor already knows what a line is: it sets a mood on the turn, it anchors
// that mood to a sentence, it marks a crisis, and the board's `ask` event is a question by name. That
// knowledge is carried to the voice here as one small enum. Nothing here reads the words to guess.

/** What kind of line this is. The gateway holds the same five (`wobo_gateway.voice.BEATS`). */
export type VoiceBeat = 'win' | 'miss' | 'ask' | 'step' | 'crisis';

/** The mood the tutor set, read as a beat. Calm moods have no opinion and fall to the caller's. */
export function beatOfMood(mood: WoboMood | undefined): VoiceBeat | undefined {
  switch (mood) {
    case 'correct':
    case 'celebrate':
      return 'win';
    case 'oops':
    case 'hint':
      return 'miss';
    case 'waiting': // "waiting when the move is theirs": Wobo just asked and is holding still
      return 'ask';
    default:
      return undefined;
  }
}

/**
 * One turn's beat: the crisis line first (the softest of all, whatever mood rode along), else the
 * last mood the tutor set on the turn, else the step. The safety block is the gateway's own, never
 * a reading of the text.
 */
export function beatOfTurn(actions: WoboAction[], safety?: { category?: string }): VoiceBeat {
  if (safety?.category === 'crisis') return 'crisis';
  let beat: VoiceBeat = 'step';
  for (const a of actions) {
    const b = a.type === 'setMood' ? beatOfMood(a.mood as WoboMood) : undefined;
    if (b) beat = b;
  }
  return beat;
}

/** The beat rides the socket URL beside the token. The first frame stays the line itself. */
export function withBeat(url: string, beat: VoiceBeat): string {
  return `${url}&beat=${beat}`;
}

/** Synthesize one sentence to PCM samples (or null when keyless/rate-limited/muted). */
async function synth(
  text: string,
  beat: VoiceBeat = 'step',
  opts?: { deciding?: boolean; signal?: AbortSignal },
): Promise<Clip | null> {
  // Offline (or keyless): don't burn the timeout on a fetch that can't land — fall straight to
  // text. The reply is already on screen; Wobo's voice is the grace, not the help.
  const gateway = gatewayUrl();
  if (!gateway || !text.trim() || isOffline()) return null;
  const ctrl = new AbortController();
  // The ladder below retires an ask that lost; its abort is this request's abort.
  if (opts?.signal?.aborted) return null;
  opts?.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  const timer = setTimeout(
    () => ctrl.abort(),
    opts?.deciding ? FIRST_TTS_TIMEOUT_MS : TTS_TIMEOUT_MS,
  );
  try {
    // Identity rides every gateway call (gatewayFetch); the brain decides whether this learner has
    // a voice left today. A refusal is just silence here — the words are already on screen.
    const res = await gatewayFetch(`${gateway}/v1/voice/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 600), beat }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // quota 502 / any non-ok → silent-safe, gate releases via onDone
    const audio = (await res.json()) as { mime?: string; b64?: string };
    if (!audio.b64) return null;
    const rate = Number(/rate=(\d+)/.exec(audio.mime ?? '')?.[1] ?? 24000);
    const samples = base64ToFloat32(audio.b64);
    return samples.length === 0 ? null : { samples, rate };
  } catch {
    return null; // abort (stall) or network error — same graceful text-first fallback
  } finally {
    clearTimeout(timer);
  }
}

/** Play one sentence; resolves when it finishes (or immediately if superseded). */
/** One sentence's audio, as the gateway hands it back. */
type Clip = { samples: Float32Array<ArrayBuffer>; rate: number };

async function playSamples(
  samples: Float32Array<ArrayBuffer>,
  rate: number,
  gen: number,
): Promise<void> {
  if (gen !== speechGen) return;
  const ctx = speechCtx();
  if (!ctx) return;
  if (playing) {
    try {
      playing.source.stop();
    } catch {
      /* ended */
    }
    playing = null;
  }
  // Unlock before scheduling — mirrors voice.ts:148 ("Safari still starts contexts suspended").
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  if (gen !== speechGen) return; // a newer utterance took over during the resume await
  // The buffer carries its own sample rate; WebAudio resamples it to the shared context's rate.
  const buffer = ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  playing = { source };
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (playing?.source === source) playing = null;
      resolve();
    };
    source.onended = done;
    source.start();
    // Never hang the pipeline (or a gated advance button) if onended never fires — e.g. the context
    // is still suspended because the page has had no gesture yet. Resolve on the sentence's own
    // clock as a floor; the audio still plays once a tap resumes the context.
    setTimeout(done, (samples.length / rate) * 1000 + 500);
  });
}

/**
 * Speak a line aloud, sentence by sentence: the first sentence plays the instant it returns while
 * the next is already synthesizing — first audio in ~1s instead of after the whole line renders.
 * `onDone` fires once the last sentence finishes (used to gate the course's advance button).
 */
/**
 * Stream the whole line through the gateway's voice socket — playback starts at the first
 * ~200 ms audio chunk instead of waiting on the full clip (~4 s sooner to first sound; verified
 * verbatim so Wobo reads the exact line). Resolves `true` once audio has begun (the caller is done),
 * `false` if it can't start — the caller then falls back to the buffered path, so voice never
 * regresses. A watchdog bails to the fallback if no audio arrives in time.
 */
async function speakStream(
  text: string,
  gen: number,
  opts?: { onDone?: () => void; beat?: VoiceBeat; mouth?: OneMouth },
): Promise<boolean> {
  const gateway = gatewayUrl();
  if (!gateway || !text.trim() || isOffline()) return false;
  const ctx = speechCtx();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  if (gen !== speechGen) return true; // superseded during the resume await — treat as handled
  // A websocket carries no headers we control, so identity is proved over authenticated HTTP and
  // the socket carries the short-lived, single-use token it mints. No token, no stream — the
  // buffered path below still speaks Wobo's line.
  // ponytail: one extra round-trip before first audio; a pre-minted token pool is the upgrade if
  // that ever shows up next to the ~4s the stream already saves.
  const minted = await mintVoiceToken(gateway);
  if (!minted) return false;
  if (gen !== speechGen) return true; // superseded while minting
  const url = withBeat(
    voiceSocketUrl(gateway, '/v1/voice/tts/stream', minted.token),
    opts?.beat ?? 'step',
  );
  return new Promise<boolean>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    let playhead = 0;
    let played = false;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try {
        ws.close();
      } catch {
        // already closing
      }
      resolve(ok);
    };
    // No first chunk within the budget → abandon to the buffered fallback.
    const watchdog = setTimeout(() => !played && finish(false), TTS_TIMEOUT_MS);
    // The buffered pipeline took the mouth first: this socket goes quiet, and stays quiet.
    opts?.mouth?.onLost('stream', () => finish(played));
    ws.onopen = () => {
      try {
        ws.send(text.slice(0, 600));
      } catch {
        finish(false);
      }
    };
    // Error before any audio → fall back; error after → keep what played (finish handled).
    ws.onerror = () => finish(played);
    ws.onclose = () => {
      if (played && gen === speechGen) {
        const remainMs = Math.max(0, playhead - ctx.currentTime) * 1000;
        setTimeout(() => gen === speechGen && opts?.onDone?.(), remainMs + 40);
      }
      finish(played);
    };
    ws.onmessage = (e) => {
      if (gen !== speechGen) {
        finish(true);
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const sc = (msg as { serverContent?: Record<string, unknown> }).serverContent;
      const parts =
        (sc?.modelTurn as { parts?: { inlineData?: { data?: string } }[] })?.parts ?? [];
      for (const p of parts) {
        const b64 = p?.inlineData?.data;
        if (!b64) continue;
        const samples = base64ToFloat32(b64);
        if (samples.length === 0) continue;
        if (opts?.mouth && !opts.mouth.claim('stream')) {
          finish(false); // the other mouth is already speaking this line
          return;
        }
        const buf = ctx.createBuffer(1, samples.length, 24000);
        buf.copyToChannel(samples, 0);
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.connect(ctx.destination);
        playhead = Math.max(playhead, ctx.currentTime + 0.05);
        node.start(playhead);
        playhead += buf.duration;
        streamSources.add(node);
        node.onended = () => streamSources.delete(node);
        played = true;
        clearTimeout(watchdog);
      }
    };
  });
}

/**
 * Wrap a callback so it runs at most once. `onDone` releases the course's advance button — firing
 * it twice double-advances a card, never firing it locks the learner on one. Every exit of
 * speakLine goes through one of these.
 */
export function onceCallback(fn?: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn?.();
  };
}

export async function speakLine(
  text: string,
  opts?: { onDone?: () => void; beat?: VoiceBeat },
): Promise<void> {
  // Guaranteed-once: muted, keyless, superseded, thrown or finished — the gate always releases.
  // (A whole-body finally can't do this: the streaming path resolves before its audio ends and
  // fires onDone from a timer afterwards, so a finally here would pre-empt it.)
  const finish = onceCallback(opts?.onDone);
  if (!gatewayUrl() || isMuted() || !text.trim()) {
    finish();
    return;
  }
  stopSpeaking();
  const gen = ++speechGen;
  // Fast path: stream the whole line (first audio ~4s sooner). If it can't start, fall through to
  // the buffered sentence pipeline below — voice never regresses.
  const beat = opts?.beat ?? 'step';
  const mouth = oneMouth();
  if (await speakStream(text, gen, { onDone: finish, beat, mouth })) {
    // Handled — the stream fires `finish` when its audio drains. Unless it was superseded, in which
    // case nothing more is coming and the gate would hang: release it now.
    if (gen !== speechGen) finish();
    return;
  }
  if (gen !== speechGen) {
    finish(); // superseded while streaming attempted
    return;
  }
  try {
    // Low-fi (reduced-motion / Data Saver / 2G): shorter TTS — voice the first couple of sentences,
    // the rest stays on screen. Grace degrades, the words don't.
    const all = sentences(text);
    const parts = currentFidelity() === 'low' ? all.slice(0, 2) : all;
    const turn = voiceOfTheTurn();
    // The ladder stops the moment this line is superseded, muted, or spoken by the other mouth.
    const lost = () =>
      gen !== speechGen || isMuted() || mouth.owner() === 'stream' || turn.chosen() === 'device';
    const synthDeciding = (sentence: string) =>
      turn.chosen() === null ? synthFirst(sentence, beat, lost) : synth(sentence, beat);
    let pending = synthDeciding(parts[0] as string);
    for (let i = 0; i < parts.length; i++) {
      let cur = await pending;
      if (gen !== speechGen || !mouth.claim('buffered')) {
        finish(); // a newer utterance took over, or the stream has this line
        return;
      }
      pending =
        i + 1 < parts.length ? synthDeciding(parts[i + 1] as string) : Promise.resolve(null);
      if (isMuted()) {
        finish(); // muted mid-flight — respect it, but never strand the gate
        return;
      }
      if (!cur) cur = await synthAgain(parts[i] as string, beat, gen, turn);
      // A turn the phone began is the phone's to the end: a gateway clip that arrives late into
      // one is the same defect wearing the other coat, and a learner hears the answer change
      // mouths halfway through either way.
      if (cur && turn.chosen() !== 'device') {
        turn.spoke();
        await playSamples(cur.samples, cur.rate, gen);
      } else await lastResort(parts[i] as string, gen, turn);
      if (gen !== speechGen) {
        finish();
        return;
      }
    }
    finish();
  } catch {
    // Never fail silently: Wobo's words are already on screen — just release any gate waiting on us
    // (the course advance button) so a TTS hiccup can never strand the learner on a locked card.
    finish();
  }
}

// --- THE VOICE'S CLOCK: what the hand waits on ------------------------------------------------
//
// A board turn's ink lands on sentence boundaries (wobo/beat.ts): the utterance below reports each
// sentence's start, and the conductor lets the mark that names it go on that beat. There is no
// second choreography beside it; the overlay's per-action beats went with the overlay
// (docs/INK-FREEZE-PLAN-TRACE.md §4).

/** Hold a beat on the reading clock (muted / keyless / a sentence that failed to synth). */
/** The reading clock's waits, so an interruption ends them now rather than at the full stop. */
const readingWaits = new Set<() => void>();

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      readingWaits.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    readingWaits.add(done);
  });
}

// --- ONE VOICE, ONE TURN ------------------------------------------------------------------------
//
// Measured live on 2026-09-10, twelve turns, every browser muted, timings off the synthesis call
// and the wire: on two of six boards the answer fell through to the DEVICE's own voice in the
// MIDDLE of itself — the plant cell's second sentence spoke at 25 271 ms and the projectile's at
// 21 428 ms, after this file's eight-second abandon. A learner heard Wobo say the first sentence
// of an answer and the phone say the second. INK-FOUR experience asks for ONE voice, and an answer
// is one performance: the voice belongs to the turn, not to the sentence.
//
// The gateway now decides ITS voice once per turn and holds it (``wobo_gateway.voice``). This is
// the same law on the last voice there is. The device may read a turn Wobo never began — that is
// one voice, the only one available — and it may never finish a turn Wobo started.

/** Which voice is reading this turn, once anything has read a sentence of it. */
export type TurnVoice = 'gateway' | 'device';

export interface VoiceOfTheTurn {
  /** The voice this turn is being read in, or ``null`` while nothing has read a sentence yet. */
  chosen: () => TurnVoice | null;
  /** Wobo's own voice read a sentence of this turn. From here the device is out. */
  spoke: () => void;
  /** Nothing came back for this sentence. Who reads it: the device, or the reading clock? */
  whenSilent: (deviceAvailable: boolean) => 'device' | 'clock';
}

/** One turn's voice. Made per utterance, never shared, never carried into the next answer. */
export function voiceOfTheTurn(): VoiceOfTheTurn {
  let chosen: TurnVoice | null = null;
  return {
    chosen: () => chosen,
    spoke() {
      // A turn the device has begun stays the device's: handing it back to Wobo halfway is the
      // same defect wearing the other coat.
      if (chosen === null) chosen = 'gateway';
    },
    whenSilent(deviceAvailable: boolean) {
      if (chosen === 'gateway') return 'clock'; // silence is a pause; a second voice is a stranger
      if (!deviceAvailable) return 'clock';
      chosen = 'device';
      return 'device';
    },
  };
}

/**
 * The gateway had no voice for this sentence (its voice failed, or the network did). The device
 * reads the same words ONLY when it is this turn's voice — a turn Wobo has already spoken in holds
 * the sentence on the reading clock instead, in silence, so the ink stays paced and the answer
 * keeps the one voice it started in. Never while muted, never offline-only text.
 */
async function lastResort(sentence: string, gen: number, turn: VoiceOfTheTurn): Promise<void> {
  if (gen !== speechGen || isMuted() || !gatewayUrl() || isOffline()) {
    await waitMs(estimateReadMs(sentence));
    return;
  }
  if (turn.whenSilent(deviceCanSpeak()) !== 'device') {
    await waitMs(estimateReadMs(sentence));
    return;
  }
  const spoke = await speakWithDevice(sentence);
  if (!spoke && gen === speechGen) await waitMs(estimateReadMs(sentence));
}

/**
 * One sentence, asked for again. The gateway buys a whole plan's speech the moment its sentences
 * are decided and reads every sentence of a turn in one voice — so an empty answer here is
 * usually a sentence that was still in flight when this call's own budget ran out, or a turn whose
 * voice the gateway has just re-decided (it does that silently, while nothing has been heard).
 * Either way the audio is seconds from the disk, and one more ask is cheaper for the ear than a
 * gap and far cheaper than a second voice.
 *
 * Asked at most once per sentence, and never with the long deciding budget: this is the ask that
 * keeps the phone's own voice from taking a turn Wobo was about to speak.
 */
async function synthAgain(
  text: string,
  beat: VoiceBeat,
  gen: number,
  turn: VoiceOfTheTurn,
): Promise<Clip | null> {
  if (turn.chosen() === 'device' || gen !== speechGen || isMuted()) return null;
  return synth(text, beat);
}

// --- THE FIRST SYLLABLE: one mouth, and a ladder of asks ------------------------------------------
//
// Measured live on 2026-09-11 (every browser muted, the first clip read off the audio graph and the
// fetches off a patched fetch): on three of ten board turns not one /v1/voice/tts request for the
// deciding sentence completed before 12.3 s, while the very next request for the SAME sentence
// came back in 9, 15 and 21 ms. The clip was on the gateway's disk the whole time; the request the
// client was holding had been opened before the gateway re-decided the turn's voice, and a held
// request cannot learn that. Only a new one can. So the sentence that owns the learner's first
// syllable is asked for on a ladder: the same ask again at each rung, at most three in flight, the
// oldest retired first, and the first audio that lands is the one they hear. BOARD.md §10 gives the
// first syllable 1.5 s; the early rungs sit inside that, the late ones sit past the gateway's own
// silent re-decision (six seconds unheard, then the other voice's two to four).

/** The two ways a line can reach the ear: the voice socket, or the buffered sentence pipeline. */
export type Mouth = 'stream' | 'buffered';

export interface OneMouth {
  /** Somebody has the turn. */
  taken: () => boolean;
  /** Who has it, or ``null`` while it is free. */
  owner: () => Mouth | null;
  /** Take the turn. True for the first claimer, and for that same claimer again; false for anyone else. */
  claim: (who: Mouth) => boolean;
  /** Tell ``who`` when the mouth went to somebody else: once, and at once if it already has. */
  onLost: (who: Mouth, tell: () => void) => void;
}

/**
 * One line, one mouth. The stream and the buffered pipeline both want to be the first sound; the
 * first to have audio takes the turn, the other is told it lost exactly once and goes quiet. Made
 * per line, never shared.
 */
export function oneMouth(): OneMouth {
  let owner: Mouth | null = null;
  const losers = new Map<Mouth, (() => void)[]>();
  const tell = (who: Mouth) => {
    const list = losers.get(who) ?? [];
    losers.delete(who);
    for (const fn of list) fn();
  };
  return {
    taken: () => owner !== null,
    owner: () => owner,
    claim(who) {
      if (owner === null) {
        owner = who;
        for (const other of [...losers.keys()]) if (other !== who) tell(other);
        return true;
      }
      return owner === who;
    },
    onLost(who, fn) {
      if (owner !== null && owner !== who) {
        fn();
        return;
      }
      losers.set(who, [...(losers.get(who) ?? []), fn]);
    },
  };
}

/**
 * When the deciding sentence is asked for again, in ms from the first ask. The first two rungs are
 * inside the first-syllable budget (BOARD.md §10, 1.5 s): an ask the disk would answer in twenty
 * milliseconds and has not answered in seven hundred is being held, not served. The last two sit
 * past the gateway's unheard re-decision, which is the moment a fresh ask can first learn of it.
 */
export const REASK_RUNGS_MS = [700, 1400, 3000, 6500, 9500] as const;

/** Asks in flight for one sentence, at most. Past this the oldest, deadest ask is retired. */
const ASKS_IN_FLIGHT = 3;

export interface FirstSoundLadder {
  /** When to ask again, in ms from the first ask. */
  rungs: readonly number[];
  /** When to stop asking altogether and return silence. Bounds every ask, whatever the rungs say. */
  budgetMs: number;
  /** Read at each rung: true when another mouth has the turn, so there is nothing left to ask for. */
  stop?: () => boolean;
}

/**
 * Ask for one sentence's first sound on a ladder. ``ask`` is called with the attempt number and a
 * signal that fires when that attempt is retired; the first non-null answer wins and every other
 * attempt is abandoned. Null when every rung was silent inside the budget, or when ``stop`` said
 * another mouth already has the turn.
 */
export function askForFirstSound<T>(
  ask: (attempt: number, signal: AbortSignal) => Promise<T | null>,
  ladder: FirstSoundLadder,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const inFlight = new Map<number, AbortController>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let launched = 0;
    let rungsLeft = ladder.rungs.length;
    let settled = false;

    const settle = (got: T | null) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      for (const ctrl of inFlight.values()) ctrl.abort();
      inFlight.clear();
      resolve(got);
    };

    const launch = () => {
      const attempt = launched++;
      if (inFlight.size >= ASKS_IN_FLIGHT) {
        const oldest = inFlight.keys().next().value as number;
        inFlight.get(oldest)?.abort();
        inFlight.delete(oldest);
      }
      const ctrl = new AbortController();
      inFlight.set(attempt, ctrl);
      Promise.resolve()
        .then(() => ask(attempt, ctrl.signal))
        .then(
          (got) => got,
          () => null,
        )
        .then((got) => {
          if (inFlight.get(attempt) === ctrl) inFlight.delete(attempt);
          if (settled) return;
          if (got !== null && got !== undefined) {
            settle(got);
            return;
          }
          // This ask came back empty. Silence is the answer only when nothing else is coming.
          if (inFlight.size === 0 && rungsLeft === 0) settle(null);
        });
    };

    launch();
    for (const at of ladder.rungs) {
      timers.push(
        setTimeout(() => {
          rungsLeft--;
          if (settled) return;
          if (ladder.stop?.()) {
            settle(null); // another mouth has the turn: nothing here is worth hearing now
            return;
          }
          launch();
        }, at),
      );
    }
    timers.push(setTimeout(() => settle(null), ladder.budgetMs));
  });
}

/**
 * The sentence that decides a turn's voice, asked for on the ladder. Twelve seconds of patience in
 * all, because the gateway's own silent re-decision lands at six to nine, and a learner who waits
 * ten seconds and hears Wobo is better served than one who hears a stranger at eight.
 */
function synthFirst(text: string, beat: VoiceBeat, stop: () => boolean): Promise<Clip | null> {
  return askForFirstSound<Clip>(
    (_attempt, signal) => synth(text, beat, { deciding: true, signal }),
    { rungs: REASK_RUNGS_MS, budgetMs: FIRST_TTS_TIMEOUT_MS, stop },
  );
}

/** A tiny timing trail the live verifier reads off `window` — proves ink lands on its beat. */
function traceBeat(kind: string, i: number, count: number, voicedMs?: number): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __woboTiming?: unknown[] };
  if (!Array.isArray(w.__woboTiming)) return; // opt-in: the verifier sets it to []
  w.__woboTiming.push({
    t: Math.round(performance.now()),
    kind,
    sentence: i,
    marks: count,
    voicedMs,
  });
}

// --- THE UTTERANCE CLOCK: what the board's hand is timed against ---------------------------------
//
// A board turn's plan carries `t.start` on every object, measured from the beginning of the current
// utterance (docs/BOARD.md §2). The clock that zero is measured from lives HERE, with Wobo's voice, not
// in the renderer: the performance opens, the board is zeroed on the same instant, and the pen then
// leads the first syllable by exactly the time that syllable takes to arrive — a hand's anticipation
// before a stroke, which is what BOARD.md §7 asks for and what keeps the first stroke inside its
// one-second budget while the voice keeps its own.
//
// Lines arrive as the plan streams, so the utterance is a queue, not a string: `say` each frame as
// it lands, `end` when the stream closes, and the speaker drains them in order without ever
// re-synthesising a sentence it has already spoken.

/** What the board offers the voice: a clock it can zero. `BoardStore` satisfies this as it is. */
export interface UtteranceClock {
  beginUtterance: (at?: number) => void;
}

export interface UtteranceHooks {
  /**
   * Sentence `index` (counted across every line queued to this utterance) is beginning: the
   * audio is about to play, or the reading clock has started on it. The board's hand waits on
   * exactly this beat (wobo/beat.ts), so a mark lands with the word that names it.
   */
  onSentence?: (index: number, voicedMs?: number) => void;
}

export interface Utterance {
  /** Queue a line of Wobo's, with what kind of line it is (10b). Safe to call mid-speech. */
  say: (text: string, beat?: VoiceBeat) => void;
  /** No more lines are coming; `done` resolves once the queue drains. */
  end: () => void;
  /** The learner cut Wobo off: the voice stops mid-word and the queue is dropped. */
  stop: () => void;
  /** Resolves when Wobo has finished speaking, been superseded, or been stopped. */
  readonly done: Promise<void>;
}

/**
 * Open one utterance. `clock` is read at the moment the performance opens (the board Wobo is drawing
 * on can be chosen on the first object, so it is a getter, not a value).
 */
export function startUtterance(
  clock?: () => UtteranceClock | null | undefined,
  hooks?: UtteranceHooks,
): Utterance {
  stopSpeaking();
  const gen = ++speechGen;
  clock?.()?.beginUtterance();
  const queue: { text: string; beat: VoiceBeat }[] = [];
  // ONE VOICE FOR THE WHOLE UTTERANCE, every line of it — the say frames and the closing question
  // alike. An utterance IS the turn as the learner hears it, so this is where the turn's voice
  // lives, and the device can only be it from the very first sentence.
  const turn = voiceOfTheTurn();
  /** Sentences begun so far, across every line: the index the hand's gate waits on. */
  let spoken = 0;
  let ended = false;
  let wake: (() => void) | null = null;
  const nudge = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const drain = (async () => {
    while (true) {
      if (gen !== speechGen) return;
      const next = queue.shift();
      if (next === undefined) {
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      const canVoice = Boolean(gatewayUrl()) && !isMuted();
      const segs = sentences(next.text);
      // Low-fi (reduced motion, Data Saver, 2G): voice the first couple of sentences, read the rest
      // on the clock. Grace degrades; the timing the ink is paced against does not.
      const voiceCount = currentFidelity() === 'low' ? Math.min(2, segs.length) : segs.length;
      // While nothing of this turn has been heard, the ask goes down the ladder (asked again at
      // each rung, the first audio to land wins); once Wobo is speaking, one ask, one budget.
      const lost = () => gen !== speechGen || isMuted() || turn.chosen() === 'device';
      const synthNext = (sentence: string) =>
        turn.chosen() === null ? synthFirst(sentence, next.beat, lost) : synth(sentence, next.beat);
      let pending = canVoice && segs.length > 0 ? synthNext(segs[0] as string) : null;
      for (let i = 0; i < segs.length; i++) {
        let cur = pending ? await pending : null;
        if (gen !== speechGen) return;
        pending = canVoice && i + 1 < voiceCount ? synthNext(segs[i + 1] as string) : null;
        // One ask more for a sentence of an answer Wobo is already speaking: the gateway bought
        // the whole plan when its words were decided, so an empty answer here is usually a
        // sentence that was still in flight, and a gap is cheaper to close than a voice is to keep.
        if (!cur && canVoice && i < voiceCount) {
          cur = await synthAgain(segs[i] as string, next.beat, gen, turn);
        }
        // The beat the ink waits on: this sentence is starting now, voiced or read.
        const voicedMs = cur ? (cur.samples.length / cur.rate) * 1000 : undefined;
        traceBeat('sentence', spoken, 0, voicedMs);
        hooks?.onSentence?.(spoken++, voicedMs);
        if (cur && !isMuted() && turn.chosen() !== 'device') {
          turn.spoke();
          await playSamples(cur.samples, cur.rate, gen);
        } else if (canVoice && i < voiceCount) await lastResort(segs[i] as string, gen, turn);
        else await waitMs(estimateReadMs(segs[i] as string));
        if (gen !== speechGen) return;
      }
    }
  })();

  return {
    say(text: string, beat: VoiceBeat = 'step') {
      if (!text.trim()) return;
      queue.push({ text, beat });
      nudge();
    },
    end() {
      ended = true;
      nudge();
    },
    stop() {
      ended = true;
      queue.length = 0;
      stopSpeaking();
      nudge();
    },
    done: drain,
  };
}

// A turn's beat (docs/copy/voice.md 10b), handed from App's ask() to the narrator and consumed
// once, keyed by the wobo turn's id (so it never mis-fires on an identical-looking line).
const pendingBeats = new Map<string, VoiceBeat>();
export function registerBeat(turnId: string, beat: VoiceBeat = 'step'): void {
  if (beat !== 'step') pendingBeats.set(turnId, beat);
}
function takeBeat(turnId: string): VoiceBeat | undefined {
  const beat = pendingBeats.get(turnId);
  if (beat !== undefined) pendingBeats.delete(turnId);
  return beat;
}

/**
 * Always-mounted: the narrator. It watches the one conversation and speaks each new line of
 * Wobo's as it lands, on the beat the turn was given. A board turn's voice is not this: the
 * conductor (wobo/board-turn.ts) opens its own utterance, and the hand waits on its sentences.
 */
export function SpeechNarrator() {
  const { turns } = useWoboChat();
  // Mark everything already said before this mount as spoken — Wobo only voices NEW lines.
  // Initialized synchronously (not in the effect) so a mount that happens mid-exchange, while
  // the newest turn is the learner's, can never swallow the reply that follows it.
  const spokenUpTo = useRef<string | null>(null);
  const booted = useRef(false);
  if (!booted.current) {
    booted.current = true;
    spokenUpTo.current =
      ([...turns].reverse().find((t) => t.role === 'wobo') as ChatTurn | undefined)?.id ?? 'none';
  }
  useEffect(() => {
    const last = turns[turns.length - 1] as ChatTurn | undefined;
    if (last?.role !== 'wobo' || last.id === 'seed') return;
    if (spokenUpTo.current === last.id) return;
    spokenUpTo.current = last.id;
    void speakLine(last.text, { beat: takeBeat(last.id) ?? 'step' });
  }, [turns]);
  return null;
}

// --- Card narration: Wobo reads each course card aloud, and the advance button waits for Wobo ------
//
// A card announces its core line on arrival; the course shell speaks it and, for teaching cards,
// gates "begin/continue" until Wobo finishes — or, when muted, until an equal reading time passes.
// A tiny window-event singleton so any card can announce without threading props through the deck.

interface Narration {
  key: string;
  text: string;
  gate: boolean;
}
let currentNarration: Narration = { key: 'none', text: '', gate: false };
const NARR_EVENT = 'wobo-card-narration';

/** A card calls this on arrival. `gate` locks the advance button while Wobo reads (teaching cards). */
export function announceCard(key: string, text: string, gate = true): void {
  currentNarration = { key, text, gate };
  window.dispatchEvent(new Event(NARR_EVENT));
}

/** Rough spoken/read duration for a line — the fallback clock when Wobo is muted. */
export function estimateReadMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1600, Math.min(14000, (words / 165) * 60000)); // ~165 wpm
}

export interface CardNarration {
  /** The line Wobo is reading — what the lesson screen writes in Wobo's hand under the board. */
  text: string;
  /** True once Wobo has finished reading (or the muted reading clock elapsed). */
  ready: boolean;
  /** 0→1 fill for the locked advance button — never a dead button. */
  progress: number;
  /** True while a gating (teaching) line is still being read. */
  gating: boolean;
  /** Re-speak the current card from the top. */
  replay: () => void;
}

/**
 * Mounted once by the course shell. Watches announced cards, speaks each on arrival, and reports
 * readiness so the advance button can wait for Wobo. When muted, a reading-time clock stands in.
 */
export function useCardNarration(): CardNarration {
  const [narr, setNarr] = useState<Narration>(currentNarration);
  const [progress, setProgress] = useState(1);
  const [ready, setReady] = useState(true);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const h = () => setNarr(currentNarration);
    // Child cards run their announce effect BEFORE this parent effect attaches (React runs child
    // effects first), so the first card's event lands before we're listening — re-sync on attach.
    h();
    window.addEventListener(NARR_EVENT, h);
    return () => window.removeEventListener(NARR_EVENT, h);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch is a replay trigger, not read here
  useEffect(() => {
    if (!narr.text) {
      setProgress(1);
      setReady(true);
      return;
    }
    setProgress(0);
    setReady(false);
    let raf = 0;
    let cancelled = false;
    let audioDone = false;
    const dur = estimateReadMs(narr.text);
    // Hard ceiling: if Wobo's onDone is ever lost (a socket that neither closes nor errors), the gate
    // degrades to the reading clock instead of locking the learner on the card forever.
    const ceiling = dur * 2 + 5000;
    const started = performance.now();
    if (!isMuted()) void speakLine(narr.text, { onDone: () => (audioDone = true) });
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - started;
      const t = elapsed / dur;
      // Re-read the switch each frame: muting mid-line cuts Wobo off, and from then on the reading
      // clock — not an audio callback that will never come — has to carry the gate.
      const muted = isMuted();
      if (audioDone || elapsed >= ceiling || (muted && t >= 1)) {
        setProgress(1);
        setReady(true);
        return;
      }
      // ramp toward 0.95 on the estimate, then snap to done when Wobo's audio actually ends
      setProgress(muted ? Math.min(1, t) : Math.min(0.95, t * 0.95));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [narr, epoch]);

  const replay = useCallback(() => {
    stopSpeaking();
    setEpoch((e) => e + 1);
  }, []);

  return { text: narr.text, ready, progress, gating: narr.gate, replay };
}

/**
 * Replay button for the course stage — re-speaks the current card. Sits beside mute.
 *
 * 22 px on a 20-unit viewBox, drawn at 2.4 — the rail's own icon register in
 * design/prototypes/app-v1.html, and 2.6 px of ink on the page. It used to be 17 px at 1.5, which
 * lands under a pixel and a half: a photocopy of a pencil, which DESIGN.md's line clause calls a
 * defect by name.
 */
export function ReplayButton({ onReplay, size = 22 }: { onReplay: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onReplay}
      aria-label="Hear Wobo again"
      title="Hear this again"
      style={{
        border: 'none',
        background: 'transparent',
        color: 'var(--wobo-ink)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: 6,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
        role="presentation"
      >
        <path
          d="M15.5 6.5 A6 6 0 1 0 16.4 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M15.8 3.4 L16 6.9 L12.5 6.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * The sound switch — mutes Wobo's voice, never Wobo's words. Lives beside Wobo's name.
 * Drawn at the same weight as its neighbour, for the same reason.
 */
export function MuteButton({ size = 22 }: { size?: number }) {
  const [muted, setMutedState] = useState(isMuted);
  useEffect(() => {
    const sync = () => setMutedState(isMuted());
    window.addEventListener(MUTE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MUTE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Unmute Wobo' : 'Mute Wobo'}
      aria-pressed={muted}
      title={muted ? "Wobo's voice is off — words still arrive" : 'Wobo speaks replies aloud'}
      style={{
        border: 'none',
        background: 'transparent',
        color: muted ? 'var(--wobo-ink-faint)' : 'var(--wobo-ink)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: 6,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
        role="presentation"
      >
        {/* a small speaker, Wobo's own */}
        <path
          d="M3.5 7.5 H6.8 L10.6 4.4 V15.6 L6.8 12.5 H3.5 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {muted ? (
          <path
            d="M13.2 7.6 L17 12.4 M17 7.6 L13.2 12.4"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        ) : (
          <>
            <path
              d="M13.2 7.2 C14.2 8.6 14.2 11.4 13.2 12.8"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M15.4 5.6 C17.2 7.8 17.2 12.2 15.4 14.4"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              opacity="0.55"
            />
          </>
        )}
      </svg>
    </button>
  );
}
