'use client';

/**
 * The bindery — where a learner forges their own practice workbook. You pick only from what you
 * have already touched (completed or attempted chapters and topics); untouched topics are visible
 * but honestly unpickable, with a playful note, because you can't drill what you haven't met yet.
 * Each pick stacks as a page in a growing workbook; you choose its size and its balance; Wobo
 * suggests through Wobo's normal action path (Wobo reads the builder at code level and can add a pick,
 * set the size, or forge it directly). Binding fires a spring and a sound, then it goes to the
 * downloading queue and lands on your shelf.
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { chaptersBySubject, subjects, topicById } from '../../curriculum/registry';
import type { Topic } from '../../data/model';
import { loadMind } from '../../store/mind';
import { useProgress } from '../../store/progress';
import { hueForTopic } from '../../ui/hues';
import { ChevronIcon } from '../../ui/icons';
import { sfx } from '../../ui/sound';
import { topicNodeUuid } from '../course/Composing';
import { rgba, whisper } from '../course/shared';
import { createForge } from './forge-store';
import { type ForgeMix, type ForgeSize, MIX_LABEL, SIZE_LABEL } from './pools';

const SIZES: ForgeSize[] = [10, 20, 40];
const MIXES: ForgeMix[] = ['recall', 'problem', 'balanced', 'wobo'];
const MAX_PICKS = 8;

export function ForgeBuilder({ onForged }: { onForged: (id: string) => void }) {
  const { completed, topicProgress } = useProgress();
  const { publishPage } = useWoboBus();
  const reduced = useReducedMotion();
  const [picks, setPicks] = useState<string[]>([]);
  const [size, setSize] = useState<ForgeSize>(20);
  const [mix, setMix] = useState<ForgeMix>('balanced');
  const [binding, setBinding] = useState(false);

  const pickable = useMemo(
    () => (id: string) => completed.has(id) || (topicProgress[id] ?? 0) > 0,
    [completed, topicProgress],
  );

  // the chapters worth showing — only subjects/chapters the learner has actually stepped into
  const groups = useMemo(() => {
    const out: {
      subjectId: string;
      name: string;
      chapters: { name: string; topics: Topic[] }[];
    }[] = [];
    for (const subject of subjects) {
      const chapters = (chaptersBySubject[subject.id] ?? [])
        .filter((c) => c.topics.some((t) => pickable(t.id)))
        .map((c) => ({ name: c.name, topics: c.topics }));
      if (chapters.length > 0) out.push({ subjectId: subject.id, name: subject.name, chapters });
    }
    return out;
  }, [pickable]);

  // Wobo's suggestion — a topic the learner recently slipped on that isn't in the stack yet
  const suggestion = useMemo(() => {
    const slipNodes = new Set(loadMind().slips.map((s) => s.nodeId));
    for (const g of groups) {
      for (const c of g.chapters) {
        for (const t of c.topics) {
          if (!pickable(t.id) || picks.includes(t.id)) continue;
          if (slipNodes.has(topicNodeUuid(t.id)) || (t.nodeId && slipNodes.has(t.nodeId))) return t;
        }
      }
    }
    return null;
  }, [groups, picks, pickable]);

  const toggle = (id: string) =>
    setPicks((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_PICKS ? [...p, id] : p,
    );

  // Wobo perceives the builder and can drive it — Wobo's normal action path (component contract §12)
  const stageRef = useRegisterTarget<HTMLDivElement>('forge-builder', {
    kind: 'input',
    label: 'the forge — a custom practice workbook being built',
    getSceneState: () => ({
      picks: picks.map((id) => topicById(id)?.name ?? id),
      size,
      mix,
      canForge: picks.length > 0,
    }),
    getValidActions: () =>
      picks.length > 0
        ? ['forge it', 'change the size', 'let me balance it', 'add a chapter']
        : ['add a chapter you have already touched'],
    applyTutorAction: (patch) => {
      const p = patch as { addTopic?: string; size?: number; mix?: string; forge?: boolean };
      if (typeof p.addTopic === 'string' && pickable(p.addTopic)) toggle(p.addTopic);
      if (p.size === 10 || p.size === 20 || p.size === 40) setSize(p.size);
      if (p.mix && MIXES.includes(p.mix as ForgeMix)) setMix(p.mix as ForgeMix);
      if (p.forge === true && picks.length > 0) forge();
    },
  });

  useEffect(() => {
    publishPage({
      route: 'practice',
      state: { title: 'the forge', intent: 'practice', picks: picks.length, size, mix },
    });
  }, [publishPage, picks.length, size, mix]);

  const forge = () => {
    if (picks.length === 0 || binding) return;
    setBinding(true);
    sfx.reward(); // the bind — pages snap into one book, a bright earned tone
    const names = picks.map((id) => topicById(id)?.name ?? id);
    const title = names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`;
    const id = createForge({ title: title ?? 'practice', picks, pickNames: names, size, mix });
    // let the bind animation breathe, then hand off to the shelf where it downloads in
    window.setTimeout(() => onForged(id), reduced ? 0 : 620);
  };

  const hue = picks.length > 0 ? hueForTopic(picks[0] ?? '') : 'var(--pig)';

  return (
    <div
      ref={stageRef}
      style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}
    >
      {/* the picker — only what you've touched */}
      <div style={{ flex: '1 1 340px', minWidth: 0 }}>
        {groups.length === 0 ? (
          <div
            style={{
              padding: '28px 24px',
              border: '0.5px dashed var(--wobo-hairline-on-paper-strong)',
              borderRadius: 3,
              color: 'var(--wobo-ink-500)',
              lineHeight: 1.6,
            }}
          >
            nothing to forge from yet. the forge only takes chapters you've already met: learn one
            first, then come back and bind it into a workbook of your own.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {groups.map((g) => (
              <div key={g.subjectId}>
                <div style={{ ...whisper, marginBottom: 10 }}>{g.name.toLowerCase()}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {g.chapters.map((c) => (
                    <div key={c.name}>
                      <div
                        style={{
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          color: 'var(--wobo-ink-700)',
                          marginBottom: 8,
                        }}
                      >
                        {c.name}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {c.topics.map((t) => {
                          const can = pickable(t.id);
                          const on = picks.includes(t.id);
                          const th = hueForTopic(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              disabled={!can || (!on && picks.length >= MAX_PICKS)}
                              onClick={() => toggle(t.id)}
                              title={
                                can ? undefined : "you haven't met this one yet. learn it first"
                              }
                              style={{
                                padding: '8px 13px',
                                fontFamily: 'inherit',
                                fontSize: '0.88rem',
                                borderRadius: 999,
                                cursor: can ? 'pointer' : 'not-allowed',
                                color: can ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-300)',
                                border: on
                                  ? `1px solid ${th}`
                                  : '0.5px solid var(--wobo-hairline-on-paper-strong)',
                                background: on ? rgba(th, 0.12) : 'var(--wobo-paper)',
                                opacity: can ? 1 : 0.55,
                                transition:
                                  'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              {on && <span style={{ color: th, fontWeight: 700 }}>✓</span>}
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the growing workbook + the controls */}
      <div
        style={{
          flex: '0 1 320px',
          minWidth: 260,
          position: 'sticky',
          top: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* the stack of pages, binding on forge */}
        <div
          style={{ position: 'relative', minHeight: 168, display: 'grid', placeItems: 'center' }}
        >
          <AnimatePresence mode="popLayout">
            {picks.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  width: 148,
                  height: 168,
                  borderRadius: 4,
                  border: '0.5px dashed var(--wobo-hairline-on-paper-strong)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--wobo-ink-300)',
                  fontSize: '0.82rem',
                  textAlign: 'center',
                  padding: 16,
                }}
              >
                your workbook grows a page with each pick
              </motion.div>
            ) : (
              picks.map((id, i) => (
                <motion.div
                  key={id}
                  layout
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16, rotate: -6 }}
                  animate={
                    binding
                      ? { opacity: 1, y: 0, x: 0, rotate: 0 }
                      : reduced
                        ? { opacity: 1 }
                        : {
                            opacity: 1,
                            y: i * -3,
                            x: i * 3,
                            rotate: (i % 2 === 0 ? 1 : -1) * (1 + i * 0.4),
                          }
                  }
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{
                    type: 'spring',
                    stiffness: binding ? 520 : 320,
                    damping: binding ? 30 : 24,
                  }}
                  style={{
                    position: 'absolute',
                    width: 148,
                    height: 168,
                    borderRadius: 4,
                    background: 'var(--wobo-card)',
                    border: `0.5px solid ${rgba(hueForTopic(id), 0.5)}`,
                    borderLeft: `3px solid ${hueForTopic(id)}`,
                    padding: '14px 14px 14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    zIndex: i,
                  }}
                >
                  <div style={{ ...whisper }}>page {i + 1}</div>
                  <div
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: 560,
                      color: 'var(--wobo-ink-900)',
                      lineHeight: 1.35,
                    }}
                  >
                    {topicById(id)?.name}
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* size */}
        <div>
          <div style={{ ...whisper, marginBottom: 8 }}>how long</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                style={segStyle(size === s, hue)}
              >
                <span style={{ fontWeight: 600 }}>{s}</span>
                <span style={{ ...whisper, marginTop: 2 }}>{SIZE_LABEL[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* mix */}
        <div>
          <div style={{ ...whisper, marginBottom: 8 }}>the balance</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MIXES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMix(m)}
                style={segStyle(mix === m, hue, true)}
              >
                {MIX_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Wobo's suggestion — Wobo's normal action path, offered as a tap */}
        <AnimatePresence>
          {suggestion && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={() => toggle(suggestion.id)}
              style={{
                textAlign: 'left',
                padding: '11px 14px',
                borderRadius: 3,
                border: `0.5px solid ${rgba('var(--pig)', 0.4)}`,
                background: 'var(--wobo-ultramarine-soft)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'var(--wobo-ink-900)',
                fontSize: '0.86rem',
                lineHeight: 1.5,
              }}
            >
              <span style={{ ...whisper, color: 'var(--wobo-ultramarine)' }}>Wobo</span>
              <div style={{ marginTop: 3 }}>
                you slipped on “{suggestion.name}” lately. add it to the forge?
              </div>
            </motion.button>
          )}
        </AnimatePresence>

        {/* the forge button */}
        <motion.button
          type="button"
          disabled={picks.length === 0 || binding}
          onClick={forge}
          whileTap={picks.length > 0 ? { scale: 0.98 } : undefined}
          style={{
            padding: '15px 20px',
            borderRadius: 3,
            border: 'none',
            cursor: picks.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            fontSize: '1rem',
            fontWeight: 600,
            color: picks.length === 0 ? 'var(--wobo-ink-300)' : 'var(--wobo-on-ink)',
            background: picks.length === 0 ? 'var(--wobo-tonal)' : 'var(--wobo-ultramarine)',
            transition: 'background 0.2s ease, color 0.2s ease',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {binding
            ? 'binding…'
            : picks.length === 0
              ? 'pick a page to begin'
              : `forge · ${size} items`}
          {picks.length > 0 && !binding && <ChevronIcon size={14} />}
        </motion.button>
      </div>
    </div>
  );
}

function segStyle(active: boolean, hue: string, single = false): React.CSSProperties {
  return {
    flex: 1,
    padding: single ? '10px 8px' : '10px 6px',
    // the 44 px hit-area law (DESIGN.md §0): the chips measured 156x42 at 390 and 1440
    minHeight: 44,
    boxSizing: 'border-box',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.82rem',
    color: active ? 'var(--wobo-ink-900)' : 'var(--wobo-ink-500)',
    border: active ? `1px solid ${hue}` : '0.5px solid var(--wobo-hairline-on-paper-strong)',
    background: active ? rgba(hue, 0.1) : 'var(--wobo-paper)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
  };
}
