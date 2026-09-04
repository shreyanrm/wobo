'use client';

/**
 * You — progress, parents, settings. Board 05 of design/prototypes/app-v1.html, ported as drawn:
 * the week in Wobo's words over a chart in Wobo's hand, the three behaviour-based strengths, the
 * parent link, and the settings list; the plan in the rail's bottom slot.
 *
 * Every number on the page is the device's own record (`you/week.ts` over the mind's day ledger),
 * every settings row moves a real switch, and the parent card talks to the gateway's own link.
 * Nothing here is a mock of a feature: a row with nothing behind it on this build says so.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { adoptFramework, adoptOwnSyllabus, askDiscovery, chooseLevel } from '../curriculum/adopt';
import { useFramework, useRegistryRevision, useWorld } from '../curriculum/hooks';
import { OwnSyllabus } from '../curriculum/OwnSyllabus';

import { DiscoveryCard } from '../curriculum/StatusCard';
import { UpgradeCard } from '../curriculum/UpgradeCard';
import { useRouter } from '../shell/router';
import { eraseFromBrain, lifetimeSnapshot } from '../store/mind';
import { useProgress } from '../store/progress';
import { useSdk } from '../store/sdk';
import { paintAccess } from '../ui/access';
import { setMotionPref, useMotionPref } from '../ui/motion';
import {
  AppShell,
  Avatar,
  Button,
  Card,
  CardFoot,
  Chip,
  HandNote,
  type NavId,
  Pill,
  Segmented,
  Tag,
  ToggleRow,
  TopBar,
} from '../ui/primitives';
import { setThemePref, type ThemePref, useThemePref } from '../ui/theme';
import { GradeBoardPicker } from './you/GradeBoardPicker';
import { weeklyNote } from './you/ledger';
import { chosenNames, type MailPrefsView, readMailPrefs, writeCalendars } from './you/mailPrefs';
import { ParentInvite, PHONE_LINK_LINE } from './you/ParentInvite';
import { PlanPanel } from './you/PlanPanel';
import { endParentLink, type ParentLinkStatus, readParentLink } from './you/parentLink';
import {
  boardName,
  frameworkLabel,
  getFlag,
  loadProfile,
  markToday,
  PARENT_KEY,
  type StoredProfile,
  saveProfile,
  setFlag,
  VOICE_KEY,
} from './you/profile';
import { barHeight, type Span, strengths, weekSentence } from './you/week';
import './you/you.css';

const SPANS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
] as const;

const APPEARANCE = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
] as const;

/** "Class 8" from a bare "8"; a level the board names itself ("Year 9") stays as it is. */
export function classLine(grade: string): string {
  const g = grade.trim();
  return /^\d{1,2}$/.test(g) ? `Class ${g}` : g;
}

