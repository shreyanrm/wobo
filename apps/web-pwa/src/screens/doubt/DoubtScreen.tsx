'use client';

/**
 * THE DOUBT SOLVER (owner, 2026-09-05): "when the students are using their phones or computers
 * or tabs, they can upload or take a photo of their book or whatever they have a doubt about and
 * wobo can annotate on that and explain as well."
 *
 * The screen moves in the order flow.ts allows and no other:
 *
 *   capture     the camera (a phone), the picker and the drop zone (a laptop);
 *   reading     the gateway reads the page (`POST /v1/doubt`) — the one place the product uses
 *               vision, screened on the way in;
 *   confirm     LAW 1: "I read this as ..." with every line editable in place and the line it came
 *               from lit on the photo. Nothing is computed until the learner says Explain;
 *   explaining  LAW 5: the answer rides the ordinary board turn over the SAME SSE wire, from
 *               `POST /v1/doubt/{id}/answer` with the corrections as the body; each ink frame lands
 *               on its line inside the sentence about it (wobo/Stage.tsx paints `screenStore` over
 *               the photo through the registry — PhotoStage registers the lines under the gateway's
 *               own ids). The board opens only if the answer builds something the page does not
 *               show (the conductor's own rule). Scroll holds during a stroke and releases;
 *   placing     LAW 4: the doubt joins the climb on the device (climb.ts) as the gateway files it
 *               in the syllabus on its side, and is listed on the memory page with a remove that
 *               reaches the server (doubt-store.ts).
 *
 * Taps from "I have a doubt" to the first line of explanation, on a phone: the camera button (1),
 * then Explain (2). The OS camera's own shutter and "Use photo" sit between them and are not ours.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useWorld } from '../../curriculum/hooks';
import { loadedTopics } from '../../curriculum/registry';
import { AppFrame } from '../../shell/AppFrame';
import { useRouter } from '../../shell/router';
import { GATEWAY_URL } from '../../store/app-sdk';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { Button, Chip, Tag, TopBar } from '../../ui/primitives';
import { screenStore } from '../../wobo/board-turn';
import { useWoboChat } from '../../wobo/chat';
import { type Rotation, readingLine, strokeHold } from '../../wobo/doubt-surface';
import {
  type Capture,
  DoubtUnreadable,
  gatewayPost,
  MAX_LINE_CHARS,
  readDoubt,
  readingText,
} from './api';
import { doubtCaption } from './caption';
import { acceptsFile, CaptureRefused, captureFromFile } from './capture';
import { joinClimb, suggestTopics, topicForDoubt } from './climb';
import { CameraIcon, DOUBT_ENTRY_LABEL, DOUBT_SIGN_IN_LINE } from './DoubtEntry';
import { saveDoubt, takeCapture } from './doubt-store';
import {
  doorFor,
  doubtPacket,
  explainAllowed,
  explainPrompt,
  initialFlow,
  liveLines,
  liveRegions,
  reduce,
} from './flow';
import { PhotoStage } from './PhotoStage';
import './doubt.css';

export const DOUBT_TITLE = 'Take a photo of the doubt';
/** What a keyless build says instead of pretending to read. */
export const OFFLINE_LINE =
  'I need to be connected to read a photo. Type the question in the chat and I am still here.';
/** How long a stroke is held for when the pen did not say. */
const DEFAULT_STROKE_MS = 900;

interface Placed {
  topicId: string;
  topicName: string;
}

