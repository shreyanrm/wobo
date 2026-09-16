'use client';

/**
 * THE INSTALL OFFER, AS A SUGGESTION OF THE SIDE DOOR KIND.
 *
 * docs/SUGGESTIONS-AND-NOTICES.md §2 gives the side door its definition: *"that a game opened, and
 * that it is optional"*, and it may never carry *"a reward for taking it that a learner loses by
 * not taking it"*. An install is the same shape of thing. It is off the climb, nothing about a
 * learner's work depends on it, and a learner who ignores it for ever has lost nothing at all. So
 * it is offered in that register and through the same arbiter, never as a banner: it goes through
 * `Suggestions`, which keeps at most one suggestion on screen and lends this card its no.
 *
 * WHY IT BRINGS ITS OWN CARD. The arcade brings one because its card carries what a level is worth
 * (`screens/course/SideDoor.tsx`); this one brings one because on iOS the offer is not a button at
 * all but two steps a learner performs themselves, and a picture of them has to be drawn. The gate
 * above it is still the host's: `choose` runs first, and the decline sits underneath either way.
 *
 * WHAT IT NEVER DOES. It never appears on a public page or at a door, because the only thing that
 * renders it is the app frame. It never appears before an earned moment. It never appears twice.
 * It never describes itself, announces itself, or says what Wobo is about to do (DESIGN.md §0.x):
 * it names a thing and says why it follows, like every other suggestion in this folder.
 */

import { useReducedMotion } from 'framer-motion';
import { useEffect, useSyncExternalStore } from 'react';
import {
  armInstallCapture,
  type InstallRoute,
  installGeneration,
  mayOffer,
  noteOffered,
  onInstallChange,
  takePrompt,
} from '../shell/install';
import { useRouter } from '../shell/router';
import { useProgress } from '../store/progress';
import type { Suggestion as Offer } from './kind';
import { QUIET } from './quiet';
import { Suggestions } from './Suggestions';

/**
 * Every word a learner reads here. One place, so the whole voice can be read at once, and held by
 * `shell/install.test.ts` to docs/copy/voice.md: sentence case, no exclamation, nothing that
 * describes the software, and no promise the product does not keep.
 */
export const INSTALL_COPY = {
  label: 'on your home screen',
  title: 'Keep Wobo on your home screen',
  /** True of both routes, and it is the only reason given, because it is the only one that is a
   *  reason for the learner rather than for us. */
  why: 'It opens straight from the home screen, like anything else on the phone.',
  action: 'add it',
  /** What the side door owes: that the climb goes on without it (docs/SUGGESTIONS-AND-NOTICES.md). */
  note: 'Everything works the same in the browser, so nothing here needs it.',
  /** iOS, where the learner walks the route themselves and the two steps are the whole offer. */
  stepOne: 'Open the share menu',
  stepTwo: 'Choose Add to Home Screen',
} as const;

/** The id names what the offer is about, the way every suggestion id in this folder does. */
export const INSTALL_OFFER_ID = 'side_door:app:install';

export function installSuggestion(): Offer {
  return {
    kind: 'side_door',
    id: INSTALL_OFFER_ID,
    title: INSTALL_COPY.title,
    why: INSTALL_COPY.why,
    action: INSTALL_COPY.action,
    decline: 'not now',
    note: INSTALL_COPY.note,
    questions: [],
    target: null,
  };
}

/**
 * THE TWO STEPS, DRAWN. Not a screenshot: a photograph of somebody else's phone is the wrong size
 * on this one, the wrong theme at night, and wrong altogether on the next OS release. These are the
 * two marks the learner is looking for, in the app's own ink, at the app's own weight.
 */
function ShareMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 3.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8.5 7 12 3.5 15.5 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 11H5.5v9h13v-9H17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusSquareMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 8.5v7M8.5 12h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Step({ mark, words }: { mark: 'share' | 'plus'; words: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, color: QUIET.body }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'var(--paper)',
          color: QUIET.title,
          flex: '0 0 auto',
        }}
      >
        {mark === 'share' ? <ShareMark /> : <PlusSquareMark />}
      </span>
      <span style={{ fontSize: QUIET.bodySize, lineHeight: 1.5 }}>{words}</span>
    </li>
  );
}

