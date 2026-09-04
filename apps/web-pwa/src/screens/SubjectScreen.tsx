'use client';

/**
 * A subject — the Learn board (02 of design/prototypes/app-v1.html) scoped to one subject, on the
 * kit. Nothing here is a new surface: it is the board the learner just came from, with one subject
 * in front of them.
 *
 *   the crumb                Learn · Mathematics  /  Practice · Mathematics
 *   the provenance pill      where this syllabus came from, in the brain's own words
 *   the subject tiles        every subject of their class, this one outlined
 *   the two tabs             Learn (the climb and the chapter rows) and Practice (the set list)
 *   the climb                the chapter in front of them as a map, topic by topic, with the two
 *                            things a row cannot show: a topic that slipped back below the mastery
 *                            floor, and the ground still to lay under one (screens/learn/Climb.tsx)
 *   the chapter rows         done · now · next · come back to · later, the mint bar on the one
 *                            under way; a row's state is completion AND the mastery band together.
 *                            They sit under a new "Every chapter" label: once the climb is above
 *                            them the list is the SECOND thing on the tab and an unheaded run of
 *                            rows under a map reads as part of it. That label is a copy change to
 *                            this screen and is named here so it is not mistaken for indentation.
 *   the set list             board 04's "This set", one row per chapter, ticked once mastered
 *   Wobo's line              the door to reordering the list, in conversation
 *
 * Subjects and chapters are the registry's; states are the progress store's truth read against the
 * mastery bands (screens/learn/mastery.ts); nothing is seeded. A tap on a chapter opens its course (learn) or its sandbox (practice) — the download
 * gate lives in the course screen, once, for every path into it.
 */

import { DISCOVERY_COPY, labelFor } from '@wobo/sdk';
import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { useCallback, useEffect, useMemo } from 'react';
import { useRegistryRevision, useTopics, useUnits, useWorld } from '../curriculum/hooks';
import { chaptersBySubject, type DisplaySubject, displaySubjects } from '../curriculum/registry';
import { DiscoveryCard } from '../curriculum/StatusCard';
import { subjectFamily } from '../curriculum/subjects';
import { AppFrame } from '../shell/AppFrame';
import { type Route, routeToPath, useRouter } from '../shell/router';
import { useMastery } from '../store/mastery';
import { useProgress } from '../store/progress';
import {
  Avatar,
  Button,
  Card,
  CardFoot,
  Chip,
  Label,
  Tag,
  Tile,
  TopBar,
  WoboHead,
} from '../ui/primitives';
import { Climb } from './learn/Climb';
import { tileLine, type UnitRow, unitLine, unitRows, unitState } from './learn/units';
import { frameworkLabel, loadProfile } from './you/profile';
import './learn/Learn.css';
import './practice/practice.css';
import './subject/subject.css';

type Intent = 'learn' | 'practice';

/** Wobo's line under the chapters — the board's own, word for word. */
const WOBO_LINE =
  "Something your school does differently? Tell me and I'll reorder, add or drop a chapter for you.";

/**
 * Which subject an address means.
 *
 * The registry keys subjects by what the framework calls them ("Mathematics"), and the address
 * used to carry a slug ("math"). Both are in the wild — bookmarks, the command palette, links
 * shared between learners — so the segment is resolved rather than believed: by the subject's own
 * id, then by its name however it happens to be cased, then by the canonical family behind both.
 * An id that means nothing resolves to nothing, and the screen hands the learner back to Learn
 * rather than printing the URL where a subject's name goes.
 */
export function resolveSubject(
  subjects: readonly DisplaySubject[],
  segment: string,
): DisplaySubject | undefined {
  const raw = segment.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const byId = subjects.find((s) => s.id === raw);
  if (byId) return byId;
  const byName = subjects.find(
    (s) => s.id.toLowerCase() === lower || s.name.trim().toLowerCase() === lower,
  );
  if (byName) return byName;
  const family = subjectFamily(raw);
  if (family === 'general') return undefined;
  return subjects.find((s) => subjectFamily(s.name) === family || subjectFamily(s.id) === family);
}

/** A chapter opens as its course; with practice in hand it opens as a sandbox on the same ground. */
function chapterRoute(row: UnitRow, intent: Intent): Route {
  const topicId = row.topicId ?? row.chapter.id;
  return intent === 'practice' ? { name: 'sandbox', topicId } : { name: 'course', topicId };
}

