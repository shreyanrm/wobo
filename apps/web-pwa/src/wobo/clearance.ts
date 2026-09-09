/**
 * WOBO'S OWN FURNITURE GETS OUT OF THE INK'S WAY (docs/INK-FREEZE-PLAN-TRACE.md §3, Trace).
 *
 * The adversary's lab (2026-09-08, finding 15) watched a phone at 390: the "Your course is ready"
 * toast and the Tell Wobo pill sat over the folded strip and over the page for every turn, and at
 * the end the sheet unfolded modal over the very marks the question was about. The ink is the
 * point of the turn, so for as long as Wobo's ink is on the screen, everything of Wobo's that
 * floats over the page stands aside; it comes back the moment the ink goes.
 *
 * The toast keeps its box and its `aria-live` region — it fades rather than being hidden — so a
 * course that finishes composing mid-turn is still announced to a learner who cannot see it. The
 * pill is a control with nothing to announce, and it hides outright (`ui/FlagControl.tsx`).
 */

/** The root carries this while any of Wobo's marks are on the screen. `WoboStage` sets it. */
export const INK_ON_SCREEN_ATTRIBUTE = 'data-wobo-ink';

/** The root carries this while the glass is held for a turn (`packages/wobo/src/glass/hold.ts`). */
export const GLASS_HELD = 'data-glass-held';

/**
 * The clearance, as CSS. Mounted beside the ink surface itself, so the rule and the layer it
 * protects live in one place (`wobo/Stage.tsx`).
 *
 * IT IS KEYED ON THE TURN, NOT ONLY ON THE INK (the adversary, 2026-09-09, finding 14). Wave 40
 * keyed it on marks already being on the screen — so the turns that most needed the page clear,
 * the ones that drew nothing, were exactly the turns it never fired on. The toast sat at full
 * opacity over the card's bottom rows and over the "Start the course" button on every live course
 * turn. The freeze is taken before the deciding read now (AppRuntime `ask`), so the held attribute
 * is on the root for the whole of a turn whether or not any ink ever lands, and the rule fires
 * while the problem is happening rather than after it has gone.
 */
export const INK_CLEARANCE_CSS = `
[${INK_ON_SCREEN_ATTRIBUTE}] [data-wobo-toast],[${GLASS_HELD}] [data-wobo-toast]{opacity:0;pointer-events:none}
[${INK_ON_SCREEN_ATTRIBUTE}] [data-wobo-toast],[${GLASS_HELD}] [data-wobo-toast]{transition:opacity 160ms cubic-bezier(0.2,0,0,1)}
@media (prefers-reduced-motion: reduce){
[${INK_ON_SCREEN_ATTRIBUTE}] [data-wobo-toast],[${GLASS_HELD}] [data-wobo-toast]{transition:none}
}
`;
