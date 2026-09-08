'use client';

/**
 * Which surface the lesson shows Wobo's board on — the three chips at the top of the lesson screen
 * (design/prototypes/app-v1.html, board 03): the full board, the plane card, or the notes.
 *
 * The lesson screen owns the choice and the plane card's canvas; the stage (wobo/Stage.tsx) owns
 * the board itself and the props it needs. This store is the seam between them: the screen says
 * which view is on and hands over the canvas element, and the stage puts the board there — full
 * screen, or portalled into the canvas. Neither imports the other.
 */

import { useSyncExternalStore } from 'react';

export type LessonView = 'full' | 'plane' | 'notes';

export interface LessonViewState {
  view: LessonView;
  /** The plane card's canvas, where the inline board lands. Null when no lesson is on screen. */
  host: HTMLElement | null;
  /**
   * The learner put this board away (Escape, or "close the board"). Wobo's next turn brings it
   * back, because dismissing is for this board and not for lessons.
   *
   * It lives here rather than in `LessonBoard`'s own `useState` so that anything can reach it. As
   * a local state it could only be set by the Escape key inside the component, which meant "close
   * the board" said in a lesson called `plane.dismiss()` — a controller that cannot touch the
   * lesson's board — and Wobo said "Put away." over a board still covering the screen.
   */
  dismissed: boolean;
}

const RESTING: LessonViewState = { view: 'plane', host: null, dismissed: false };

class LessonViewStore {
  private state: LessonViewState = RESTING;
  private readonly listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = (): LessonViewState => this.state;

  private set(patch: Partial<LessonViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** The learner picked a chip. */
  view(view: LessonView): void {
    if (this.state.view !== view) this.set({ view });
  }

  /** The lesson screen mounted (or unmounted) its canvas. */
  host(el: HTMLElement | null): void {
    if (this.state.host !== el) this.set({ host: el });
  }

  /** Put the lesson's board away. It stays away until Wobo draws again. */
  dismiss(): void {
    if (!this.state.dismissed) this.set({ dismissed: true });
  }

  /** Wobo is drawing again: the board comes back with the ink on it. */
  show(): void {
    if (this.state.dismissed) this.set({ dismissed: false });
  }

  /** Leaving the lesson: back to the plane, no canvas. */
  reset(): void {
    if (this.state !== RESTING) this.set(RESTING);
  }
}

/** The one lesson view. */
export const lessonView = new LessonViewStore();

export function useLessonView(): LessonViewState {
  return useSyncExternalStore(lessonView.subscribe, lessonView.get, lessonView.get);
}
