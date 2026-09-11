'use client';

/**
 * THE SIDE DOOR — the one thing on a chapter that is not part of the climb.
 *
 * docs/CONTENT-INTERACTION.md §7: *"a bonus level appears as a side door off the climb: optional,
 * never in the path, never a nag."* Three words, three rules, and each one is visible here:
 *
 *   OFF THE CLIMB.   It is an `<aside>`, outside the course's own flow and outside any list of
 *                    steps. Nothing that counts a learner's progress can see it.
 *   OPTIONAL.        It offers and then stops. The course's own action bar is untouched, so the
 *                    primary thing on the screen is still whatever came next before this existed.
 *   NEVER A NAG.     It says what it is once, says the climb goes on without it, and never
 *                    reappears with a louder voice. A door already cleared says so plainly and
 *                    still opens, because it is theirs.
 *
 * docs/FEEL.md §3: *"a bonus level is found: the side door opens itself, once, so the learner knows
 * it was there."* That is the whole animation, and reduced motion is the still.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { useRouter } from '../../shell/router';
import {
  BONUS_XP,
  bonusLeftInChapter,
  bonusLeftToday,
  clearedBonus,
  rememberDoor,
} from '../../store/arcade';
import type { DoorOffer } from './side-door';
import { DOOR_TITLE } from './side-door';

export function SideDoor({ offer, hue }: { offer: DoorOffer; hue: string }) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;

  // The door remembers itself, so the day's quest on the home thread can point at a bonus level
  // that really is open rather than at a game we hope exists.
  useEffect(() => {
    rememberDoor({
      chapterId: offer.chapterId,
      topicId: offer.topicId,
      levelId: offer.spec.id,
      title: offer.spec.title,
      spec: offer.spec,
    });
  }, [offer]);

  const done = clearedBonus(offer.chapterId, offer.spec.id);
  const dayLeft = bonusLeftToday();
  const chapterLeft = bonusLeftInChapter(offer.chapterId);
  const pays = !done && dayLeft >= BONUS_XP && chapterLeft >= BONUS_XP;

  // What it is worth, said once and honestly. A door that pays nothing today says so rather than
  // promising XP it will not hand over.
  const worth = done
    ? 'already yours'
    : dayLeft < BONUS_XP
      ? 'the arcade is done paying today'
      : chapterLeft < BONUS_XP
        ? 'the arcade has paid all it pays in this chapter'
        : `${BONUS_XP} bonus xp`;

  return (
    <motion.aside
      data-testid="side-door"
      aria-label={`${DOOR_TITLE}: ${offer.spec.title}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 240, damping: 26 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        borderRadius: 16,
        background: 'var(--paper-2)',
        maxWidth: 620,
        margin: '20px auto 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: 999, background: hue, flex: '0 0 auto' }}
        />
        <span
          style={{
            fontSize: '0.8125rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 500,
          }}
        >
          {DOOR_TITLE}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--ink-3)' }}>
          {worth}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 540, color: 'var(--ink)' }}>
        {offer.spec.title}
      </h3>
      <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.5, color: 'var(--ink-2)' }}>
        {offer.why}
      </p>
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--ink-3)' }}>
        {offer.line}
      </p>

      <div>
        <button
          type="button"
          data-testid="side-door-open"
          onClick={() => router.navigate({ name: 'arcade', topicId: offer.topicId })}
          style={{
            minHeight: 44,
            padding: '11px 20px',
            borderRadius: 999,
            border: 0,
            background: pays ? hue : 'var(--paper-3)',
            color: pays ? 'var(--paper)' : 'var(--ink)',
            fontFamily: 'inherit',
            fontSize: '0.95rem',
            fontWeight: 540,
            cursor: 'pointer',
          }}
        >
          {done ? 'play it again' : 'open it'}
        </button>
      </div>
    </motion.aside>
  );
}
