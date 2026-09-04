/**
 * How a subject's chapters are shown — the ledgered list, or the adventure roadmap.
 * One preference, remembered on device (owner: wobo-view-pref-v1). SubjectScreen honors it and
 * the You page + an in-page toggle both write it.
 */

export type SubjectView = 'list' | 'adventure';

const KEY = 'wobo-view-pref-v1';

export function loadViewPref(): SubjectView {
  try {
    return localStorage.getItem(KEY) === 'adventure' ? 'adventure' : 'list';
  } catch {
    return 'list';
  }
}

export function saveViewPref(v: SubjectView): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // storage unavailable — the choice lives for this session via component state
  }
}
