'use client';

/**
 * THE PROGRESS SURFACES, WIRED — the twin as hero, the report scrolled below it (DESIGN.md §8).
 *
 * This is the only file in the folder that talks to a store. Everything under it is pure and takes
 * what it draws as props, which is what lets the arithmetic be unit-tested against fixed inputs and
 * the two surfaces be rendered anywhere: inside You, at their own address, or on a bench.
 *
 * It reads, and never writes: the learner's own world from the registry, where each topic stands
 * from the learn flow's mastery law, the day ledger from the mind, the week from the one function
 * the whole app computes it with (`screens/you/ledger.ts`), and the milestones from the same
 * ladders the trophy room and the ceremony use. Two screens counting the same week two different
 * ways is a bug this repo has already fixed once; nothing here counts anything twice.
 */

import { useRegisterTarget } from '@wobo/wobo';
import { useEffect, useMemo, useState } from 'react';
import { useRegistryRevision } from '../../curriculum/hooks';
import { chaptersBySubject, loadedTopics, subjects } from '../../curriculum/registry';
import { useRouter } from '../../shell/router';
import { useMastery } from '../../store/mastery';
import { loadMind } from '../../store/mind';
import { useProgress } from '../../store/progress';
import { useSdk } from '../../store/sdk';
import { earnedTrophyKeys, topTrophyKey, trophyAwardFor } from '../../ui/trophies';
import { chooseNextTopic } from '../learn/mastery';
import { activityCounts, weeklyNote } from '../you/ledger';
import { markToday } from '../you/profile';
import { type Span, strengths } from '../you/week';
import { reportBadges } from './badges';
import { Constellation } from './Constellation';
import {
  chapterRows,
  comingUp,
  heldLater,
  minuteBars,
  needsAnotherPass,
  projectFinish,
  standings,
  syllabusReach,
  tally,
} from './evidence';
import { Report } from './Report';
import { buildSky, newlyLit, readSeen, writeSeen } from './sky';
import './progress.css';

/** Every day the device holds a trace of — the denominator the pace is read from. */
function activeDays(marks: readonly string[], days: Record<string, { seconds: number }>): string[] {
  const out = new Set<string>(marks);
  for (const [day, ledger] of Object.entries(days)) {
    if ((ledger?.seconds ?? 0) > 0) out.add(day);
  }
  for (const [day, n] of Object.entries(activityCounts())) {
    if (n > 0) out.add(day);
  }
  return [...out].sort();
}

