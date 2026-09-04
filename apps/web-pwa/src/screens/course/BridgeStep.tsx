'use client';

/**
 * THE BRIDGE, ON SCREEN. One card, in front of the lesson it is the run-up to.
 *
 * There is one renderer for it and this is it, because there are two players: the composed course
 * (`Composing`) and the atom journey (`AtomJourney`). Only the first of them ever laid a bridge,
 * and the atom is the one topic in the product with verifier-frozen practice items, which is the
 * only place the placement check can ask a real checked question rather than a self report. So the
 * single topic where the check had teeth was the single topic where the bridge never appeared.
 *
 * What this card does, and what it deliberately does not:
 *
 *   the steps are STEPS. They were folded into one string with newlines and rendered through a
 *   style that sets no `white-space`, so the browser collapsed every one of them and the bullets
 *   ran together as a paragraph. Each step is an element here, with its own name and its own words.
 *
 *   the prompt asks for the tap that exists. It used to say "Tap the step you are least sure of"
 *   while the steps were inside a text blob and the only control was Check.
 *
 *   nothing is awarded for reading it. The bridge card used to pay 15 XP for pressing Check, which
 *   is the composed-course reward for finishing an idea. Reading the ground under a topic is not
 *   an achievement, and paying for it teaches a child that the tap is the point.
 *
 *   a seeded bridge says so. When the engine had nothing to offer, the steps are the local outline
 *   and the card does not pretend they are a lesson.
 */

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { BridgeLesson } from '../../wobo/bridge';
import { bridgeCard } from '../../wobo/bridge';
import { type BarState, CardBody, cardTitle, lead, whisper } from './shared';

export interface BridgeStepProps {
  lesson: BridgeLesson;
  /** The topic's hue, for the quiet rule down the side of the arrival line. */
  hue: string;
  setBar: (bar: BarState) => void;
  /** The learner is ready: the lesson itself begins. */
  onDone: () => void;
}

export function BridgeStep({ lesson, hue, setBar, onDone }: BridgeStepProps) {
  const card = bridgeCard(lesson);
  const [arrived, setArrived] = useState(false);

  // Two beats, and neither of them is graded: read the ground, then step into the topic.
  useEffect(() => {
    setBar(
      arrived
        ? { primary: { label: 'Start the lesson', onClick: onDone } }
        : { primary: { label: 'Ready', onClick: () => setArrived(true) } },
    );
  }, [arrived, setBar, onDone]);

  return (
    <CardBody maxWidth={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={whisper}>the ground first</div>
        <div style={cardTitle}>{card.title.toLowerCase()}</div>
        <div style={lead}>{card.idea}</div>

        <ol
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            margin: 0,
            paddingLeft: 20,
          }}
        >
          {card.steps.map((step) => (
            <li key={`${step.title}|${step.idea}`} style={{ ...lead, margin: 0 }}>
              {step.title && <b>{step.title.toLowerCase()}</b>}
              {step.title && step.idea ? '. ' : null}
              {step.idea}
            </li>
          ))}
        </ol>

        <div style={{ ...lead, borderLeft: `2px solid ${hue}`, paddingLeft: 14 }}>
          {card.prompt}
        </div>

        {arrived && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            style={{
              background: 'var(--wobo-feedback-correctSoft)',
              border: '1px solid var(--wobo-feedback-correct)',
              borderRadius: 3,
              padding: '14px 16px',
              lineHeight: 1.6,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {card.reveal}
          </motion.div>
        )}
      </div>
    </CardBody>
  );
}
