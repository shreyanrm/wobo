/**
 * Which screen a person at /parent is shown, and the switch's three small decisions.
 *
 * Plain functions, because each of these is a ruling that breaks silently when it lives in JSX:
 * a student account shown a parent screen, an account made a parent's by accident, a one-child
 * parent shown a chooser with one thing in it. `stage.test.ts` holds each of them.
 */

import type { MeAnswer, ParentChild } from './api';

export type Stage =
  /** Nobody is signed in (or only an anonymous session is): the parent's door. */
  | 'door'
  /** Signed in, and the server has not answered yet. */
  | 'checking'
  /** Signed in, not a parent account yet, and the parent's door was the one pressed. */
  | 'joining'
  /** A parent account. */
  | 'home'
  /** A student account. It is sent to its own app and shown nothing here. */
  | 'learner'
  /** The dial is closed (docs/DOORS-CLOSED.md). */
  | 'closed'
  | 'trouble'
  /** This build has no gateway, so it has no parent side. */
  | 'unwired';

export interface StageInput {
  /** A real session: not an anonymous one, which is a stranger with a budget. */
  signedIn: boolean;
  /** The server's answer, or null while it is on its way. */
  me: MeAnswer | null;
  /** The parent's door was pressed on this device before this session began. */
  intent: boolean;
}

export function stageFor({ signedIn, me, intent }: StageInput): Stage {
  if (!signedIn) return 'door';
  if (me === null) return 'checking';
  switch (me.kind) {
    case 'parent':
      return 'home';
    case 'not-parent':
      // The only way an account becomes a parent's is somebody pressing the parent's door. A
      // signed-in student who typed /parent is not asking to become one, and is shown nothing.
      return intent ? 'joining' : 'learner';
    case 'signed-out':
      return 'door';
    case 'closed':
      return 'closed';
    case 'trouble':
      return 'trouble';
    case 'unwired':
      return 'unwired';
  }
}

/** The switch is drawn only when there is something to switch between. */
export function showsSwitcher(children: readonly ParentChild[]): boolean {
  return children.length > 1;
}

/**
 * The child to select without asking, or null. Exactly one live child and no live selection means
 * there is nothing to choose, so the parent is never asked. Two or more is always the parent's
 * choice, never ours.
 */
export function chooseFor(
  children: readonly ParentChild[],
  selected: string | null,
): string | null {
  if (children.length !== 1) return null;
  const only = children[0] as ParentChild;
  return selected === only.learnerId ? null : only.learnerId;
}

/** The child on screen: the server's selection, when it is one of the live children. */
export function current(
  children: readonly ParentChild[],
  selected: string | null,
): ParentChild | null {
  if (!selected) return null;
  return children.find((c) => c.learnerId === selected) ?? null;
}
