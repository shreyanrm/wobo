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
 * The root carries this while the plane is a SHEET across a phone's screen — which is where every
 * board built from scratch is drawn at 390 (`packages/wobo/src/board/plane.tsx`, SHEET_ATTRIBUTE).
 * Re-declared here rather than imported so this file reads as one doctrine; the test holds the two
 * to the same string.
 */
export const SHEET_UP = 'data-wobo-sheet';

/** How tall Wobo's keeper bar is, so a scroll surface can keep it clear as well as the sheet. */
export const KEEPER_HEIGHT = '60px';

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
/* AND THE SHEET KEEPS ITS OWN KEEPER BAR CLEAR (the adversary, wave 49, finding 6).
   "save to notes" is docked to the foot of the screen, which on a laptop is beside the plane and
   on a phone is INSIDE it: at 390 it sat over the Punnett's 'recessive 1'. Moving the bar only
   moves the problem — lifted above the sheet it covered the say instead, which has a law of its
   own (screens/chat/chat.css). So the BOARD gives the bar its band: the sheet's canvas ends above
   it, the drawing is laid out in what is left, and no mark is ever put where the bar stands.
   Nothing is hidden and nothing is unreachable. */
@media (max-width: 900px){
[${SHEET_UP}] .wobo-chrome-sheet > .wobo-chrome-canvas{margin-bottom:calc(12px + ${KEEPER_HEIGHT})}
}
`;
