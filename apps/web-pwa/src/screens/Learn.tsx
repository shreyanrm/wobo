'use client';

/**
 * Learn — board 02 of design/prototypes/app-v1.html, on the kit.
 *
 * The crumb (Learn · class · board) with the syllabus's provenance and the learner's initial; the
 * "Your subjects" marker and the headline naming the subject in front of them; the subject tiles,
 * the one in view outlined; the chapter rows in their states (done, now, next, come-back-to,
 * later) with the mint bar on the chapter under way; and Wobo's line about a school that does
 * things differently. Subjects and chapters are the board's own, from the registry; a row's state
 * is completion AND the mastery band together (screens/learn/mastery.ts); nothing is seeded.
 */

import { DISCOVERY_COPY, labelFor } from '@wobo/sdk';
import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chooseLevel } from '../curriculum/adopt';
import { useRegistryRevision, useUnits, useWorld } from '../curriculum/hooks';
import { chaptersBySubject, displaySubjects } from '../curriculum/registry';
import { DiscoveryCard, sharedConceptRoute } from '../curriculum/StatusCard';
import { warmFromCache } from '../curriculum/warm';
import type { Subject } from '../data/model';
import { AppFrame } from '../shell/AppFrame';
import { type Route, routeToPath, useRouter } from '../shell/router';
import { useMastery } from '../store/mastery';
import { useProgress } from '../store/progress';
import { Avatar, Button, Card, CardFoot, Label, Tile, TopBar, WoboHead } from '../ui/primitives';
import { defaultSubject, tileLine, unitLine, unitRows, unitState } from './learn/units';
import { boardName, frameworkLabel, loadProfile } from './you/profile';
import './learn/Learn.css';