export function ProgressSurfaces() {
  const router = useRouter();
  const sdk = useSdk();
  const { completed, topicProgress, xp, streakDays } = useProgress();
  const { bandOf, bands, nextNodeId } = useMastery();
  const revision = useRegistryRevision();
  const [span, setSpan] = useState<Span>('week');
  const [marks] = useState(() => markToday());
  // One reading of the clock for the whole screen. A fresh `Date.now()` on every render would make
  // every memo below a lie and restart the counting numbers each time anything else moved.
  const [now] = useState(() => Date.now());

  const view = useMemo(() => ({ completed, bandOf }), [completed, bandOf]);

  // The learner's own world. `revision` is the trigger, not an input: the registry is filled as a
  // learner opens a level, a subject, a chapter, so the map grows with them rather than ahead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents, which are filled in place
  const syllabus = useMemo(
    () => ({ subjects, chaptersOf: (id: string) => chaptersBySubject[id] ?? [] }),
    [revision],
  );
  const topics = useMemo(
    () => standings(syllabus, view, topicProgress),
    [syllabus, view, topicProgress],
  );
  // How much of the board those topics are. The registry holds a chapter's topics only once it has
  // been opened, so on a twelve-chapter syllabus with one chapter open the tally is a handful — and
  // every sentence drawn from it has to say so rather than reading as a whole syllabus.
  const reach = useMemo(() => syllabusReach(syllabus), [syllabus]);
  const sky = useMemo(() => buildSky(topics), [topics]);
  const counted = useMemo(() => tally(topics), [topics]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bands` is the trigger — a band that moved can move the answer
  const current = useMemo(
    () => chooseNextTopic(loadedTopics(), { ...view, platformNodeId: nextNodeId }),
    [view, nextNodeId, bands, revision],
  );

  // A concept earned since this session last looked catches light once, and then is remembered.
  const learntIds = useMemo(
    () => new Set(topics.filter((t) => t.state === 'learnt').map((t) => t.id)),
    [topics],
  );
  const [firstLook] = useState(() => readSeen());
  const lit = useMemo(() => new Set(newlyLit(learntIds, firstLook)), [learntIds, firstLook]);
  useEffect(() => {
    writeSeen(learntIds);
  }, [learntIds]);

  // The week, from the one function the home and the You screen also call.
  const summary = useMemo(
    () => weeklyNote({ span, marks, topicProgress, completed, now: new Date(now) }),
    [span, marks, topicProgress, completed, now],
  );
  const mind = useMemo(() => loadMind(), []);
  const bars = useMemo(() => minuteBars(mind.days ?? {}, span, new Date(now)), [mind, span, now]);
  const retention = useMemo(() => heldLater(sdk.mastery.loadCache(), now), [sdk, now]);
  const projection = useMemo(
    () =>
      projectFinish(counted.learnt, counted.total, activeDays(marks, mind.days ?? {}), now, reach),
    [counted, marks, mind, now, reach],
  );

  const chapters = useMemo(() => chapterRows(topics), [topics]);

  // Every badge is derived (`badges.ts`), never handed in: the one place this used to be written
  // inline was also the one place nothing could execute it.
  const badges = useMemo(() => {
    const earned = earnedTrophyKeys(xp, streakDays);
    const key = earned.length > 0 ? topTrophyKey(earned) : null;
    return reportBadges({
      strengths: strengths(summary),
      chapters,
      trophy: key ? { key, title: trophyAwardFor(key).title } : null,
    });
  }, [summary, chapters, xp, streakDays]);

  const mapRef = useRegisterTarget<HTMLDivElement>('progress-map', {
    kind: 'chart',
    label:
      'the knowledge map — every concept as a star, subjects fanning out from the centre, chapters ringing outward, prerequisites drawn between them',
    getSceneState: () => ({
      concepts: counted.total,
      learnt: counted.learnt,
      needsAnotherPass: counted.debt,
      current: current?.name ?? null,
    }),
  });
  const reportRef = useRegisterTarget<HTMLDivElement>('progress-report', {
    kind: 'chart',
    label:
      'the report a parent reads — minutes a day, topics learnt, how many answers came back right a week or more after the first on their concept, and where this pace lands',
    getSceneState: () => ({
      span,
      minutes: bars.reduce((sum, bar) => sum + (bar.future ? 0 : bar.minutes), 0),
      learnt: counted.learnt,
      total: counted.total,
      heldPercent: retention.recent?.percent ?? null,
      projection: projection.kind,
    }),
  });

  return (
    <div className="wp-wrap">
      <section ref={mapRef}>
        <header className="wp-head">
          <h2>Your map</h2>
        </header>
        <p className="wp-lede">
          Every concept you have opened, and what each one stands on. Subjects fan out from the
          centre, chapters ring outward, and a curve joins a concept to the one underneath it.
        </p>
        <Constellation
          topics={topics}
          sky={sky}
          currentId={current?.id ?? null}
          ignited={lit}
          onOpen={(topicId) => router.navigate({ name: 'course', topicId })}
        />
      </section>

      <section ref={reportRef}>
        <header className="wp-head">
          <h2>The report</h2>
        </header>
        <p className="wp-lede">
          The same picture a parent is shown: minutes that actually happened, chapters genuinely
          done, how many answers came back right a week or more after they were first met, and where
          this pace lands. Every number is drawn from what this device recorded, and anything it
          cannot source it does not draw.
          {projection.wholeSyllabus
            ? ''
            : ' The counts cover the chapters opened so far, which is all this device has been sent.'}
        </p>
        <Report
          span={span}
          onSpan={setSpan}
          summary={summary}
          bars={bars}
          tally={counted}
          chapters={chapters}
          debts={needsAnotherPass(topics)}
          coming={comingUp(topics)}
          retention={retention}
          projection={projection}
          badges={badges}
          now={now}
        />
      </section>
    </div>
  );
}