/** The three drawn icons, from the prototype: a tick, a star, a clock. */
function StrengthIcon({ id }: { id: 'resilience' | 'initiative' | 'consistency' }) {
  if (id === 'resilience') {
    return (
      <svg
        viewBox="0 0 44 44"
        fill="none"
        stroke="var(--mint)"
        strokeWidth="3.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8 28 l8 8 l20 -24" />
      </svg>
    );
  }
  if (id === 'initiative') {
    return (
      <svg
        viewBox="0 0 44 44"
        fill="none"
        stroke="var(--marigold)"
        strokeWidth="3.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M22 6 l4 10 l10 1 l-8 7 l3 10 l-9 -6 l-9 6 l3 -10 l-8 -7 l10 -1 z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 44 44"
      fill="none"
      stroke="var(--pig)"
      strokeWidth="3.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="22" cy="22" r="13" />
      <path d="M22 14 v8 l5 3" />
    </svg>
  );
}

/** The phone link the device kept, if any. */
function localPhoneLink(): string | null {
  try {
    const raw = localStorage.getItem(PARENT_KEY);
    return raw ? ((JSON.parse(raw) as { phone?: string }).phone ?? null) : null;
  } catch {
    return null;
  }
}

export function You() {
  const router = useRouter();
  const sdk = useSdk();
  const bus = useWoboBus();
  const { xp, streakDays, completed, topicProgress, award } = useProgress();
  const revision = useRegistryRevision();

  // --- who you are --------------------------------------------------------------------------------
  const [profile, setProfile] = useState<StoredProfile>(() => loadProfile());
  const world = useWorld();
  const framework = useFramework(world?.frameworkId ?? null);
  const [changingSchool, setChangingSchool] = useState(false);
  const [showOwnSyllabus, setShowOwnSyllabus] = useState(false);
  const [sourcing, setSourcing] = useState<string | null>(null);
  const commitProfile = (patch: Partial<StoredProfile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    saveProfile(next);
    award('account');
  };
  const patchProfile = (patch: Partial<StoredProfile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    saveProfile(next);
    paintAccess({ largeText: next.largeText, highContrast: next.highContrast });
    bus.publishLifetime(lifetimeSnapshot());
  };
  const firstName = profile.name.trim().split(/\s+/)[0] ?? '';
  // The board's NAME, never the raw id a world pinned from an id alone carries as its name.
  const board = frameworkLabel(boardName(profile.boardId));

  // --- the week ------------------------------------------------------------------------------------
  const [span, setSpan] = useState<Span>('week');
  const [marks] = useState(() => markToday());
  // THE weekly note (you/ledger.ts) — the same function the home calls, so "This week, in Wobo's
  // words" is one sentence from one set of facts wherever it is read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` stands in for the registry's contents
  const summary = useMemo(
    () => weeklyNote({ span, marks, topicProgress, completed }),
    [span, marks, topicProgress, completed, revision],
  );
  const sentence = weekSentence(summary);
  const praise = strengths(summary);

  // --- the parent link -----------------------------------------------------------------------------
  const [link, setLink] = useState<ParentLinkStatus | null>(() => {
    const phone = localPhoneLink();
    return phone
      ? { status: 'linked', parent_email: null, line: `linked · ${phone} — ${PHONE_LINK_LINE}` }
      : null;
  });
  const [inviting, setInviting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readParentLink().then((got) => {
      if (!cancelled && got && got.status !== 'none') setLink(got);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const linked = link !== null && (link.status === 'invited' || link.status === 'linked');
  const endLink = () => {
    void endParentLink().then((got) => setLink(got && got.status !== 'none' ? got : null));
    try {
      localStorage.removeItem(PARENT_KEY);
    } catch {
      // fine
    }
  };

  // --- settings ------------------------------------------------------------------------------------
  const [voice, setVoice] = useState(() => getFlag(VOICE_KEY));
  const reduce = useMotionPref();
  const theme = useThemePref();
  const [prefs, setPrefs] = useState<MailPrefsView | null>(null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readMailPrefs().then((got) => {
      if (!cancelled) setPrefs(got);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleCalendar = (id: string) => {
    if (!prefs) return;
    const chosen = prefs.chosen.includes(id)
      ? prefs.chosen.filter((c) => c !== id)
      : [...prefs.chosen, id];
    setPrefs({ ...prefs, chosen });
    void writeCalendars(chosen).then((got) => {
      if (got) setPrefs(got);
    });
  };
  const country = framework.view?.framework.country ?? null;
  const language = profile.language?.trim() || 'English';

  // --- your data -----------------------------------------------------------------------------------
  const [confirming, setConfirming] = useState(false);
  const [erasing, setErasing] = useState(false);
  const account = sdk.account;
  /**
   * Erase, for real. The brain first (`POST /v1/me/erase` — memory, mail preferences, the parent
   * link), the account's rows next, and the device last, whether or not the network cooperated:
   * an offline erase still empties this phone, and the rest is retried on the next pulse.
   */
  const startOver = () => {
    if (erasing) return;
    setErasing(true);
    const clearDevice = () => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k?.startsWith('wobo-')) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
      window.location.reload();
    };
    void eraseFromBrain()
      .catch(() => 'pending' as const)
      .then(() => account?.eraseRemoteData() ?? Promise.resolve(null))
      .catch(() => null)
      .then(clearDevice);
  };

  // --- the plan ------------------------------------------------------------------------------------
  // Which tier the brain says this learner is on. The panel below (`you/PlanPanel.tsx`) says
  // everything about it in words and owns the cancel; this read exists so the panel can tell a
  // learner who is genuinely on Free from one whose paid plan it could not read — two very
  // different things to say to somebody about their money.
  const [planId, setPlanId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void sdk
      .me()
      .then((me) => {
        if (!cancelled && me) setPlanId(me.plan);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  // --- Wobo reads this page ------------------------------------------------------------------------
  const weekRef = useRegisterTarget<HTMLDivElement>('you-weekly-note', {
    kind: 'card',
    label: "the week in Wobo's words — days shown up, questions asked, and the drawn chart",
  });
  const parentsRef = useRegisterTarget<HTMLDivElement>('you-parents', {
    kind: 'card',
    label: 'the parent link — invite a parent to the Sunday note',
  });
  const schoolRef = useRegisterTarget<HTMLButtonElement>('you-school', {
    kind: 'control',
    label: 'change your class and board — the syllabus everything is taught from',
    getSceneState: () => ({ grade: profile.grade, board, open: changingSchool }),
    getValidActions: () => ['open the class and board picker'],
    applyTutorAction: (patch) => {
      if (typeof patch.open === 'boolean') setChangingSchool(patch.open);
    },
  });
  const pickerRef = useRegisterTarget<HTMLDivElement>('you-school-picker', {
    kind: 'picker',
    label: 'the class and board picker — which syllabus this learner is on',
    getSceneState: () => ({ grade: profile.grade, board }),
    getValidActions: () => ['change the class', 'change the board'],
    applyTutorAction: (patch) => {
      if (typeof patch.grade === 'string') commitProfile({ grade: patch.grade });
      if (typeof patch.boardId === 'string') commitProfile({ boardId: patch.boardId });
    },
  });
  const settingsRef = useRegisterTarget<HTMLDivElement>('you-settings', {
    kind: 'settings',
    label: "settings — Wobo's voice, reduce motion, appearance, festivals, and your data",
    getSceneState: () => ({ voice, reduce, theme, largeText: Boolean(profile.largeText) }),
    getValidActions: () => ['mute or unmute Wobo', 'switch the theme', 'reduce motion'],
    applyTutorAction: (patch) => {
      if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system')
        setThemePref(patch.theme);
      if (typeof patch.reduce === 'boolean') setMotionPref(patch.reduce);
    },
  });
  const planRef = useRegisterTarget<HTMLDivElement>('you-plan', {
    kind: 'card',
    label:
      'your plan — which plan, what it renews on, the door to the plans page, and the cancel that keeps it until the period already paid for ends',
  });

  useEffect(() => {
    bus.publishPage({
      route: 'you',
      state: {
        name: profile.name,
        grade: profile.grade,
        board,
        xp,
        learnerDays: streakDays,
        span,
        showedUp: summary.showedUp,
        asked: summary.asked,
        parentLinked: linked,
      },
    });
  }, [bus, profile, board, xp, streakDays, span, summary, linked]);

  const go = (id: NavId, path: string) => {
    if (id === 'home') router.navigate({ name: 'home' });
    else if (id === 'learn') router.navigate({ name: 'learn' });
    else if (id === 'practice') router.navigate({ name: 'practice' });
    else if (path === '/you') router.navigate({ name: 'you' });
  };

  const crumb: ReactNode = (
    <>
      You · {firstName || profile.name}
      {(profile.grade || board) && (
        <>
          {' · '}
          <button
            type="button"
            ref={schoolRef}
            className="wy-crumb-btn"
            aria-expanded={changingSchool}
            onClick={() => setChangingSchool((s) => !s)}
          >
            {[profile.grade && classLine(profile.grade), board].filter(Boolean).join(' · ')}
          </button>
        </>
      )}
    </>
  );

  return (
    // The rail's bottom slot used to hold a second, smaller "Your plan" card. The plan now has a
    // panel of its own in the page below — the one the plans page points at — and one screen does
    // not say the same heading twice.
    <AppShell active="you" className="wy-shell" onNavigate={go}>
      <TopBar
        crumb={crumb}
        right={
          <>
            <Segmented options={SPANS} value={span} onChange={setSpan} />
            <Avatar aria-label={profile.name || undefined}>
              {(firstName[0] ?? '').toUpperCase()}
            </Avatar>
          </>
        }
      />

      {changingSchool && (
        <div ref={pickerRef} style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
          <GradeBoardPicker
            grade={profile.grade || null}
            board={
              world
                ? {
                    id: world.frameworkId,
                    name: world.frameworkName,
                    framework: null,
                    unlisted: false,
                  }
                : null
            }
            onGrade={(g) => {
              commitProfile({ grade: g });
              void chooseLevel(g);
            }}
            onBoard={(b) => {
              commitProfile({ boardId: b.id });
              if (b.unlisted)
                void askDiscovery(b.name, profile.grade || null).then(() => setSourcing(b.name));
              else
                void adoptFramework({
                  frameworkId: b.id,
                  name: b.name,
                  level: profile.grade || null,
                });
            }}
            onOwnSyllabus={() => setShowOwnSyllabus(true)}
          />
          {sourcing && !showOwnSyllabus && (
            <DiscoveryCard
              placeholder={null}
              message={`I am looking for ${sourcing} now. I will bring it here the moment I have it.`}
              onOwnSyllabus={() => setShowOwnSyllabus(true)}
            />
          )}
          {showOwnSyllabus && (
            <OwnSyllabus
              suggestedName={world?.frameworkName ?? ''}
              onCancel={() => setShowOwnSyllabus(false)}
              onReady={(view) => {
                const next = adoptOwnSyllabus(view);
                commitProfile({ boardId: next.frameworkId, grade: next.level ?? '' });
                setShowOwnSyllabus(false);
              }}
            />
          )}
          <UpgradeCard />
        </div>
      )}

      <div className="wy-you">
        {/* this week, in Wobo's words */}
        <div ref={weekRef}>
          <Card compact>
            <Tag>{summary.tag}</Tag>
            {/* the same sentence Home prints, typeset by the same primitive — one implementation */}
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
            <div
              className="wy-chart"
              role="img"
              aria-label={`activity, ${span} by ${span === 'year' ? 'month' : 'day'}`}
            >
              {summary.bars.map((bar) => (
                <i
                  key={bar.key}
                  // a day still to come, and a past day with nothing in it, are both the quiet bar
                  className={bar.future || bar.value === 0 ? 'wy-k' : undefined}
                  style={{ height: `${barHeight(bar, summary.bars)}%` }}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* learning strengths */}
        <Card compact>
          <Tag>Learning strengths</Tag>
          <div className="wy-strengths">
            {praise.length === 0 ? (
              <p>
                Wobo is still getting to know you — how you answer, where you linger, when you show
                up. It gathers here as you learn.
              </p>
            ) : (
              praise.map((s) => (
                <div key={s.id}>
                  <StrengthIcon id={s.id} />
                  <div>
                    <b>{s.title}</b>
                    {s.line}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* parents */}
        <div ref={parentsRef}>
          {/* LAW v5 (DESIGN.md §0): rose is for the thing that needs care. Sharing the week with a
              parent is a door, not a worry, so it sits on plain paper. */}
          <Card compact>
            <Tag>Parents</Tag>
            <h3>Share the week with a parent</h3>
            {link && link.status !== 'none' ? (
              <p style={{ color: 'var(--ink)' }}>{link.line}</p>
            ) : (
              <p style={{ color: 'var(--ink)' }}>
                They get the Sunday note, and nothing else. You can{' '}
                <a
                  href="/parent"
                  onClick={(e) => {
                    e.preventDefault();
                    router.navigate({ name: 'parent' });
                  }}
                >
                  see the week the way they will
                </a>{' '}
                before you send it.
              </p>
            )}
            {inviting ? (
              <ParentInvite
                learnerName={firstName}
                autoFocus
                onDone={(status) => {
                  setLink(status);
                  setInviting(false);
                  award('invite_parent', { onceKey: 'invite_parent' });
                }}
                onLater={() => setInviting(false)}
              />
            ) : (
              <CardFoot>
                {linked ? (
                  <Button size="sm" onClick={endLink}>
                    End the link
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setInviting(true)}>
                    Send an invite
                  </Button>
                )}
                <Pill>
                  {link?.status === 'invited'
                    ? 'invited'
                    : link?.status === 'linked'
                      ? 'linked'
                      : 'not linked yet'}
                </Pill>
              </CardFoot>
            )}
          </Card>
        </div>

        {/* settings */}
        <div ref={settingsRef}>
          <Card compact>
            <Tag>Settings</Tag>
            <ToggleRow
              title="Wobo speaks replies out loud"
              hint={country ? `Voice chosen for ${country} · ${language}` : language}
              on={voice}
              onChange={(v) => {
                setVoice(v);
                setFlag(VOICE_KEY, v);
                bus.publishLifetime(lifetimeSnapshot());
              }}
            />
            <ToggleRow
              title="Reduce motion"
              hint="Still frames instead of animation"
              on={reduce}
              onChange={setMotionPref}
            />
            <ToggleRow title="Appearance" hint="Auto follows your device">
              <Segmented<ThemePref> options={APPEARANCE} value={theme} onChange={setThemePref} />
            </ToggleRow>
            <ToggleRow
              title="Festivals we can wish you on"
              hint={`Chosen by your family · ${chosenNames(prefs) ?? 'none yet'}`}
            >
              <Button
                size="sm"
                tone="quiet"
                disabled={!prefs}
                aria-expanded={choosing}
                onClick={() => setChoosing((c) => !c)}
              >
                Choose
              </Button>
            </ToggleRow>
            {choosing && prefs ? (
              <div style={{ display: 'grid', gap: 10, paddingBottom: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {prefs.calendars.map((c) => (
                    <Chip
                      key={c.id}
                      on={prefs.chosen.includes(c.id)}
                      onClick={() => toggleCalendar(c.id)}
                    >
                      {c.name}
                    </Chip>
                  ))}
                </div>
                {prefs.about ? <p>{prefs.about}</p> : null}
              </div>
            ) : null}
            <ToggleRow title="Your data" hint="See what Wobo remembers, or erase it">
              <Button
                size="sm"
                tone="quiet"
                aria-expanded={confirming}
                onClick={() => setConfirming((c) => !c)}
              >
                Manage
              </Button>
            </ToggleRow>
            {confirming ? (
              <div style={{ display: 'grid', gap: 12, paddingBottom: 14 }}>
                <p>
                  this deletes your name, photo, progress, settings, what Wobo remembers about you,
                  your mail choices and the parent link, from this device and from your account on
                  our servers. it cannot be undone.
                </p>
                {/*
                  HONESTY (docs/conformance/privacy-and-children.md §J). The erase reaches 6 of the
                  22 durable stores. Your individual practice answers, your board ink, your session
                  rows, an uploaded syllabus and the account itself are NOT reached, and this line
                  must not imply they are. The help centre says the same in full, and says where to
                  write to have the rest done by hand.
                */}
                <p>
                  it does not yet reach your answers to practice questions, your ink on the board,
                  or a syllabus you uploaded, and your account itself stays open. write to
                  support@heywobo.com to have those removed too.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={startOver} disabled={erasing}>
                    {erasing ? 'erasing…' : 'erase and start over'}
                  </Button>
                  <Button size="sm" tone="quiet" onClick={() => setConfirming(false)}>
                    keep going
                  </Button>
                </div>
              </div>
            ) : null}
            <ToggleRow
              title="Larger text"
              hint="Bump the type size across the whole app"
              on={Boolean(profile.largeText)}
              onChange={(v) => patchProfile({ largeText: v })}
            />
            <ToggleRow
              title="High contrast"
              hint="Stronger text and lines, easier to read"
              on={Boolean(profile.highContrast)}
              onChange={(v) => patchProfile({ highContrast: v })}
            />
          </Card>
        </div>

        {/* your plan — the panel the plans page points at: "You → Your plan → Cancel". The Cancel
            is on the panel itself, so the confirmation is one tap away and the whole cancel is
            two, which is the count that page prints. The tab is You (ui/primitives/AppShell.tsx);
            the card above is tagged Settings and is a SIBLING of this one, never its parent, which
            is why no surface tells anyone to look inside a Settings screen for their plan. */}
        <div ref={planRef}>
          <PlanPanel planId={planId} onSeePlans={() => router.navigate({ name: 'plans' })} />
        </div>
      </div>
    </AppShell>
  );
}