export function Learn() {
  const router = useRouter();
  const { publishPage } = useWoboBus();
  const world = useWorld();
  const revision = useRegistryRevision();
  const { completed, topicProgress } = useProgress();
  // Bands and completion together decide every row: a chapter finished badly is not "Mastered",
  // and "Next" never points past a topic still owed (screens/learn/mastery.ts).
  const { bandOf, nextNodeId } = useMastery();
  const profile = loadProfile();

  // What this device already knows of the pinned syllabus, before any chapter is asked for.
  const worldKey = world
    ? `${world.frameworkId}:${world.versionId ?? ''}:${world.level ?? ''}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the world key is the trigger; the cache read is idempotent
  useEffect(() => {
    warmFromCache();
  }, [worldKey]);

  // A world with a class but no subjects yet: ask once, here, when the learner arrives.
  useEffect(() => {
    if (world?.level && world.subjects.length === 0) void chooseLevel(world.level);
  }, [world?.level, world?.subjects.length]);

  // The board's own subjects for the learner's own class, in its own naming and order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` and the world stand in for the registry's contents
  const subjects = useMemo(() => displaySubjects(), [world, revision]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const rowsOf = useCallback(
    (s: Subject) =>
      unitRows(chaptersBySubject[s.id] ?? [], {
        completed,
        topicProgress,
        bandOf,
        platformNodeId: nextNodeId,
      }),
    [completed, topicProgress, bandOf, nextNodeId, revision],
  );

  // The subject in view: the one tapped, else the one with a chapter under way, else the first.
  const [chosen, setChosen] = useState<string | null>(null);
  const active = useMemo(
    () =>
      (chosen ? subjects.find((s) => s.id === chosen) : undefined) ??
      defaultSubject(subjects, rowsOf),
    [chosen, subjects, rowsOf],
  );
  // Its chapters — the pinned version's cache first, the brain behind it (CURRICULUM.md §8).
  const units = useUnits(active?.id ?? null);
  const rows = useMemo(() => (active ? rowsOf(active) : []), [active, rowsOf]);

  const subjectRoute = (s: Subject): Route => ({
    name: 'subject',
    subjectId: s.id,
    intent: 'learn',
  });

  // Wobo reads the map at code level: which tiles are on it, and where each chapter stands.
  const gridRef = useRegisterTarget<HTMLDivElement>('learn-subjects', {
    kind: 'grid',
    label: 'the subject tiles — the outlined one is in view',
    getSceneState: () => ({
      subjects: subjects.map((s) => ({ name: s.name, line: tileLine(s, rowsOf(s)) })),
      inView: active?.name,
    }),
  });
  const unitsRef = useRegisterTarget<HTMLDivElement>('learn-units', {
    kind: 'chapters',
    label: 'the chapters of the subject in view, each with where the learner stands in it',
    getSceneState: () => ({
      subject: active?.name,
      chapters: rows.map((r) => ({
        index: r.chapter.index,
        name: r.chapter.name,
        state: r.state,
        line: unitLine(r),
      })),
    }),
  });

  useEffect(() => {
    publishPage({
      route: 'learn',
      state: {
        title: 'learn',
        intent: 'learn',
        subject: active?.name,
        chapters: rows.map((r) => `${r.chapter.name} · ${r.state}`),
      },
    });
  }, [publishPage, active?.name, rows]);

  // The crumb: "Learn · Class 8 · CBSE" — then the syllabus's provenance, in the brain's words.
  // The world's own `frameworkName` is whatever named the framework, and a restore can only pass
  // on the id it was given, so the board reads through `frameworkLabel` here exactly as it does on
  // Home and You: a crumb never prints "cbse" where a learner reads a board's name.
  const crumb = [
    'Learn',
    world?.level ?? profile.grade,
    frameworkLabel(world?.frameworkName) || boardName(profile.boardId),
  ]
    .filter(Boolean)
    .join(' · ');
  const provenance = world
    ? world.label.trim() ||
      labelFor(world.status, { name: world.frameworkName, version: world.versionYear })
    : '';
  const initial = profile.name.trim().charAt(0).toUpperCase();

  return (
    <AppFrame active="learn">
      <TopBar
        crumb={crumb}
        right={
          <>
            {provenance && (
              <span className="ln-prov">
                {/* the mint mark is the verified tick (DESIGN.md §2) — only a verified syllabus wears it */}
                {world?.status === 'verified' && <i aria-hidden="true" />}
                {provenance}
              </span>
            )}
            <Avatar aria-hidden={initial ? undefined : true}>{initial}</Avatar>
          </>
        }
      />

      <div>
        <Label>Your subjects</Label>
        {active && <h1 className="ln-h1">{active.name}, where your class is this week</h1>}
      </div>

      {!world ? (
        <Card compact>
          <p>{DISCOVERY_COPY.empty}</p>
          <CardFoot>
            <Button size="sm" onClick={() => router.navigate({ name: 'you' })}>
              Choose your board
            </Button>
          </CardFoot>
        </Card>
      ) : subjects.length === 0 ? (
        <Card compact>
          <p>
            {world.level
              ? `I am fetching the subjects ${world.frameworkName} teaches in ${world.level}.`
              : 'Tell me your class and I will bring your subjects.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="ln-subjects" ref={gridRef}>
            {subjects.map((s) => {
              const line = tileLine(s, rowsOf(s));
              return (
                <Tile
                  key={s.id}
                  title={s.name}
                  {...(line ? { meta: line } : {})}
                  on={s.id === active?.id}
                  onClick={() => setChosen(s.id)}
                />
              );
            })}
          </div>

          {units.looking ? (
            <DiscoveryCard
              view={units.view}
              // The designed wait is the learner's eight seconds, counted from when they opened
              // this subject rather than from when this card mounted (BOARD-COLD-START.md §2).
              since={units.since}
              // A row of the plan every board shares opens a lesson on that concept. Without this
              // the plan was a list of names nothing happened to when a child pressed one.
              onStart={(concept) => router.navigate(sharedConceptRoute(concept))}
              onOwnSyllabus={() => active && router.navigate(subjectRoute(active))}
            />
          ) : units.error && rows.length === 0 ? (
            <Card compact>
              <p>{units.error}</p>
            </Card>
          ) : (
            <div className="ln-units" ref={unitsRef}>
              {rows.map((r) => {
                const line = unitLine(r);
                if (r.state === 'now') {
                  return (
                    <div key={r.chapter.id} className="ln-unit ln-now">
                      <div className="ln-n">{r.chapter.index}</div>
                      <div>
                        <b>{r.chapter.name}</b>
                        {line && <span>{line}</span>}
                        <div className="ln-prog" aria-hidden="true">
                          <i style={{ width: `${Math.round(r.progress * 100)}%` }} />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          r.topicId
                            ? router.navigate({ name: 'course', topicId: r.topicId })
                            : active && router.navigate(subjectRoute(active))
                        }
                      >
                        Continue
                      </Button>
                    </div>
                  );
                }
                // Every other row opens the subject's chapter list, where its lessons live.
                const to = active ? subjectRoute(active) : null;
                return (
                  <a
                    key={r.chapter.id}
                    className={r.state === 'done' ? 'ln-unit ln-done' : 'ln-unit'}
                    href={to ? routeToPath(to) : '#'}
                    onClick={(e) => {
                      e.preventDefault();
                      if (to) router.navigate(to);
                    }}
                  >
                    <div className="ln-n">{r.chapter.index}</div>
                    <div>
                      <b>{r.chapter.name}</b>
                      {line && <span>{line}</span>}
                    </div>
                    {unitState(r.state) && <span className="ln-state">{unitState(r.state)}</span>}
                  </a>
                );
              })}
            </div>
          )}

          <div className="ln-wobo">
            <WoboHead size={28} />
            Something your school does differently? Tell me and I'll reorder, add or drop a chapter
            for you.
          </div>
        </>
      )}
    </AppFrame>
  );
}
