'use client';

/**
 * One conversation, two presentations (DESIGN.md §4): the home front door and the docked orb
 * share this context — Wobo never forgets who the learner is between the two.
 */

import type { FocusObject, WoboMood } from '@wobo/wobo';
import { createContext, useContext } from 'react';
import type { DoubtPacket } from '../screens/doubt/flow';
import { scoped } from '../store/scope';
import type { TurnExtras } from './paths/types';

export interface ChatTurn {
  id: string;
  role: 'user' | 'wobo';
  text: string;
  /** What the turn carries beyond prose — a path result (component / viz / action / route). */
  extras?: TurnExtras;
}

/** How a turn is asked. Everything here is about whose words the transcript records. */
export interface AskOptions {
  /**
   * WOBO IS ASKING ITSELF, and the learner never typed this.
   *
   * The re-teach ladder asks for a second explanation on the learner's behalf. Written as an
   * ordinary turn, that put a sentence the child never said into their permanent archive
   * ("draw multiplication of fractions on the board so I can see it"), twice per stuck concept, and
   * a child scrolling their own conversation later found requests they never made. Silent sends the
   * same text to the model and shows the same answer, and records no learner bubble for it. The
   * mode palette stays loud, because a mode is a button the child pressed.
   */
  silent?: boolean;
  /**
   * THE LEARNER IS ASKING ABOUT A PHOTO (screens/doubt). The confirmed reading and the regions
   * the brain found ride the turn's payload under `doubt`, and the turn always streams: the ink
   * has to land on the photo's registered regions inside the sentences about them (the owner's
   * law, wobo/doubt-surface.ts `checkBeats`), which only the board wire can do.
   */
  doubt?: DoubtPacket;
}

export interface WoboChat {
  turns: ChatTurn[];
  /** Wobo reasons over the page Wobo is plugged into, then speaks and acts on it. */
  ask: (text: string, options?: AskOptions) => Promise<void>;
  busy: boolean;
  mood: WoboMood;
  setMood: (mood: WoboMood) => void;
  /** The conversation never ends — older turns wait beyond what is loaded. */
  hasOlder: boolean;
  /** WhatsApp-style: pull the previous page of the archive in above the current view. */
  loadOlder: () => void;
  /** Patch a turn's extras (approval outcomes, action results) — in memory and in the archive. */
  updateTurn: (id: string, patch: (extras: TurnExtras) => TurnExtras) => void;
  /** No connection right now — every composer reflects the same offline truth. */
  offline: boolean;
  /** Messages typed while offline, held here (not yet real turns) until reconnect drains them. */
  pending: { id: string; text: string }[];
  /**
   * What the learner last circled, selected, long-pressed or drew. Every composer reads it, so the
   * modes that only mean something with a thing in hand appear exactly when there is one.
   */
  focus: FocusObject | null;
}

// ---- the never-ending archive ----------------------------------------------------------------
// One conversation for life, append-only, local-first. Only a tail is ever held in memory or
// sent to the model — the archive is for the learner to scroll, not for Wobo to re-read.

// Scoped to the signed-in subject (store/scope.ts): a shared device must never show one learner
// the other's conversation, and sign-out takes the transcript with it.
const ARCHIVE_KEY = 'wobo-archive-v1';
const ARCHIVE_CAP = 2000; // ponytail: localStorage quota guard; move to IndexedDB if anyone outgrows it
export const CHAT_PAGE = 40;

/**
 * A turn's id — minted here, once, for every turn that enters the conversation. Never derived from
 * the archive's length: the archive is CAPPED, so past the cap that counter stops moving and every
 * new turn is minted "t2000-user" again. Two turns with one id means updateTurn patches the wrong
 * bubble (an approval outcome landing on someone else's card) and React renders duplicate keys.
 */
export function mintTurnId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // no secure context (a LAN dev build over http) — still unique enough for one conversation
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function readArchive(): ChatTurn[] {
  try {
    const a = JSON.parse(scoped.getItem(ARCHIVE_KEY) ?? '[]');
    return Array.isArray(a) ? (a as ChatTurn[]) : [];
  } catch {
    return [];
  }
}

export function writeArchive(turns: ChatTurn[]): void {
  try {
    scoped.setItem(ARCHIVE_KEY, JSON.stringify(turns.slice(-ARCHIVE_CAP)));
  } catch {
    // storage unavailable — the conversation lives for this session only
  }
}

export function appendToArchive(turn: ChatTurn): void {
  const a = readArchive();
  a.push(turn);
  writeArchive(a);
}

/** Rewrite one archived turn in place (outcome recorded on a card, an action's result line). */
export function updateArchiveTurn(id: string, patch: (turn: ChatTurn) => ChatTurn): void {
  writeArchive(readArchive().map((t) => (t.id === id ? patch(t) : t)));
}

const Ctx = createContext<WoboChat | null>(null);
export const WoboChatProvider = Ctx.Provider;

export function useWoboChat(): WoboChat {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWoboChat must be used within the app');
  return c;
}
