'use client';

/**
 * The trophy room — not a list of past courses but a room you walk into. Every earned thing stands
 * in its own spotlight: a mastered concept as a crest shield in its subject hue, a streak as a
 * medal on a ribbon, XP as a struck cup. Locked positions are dark silhouettes that name exactly
 * what earns the next one — so the room is always half promise. Legit metalwork, zero authored
 * assets (DESIGN.md §2); the objects and the shelf light live in ui/trophies.tsx.
 */

import type { ReactNode } from 'react';
import { chapterById } from '../../curriculum/registry';
import type { Topic } from '../../data/model';
import { toneForSubject } from '../../ui/hues';
import { STREAK_TIERS, TrophyPlinth, tierForStreak, tierForXp, XP_TIERS } from '../../ui/trophies';

const STREAK_HUE = 'var(--mint)';
const XP_HUE = 'var(--pig)';

const fmtXp = (n: number) => n.toLocaleString('en-IN');
const shortXp = (n: number) => (n >= 1000 ? `${n / 1000}k xp` : `${n} xp`);

export function TrophyRoom({
  mastered,
  xp,
  streakDays,
}: {
  mastered: Topic[];
  xp: number;
  streakDays: number;
}) {
  const earnedObjects: ReactNode[] = [];

  // mastered concepts — the core trophies, each a crest in its subject's hue
  for (const t of mastered) {
    const subjectId = chapterById(t.chapterId)?.subjectId ?? 'math';
    const tone = toneForSubject(subjectId);
    earnedObjects.push(
      <TrophyPlinth
        key={`t-${t.id}`}
        earned
        form="shield"
        tier="gold"
        hue={tone.hue}
        engrave={subjectId.slice(0, 4).toUpperCase()}
        title={t.name}
        sub="mastered"
      />,
    );
  }

  // streak medallions — every milestone the learner has reached
  for (const m of STREAK_TIERS.filter((m) => streakDays >= m)) {
    earnedObjects.push(
      <TrophyPlinth
        key={`s-${m}`}
        earned
        form="medal"
        tier={tierForStreak(m)}
        hue={STREAK_HUE}
        engrave={`${m} days`}
        title={`${m}-day streak`}
        sub="kept coming back"
      />,
    );
  }

  // xp cups — the earned-currency milestones
  for (const m of XP_TIERS.filter((m) => xp >= m)) {
    earnedObjects.push(
      <TrophyPlinth
        key={`x-${m}`}
        earned
        form="cup"
        tier={tierForXp(m)}
        hue={XP_HUE}
        engrave={shortXp(m)}
        title={`${fmtXp(m)} xp`}
        sub="earned in full"
      />,
    );
  }

  // dark silhouettes — the very next thing each track earns, named exactly
  const ghosts: ReactNode[] = [];
  const nextStreak = STREAK_TIERS.find((m) => streakDays < m);
  if (nextStreak)
    ghosts.push(
      <TrophyPlinth
        key="g-streak"
        earned={false}
        form="medal"
        tier={tierForStreak(nextStreak)}
        hue={STREAK_HUE}
        engrave={`${nextStreak} days`}
        title={`${nextStreak}-day streak`}
        sub={`${nextStreak - streakDays} ${nextStreak - streakDays === 1 ? 'day' : 'days'} to go`}
      />,
    );
  const nextXp = XP_TIERS.find((m) => xp < m);
  if (nextXp)
    ghosts.push(
      <TrophyPlinth
        key="g-xp"
        earned={false}
        form="cup"
        tier={tierForXp(nextXp)}
        hue={XP_HUE}
        engrave={shortXp(nextXp)}
        title={`${fmtXp(nextXp)} xp`}
        sub={`${fmtXp(nextXp - xp)} xp to go`}
      />,
    );
  ghosts.push(
    <TrophyPlinth
      key="g-concept"
      earned={false}
      form="shield"
      tier="gold"
      hue={XP_HUE}
      title="A concept you master next"
      sub="finish any course"
    />,
  );

  const objects = [...earnedObjects, ...ghosts];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 14,
        }}
      >
        {objects}
      </div>
      {/* the room's floor — a single quiet line the pedestals stand on */}
      <div style={{ height: 1, background: 'var(--wobo-card-border)', marginTop: 8 }} />
      <div style={{ fontSize: '0.8rem', color: 'var(--wobo-ink-faint)', marginTop: 8 }}>
        {earnedObjects.length === 0
          ? 'The room is waiting. Your first trophy is one finished course, a three-day streak, or 250 XP away.'
          : `${earnedObjects.length} on display · the dim shelves name what comes next`}
      </div>
    </div>
  );
}
