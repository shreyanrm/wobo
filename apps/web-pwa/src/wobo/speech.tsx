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
// Every voice socket still open for a sentence of the current utterance (openStream), by the
// function that closes it and drops what it held. A new utterance or a stop closes them all.
const openStreams = new Set<() => void>();
// Bumped on every stop/new-utterance so a running sentence pipeline knows it was superseded.
let speechGen = 0;

// ONE shared AudioContext for all Wobo's speech, lazily created (mirrors ui/sound.ts). A fresh
// context per sentence starts 'suspended' on Safari/iOS — and always when narration auto-fires
// before any gesture (cold reload / deep-link into a course) — so source.start() is silent and
// onended never fires. Sharing one context lets us unlock it on the first user gesture below.
let sharedCtx: AudioContext | null = null;
function speechCtx(): AudioContext | null {
  try {
    // A closed context (Safari closes one under memory pressure; a test closes its own) is no
    // context at all: make another rather than schedule onto a dead graph for ever.
    if (!sharedCtx || sharedCtx.state === 'closed') {
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
  // Every socket still open for a sentence of the utterance: closed, and what it held dropped.
  for (const drop of [...openStreams]) drop();
  openStreams.clear();
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

/**
 * WHY A SENTENCE CAME BACK WITHOUT AUDIO, AND WHETHER ASKING AGAIN CAN CHANGE IT.
 *
 * `refused` is an answer that will repeat however often it is asked: no gateway, no key on the box
 * (503 "voice unavailable"), the day's voice spent (429), a body with no audio in it. Asking again
 * costs the learner the whole ladder in silence, which is what the keyless 59 used to pay.
 *
 * `stalled` is the opposite, and it is the case this ladder was built for. The voice route raises
 * **502** only after both voices failed for this one sentence — and before it raises it, it hands
 * the call back to the learner's day and RE-PINS the turn's voice (`voice.py`, `repin_unheard_turn`
 * / `_refund_voice`). So a 502 is the gateway saying *ask me again, I have changed my mind*, and
 * the next ask is a disk read in the new voice: 9, 15 and 21 ms, measured. Our own read timeout and
 * a broken connection say the same thing — nothing was decided, so nothing is settled.
 */
type Empty = 'refused' | 'stalled';

/** Statuses that mean the sentence failed rather than the voice was withheld. */
const STALLED_STATUS = new Set([408, 425, 500, 502, 504]);

const isEmpty = (got: Clip | Empty): got is Empty => typeof got === 'string';

/** Synthesize one sentence to PCM samples, or say why there is none (see {@link Empty}). */
async function synthOnce(
  text: string,
  beat: VoiceBeat = 'step',
  opts?: { deciding?: boolean; signal?: AbortSignal },
): Promise<Clip | Empty> {
  // Offline (or keyless): don't burn the timeout on a fetch that can't land — fall straight to
  // text. The reply is already on screen; Wobo's voice is the grace, not the help.
  const gateway = gatewayUrl();
  if (!gateway || !text.trim() || isOffline()) return 'refused';
  const ctrl = new AbortController();
  // The ladder below retires an ask that lost; its abort is this request's abort.
  if (opts?.signal?.aborted) return 'refused';
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
    // Silent-safe either way; the gate releases via onDone. The status only decides whether one
    // more ask is worth the learner's time.
    if (!res.ok) return STALLED_STATUS.has(res.status) ? 'stalled' : 'refused';
    const audio = (await res.json()) as { mime?: string; b64?: string };
    if (!audio.b64) return 'refused';
    const rate = Number(/rate=(\d+)/.exec(audio.mime ?? '')?.[1] ?? 24000);
    const samples = base64ToFloat32(audio.b64);
    return samples.length === 0 ? 'refused' : { samples, rate };
  } catch {
    // Retired for a newer rung: this ask decided nothing and must not speak for the gateway.
    if (opts?.signal?.aborted) return 'refused';
    return 'stalled'; // our own read timeout, or the connection broke: nothing was answered
  } finally {
    clearTimeout(timer);
  }
}

/** Synthesize one sentence to PCM samples (or null when keyless/rate-limited/muted). */
async function synth(
  text: string,
  beat: VoiceBeat = 'step',
  opts?: { deciding?: boolean; signal?: AbortSignal },
): Promise<Clip | null> {
  const got = await synthOnce(text, beat, opts);
  return isEmpty(got) ? null : got;
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

// --- THE FIRST SYLLABLE: one mouth, a ladder of asks, and a race ----------------------------------
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
//
// AND THE SOCKET IS THE SECOND ASK, NOT A SECOND BILL ON EVERY TURN. The read-aloud socket holds
// no pin of the gateway's, so it is the one mouth a re-decision cannot strand — but it is also the
// slow one. Measured live on 2026-09-14 over twelve turns: the socket won four boards and those
// four are the SLOWEST first syllables of the run (4780, 3825, 3745 and 3464 ms), while every
// buffered win landed in 322 to 973 ms; once the socket had a turn its sentence seams ran 2.2 to
// 12.2 s across three to five sockets. It won those four only because the buffered route had
// answered 502 — which is not a refusal at all (see Empty above) — and racing it from the first
// millisecond of every turn doubled the voice bill for audio nobody heard.
//
// So it is asked for second, and only where a second ask is the point: at once when this turn's own
// buffered ask says it stalled (or the last one did), and otherwise not until STREAM_AFTER_MS, by
// which time a healthy buffered route has long since answered and no socket is opened at all. The
// first audio to land still takes the mouth for the WHOLE turn — one voice, one performance — and
// the other mouth is closed before a syllable of it plays.

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

/**
 * Chances in the air for one sentence, at most — and A RUNG NEVER BUYS ONE BY SPENDING ANOTHER.
 *
 * Until 2026-09-15 a rung that found this many in flight ABORTED THE OLDEST to make room, on the
 * reasoning that the oldest is the deadest. That is true of a HELD request and the exact opposite
 * of a SLOW one, and the gateway has both. Measured on the lens at 1440 (the judge's run of
 * 2026-09-15, first syllable 7307 ms): every ask was answered WITH AUDIO, but only after
 * ``_UNHEARD_TIMEOUT_S`` — the six seconds voice.py gives an unheard turn's pinned voice — had
 * run. Ask 0 was sent at 0 with its audio due at 6600; the rung at 3000 killed it, the rung at
 * 6500 killed ask 1 (due at 7300) for the same reason, and the learner heard ask 2 at 8006 ms on
 * the ruler. Ten reads bought for one sentence, two of them answered and thrown away unheard.
 *
 * So the cap is a cap on ASKING, not on keeping: a rung that would have to murder the ask nearest
 * its answer is not a fourth chance, and the gateway pays a nine-to-eleven second vendor read for
 * it either way (our abort does not stop its synthesis). Every ask still ends on its own budget
 * (FIRST_TTS_TIMEOUT_MS) and the ladder's, so nothing is held for ever.
 */
const ASKS_IN_FLIGHT = 3;

/**
 * WHEN AN ASK STOPS HOLDING A PLACE IN THE SKY. It is never aborted for this — it simply stops
 * counting against the three, so a rung has somewhere to stand.
 *
 * The cap above is right about a slow gateway and wrong about a held one, and the ladder has to
 * live with both on the same day. voice.py gives an unheard turn's pinned voice six seconds
 * (`_UNHEARD_TIMEOUT_S`) and then re-decides the whole turn; a request sent BEFORE that moment is
 * waiting on a voice that no longer exists, and only a request sent AFTER it can be told so — that
 * is the 2026-09-11 shape, where the clip sat on the gateway's disk while the client's own request
 * hung, and the very next ask read it in nine milliseconds.
 *
 * With a flat cap of three, all three of a turn's asks are sent inside the first 1.4 s, every one
 * of them before that re-decision — so the ladder was frozen for the remaining nine seconds of its
 * budget with nothing left that could learn anything. On the live wire of 2026-09-15 that is what
 * the reads bought: buffered asks fell 78 to 55 while the upstream read timeouts stayed at 37 and
 * 40, the buffered route went silent on turns it used to recover on, and the socket took five
 * boards instead of one — a mouth whose own first audio was measured that day at 4.8 to 8.4 s.
 *
 * So an ask past six seconds no longer blocks a chance, and it is not killed for one either: it
 * may still answer, and on the lens at 1440 it did, at 6.6 s. One more read on a turn that has
 * heard nothing for six seconds is the cheapest thing in this file.
 */
export const ASK_SPENT_MS = 6000;

export interface FirstSoundLadder {
  /** When to ask again, in ms from the first ask. */
  rungs: readonly number[];
  /** When to stop asking altogether and return silence. Bounds every ask, whatever the rungs say. */
  budgetMs: number;
  /** Read at each rung: true when another mouth has the turn, so there is nothing left to ask for. */
  stop?: () => boolean;
  /**
   * An ask came back empty and nothing else is in flight: can a FRESH ask still be answered?
   * True asks again at once rather than settling for silence — the gateway that just said 502
   * has already re-decided this turn's voice, and a socket that died without a syllable can be
   * opened again. False (the default) settles now, which is what a keyless box and a spent day
   * have earned: nine and a half seconds of rungs would only be refused five more times.
   */
  keepClimbing?: (attempt: number) => boolean;
  /** Most asks this ladder will ever make, rungs and re-asks together. Default: rungs + 3. */
  maxAsks?: number;
  /** How old an ask must be before it stops holding a place in the sky. Default: {@link ASK_SPENT_MS}. */
  spentMs?: number;
  /** Fires when the ladder is called off (the other mouth won): every ask in flight is abandoned. */
  signal?: AbortSignal;
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
    const inFlight = new Map<number, { ctrl: AbortController; at: number }>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const spentMs = ladder.spentMs ?? ASK_SPENT_MS;
    let launched = 0;
    let settled = false;

    const settle = (got: T | null) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      for (const ask of inFlight.values()) ask.ctrl.abort();
      inFlight.clear();
      resolve(got);
    };

    /** Asks that could still be answered; a spent one (ASK_SPENT_MS) holds no place, and lives on. */
    const holding = (): number => {
      const now = performance.now();
      let n = 0;
      for (const ask of inFlight.values()) if (now - ask.at < spentMs) n++;
      return n;
    };

    const launch = () => {
      // Three chances already in the air is three (see ASKS_IN_FLIGHT): this rung is not climbed,
      // rather than climbed over the one nearest its answer. An ask older than the gateway's own
      // re-decision holds no place (ASK_SPENT_MS) — and is not killed for it either. `keepClimbing`
      // only ever calls this with the sky empty, so the ladder still asks again the instant an
      // answer says to.
      if (holding() >= ASKS_IN_FLIGHT) return;
      const attempt = launched++;
      const ctrl = new AbortController();
      inFlight.set(attempt, { ctrl, at: performance.now() });
      Promise.resolve()
        .then(() => ask(attempt, ctrl.signal))
        .then(
          (got) => got,
          () => null,
        )
        .then((got) => {
          if (inFlight.get(attempt)?.ctrl === ctrl) inFlight.delete(attempt);
          if (settled) return;
          if (got !== null && got !== undefined) {
            settle(got);
            return;
          }
          // This ask came back empty with nothing else in flight. A held request never comes back
          // empty on its own, only aborted, and an ask is only ever aborted for a newer one that
          // is in flight — so the gateway ANSWERED, and the answer decides what happens next.
          //
          // A REFUSAL settles here: a keyless 503, a spent day's 429. Until 2026-09-15 the ladder
          // waited for every rung to ask and be refused first — 9.5 s of the first sentence, on
          // each of the 59 keyless turns.
          //
          // A STALL asks again NOW, not at the next rung. On 2026-09-14 the deciding sentence of
          // four live turns was answered 502 in a few hundred milliseconds, the ladder read that
          // as a refusal, and the turn fell to the mouth that costs 3.5 to 4.8 s for its first
          // syllable and up to 12.2 s between sentences. The 502 was the gateway saying it had
          // re-pinned the voice and the clip was on its disk.
          if (inFlight.size === 0) {
            const another = launched < (ladder.maxAsks ?? ladder.rungs.length + 3);
            if (another && !ladder.stop?.() && ladder.keepClimbing?.(attempt) === true) launch();
            else settle(null);
          }
        });
    };

    if (ladder.signal?.aborted) {
      resolve(null);
      return;
    }
    ladder.signal?.addEventListener('abort', () => settle(null), { once: true });
    launch();
    for (const at of ladder.rungs) {
      timers.push(
        setTimeout(() => {
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
 * One buffered ask for the deciding sentence, wired for a ladder: it answers with the clip, or
 * with null after writing down WHY there was none, so `keepClimbing` can tell a refusal that will
 * repeat from a stall that the next ask answers off the disk.
 */
function decidingAsk(
  text: string,
  beat: VoiceBeat,
  reasons: Map<number, Empty>,
  onStall?: () => void,
): (attempt: number, signal: AbortSignal) => Promise<Clip | null> {
  return async (attempt, signal) => {
    const got = await synthOnce(text, beat, { deciding: true, signal });
    if (!isEmpty(got)) {
      bufferedStalled = false; // the route is answering again
      return got;
    }
    reasons.set(attempt, got);
    if (got === 'stalled') {
      bufferedStalled = true;
      onStall?.();
    }
    return null;
  };
}

/**
 * The sentence that decides a turn's voice, asked for on the ladder. Twelve seconds of patience in
 * all, because the gateway's own silent re-decision lands at six to nine, and a learner who waits
 * ten seconds and hears Wobo is better served than one who hears a stranger at eight.
 */
function synthFirst(text: string, beat: VoiceBeat, stop: () => boolean): Promise<Clip | null> {
  const reasons = new Map<number, Empty>();
  return askForFirstSound<Clip>(decidingAsk(text, beat, reasons), {
    rungs: REASK_RUNGS_MS,
    budgetMs: FIRST_TTS_TIMEOUT_MS,
    stop,
    keepClimbing: (attempt) => reasons.get(attempt) === 'stalled',
  });
}

// --- THE STREAMED SENTENCE ------------------------------------------------------------------------
//
// One sentence on the voice socket, held in hand until it is its turn. The socket is opened the
// moment the sentence is decided — or while the sentence before it plays — and its chunks are kept
// rather than scheduled, so a streamed turn runs sentence to sentence with no mint and no connect
// between them, and the beat the ink waits on can fire on a sentence's first chunk.

export interface StreamedSentence {
  /** True at the first chunk of audio (the sentence can begin); false when the socket died first. */
  ready: Promise<boolean>;
  /** Everything has arrived: `heldMs` is the whole sentence's length. */
  complete: () => boolean;
  /** How much audio is in hand, in ms. */
  heldMs: () => number;
  /**
   * How long this socket has been a socket: ms since it was actually connected, and 0 while it is
   * still waiting for one of the gateway's two. A death is told from a refusal by this.
   */
  liveMs: () => number;
  /** Play what is held and what is still coming; resolves when the last chunk has ended. */
  play: () => Promise<void>;
  /** Close the socket and drop what was held. Nothing of it is ever heard. */
  drop: () => void;
}

const STREAM_RATE = 24000;

/**
 * HOW MANY VOICE SOCKETS ONE LEARNER MAY HAVE OPEN AT ONCE — the gateway's own number, kept here.
 *
 * voice.py caps a subject at two live TTS sockets (`_MAX_TTS_PER_SUBJECT`) and closes the third at
 * once, unheard. On the wire of 2026-09-15 a later sentence of a streamed turn opened THREE sockets
 * inside twenty milliseconds — every one of them refused and closed with no syllable — before a
 * fourth spoke: the sentence in front of it was still streaming (one), its own socket was open
 * (two), and the rung at STREAM_REASK_MS made a third. Three mints, three native-audio starts,
 * nothing heard, and the sentence itself fell silent while they were spent.
 *
 * So a socket over the cap is not opened and refused; it WAITS — no token minted, no connection,
 * no second vendor started — and takes a slot the moment the sentence in front of it is whole. Its
 * own deadline still bounds the wait, so a learner never waits longer for the silence.
 */
const LIVE_SOCKETS = 2;

/** Sockets connected (or connecting) right now, as the gateway counts them. */
let liveSockets = 0;
/** Sockets waiting for one of those two, oldest first. */
const slotWaiters: (() => void)[] = [];

/** Give a slot back and wake whoever is waiting; each waiter re-queues itself if it is still full. */
function releaseSocketSlot(): void {
  if (liveSockets > 0) liveSockets--;
  wakeSlotWaiters();
}

function wakeSlotWaiters(): void {
  for (const wake of slotWaiters.splice(0)) wake();
}

/**
 * Take one of the gateway's sockets, now or when one comes free. False when the caller gave up
 * while waiting (its own watchdog, a stop, a newer utterance) — nothing is opened then.
 *
 * `claim` runs on the same tick as the count, never a microtask later: a socket dropped in that
 * gap would otherwise leave a slot taken by nobody, and two of those close the voice for the rest
 * of the session.
 */
function takeSocketSlot(gone: () => boolean, claim: () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const attempt = () => {
      if (gone()) {
        resolve(false);
        return;
      }
      if (liveSockets < LIVE_SOCKETS) {
        liveSockets++;
        claim();
        resolve(true);
        return;
      }
      slotWaiters.push(attempt);
    };
    attempt();
  });
}

function openStream(
  text: string,
  beat: VoiceBeat,
  gen: number,
  deadlineMs: number,
): StreamedSentence {
  const held: Float32Array<ArrayBuffer>[] = [];
  let heldSamples = 0;
  let complete = false; // the gateway closed the socket after the whole sentence
  let dead = false; // dropped, or died before a chunk
  let playing = false;
  let playhead = 0;
  let ws: WebSocket | null = null;
  let ctx: AudioContext | null = null;
  let readyResolve: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    readyResolve = resolve;
  });
  let playResolve: (() => void) | null = null;
  /** One of the gateway's two (LIVE_SOCKETS), held from before the mint until this one is done. */
  let hasSlot = false;
  /** When this socket stopped waiting and started costing: the clock a day is measured on. */
  let tookSlotAt = performance.now();
  /** When it became a connection; 0 while it is still only a queue place. */
  let connectedAt = 0;
  /** Give the slot back the moment the gateway stops counting this socket, and only once. */
  const leaveSocket = () => {
    if (!hasSlot) return;
    hasSlot = false;
    releaseSocketSlot();
  };

  const drop = () => {
    if (dead) return;
    dead = true;
    complete = true;
    clearTimeout(watchdog);
    openStreams.delete(drop);
    leaveSocket();
    // A socket still waiting for a slot gave its place up here: whoever is behind it may go now.
    wakeSlotWaiters();
    try {
      ws?.close();
    } catch {
      // already closing
    }
    held.length = 0;
    readyResolve(false);
    const done = playResolve;
    playResolve = null;
    done?.();
  };
  // No first chunk inside the budget: this mouth is not going to speak.
  const watchdog = setTimeout(() => heldSamples === 0 && drop(), deadlineMs);
  openStreams.add(drop);

  const schedule = (samples: Float32Array<ArrayBuffer>) => {
    const c = ctx;
    if (!c) return;
    const buf = c.createBuffer(1, samples.length, STREAM_RATE);
    buf.copyToChannel(samples, 0);
    const node = c.createBufferSource();
    node.buffer = buf;
    node.connect(c.destination);
    playhead = Math.max(playhead, c.currentTime + 0.05);
    node.start(playhead);
    playhead += buf.duration;
    streamSources.add(node);
    node.onended = () => streamSources.delete(node);
  };
  // Playing and complete: the sentence ends when the last scheduled chunk does.
  const settlePlay = () => {
    if (!playing || !complete || !playResolve) return;
    const done = playResolve;
    playResolve = null;
    const remainMs = ctx ? Math.max(0, playhead - ctx.currentTime) * 1000 : 0;
    setTimeout(done, remainMs + 40);
  };

  void (async () => {
    const gateway = gatewayUrl();
    if (!gateway || !text.trim() || isOffline() || gen !== speechGen) {
      drop();
      return;
    }
    ctx = speechCtx();
    if (!ctx) {
      drop();
      return;
    }
    // One of the learner's two sockets, or a wait for one (LIVE_SOCKETS). Before the token, so a
    // socket the gateway would only refuse costs no mint, no connection and no second vendor.
    // The day is measured from the slot, not from the call: the wait for one is ours, and what a
    // later sentence must be given time for is the vendor's mint, connection and synthesis.
    const claim = () => {
      hasSlot = true;
      tookSlotAt = performance.now();
    };
    if (!(await takeSocketSlot(() => dead || gen !== speechGen, claim))) {
      drop();
      return;
    }
    if (dead || gen !== speechGen) {
      drop();
      return;
    }
    // A websocket carries no headers we control: identity is proved over authenticated HTTP and
    // the socket carries the short-lived, single-use token it mints.
    const minted = await mintVoiceToken(gateway);
    if (!minted || dead || gen !== speechGen) {
      drop();
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        withBeat(voiceSocketUrl(gateway, '/v1/voice/tts/stream', minted.token), beat),
      );
    } catch {
      drop();
      return;
    }
    ws = socket;
    connectedAt = performance.now();
    socket.onopen = () => {
      try {
        socket.send(text.slice(0, 600));
      } catch {
        drop();
      }
    };
    socket.onerror = () => heldSamples === 0 && drop();
    socket.onclose = () => {
      if (dead) return;
      if (heldSamples === 0) {
        drop(); // closed without a syllable: the gateway had no voice for it
        return;
      }
      complete = true;
      clearTimeout(watchdog);
      openStreams.delete(drop);
      leaveSocket(); // the sentence is whole: the gateway counts this socket no longer, nor do we
      settlePlay();
    };
    socket.onmessage = (e) => {
      if (dead) return;
      if (gen !== speechGen) {
        drop();
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
      for (const part of parts) {
        const b64 = part?.inlineData?.data;
        if (!b64) continue;
        const samples = base64ToFloat32(b64);
        if (samples.length === 0) continue;
        const first = heldSamples === 0;
        heldSamples += samples.length;
        if (playing) schedule(samples);
        else held.push(samples);
        if (first) {
          clearTimeout(watchdog);
          // What this vendor took to say a syllable, today, on this connection. Every sentence
          // behind this one is given it (streamSentenceMs) instead of a constant that was true
          // on a different day.
          streamFirstAudioMs = performance.now() - tookSlotAt;
          readyResolve(true);
        }
      }
    };
  })();

  return {
    ready,
    complete: () => complete && !dead,
    heldMs: () => (heldSamples / STREAM_RATE) * 1000,
    liveMs: () => (connectedAt === 0 ? 0 : performance.now() - connectedAt),
    async play() {
      if (dead || playing) return;
      const c = ctx;
      if (!c) return;
      if (c.state === 'suspended') await c.resume().catch(() => {});
      if (dead || gen !== speechGen) return;
      playing = true;
      for (const samples of held) schedule(samples);
      held.length = 0;
      await new Promise<void>((resolve) => {
        playResolve = resolve;
        settlePlay();
      });
    },
    drop,
  };
}

/** What a sentence reaches the ear as: a clip in hand, or a sentence on the socket. */
type Sound = { clip: Clip } | { stream: StreamedSentence };

/** How long the sound runs, when that is known before it plays (a clip always; a socket once whole). */
function soundMs(sound: Sound): number | undefined {
  if ('clip' in sound) return (sound.clip.samples.length / sound.clip.rate) * 1000;
  return sound.stream.complete() ? sound.stream.heldMs() : undefined;
}

function dropSound(sound: Sound | null): void {
  if (sound && 'stream' in sound) sound.stream.drop();
}

async function playSound(sound: Sound, gen: number): Promise<void> {
  if ('clip' in sound) await playSamples(sound.clip.samples, sound.clip.rate, gen);
  else await sound.stream.play();
}

/**
 * HOW LONG THE BUFFERED ROUTE GETS BEFORE A SOCKET IS OPENED BESIDE IT.
 *
 * Every buffered win of the twelve live turns landed in 322 to 973 ms, so a grace of six hundred
 * milliseconds opens no socket at all on most healthy turns — no mint, no second vendor, no second
 * bill — and still leaves nine hundred of the first syllable's 1.5 s budget for one to speak on the
 * turns where the buffered route is slow. It is a CEILING, not a wait: this turn's own 502, or a
 * stall on the turn before it, opens the socket at once.
 */
export const STREAM_AFTER_MS = 600;

/**
 * The buffered route stalled on a sentence somewhere in this session and has not answered since.
 * A day where the voice provider is hanging is a day where it hangs on every turn, so the next
 * turn does not spend its grace finding that out a second time: the grace is paid ONCE.
 */
let bufferedStalled = false;

/** Forget that (a cold session again). Exported for the tests; nothing in the app calls it. */
export function forgetVoiceHealth(): void {
  bufferedStalled = false;
  liveSockets = 0;
  slotWaiters.length = 0;
  streamFirstAudioMs = 0;
}

/**
 * The sentence that decides a turn's voice: the buffered ladder, and the voice socket as its
 * second ask. The first audio to land takes the mouth for the whole turn; the other is called off
 * before a syllable of it plays. Null when both were silent inside the budget, or the turn moved
 * on (superseded, muted, or the device's) while they were asked.
 */
function firstSound(
  text: string,
  beat: VoiceBeat,
  gen: number,
  lost: () => boolean,
  mouth: OneMouth,
): Promise<Sound | null> {
  return new Promise((resolve) => {
    const cancel = new AbortController();
    const reasons = new Map<number, Empty>();
    let stream: StreamedSentence | null = null;
    let streamSettled = false;
    let ladderDone = false;
    let settled = false;
    let openTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (sound: Sound | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      resolve(sound);
    };
    /** Nothing is left that could still make a sound: the ladder is done and no socket is pending. */
    const silent = () => {
      if (!ladderDone) return;
      if (stream !== null && !streamSettled) return;
      settle(null);
    };

    const openSocket = () => {
      clearTimeout(openTimer);
      if (stream !== null || settled || lost() || mouth.taken()) return;
      const opened = openStream(text, beat, gen, FIRST_TTS_TIMEOUT_MS);
      stream = opened;
      void opened.ready.then((ok) => {
        streamSettled = true;
        if (ok && !settled && !lost() && mouth.claim('stream')) {
          // The socket only ever wins a turn the buffered route could not answer, so the next
          // turn does not spend its grace discovering that a second time: on a hanging day only
          // the FIRST turn pays the six hundred milliseconds, and the rest open at once.
          bufferedStalled = true;
          cancel.abort();
          settle({ stream: opened });
          return;
        }
        opened.drop(); // the clip was first, or the turn moved on
        silent();
      });
    };

    // Opened at once on a session that has already seen this route stall, on this turn's own stall
    // (decidingAsk hands `openSocket` the moment one is answered), and otherwise on the grace.
    // NEVER on a refusal: no key on the box or a spent day refuses the socket's token too, so a
    // keyless turn mints nothing and opens nothing — the ladder settles and the timer is cleared.
    if (bufferedStalled) openSocket();
    else openTimer = setTimeout(openSocket, STREAM_AFTER_MS);

    askForFirstSound<Clip>(decidingAsk(text, beat, reasons, openSocket), {
      rungs: REASK_RUNGS_MS,
      budgetMs: FIRST_TTS_TIMEOUT_MS,
      stop: () => lost() || mouth.owner() === 'stream',
      keepClimbing: (attempt) => reasons.get(attempt) === 'stalled',
      signal: cancel.signal,
    }).then((clip) => {
      ladderDone = true;
      if (clip && !settled && !lost() && mouth.claim('buffered')) {
        stream?.drop();
        settle({ clip });
        return;
      }
      silent();
    });
  });
}

// --- A LATER SENTENCE ON THE SOCKET ---------------------------------------------------------------
//
// A socket that opens and never says a word used to cost the learner the whole eight-second
// watchdog — and only THEN was a replacement opened, after the sentence before it had already
// finished playing. That is the 11.7 and 12.2 s seams the judge measured on 2026-09-14. A sentence
// gets one socket, and a second one the moment the first is known to be dead (or has spent
// STREAM_REASK_MS without a syllable, in which case the two run side by side and the first audio of
// either is what plays). Two at most: past that it is the day, not the socket, and silence on the
// reading clock keeps the turn's one voice.

/** The floor for a later sentence's socket, past the 2.3-3.5 s its first audio took on a good day. */
const STREAM_SENTENCE_MS = 4500;
/** A socket that is merely slow gets a second one beside it here, not after its whole deadline. */
const STREAM_REASK_MS = 2600;

/**
 * HOW LONG THE LAST SOCKET THAT SPOKE TOOK TO SAY ITS FIRST SYLLABLE — the day, measured, not guessed.
 *
 * A constant deadline cannot know the vendor's weather. On 2026-09-15 the socket that WON a turn
 * had its first audio at 4.8 to 8.4 s (its first message at 1.8 to 2.0 s, the audio long after), and
 * the deciding sentence could afford that because firstSound gives it the whole
 * FIRST_TTS_TIMEOUT_MS. Every sentence AFTER it got STREAM_SENTENCE_MS — 4500 — so our own watchdog
 * killed each of its sockets before the day's audio could arrive, a second was opened on the rung
 * and killed the same way, and the sentence then fell to the reading clock in silence. That is a
 * turn whose first sentence is heard and whose rest is not, with two or three native-audio starts
 * bought per silent sentence: five boards of the run, and most of the 12-to-43 rise in sockets.
 *
 * The socket that won the turn already measured this day, seconds ago, on this learner's
 * connection. Every sentence behind it is given what that one needed — never less than the floor,
 * and never more than the budget a later sentence already had (TTS_TIMEOUT_MS), so nobody waits
 * longer than before. The change is what they hear at the end of the wait.
 *
 * It cannot go stale: a later sentence only ever reaches the socket because one SPOKE on this turn
 * (`mouth.owner() === 'stream'`), and that is the socket that wrote this number, seconds ago.
 */
let streamFirstAudioMs = 0;

/** The deadline a later sentence's socket gets: the floor, or what the day actually took. */
function streamSentenceMs(): number {
  return Math.min(TTS_TIMEOUT_MS, Math.max(STREAM_SENTENCE_MS, streamFirstAudioMs + 1500));
}

/** When a second socket is opened beside a slow one: once it has missed the day's own time. */
function streamReaskMs(): number {
  return Math.max(STREAM_REASK_MS, streamFirstAudioMs + 600);
}
/**
 * A socket that closed with no syllable in less time than a connection takes was not a socket that
 * DIED; it was one the gateway REFUSED — the 1008 over `_MAX_TTS_PER_SUBJECT`, or a token it would
 * not honour. Opening another in the same millisecond buys the same answer: on 2026-09-15 it bought
 * three inside twenty milliseconds, all closed unheard, before a fourth spoke. A refusal waits for
 * the rung; only a socket that really tried is replaced at once.
 */
const SOCKET_REFUSED_MS = 400;

/** One sentence on the voice socket, with a second socket behind it. Null when neither speaks. */
function streamSound(text: string, beat: VoiceBeat, gen: number): Promise<Sound | null> {
  /** How long each socket lived before it closed unheard: a refusal is told from a death by this. */
  const lived = new Map<number, number>();
  const deadline = streamSentenceMs();
  const reask = streamReaskMs();
  return askForFirstSound<Sound>(
    (attempt, signal) => {
      const opened = openStream(text, beat, gen, deadline);
      signal.addEventListener('abort', () => opened.drop(), { once: true });
      return opened.ready.then((ok) => {
        if (ok) return { stream: opened } as Sound;
        // Its own life, not ours: a socket that never got one of the gateway's two reads 0 here,
        // and asking for another would only queue behind the same sentence again.
        lived.set(attempt, opened.liveMs());
        return null;
      });
    },
    {
      // A rung past the sentence's own deadline is no rung at all: the socket it would stand
      // beside is already dead by then, and a day this slow has no room for a fourth vendor start.
      rungs: reask < deadline ? [reask] : [],
      budgetMs: TTS_TIMEOUT_MS,
      // A socket that tried and died can always be opened again; one that was refused on sight
      // cannot, and asking again at once only spends the learner's sentence on the same no.
      keepClimbing: (attempt) => (lived.get(attempt) ?? 0) >= SOCKET_REFUSED_MS,
      // Three at most. The client keeps the gateway's own live count now (LIVE_SOCKETS), so a rung
      // no longer opens a socket the gateway would close unheard — it waits for the sentence in
      // front of it to finish and takes its place.
      maxAsks: 3,
    },
  );
}

/**
 * One sentence more, for an answer Wobo is already speaking — on the mouth the turn was won with:
 * a socket opened again, or the buffered route asked again (synthAgain). Never for the deciding
 * sentence: its race was already the asking-again, and twelve seconds of silence is not to be
 * followed by eight more before the ink may move.
 */
async function soundAgain(
  text: string,
  beat: VoiceBeat,
  gen: number,
  turn: VoiceOfTheTurn,
  mouth: OneMouth,
): Promise<Sound | null> {
  if (turn.chosen() !== 'gateway' || gen !== speechGen || isMuted()) return null;
  // On the socket there is nothing left to ask: streamSound already opened the second one, and a
  // third here would only add a vendor's bill to a seam the learner is already inside. Silence on
  // the reading clock keeps the ink paced and keeps the turn's one voice.
  if (mouth.owner() === 'stream') return null;
  const clip = await synthAgain(text, beat, gen, turn);
  return clip ? { clip } : null;
}

/** A tiny timing trail the live verifier reads off `window` — proves ink lands on its beat. */
function traceBeat(kind: string, i: number, count: number, voicedMs?: number, mouth?: Mouth): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __woboTiming?: unknown[] };
  if (!Array.isArray(w.__woboTiming)) return; // opt-in: the verifier sets it to []
  w.__woboTiming.push({
    t: Math.round(performance.now()),
    kind,
    sentence: i,
    marks: count,
    voicedMs,
    mouth,
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
  // AND ONE MOUTH FOR IT. The deciding sentence is a race between the socket and the buffered
  // route (firstSound); whichever wins reads every sentence after it, so the answer is one voice.
  const mouth = oneMouth();
  /** Sentences begun so far, across every line: the index the hand's gate waits on. */
  let spoken = 0;
  let ended = false;
  let wake: (() => void) | null = null;
  const nudge = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const lost = () => gen !== speechGen || isMuted() || turn.chosen() === 'device';
  /**
   * Ask for one sentence's sound, on the mouth this turn has: the socket once the socket won it,
   * the buffered route once a clip did, both at once while nothing has been heard, and nothing
   * at all once the device is reading the turn (lastResort reads it there).
   */
  const soundFor = (
    sentence: string,
    beat: VoiceBeat,
    /**
     * Is the mouth still in doubt when this sentence is asked for? A sentence is only the DECIDING
     * one while nothing of the turn is in hand. `turn.spoke()` cannot answer this on its own: it
     * does not run until the audio actually plays, and the next sentence is asked for a line
     * earlier — so on every turn sentence two found `chosen()` still null and took the full
     * deciding ladder, three more reads and a twelve-second budget for a mouth that was settled
     * the moment sentence one's clip won it. Six upstream voice reads for a two-sentence turn on the
     * judge's lens at 1440; four is the honest number. The caller knows what it is holding.
     */
    deciding: boolean,
  ): Promise<Sound | null> | null => {
    if (turn.chosen() === 'device') return null;
    if (mouth.owner() === 'stream') return streamSound(sentence, beat, gen);
    if (turn.chosen() === null && deciding) {
      // The race, while no mouth has the turn; once the clip won it but nothing has played yet
      // (muted mid-race), the ladder alone, on its deciding budget.
      if (mouth.owner() === null) return firstSound(sentence, beat, gen, lost, mouth);
      return synthFirst(sentence, beat, lost).then((clip) => (clip ? { clip } : null));
    }
    return synth(sentence, beat).then((clip) => (clip ? { clip } : null));
  };
  /** Nothing of this turn is in hand or playing yet: the next sentence asked for is the deciding one. */
  let undecided = true;
  /** The next line's first sentence, asked for before that line was dequeued. */
  let carried: { text: string; beat: VoiceBeat; sound: Promise<Sound | null> } | null = null;

  const drain = (async () => {
    while (true) {
      if (gen !== speechGen) return;
      const next = queue.shift();
      if (next === undefined) {
        if (ended) {
          void carried?.sound.then(dropSound);
          return;
        }
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
      // The sentence before this line's first was carried across the seam (opened while the last
      // sentence of the previous line played, so a streamed turn has no gap between lines). It
      // is this line's only when the line is the one the queue showed.
      let pending: Promise<Sound | null> | null = null;
      if (carried !== null) {
        if (carried.text === segs[0] && carried.beat === next.beat) pending = carried.sound;
        else void carried.sound.then(dropSound);
        carried = null;
      }
      if (pending === null && canVoice && segs.length > 0) {
        pending = soundFor(segs[0] as string, next.beat, undecided);
      }
      for (let i = 0; i < segs.length; i++) {
        let cur = pending ? await pending : null;
        pending = null;
        if (gen !== speechGen) return;
        // A sound in hand settles the mouth, whatever `turn.chosen()` still says: the sentence
        // behind it is not the deciding one and must not be asked for as though it were.
        if (cur) undecided = false;
        // The next sentence is asked for while this one plays: the next of this line, or — when
        // this is the line's last and the plan has already sent the next line — that one's first.
        if (canVoice && i + 1 < voiceCount) {
          pending = soundFor(segs[i + 1] as string, next.beat, undecided);
        } else if (canVoice && i + 1 === segs.length && queue[0] !== undefined) {
          const ahead = queue[0];
          const first = sentences(ahead.text)[0];
          const sound = first !== undefined ? soundFor(first, ahead.beat, undecided) : null;
          if (first !== undefined && sound !== null) {
            carried = { text: first, beat: ahead.beat, sound };
          }
        }
        // One ask more for a sentence of an answer Wobo is already speaking: the gateway bought
        // the whole plan when its words were decided, so an empty answer here is usually a
        // sentence that was still in flight, and a gap is cheaper to close than a voice is to keep.
        if (!cur && canVoice && i < voiceCount) {
          cur = await soundAgain(segs[i] as string, next.beat, gen, turn, mouth);
        }
        // The beat the ink waits on: this sentence is starting now, voiced or read.
        const voicedMs = cur ? soundMs(cur) : undefined;
        traceBeat('sentence', spoken, 0, voicedMs);
        hooks?.onSentence?.(spoken++, voicedMs);
        if (cur && !isMuted() && turn.chosen() !== 'device') {
          if (turn.chosen() === null) {
            traceBeat(
              'first-sound',
              spoken - 1,
              0,
              voicedMs,
              'clip' in cur ? 'buffered' : 'stream',
            );
          }
          turn.spoke();
          await playSound(cur, gen);
        } else {
          dropSound(cur);
          if (canVoice && i < voiceCount) await lastResort(segs[i] as string, gen, turn);
          else await waitMs(estimateReadMs(segs[i] as string));
        }
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
