/**
 * @wobo/wobo — the signature tutor (docs/02-DESIGN/02-wobo.md) and Wobo's connected presence.
 *
 * Wobo's identity is LOCKED and encoded in `identity.ts` (asserted by tests). Wobo's choreography is free
 * (the Wobo-cute license). The context bus + action layer make every page a canvas Wobo is plugged
 * into: Wobo perceives the app's own state (never a screen-share) and can draw on it and act in it.
 */

export * from './actions';
// The answer kinds — every interactive way a learner answers (WOBO-PLAN.md §16).
export * from './answers';
// The board — Wobo's hand and its three presentations (docs/BOARD.md).
export * from './board';
// The wait — the orb doing the subject's thing while the thing arrives, and the geometry of every
// scene in one pure place (docs/EMAILS-AND-ANIMATIONS.md §3, docs/THE-WAIT.md §1).
export * from './body/wait';
export * from './body/WaitScene';
export * from './body/WoboBody';
// The boot loader (the loader IS the character, WOBO-PLAN §16) and the living wordmark.
export * from './body/WoboLoader';
export * from './body/WoboWordmark';
export * from './context-bus';
export * from './focus';
export * from './gesture';
// The glass — the map the brain plans from and the hold that keeps it still (docs/INK-FREEZE-PLAN-TRACE.md).
export * from './glass';
export * from './identity';
export * from './packet';
export * from './registry';
export * from './scroll-hold';