export function DoubtScreen() {
  const router = useRouter();
  const sdk = useSdk();
  const world = useWorld();
  const progress = useProgress();
  const { ask, turns, busy } = useWoboChat();
  const [state, dispatch] = useReducer(reduce, initialFlow);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [asking, setAsking] = useState(false);
  const [held, setHeld] = useState(false);
  const [over, setOver] = useState(false);
  /** The printed caption, revealed on the beat (caption.ts), never the whole paragraph at once. */
  const [caption, setCaption] = useState('');
  /** Where Wobo's words for THIS doubt begin in the one conversation. */
  const [saidFrom, setSaidFrom] = useState<number | null>(null);
  const itemId = useRef<string>(crypto.randomUUID());
  const lineInputs = useRef(new Map<string, HTMLInputElement>());
  const frameworkId = world?.frameworkId ?? null;

  // --- reading -----------------------------------------------------------------------------------
  const begin = useCallback(
    async (capture: Capture) => {
      itemId.current = crypto.randomUUID();
      setRotation(0);
      setPlaced(null);
      setSaidFrom(null);
      dispatch({ type: 'captured', capture });
      if (!GATEWAY_URL) {
        dispatch({ type: 'unreadable', say: OFFLINE_LINE });
        return;
      }
      try {
        const result = await readDoubt(gatewayPost(GATEWAY_URL), capture, { frameworkId });
        dispatch({ type: 'read', result });
      } catch (err) {
        dispatch({
          type: 'unreadable',
          say:
            err instanceof DoubtUnreadable
              ? err.message
              : err instanceof Error && err.message
                ? err.message
                : 'I could not reach my reading just now. Try again in a moment?',
        });
      }
    },
    [frameworkId],
  );

  // The entry control took the photo before this screen existed: collect it, once.
  useEffect(() => {
    const capture = takeCapture();
    if (capture) void begin(capture);
  }, [begin]);

  const onFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      await begin(await captureFromFile(file));
    } catch (err) {
      dispatch({
        type: 'unreadable',
        say:
          err instanceof CaptureRefused ? err.message : 'I could not open that photo. Try another?',
      });
    }
  };

  // --- explaining --------------------------------------------------------------------------------
  const explain = async () => {
    const packet = doubtPacket(state);
    if (!packet || asking) return;
    dispatch({ type: 'explain' });
    setAsking(true);
    setSaidFrom(turns.length);
    try {
      await ask(explainPrompt(state), { doubt: packet });
    } finally {
      setAsking(false);
      dispatch({ type: 'explained' });
    }
  };

  // The caption follows the beat: a sentence is printed when it is spoken, so with the sound off
  // the words and the strokes still arrive together (law 5).
  useEffect(() => {
    if (state.phase !== 'explaining') {
      setCaption('');
      return;
    }
    let timer: number | null = null;
    const show = () => {
      setCaption(doubtCaption.visible());
      if (timer !== null) window.clearTimeout(timer);
      timer = doubtCaption.pending() ? window.setTimeout(show, 100) : null;
    };
    show();
    const off = doubtCaption.subscribe(show);
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [state.phase]);

  // The page holds still under the pen: a stroke landing on the photo locks scroll until it ends.
  useEffect(() => {
    if (state.phase !== 'explaining') return;
    const root = document.documentElement;
    const before = root.style.overflow;
    const hold = strokeHold({
      lock: () => {
        root.style.overflow = 'hidden';
        setHeld(true);
      },
      unlock: () => {
        root.style.overflow = before;
        setHeld(false);
      },
      now: () => performance.now(),
      after: (ms, fn) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
    let seen = screenStore.snapshot().length;
    const off = screenStore.subscribe(() => {
      const live = screenStore.snapshot();
      if (live.length <= seen) {
        seen = live.length;
        return;
      }
      for (const entry of live.slice(seen)) hold.onStroke(entry.durMs ?? DEFAULT_STROKE_MS);
      seen = live.length;
    });
    return () => {
      off();
      hold.dispose();
    };
  }, [state.phase]);

  // --- placing -----------------------------------------------------------------------------------
  const keep = useCallback(
    (topic: { id: string; name: string } | null) => {
      if (!state.result || !state.capture) return;
      const { result } = state;
      if (topic) {
        joinClimb(itemId.current, topic.id, {
          nowMs: Date.now(),
          record: (type, payload, context) => sdk.events.record(type, payload as never, context),
          reportProgress: progress.reportProgress,
          progressNow: progress.topicProgress[topic.id],
        });
        setPlaced({ topicId: topic.id, topicName: topic.name });
      }
      const lines = liveLines(state);
      saveDoubt({
        id: result.id,
        createdAt: result.createdAt || new Date().toISOString(),
        reading: readingText(lines, result.reading.question),
        lines,
        width: result.reading.width || state.capture.width,
        height: result.reading.height || state.capture.height,
        explained: true,
        ...(topic ? { topicId: topic.id, topicName: topic.name } : {}),
      });
    },
    [sdk, progress.reportProgress, progress.topicProgress, state],
  );

  // The moment the explanation ends: place it where it belongs, or ask where that is.
  const placedOnce = useRef(false);
  useEffect(() => {
    if (state.phase !== 'placing' || placedOnce.current) return;
    placedOnce.current = true;
    const topic = topicForDoubt(readingText(liveLines(state)), {
      nodeId: state.result?.climb.nodeId,
      name: state.result?.climb.nodeName ?? state.result?.reading.topic,
    });
    keep(topic ? { id: topic.id, name: topic.name } : null);
  }, [state, keep]);
  useEffect(() => {
    if (state.phase === 'capture') placedOnce.current = false;
  }, [state.phase]);

  const said =
    saidFrom === null
      ? ''
      : turns
          .slice(saidFrom)
          .filter((t) => t.role === 'wobo')
          .map((t) => t.text)
          .join(' ')
          .trim();
  const canExplain = explainAllowed(state) && !busy && !asking;
  const reading = readingText(liveLines(state), state.result?.reading.question);
  const regions = liveRegions(state);
  const door = doorFor(sdk.account);
  // The topics this doubt could belong to, best first (climb.ts), never the first eight in load
  // order: a learner with two hundred topics whose match failed used to see eight unrelated chips.
  const choices =
    state.phase === 'placing' && !placed
      ? suggestTopics(reading, state.result?.reading.topic, loadedTopics(), progress.topicProgress)
      : [];

  return (
    <AppFrame active="learn" about={{ surface: 'doubt' }}>
      <TopBar crumb="A doubt" />
      <div className="db-wrap">
        {state.phase === 'capture' && door === 'sign-in' ? (
          <section className="db-drop" aria-label={DOUBT_TITLE} data-door="sign-in">
            <CameraIcon />
            <h2>{DOUBT_TITLE}</h2>
            <p>
              {DOUBT_SIGN_IN_LINE} A photo of your page is kept with your account and only there.
            </p>
            <div className="db-row">
              <Button tone="pig" onClick={() => router.navigate({ name: 'sign-in' })}>
                Sign in
              </Button>
            </div>
          </section>
        ) : null}

        {state.phase === 'capture' && door === 'camera' ? (
          <section
            className={over ? 'db-drop db-over' : 'db-drop'}
            aria-label={DOUBT_TITLE}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const file = e.dataTransfer.files?.[0];
              const refusal = file ? acceptsFile(file) : null;
              if (refusal) dispatch({ type: 'unreadable', say: refusal });
              else void onFile(file);
            }}
          >
            <CameraIcon />
            <h2>{DOUBT_TITLE}</h2>
            <p>
              Point at the page, the sum, the diagram, whatever it is. I say what I read, you fix
              anything I got wrong, then I explain it on the photo.
            </p>
            <div className="db-row">
              <label className="wk-btn wk-pig db-take">
                Take a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={DOUBT_ENTRY_LABEL}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    void onFile(file);
                  }}
                />
              </label>
              <label className="wk-btn wk-quiet db-take">
                Choose a file
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Choose a photo of the page from your files"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    void onFile(file);
                  }}
                />
              </label>
            </div>
            <p className="db-note">On a laptop you can also drop the photo here.</p>
            {state.error ? (
              <p className="db-error" role="alert">
                {state.error}
              </p>
            ) : null}
          </section>
        ) : null}

        {state.phase !== 'capture' && state.capture ? (
          <div className="db-grid">
            <PhotoStage
              photoId={state.result?.id ?? 'photo'}
              capture={state.capture}
              regions={regions}
              reading={reading}
              rotation={rotation}
              onRotate={setRotation}
              lit={state.lit}
              onLight={(id) => {
                dispatch({ type: 'light', regionId: id });
                if (id && state.phase === 'confirm') lineInputs.current.get(id)?.focus();
              }}
              held={held}
              {...(state.phase === 'confirm' || state.phase === 'placing'
                ? { onRetake: () => dispatch({ type: 'retake' }) }
                : {})}
            />

            <section className="db-read" aria-label="What Wobo read">
              {state.phase === 'reading' ? (
                <>
                  <Tag>Reading</Tag>
                  <p className="db-busy" role="status">
                    Reading the page, one moment.
                  </p>
                </>
              ) : null}

              {state.phase === 'confirm' ? (
                <>
                  <Tag>Check what I read</Tag>
                  <p className="db-line" data-testid="doubt-reading-line">
                    {readingLine(reading)}
                  </p>
                  <p className="db-note">Fix anything I misread, line by line, then I explain.</p>
                  <ol className="db-lines">
                    {state.lines.map((line, i) => (
                      <li
                        key={line.id}
                        className={state.lit === line.id ? 'db-lit-row' : undefined}
                      >
                        <input
                          ref={(el) => {
                            if (el) lineInputs.current.set(line.id, el);
                            else lineInputs.current.delete(line.id);
                          }}
                          className="db-text"
                          type="text"
                          maxLength={MAX_LINE_CHARS}
                          value={line.text}
                          aria-label={`Line ${i + 1} as I read it. Edit it if I got something wrong.`}
                          onFocus={() =>
                            dispatch({ type: 'light', regionId: line.box ? line.id : null })
                          }
                          onChange={(e) =>
                            dispatch({ type: 'editLine', id: line.id, text: e.target.value })
                          }
                        />
                      </li>
                    ))}
                  </ol>
                  {regions.length > 0 ? (
                    <div className="db-parts">
                      {regions.map((r) => (
                        <Chip
                          key={r.id}
                          on={state.lit === r.id}
                          onClick={() =>
                            dispatch({ type: 'light', regionId: state.lit === r.id ? null : r.id })
                          }
                        >
                          {r.label}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                  <label className="db-words">
                    <span className="db-note">
                      Anything to tell me? Which step, or what is confusing. Optional.
                    </span>
                    <textarea
                      className="db-text"
                      rows={2}
                      maxLength={500}
                      value={state.words}
                      placeholder="I do not get how the 5 moves across"
                      aria-label="Your own words about this doubt, if you want to add any"
                      onChange={(e) => dispatch({ type: 'words', text: e.target.value })}
                    />
                  </label>
                  <div className="db-row">
                    <Button tone="pig" onClick={() => void explain()} disabled={!canExplain}>
                      Explain
                    </Button>
                  </div>
                </>
              ) : null}

              {state.phase === 'explaining' || state.phase === 'placing' ? (
                <>
                  <Tag>{state.phase === 'explaining' ? 'Explaining' : 'Explained'}</Tag>
                  <p className="db-line">{reading}</p>
                  <p className="db-said" aria-live="polite" data-testid="doubt-said">
                    {state.phase === 'explaining' ? caption || 'One moment.' : said}
                  </p>
                </>
              ) : null}

              {state.phase === 'placing' ? (
                <div className="db-place">
                  {placed ? (
                    <p>
                      Filed under <b>{placed.topicName}</b>. It is on your map now, and it will come
                      round again in practice so it sticks.
                    </p>
                  ) : choices.length > 0 ? (
                    <>
                      <p>Where does this belong? Pick a topic and it joins your map.</p>
                      <div className="db-parts">
                        {choices.map((t) => (
                          <Chip key={t.id} onClick={() => keep({ id: t.id, name: t.name })}>
                            {t.name}
                          </Chip>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>Kept with your doubts. Choose a board in You and it can join your map.</p>
                  )}
                  <div className="db-row">
                    <Button tone="pig" onClick={() => dispatch({ type: 'retake' })}>
                      Another doubt
                    </Button>
                    <Button tone="quiet" onClick={() => router.navigate({ name: 'you' })}>
                      See my doubts
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </AppFrame>
  );
}