export function SubjectScreen({ subjectId, intent }: { subjectId: string; intent: Intent }) {
  const router = useRouter();
  const { publishPage } = useWoboBus();
  const world = useWorld();
  const revision = useRegistryRevision();
  const { completed, topicProgress } = useProgress();
  // The same law the learn board reads: a row's state is band AND completion (screens/learn/mastery.ts).
  const { bandOf, nextNodeId } = useMastery();
  const profile = loadProfile();

  // The board's own subjects for the learner's class, in its own naming and order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` and the world stand in for the registry's contents
  const subjects = useMemo(() => displaySubjects(), [world, revision]);

  // The address may be an old slug or another casing. Everything below reads the RESOLVED subject,
  // so the page shows the subject it means from the first frame; the address catches up in the
  // effect underneath. Nothing is ever named after a URL segment.
  const subject = useMemo(() => resolveSubject(subjects, subjectId), [subjects, subjectId]);
  const openId = subject?.id ?? subjectId;

  // Chapters on opening the subject (CURRICULUM.md §8) — nothing is fetched ahead of the learner.
  const units = useUnits(openId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const rowsOf = useCallback(
    (id: string) =>
      unitRows(chaptersBySubject[id] ?? [], {
        completed,
        topicProgress,
        bandOf,
        platformNodeId: nextNodeId,
      }),
    [completed, topicProgress, bandOf, nextNodeId, revision],
  );

  // What Wobo and the page call this subject. Empty when the address resolves to none — the code
  // that reads a page's state has to see "no subject", never a URL segment dressed as a name.
  const name = subject?.name ?? '';
  const rows = useMemo(() => rowsOf(openId), [rowsOf, openId]);

  // The address, corrected. A slug hands over to the name the tiles link to; a segment that names
  // no subject of this class hands back to Learn, which is the page that lists them.
  useEffect(() => {
    if (subjects.length === 0) return;
    if (!subject) {
      router.replace({ name: 'learn' });
      return;
    }
    if (subject.id !== subjectId) {
      router.replace({ name: 'subject', subjectId: subject.id, intent });
    }
  }, [router, subject, subjects.length, subjectId, intent]);

  // The chapter in front of them — the one under way, else the one up next, else the first. Its
  // topics are read so the row carries a real lesson count and Continue opens a real lesson.
  const here =
    rows.find((r) => r.state === 'now') ?? rows.find((r) => r.state === 'next') ?? rows[0];
  useTopics(here?.chapter.id ?? null);

  const go = (next: Intent) => router.replace({ name: 'subject', subjectId: openId, intent: next });

  // Wobo reads the page at code level: which subject is open, and where every chapter stands.
  const listRef = useRegisterTarget<HTMLDivElement>('subject-chapters', {
    kind: 'chapters',
    label: `the chapters of ${name}, each with where the learner stands in it`,
    getSceneState: () => ({
      subject: name,
      intent,
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
      route: 'subject',
      state: {
        title: name,
        intent,
        subject: name,
        chapters: rows.map((r) => `${r.chapter.name} · ${r.state}`),
      },
    });
  }, [publishPage, name, intent, rows]);

  // The crumb: "Learn · Mathematics". The pill beside it is the syllabus's provenance, in the
  // brain's own words — only a verified one wears the mint mark (DESIGN.md §2). With no subject
  // resolved there is no name to print, and the door alone is the honest crumb — the URL segment
  // is the app talking to itself.
  const door = intent === 'practice' ? 'Practice' : 'Learn';
  const crumb = subject ? `${door} · ${subject.name}` : door;
  const provenance = world
    ? world.label.trim() ||
      labelFor(world.status, { name: world.frameworkName, version: world.versionYear })
    : '';
  const initial = profile.name.trim().charAt(0).toUpperCase();

  return (
    <AppFrame active={intent === 'practice' ? 'practice' : 'learn'}>
      <TopBar
        crumb={crumb}
        right={
          <>
            {provenance && (
              <span className="ln-prov">
                {world?.status === 'verified' && <i aria-hidden="true" />}
                {provenance}
              </span>
            )}
            <Avatar aria-hidden={initial ? undefined : true}>{initial}</Avatar>
          </>
        }
      />

      {subject && (
        <div>
          <Label>Your subjects</Label>
          <h1 className="ln-h1">{subject.name}, where your class is this week</h1>
        </div>
      )}

      {!world ? (
        <Card compact>
          <p>{DISCOVERY_COPY.empty}</p>
          <CardFoot>
            <Button size="sm" onClick={() => router.navigate({ name: 'you' })}>
              Choose your board
            </Button>
          </CardFoot>
        </Card>
      ) : (
        <>
          {subjects.length > 0 && (
            <div className="ln-subjects">
              {subjects.map((s) => {
                const line = tileLine({ id: s.id, name: s.name, line: s.line }, rowsOf(s.id));
                return (
                  <Tile
                    key={s.id}
                    title={s.name}
                    {...(line ? { meta: line } : {})}
                    on={s.id === openId}
                    onClick={() => router.replace({ name: 'subject', subjectId: s.id, intent })}
                  />
                );
              })}
            </div>
          )}

          <div className="sb-tabs">
            <Chip on={intent === 'learn'} onClick={() => go('learn')}>
              Learn
            </Chip>
            <Chip on={intent === 'practice'} onClick={() => go('practice')}>
              Practice
            </Chip>
          </div>

          {units.looking ? (
            <DiscoveryCard
              placeholder={units.view?.placeholder ?? null}
              onOwnSyllabus={() => router.navigate({ name: 'you' })}
              onFinished={() => units.reload()}
            />
          ) : rows.length === 0 ? (
            <Card compact>
              <p>
                {units.error ??
                  (world.level && name
                    ? `I am fetching the chapters ${frameworkLabel(world.frameworkName)} teaches in ${name}.`
                    : 'Tell me your class and I will bring your chapters.')}
              </p>
            </Card>
          ) : intent === 'practice' ? (
            <div className="sb-sets" ref={listRef}>
              <Card compact>
                <Tag>This set</Tag>
                <div className="pr-set">
                  {rows.map((r) => (
                    <button
                      key={r.chapter.id}
                      type="button"
                      className={r.state === 'now' ? 'pr-on' : undefined}
                      aria-current={r.state === 'now' ? 'step' : undefined}
                      onClick={() => router.navigate(chapterRoute(r, 'practice'))}
                    >
                      {r.chapter.name}
                      {r.state === 'done' ? (
                        <span className="pr-ok" role="img" aria-label="mastered">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--ink)"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12 l5 5 l9 -10" />
                          </svg>
                        </span>
                      ) : (
                        <span className="pr-dot" />
                      )}
                    </button>
                  ))}
                </div>
              </Card>
              {/* LAW v5 (DESIGN.md §0): an explainer is neither the highlighter nor an earned
              moment, so it takes no wash. The pigment on this screen stays where it works —
              the set the learner is standing in, and the tick beside a finished one. */}
              <Card compact>
                <Tag>How this works</Tag>
                <p style={{ color: 'var(--ink)' }}>
                  Wobo never says wrong. When you're close, it draws the difference on your answer
                  and waits. Get it, and it makes a small fuss.
                </p>
              </Card>
            </div>
          ) : (
            <>
              {/* THE CLIMB — the chapter in front of them, topic by topic, with the two things a
              chapter row can never show: a topic that slipped back, and the ground still to lay
              under one. Every node reads the same mastery state these rows do, one level down
              (screens/learn/Climb.tsx). The chapter ledger stays underneath it. */}
              {here && <Climb chapter={here.chapter} />}

              <Label>Every chapter</Label>
              <div className="ln-units" ref={listRef}>
                {rows.map((r) => {
                  const line = unitLine(r);
                  const to = chapterRoute(r, 'learn');
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
                        <Button size="sm" onClick={() => router.navigate(to)}>
                          Continue
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <a
                      key={r.chapter.id}
                      className={r.state === 'done' ? 'ln-unit ln-done' : 'ln-unit'}
                      href={routeToPath(to)}
                      onClick={(e) => {
                        e.preventDefault();
                        router.navigate(to);
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
            </>
          )}

          <div className="ln-wobo">
            <WoboHead size={28} />
            {WOBO_LINE}
          </div>
        </>
      )}
    </AppFrame>
  );
}
