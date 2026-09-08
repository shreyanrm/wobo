'use client';

/**
 * The home — board 01 of design/prototypes/app-v1.html, on the kit.
 *
 * The crumb (weekday · class · board), the streak and the learner's initial; the greeting in
 * Wobo's hand and the one question; a situational line built from the day's real plan; the ask
 * box, which is the front door to the one conversation; the three today cards (continue, practice,
 * and either what Wobo noticed or the door to asking — the row never has a hole in it); this week
 * in Wobo's words, the one note the You screen also reads; and the streak, with the line that says
 * rest days are fine. Every number on the page is the learner's own — the plan comes from the
 * registry and the progress store, the note from the activity marks, the observation from the mind.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { useEffect, useMemo, useState } from 'react';
import { useRegistryRevision, useWorld } from '../curriculum/hooks';
import { loadedTopics } from '../curriculum/registry';
import { warmFromCache } from '../curriculum/warm';
import { AppFrame } from '../shell/AppFrame';
import { useRouter } from '../shell/router';
import { loadMind } from '../store/mind';
import { useProgress } from '../store/progress';
import {
  AskBox,
  Avatar,
  Button,
  Card,
  CardFoot,
  Chip,
  HandNote,
  Pill,
  StreakDays,
  Tag,
  TopBar,
  usePhone,
  WoboHead,
} from '../ui/primitives';
import { useWoboChat } from '../wobo/chat';
import { useWoboVoice } from '../wobo/voice';
import {
  ASK_PLACEHOLDER,
  asHeading,
  calendarWeek,
  continueLine,
  finishedChapter,
  HOME_QUESTION,
  noticed as noticedBy,
  practiceLine,
  todayLine,
  todayPlan,
} from './home/today';
import { SET_TITLE } from './practice/set';
import { weeklyNote } from './you/ledger';
import { boardName, frameworkLabel, loadProfile, markToday } from './you/profile';
import { weekSentence } from './you/week';
import './home/Home.css';

export function Home() {
  const router = useRouter();
  const { publishPage } = useWoboBus();
  const { ask, busy, mood, setMood } = useWoboChat();
  const progress = useProgress();
  const world = useWorld();
  const revision = useRegistryRevision();
  const phone = usePhone();
  const profile = loadProfile();

  // What this device already knows of the pinned syllabus, before any subject screen has opened.
  const worldKey = world
    ? `${world.frameworkId}:${world.versionId ?? ''}:${world.level ?? ''}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the world key is the trigger; the cache read is idempotent
  useEffect(() => {
    warmFromCache();
  }, [worldKey]);

  // The day, from real state. Re-derived whenever the registry ingests or progress moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const plan = useMemo(() => todayPlan(progress), [progress, revision]);
  const line = todayLine(plan);

  // Showing up is marked once per visit; the week and the note both read the marks.
  const [marks] = useState(() => markToday());
  const week = useMemo(() => calendarWeek(marks), [marks]);
  // "This week, in Wobo's words" — THE weekly note (you/ledger.ts), the same one the You screen
  // reads. There is no second sentence generator; both screens ask this one function.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const summary = useMemo(
    () =>
      weeklyNote({
        span: 'week',
        marks,
        topicProgress: progress.topicProgress,
        completed: progress.completed,
      }),
    [marks, progress.topicProgress, progress.completed, revision],
  );
  const sentence = weekSentence(summary);

  // What Wobo noticed — a real observation of this learner's own records, or nothing at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const seen = useMemo(
    () =>
      noticedBy({
        mind: loadMind(),
        marks,
        streakDays: progress.streakDays,
        chapter: finishedChapter(progress.completed),
      }),
    [marks, progress.streakDays, progress.completed, revision],
  );

  // The crumb: "Tuesday · Class 8 · CBSE" — the weekday, then the class and board they chose.
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  const crumb = [
    weekday,
    world?.level ?? profile.grade,
    // The board's NAME. A world pinned from an id alone carries that id as its name; the crumb is
    // read by a learner, so it prints "CBSE", never "cbse".
    frameworkLabel(world?.frameworkName ?? boardName(profile.boardId)),
  ]
    .filter(Boolean)
    .join(' · ');
  const initial = profile.name.trim().charAt(0).toUpperCase();

  // The composer — the same door as before: one line into the one conversation, on the chat page.
  const [draft, setDraft] = useState('');
  const submit = (text: string) => {
    if (busy) return;
    setDraft('');
    router.navigate({ name: 'chat' });
    void ask(text);
  };
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const voice = useWoboVoice({ setMood });
  const voiceOn =
    voice.status === 'listening' || voice.status === 'speaking' || voice.status === 'connecting';
  const toggleVoice = () => {
    if (voiceOn) {
      voice.stop();
      return;
    }
    void voice.start().then((state) => {
      // 'idle' back from start() means the microphone was refused — say so rather than fail silently.
      const said =
        state === 'unavailable'
          ? 'My voice is asleep right now — the words still arrive'
          : state === 'idle'
            ? 'Allow microphone access to talk with Wobo'
            : null;
      if (said) {
        setVoiceNote(said);
        window.setTimeout(() => setVoiceNote(null), 3000);
      }
    });
  };

  // Wobo reads the home at code level: the box, and the three cards of the day (DESIGN.md §12).
  const composerRef = useRegisterTarget<HTMLDivElement>('home-composer', {
    kind: 'composer',
    label: 'the box where you talk to Wobo',
    getSceneState: () => ({ draft }),
  });
  const todayRef = useRegisterTarget<HTMLDivElement>('home-today', {
    kind: 'plan',
    label: "today's cards — continue, practice, and what Wobo noticed",
    getSceneState: () => ({
      continue: plan.continue?.topic.name,
      next: plan.next?.topic.name,
      noticed: seen?.title,
    }),
  });

  useEffect(() => {
    publishPage({
      route: 'home',
      state: {
        title: 'today',
        intent: 'figure out today',
        line,
        continue: plan.continue?.topic.name,
        next: plan.next?.topic.name,
      },
    });
  }, [publishPage, line, plan]);

  // The practice door is always drawn (a row with a hole in it is "emptiness that is just
  // absence", DESIGN.md §2): the topic in flight, else the first the world knows; with no topic
  // loaded yet, the door opens the practice set itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const practiceTopic = useMemo(
    () => plan.continue?.topic ?? plan.next?.topic ?? loadedTopics()[0] ?? null,
    [plan, revision],
  );

  return (
    <AppFrame active="home">
      <TopBar
        crumb={crumb}
        right={
          <>
            <Chip>Streak · {progress.streakDays}</Chip>
            <Avatar aria-hidden={initial ? undefined : true}>{initial}</Avatar>
          </>
        }
      />

      <div className="hm-greet">
        <div>
          <h1>
            <span className="hand">Hey{profile.name.trim() ? ` ${profile.name.trim()}` : ''},</span>
            {HOME_QUESTION}
          </h1>
          <p>{line}</p>
          <div ref={composerRef}>
            <AskBox
              placeholder={ASK_PLACEHOLDER}
              value={draft}
              onChange={setDraft}
              onAsk={submit}
              onMic={toggleVoice}
              micLabel={voiceOn ? 'Stop voice' : 'Talk by voice'}
              label="Ask Wobo"
            />
          </div>
          {voiceNote && <p>{voiceNote}</p>}
        </div>
        <div className="hm-head">
          <WoboHead
            size={phone ? 120 : 180}
            shadow
            mood={busy ? 'thinking' : mood}
            gaze="pointer"
            label="Wobo"
          />
        </div>
      </div>

      {/*
        LAW v5 (DESIGN.md §0, and design/prototypes/landing-v8.html, where every panel is paper-2):
        the three today cards are TONAL SURFACES, never washes. Board 01 of app-v1.html drew them
        pig / mint / marigold, which on cream read as three sheets of paper and on white reads as a
        rainbow. A wash now tints only a pill, a tick or a selected row. The one pointer on this
        view is the pig button inside the first card — the next best action, and nothing else.
      */}
      <div className="hm-today" ref={todayRef}>
        {plan.continue ? (
          <Card>
            <Tag>Continue</Tag>
            <h3>{plan.continue.topic.name}</h3>
            <p>{continueLine(plan.continue)}</p>
            <CardFoot>
              <Button
                size="sm"
                tone="pig"
                onClick={() =>
                  plan.continue &&
                  router.navigate({ name: 'course', topicId: plan.continue.topic.id })
                }
              >
                Continue
              </Button>
              {/* TODO(data): the prototype's pill is a duration ("6 min"); until a course reports
                  one, the pill carries how far the learner has walked. */}
              <Pill>{Math.round(plan.continue.progress * 100)}%</Pill>
            </CardFoot>
          </Card>
        ) : plan.next ? (
          <Card>
            <Tag>Continue</Tag>
            <h3>{plan.next.topic.name}</h3>
            <p>{continueLine(plan.next)}</p>
            <CardFoot>
              <Button
                size="sm"
                tone="pig"
                onClick={() =>
                  plan.next && router.navigate({ name: 'course', topicId: plan.next.topic.id })
                }
              >
                Continue
              </Button>
            </CardFoot>
          </Card>
        ) : plan.finished ? (
          // Everything opened is done: the same card as "opened nothing" would contradict the
          // "Wobo noticed / You finished ..." card beside it. The next chapter is opened from Learn.
          <Card>
            <Tag>Continue</Tag>
            <h3>Everything you have opened is done</h3>
            <p>Open the next chapter and it lands here.</p>
            <CardFoot>
              <Button size="sm" tone="pig" onClick={() => router.navigate({ name: 'learn' })}>
                Open the next chapter
              </Button>
            </CardFoot>
          </Card>
        ) : plan.world ? (
          <Card>
            <Tag>Continue</Tag>
            <h3>Open your subjects</h3>
            <p>Your chapters come from your board when you open one.</p>
            <CardFoot>
              <Button size="sm" tone="pig" onClick={() => router.navigate({ name: 'learn' })}>
                Learn
              </Button>
            </CardFoot>
          </Card>
        ) : (
          <Card>
            <Tag>Continue</Tag>
            <h3>Tell me your board</h3>
            <p>Then your own syllabus lands here.</p>
            <CardFoot>
              <Button size="sm" tone="pig" onClick={() => router.navigate({ name: 'you' })}>
                Choose your board
              </Button>
            </CardFoot>
          </Card>
        )}

        <Card>
          <Tag>Practice</Tag>
          <h3>{practiceTopic?.name ?? SET_TITLE}</h3>
          <p>{practiceLine(practiceTopic)}</p>
          <CardFoot>
            <Button
              size="sm"
              tone="quiet"
              onClick={() =>
                router.navigate(
                  practiceTopic
                    ? { name: 'sandbox', topicId: practiceTopic.id }
                    : { name: 'practice' },
                )
              }
            >
              Start
            </Button>
            {/* TODO(data): the prototype's pill is a duration ("8 min"); no practice set reports one yet. */}
          </CardFoot>
        </Card>

        {/* The third card is what Wobo actually saw, or the door to asking — never blank paper
            (DESIGN.md §2: emptiness that is just absence). */}
        {seen ? (
          <Card>
            <Tag>Wobo noticed</Tag>
            <h3>{seen.title}</h3>
            <p>{seen.body}</p>
            <CardFoot>
              <WoboHead size={40} />
              {seen.when && <Pill>{seen.when}</Pill>}
            </CardFoot>
          </Card>
        ) : (
          <Card>
            <Tag>Ask Wobo</Tag>
            <h3>{asHeading(HOME_QUESTION)}</h3>
            <p>{ASK_PLACEHOLDER}</p>
            <CardFoot>
              <Button size="sm" tone="quiet" onClick={() => router.navigate({ name: 'chat' })}>
                Ask
              </Button>
              <WoboHead size={40} />
            </CardFoot>
          </Card>
        )}
      </div>

      <div className="hm-split">
        <div className="hm-week">
          <Tag>{summary.tag}</Tag>
          <HandNote>
            {sentence.map((seg, i) =>
              seg.em ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the segments are a fixed sentence
                <em key={i}>{seg.text}</em>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: the segments are a fixed sentence
                <span key={i}>{seg.text}</span>
              ),
            )}
          </HandNote>
        </div>
        <StreakDays
          count={progress.streakDays}
          title="days in a row"
          days={week}
          note="Rest days don't break it. Learning does not need guilt."
        />
      </div>
    </AppFrame>
  );
}
