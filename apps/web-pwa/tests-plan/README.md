# The cancel, proved in a browser

The plans page prints "You → Your plan → Cancel. Two taps, no call, no 'are you sure' maze."
`src/screens/you/plan.test.ts` proves that over the model; this proves it over the real app.

It cannot live in `tests/`. That suite is deliberately **hermetic** — its `global-setup.ts` fails
the run if the page reaches any origin but its own, and its dev server is started with
`VITE_GATEWAY_URL=` so nothing can. A cancel has no meaning without a brain to cancel against, so
this suite starts its own dev server pointed at an address nothing is listening on and answers
every gateway call with `page.route`. Same browser, same app, stubbed brain.

    cd apps/web-pwa && bun run test:e2e:plan

It runs in CI, in the `e2e` job, beside the journey suite — it used to run only from this file, by
hand, which left the product's one door out as the only flow with no watched proof.

What it holds:

* one tap on the panel reaches the confirmation, a second finishes the cancel, and the dialog
  offers exactly two buttons;
* focus enters the dialog, Tab cycles inside it and never leaves, Escape closes it and focus lands
  back on the Cancel control;
* a refused cancel (503) leaves the plan reading **active**, with the date it runs to and its
  Cancel still there, and says so in an `alert` — and the retry after it lands;
* 390 / 834 / 1440, light and dark: `scrollWidth === clientWidth`, and no console error that the
  test did not itself stage.

Screenshots land in `tests-plan/shots/` and are not committed.
