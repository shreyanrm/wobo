'use client';

/**
 * THE ARCADE SCREEN — where a side door leads, and the only place a bonus level is played.
 *
 * It is deliberately a thin screen. The level was already served with the course the learner just
 * finished and the door remembered it (`store/arcade.ts`), so opening one fetches nothing,
 * generates nothing and costs nothing: that is the whole point of §7's "templates filled from the
 * level rendering, zero model calls per play".
 *
 * A door with nothing behind it is not an error. A learner who lands here with no remembered level
 * — a shared link, a cleared cache, a different device — is told plainly and shown the way back to
 * their chapter. Nothing is invented to fill the screen.
 *
 * THE LIGHTER SHELL. §7: *"older classes get a lighter shell than class 6."* The class comes from
 * the learner's own world (`curriculum/world.ts`), and from class 9 up the shell drops its
 * encouragement and its instructions to one line. The game is identical; only the talking changes.
 */

import { useCallback, useMemo, useState } from 'react';
import { chapterById, topicById } from '../curriculum/registry';
import { loadWorld } from '../curriculum/world';
import { ArcadeShell } from '../engines/ArcadeShell';
import { parseArcade } from '../engines/arcade/spec';
import { AppFrame } from '../shell/AppFrame';
import { useRouter } from '../shell/router';
import { readArcade } from '../store/arcade';
import { hueForTopic } from '../ui/hues';
import { Button, TopBar } from '../ui/primitives';
import { ActionBar, type BarState } from './course/shared';
import { topicNodeUuid } from './learn/mastery';
import './course/lesson.css';

/**
 * From which class the shell gets lighter. Class 9 is where a learner stops wanting to be told they
 * did well and starts wanting to be left alone with it.
 */
export const LIGHTER_FROM_CLASS = 9;

/** The class out of the learner's own world, or null when they have not pinned one. */
export function classOf(level: string | null | undefined): number | null {
  const found = /\d{1,2}/.exec(level ?? '');
  return found ? Number(found[0]) : null;
}

export function lighterShell(level: string | null | undefined): boolean {
  const cls = classOf(level);
  return cls !== null && cls >= LIGHTER_FROM_CLASS;
}

export function Arcade({ topicId }: { topicId: string }) {
  const router = useRouter();
  const [bar, setBar] = useState<BarState | null>(null);

  const door = useMemo(() => readArcade().doors.find((d) => d.topicId === topicId), [topicId]);
  // Re-gated on the way in. A blob out of a learner's storage is untrusted, and a level the six
  // mechanics cannot render is refused here exactly as it would be on the wire.
  const spec = useMemo(() => (door ? parseArcade(door.spec) : null), [door]);

  const topic = topicById(topicId);
  const chapter = topic ? chapterById(topic.chapterId) : undefined;
  const hue = hueForTopic(topicId);
  const lite = lighterShell(loadWorld()?.level);

  const leave = useCallback(() => {
    router.navigate({ name: 'course', topicId });
  }, [router, topicId]);

  const crumb = chapter?.name ?? topic?.name ?? 'bonus level';

  return (
    <AppFrame active="learn">
      <h1 className="ls-sr">{spec ? spec.title : 'bonus level'}</h1>
      <TopBar className="ls-topbar" crumb={crumb} />
      <div className="ls-lesson">
        <section className="ls-plane" aria-label={spec ? spec.title : 'bonus level'}>
          {spec ? (
            <ArcadeShell
              spec={spec}
              hue={hue}
              // The id a topic's evidence is filed under, always derived from the topic id
              // (`screens/learn/mastery.ts`). `topic.nodeId` is a slug, and every payload that
              // records evidence types `node_id` as a uuid, so passing it would throw the
              // attempt away at the door and the band would read from a key nothing wrote.
              nodeId={topicNodeUuid(topicId)}
              // The chapter the DOOR hangs off, as the door itself recorded it. The registry is
              // the fallback and not the source: a learner can reach this screen with the
              // registry cold, and the cap is per chapter, so guessing one chapter for all of
              // them would spend a whole chapter's allowance on the first level they play.
              chapterId={door?.chapterId ?? chapter?.id ?? topic?.chapterId ?? 'chapter'}
              lite={lite}
              setBar={setBar}
              onDone={leave}
            />
          ) : (
            <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 20px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 540, color: 'var(--ink)' }}>
                this one is not open on this device
              </h2>
              <p
                style={{
                  margin: '10px 0 20px',
                  fontSize: '0.95rem',
                  lineHeight: 1.5,
                  color: 'var(--ink-2)',
                }}
              >
                a bonus level comes with the topic it sits beside. open the topic and the side door
                is there at the end of it.
              </p>
              <Button onClick={leave}>back to the topic</Button>
            </div>
          )}
        </section>
      </div>
      <ActionBar bar={bar} />
    </AppFrame>
  );
}
