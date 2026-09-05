/**
 * The learner's local identity — name, grade, board, photo, activity marks, quiet settings.
 * Everything lives under wobo-* keys so "start over" can honestly erase this device.
 * ponytail: localStorage until real profiles sync through KGtoPG identity.
 */

import { loadWorld } from '../../curriculum/world';
import { scoped } from '../../store/scope';

export const PROFILE_KEY = 'wobo-learner-profile';
export const PHOTO_KEY = 'wobo-profile-photo-v1';
const ACTIVITY_KEY = 'wobo-activity-v1';
export const PARENT_KEY = 'wobo-parent-link-v1';
export const VOICE_KEY = 'wobo-voice';
export const SOUND_KEY = 'wobo-ignite-sound';

export interface StoredProfile {
  name: string;
  grade: string;
  boardId: string;
  /** When they were born — a bare year or any date string they gave. Source of truth for age. */
  birthdate?: string;
  /** Derived from birthdate (drives the age-branch); may be stored on older saved profiles. */
  age?: number;
  /** What they're into — folded into Wobo's analogies/examples. */
  interests?: string[];
  /** Durable accessibility profile — rides the dossier so Wobo honors it every turn. */
  largeText?: boolean;
  highContrast?: boolean;
  /** Persistent instruction language — Wobo teaches in this until it's changed. */
  language?: string;
  /** From a signed-in account (Google) — display only; the opaque subject stays in the session. */
  email?: string;
}

/**
 * An untouched device knows nothing. No seeded name, no default class, and above all no default
 * board — the invented world the audit caught started exactly here (WOBO-PLAN §13).
 */
const FALLBACK: StoredProfile = { name: '', grade: '', boardId: '' };

/**
 * Whole-year age from a birthdate — a bare 4-digit year, or any date the browser can parse.
 * Best-effort by design (owner law: take whatever they gave); unparseable input yields undefined,
 * it never rejects the value itself. A full date adjusts for whether this year's birthday passed.
 */
export function ageFromBirthdate(birthdate: string | undefined): number | undefined {
  if (!birthdate) return undefined;
  const s = birthdate.trim();
  const now = new Date();
  const bareYear = /^\d{4}$/.test(s);
  const year = bareYear ? Number(s) : new Date(s).getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > now.getFullYear()) return undefined;
  let age = now.getFullYear() - year;
  if (!bareYear) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const passed =
        now.getMonth() > d.getMonth() ||
        (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate());
      if (!passed) age -= 1;
    }
  }
  return age;
}

export function loadProfile(): StoredProfile {
  try {
    const raw = scoped.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredProfile>;
      return {
        name: p.name?.trim() || FALLBACK.name,
        grade: p.grade || FALLBACK.grade,
        boardId: p.boardId || FALLBACK.boardId,
        birthdate: typeof p.birthdate === 'string' && p.birthdate.trim() ? p.birthdate : undefined,
        // Birthdate is the source of truth; fall back to a stored age on older profiles.
        age: ageFromBirthdate(p.birthdate) ?? (typeof p.age === 'number' ? p.age : undefined),
        interests: Array.isArray(p.interests) ? p.interests : undefined,
        largeText: p.largeText === true,
        highContrast: p.highContrast === true,
        language:
          typeof p.language === 'string' && p.language.trim() ? p.language.trim() : undefined,
        email: typeof p.email === 'string' && p.email.trim() ? p.email.trim() : undefined,
      };
    }
  } catch {
    // unreadable — fall through to the seed learner
  }
  return { ...FALLBACK };
}