/**
 * The card. It paints only from `quiet.ts` — a surface, body type, a text action, one accent dot —
 * so it cannot become the loudest thing on the page. The dot is marigold because DESIGN.md §0 gives
 * marigold the earned moment, and this offer is made of one.
 */
export function InstallCard({ route }: { route: InstallRoute }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <aside
      data-testid="install-offer"
      data-route={route}
      aria-label={INSTALL_COPY.title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: QUIET.gap,
        padding: QUIET.pad,
        borderRadius: QUIET.radius,
        background: QUIET.surface,
        maxWidth: QUIET.maxWidth,
        margin: '20px auto 0',
        transition: reduced ? 'none' : 'opacity 200ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: QUIET.dot,
            height: QUIET.dot,
            borderRadius: 999,
            background: 'var(--marigold)',
            flex: '0 0 auto',
          }}
        />
        <span
          style={{
            fontSize: QUIET.labelSize,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: QUIET.label,
            fontWeight: 500,
          }}
        >
          {INSTALL_COPY.label}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: QUIET.titleSize, fontWeight: 540, color: QUIET.title }}>
        {INSTALL_COPY.title}
      </h3>
      <p style={{ margin: 0, fontSize: QUIET.bodySize, lineHeight: 1.5, color: QUIET.body }}>
        {INSTALL_COPY.why}
      </p>

      {route === 'share-sheet' ? (
        // iOS: no event, no dialog, and nothing here pretends otherwise. The learner does it, so
        // what they get is the two marks they are looking for and no button that cannot work.
        <ol
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          <Step mark="share" words={INSTALL_COPY.stepOne} />
          <Step mark="plus" words={INSTALL_COPY.stepTwo} />
        </ol>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            data-testid="install-take"
            onClick={() => {
              void takePrompt();
            }}
            style={{
              minHeight: QUIET.tap,
              padding: '11px 16px',
              borderRadius: 999,
              border: 0,
              background: QUIET.actionBackground,
              color: QUIET.actionColor,
              fontFamily: 'inherit',
              fontSize: QUIET.bodySize,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {INSTALL_COPY.action}
          </button>
        </div>
      )}

      <p style={{ margin: 0, fontSize: QUIET.labelSize, lineHeight: 1.5, color: QUIET.label }}>
        {INSTALL_COPY.note}
      </p>
    </aside>
  );
}

/**
 * What the frame mounts. It renders nothing at all on most screens most of the time, which is the
 * ordinary answer: no route to install by, no earned moment yet, a celebration already on screen,
 * an immersive route, or an offer already made once.
 */
export function InstallOffer() {
  const { route } = useRouter();
  const { completed, trophies } = useProgress();

  // The entry already armed this, before a single lazy chunk was fetched, which is the only place
  // early enough to catch an event the browser fires once per page load (`main.tsx` says why). This
  // call stands behind it and nothing more: it is idempotent, so a remount never doubles a
  // listener, and it keeps the frame working in a harness that never ran the entry.
  useEffect(() => {
    armInstallCapture();
  }, []);

  // How a capture that lands AFTER this frame is on screen reaches it. The gate below reads the
  // route, the earned moment and the trophies, and the event's arrival changes none of them — so
  // without this, an event a moment late was an offer never made for the whole of that load. The
  // snapshot itself is not read: what it is for is the re-render, and `mayOffer` reads the capture.
  useSyncExternalStore(onInstallChange, installGeneration, () => 0);

  // docs/FEEL.md §3 and docs/REWARDS.md §3: one topic mastered is the product's own earned moment.
  const earned = completed.size > 0;
  const offer = mayOffer({ route: route.name, earned, celebrating: trophies.length > 0 });

  // *"Shown once"*: written when it goes up, not when it is answered, so a learner who never
  // touched it is not asked a second time (`shell/install.ts` says why).
  useEffect(() => {
    if (offer) noteOffered();
  }, [offer]);

  if (!offer) return null;

  return (
    <Suggestions
      candidates={[installSuggestion()]}
      hue="var(--marigold)"
      slotFor={() => <InstallCard route={offer} />}
    />
  );
}