/** True only when a learner actually typed a name on this device — never the seed fallback. */
export function hasStoredName(): boolean {
  try {
    const raw = scoped.getItem(PROFILE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as Partial<StoredProfile>;
    return Boolean(p.name?.trim());
  } catch {
    return false;
  }
}

export function saveProfile(p: StoredProfile): void {
  try {
    scoped.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable — session-only profile is fine
  }
}

/**
 * Fold a signed-in account's identity into the local profile — fills gaps only, never overwrites a
 * name the learner chose or a photo they set. localStorage stays the working copy; the account is
 * identity + sync on top (auth is additive). Returns true when the stored profile changed.
 */
export function mergeAccount(acct: { email?: string; name?: string; avatar?: string }): boolean {
  const p = loadProfile();
  let changed = false;
  if (acct.email && p.email !== acct.email) {
    p.email = acct.email;
    changed = true;
  }
  // Name only when the learner has not set one of their own (still the seed fallback).
  if (acct.name && (!p.name || p.name === FALLBACK.name)) {
    p.name = acct.name;
    changed = true;
  }
  if (changed) saveProfile(p);
  // Adopt the Google picture only when there is no photo yet — renderAvatar reads it as-is (a URL).
  if (acct.avatar && !loadPhoto()) savePhoto(acct.avatar);
  return changed;
}

/**
 * The board's own name. The registry is the only place a framework id has a name, so this reads
 * the learner's pinned world and otherwise hands back what it was given — never a guess from a
 * list of boards we happen to ship.
 */
/**
 * The board's name for a learner to read. The pinned world knows its framework's name; a stored
 * id the world does not answer for is never printed raw — a short bare id ("cbse") is a board's
 * initials and is written as such ("CBSE"), and anything longer is left as it was typed.
 */
export function boardName(boardId: string): string {
  const id = boardId.trim();
  if (!id) return '';
  const world = loadWorld();
  return frameworkLabel(world?.frameworkId === id ? world.frameworkName : id);
}

/**
 * A framework's name as a learner reads it, never the raw id.
 *
 * The world is built from whatever named the framework, and onboarding can only pass on the id it
 * was given ("cbse") — so the pinned world's own `frameworkName` is sometimes that id, and a crumb
 * reading "Tuesday · Class 8 · cbse" is the app talking to itself. A bare lowercase id of a board's
 * length is its initials and is written as such; everything else — a real name, a name the learner
 * typed, their own syllabus's id — is left exactly as it was given. Idempotent, so it is safe
 * wherever a name is printed.
 */
export function frameworkLabel(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  return /^[a-z]{2,6}$/.test(s) ? s.toUpperCase() : s;
}

/** Reverse of boardName — a stored board (raw id OR display name) resolved against the world. */
export function resolveBoardId(board: string | undefined): string | undefined {
  const s = board?.trim();
  if (!s) return undefined;
  const world = loadWorld();
  if (world && (world.frameworkId === s || world.frameworkName === s)) return world.frameworkId;
  return s;
}

export function loadPhoto(): string | null {
  try {
    return scoped.getItem(PHOTO_KEY);
  } catch {
    return null;
  }
}

export function savePhoto(dataUrl: string): void {
  try {
    scoped.setItem(PHOTO_KEY, dataUrl);
  } catch {
    // a photo that does not persist is still a photo today
  }
}

function dayString(offset = 0): string {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

/** Mark today as an active day and return the (trimmed) mark list. Today is always marked. */
export function markToday(): string[] {
  let marks: string[] = [];
  try {
    marks = JSON.parse(scoped.getItem(ACTIVITY_KEY) ?? '[]') as string[];
  } catch {
    marks = [];
  }
  const t = dayString();
  if (!marks.includes(t)) marks.push(t);
  marks = marks.slice(-30);
  try {
    scoped.setItem(ACTIVITY_KEY, JSON.stringify(marks));
  } catch {
    // fine
  }
  return marks;
}

/** The last seven days, oldest first — the activity filament. */
export function lastSevenDays(marks: string[]): { day: string; active: boolean }[] {
  const set = new Set(marks);
  return Array.from({ length: 7 }, (_, i) => {
    const d = dayString(6 - i);
    return { day: d, active: set.has(d) };
  });
}

/** Quiet on/off settings — default on. */
export function getFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

export function setFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // fine
  }
}
