# The daily allowance: a quarter of the plan, a day at a time

**The owner, 2026-09-08:** *"Keep a buffer of 4x: users get at most a quarter of the plan amount
they selected for that month. A ₹2,000 plan gives ₹500 to spend, technically their monthly limit,
but we don't show that anywhere. We only show a bar on their profile page with their daily limit:
500 over 30 is about ₹16-something a day, whether they use it or not; it does not carry forward,
and it resets every day in the learner's own time zone. In the superadmin I decide how generous I
want to be, how much of the plan amount is given, and I want to create promo codes there too. 500
is just a start; we watch the pace."*

## 1. The numbers

| Term | Definition | Example (Pro yearly, ₹19,992 a year) |
|---|---|---|
| plan amount | the price the learner pays per month (a yearly plan's monthly equivalent) | ₹1,666 |
| generosity | the fraction of the plan amount given as model spend; a superadmin setting, **default 0.25** | 0.25 |
| monthly allowance | plan amount x generosity; **never shown to a learner** | ₹416.50 |
| daily allowance | monthly allowance / days in the learner's current month | ₹13.88 (30 days) |
| the day | midnight to midnight in the learner's time zone (`family_local` already knows it; the device's zone for a learner with no family record) | Asia/Kolkata |
| spend | the ledger's actual cost of every metered call the learner made today, in USD, converted at the superadmin's INR rate | from `ops.model_calls` |
| the free plan | a superadmin setting in paise per day, **default ₹5** (about seventy luna turns) | ₹5.00 |

Nothing carries forward. An unused day is gone. The month's total is a ceiling that exists only in
arithmetic; the learner sees one bar.

## 2. What the learner sees

One bar on the You page, under the plan: **"Today"**, filled by today's use against today's
allowance, with one line underneath: "Refills overnight." (The owner, 2026-09-16: the clock law
wins, so no hour is named on a learner's screen; the day is still the learner's own, midnight to
midnight in their zone, and the refusal carries that moment on the wire.) **No money anywhere at the learner's end,
and not at the parent's either** (the owner, 2026-09-08: "it's not money based at the users' end;
that is only for internal purposes"). The rupees exist in the gateway's arithmetic and on the
superadmin's pace desk, and nowhere else. When the bar is full, Wobo says the same honest line the
question counter says today, and the lesson already on screen stays; nothing already generated is
taken away. Never a number for the month, never the word "budget", never the generosity fraction.

## 3. What the superadmin sees (the console, `desks_api.py`)

- **Generosity**: the fraction, per plan (Pro, Max) and the free daily paise, with the effect shown
  live ("a Pro learner gets ₹13.88 a day") before it is saved; every change is an audit row.
- **The INR rate** for converting the ledger's USD, with the date it was set.
- **The pace**: today's spend against today's allowance across all learners; how many hit the bar
  and at what hour of their day; the median fraction used. This is how the owner "watches the pace".
- **Promo codes**: create, list, disable. A code has a kind (days of a plan free; extra allowance
  for N days; a percentage off the first payment), a value, an expiry, a use limit, once per account,
  and an audit trail of who redeemed it. Redeemed at checkout (a field on the checkout card) or on You.

## 4. What changes in the code

1. **A money meter beside the counters** (`budget.py`, `spend.py`, `ledger.py`): the daily allowance
   in paise per learner per local day, debited from the ledger's cost per call as it lands; the
   existing turn, generation and voice counters stay as abuse caps far above it (a hundred turns a
   day is a bot, not a child). The meter is the limit a learner meets first.
2. **Settings** (`ops.settings`, migration): generosity per plan, free daily paise, the INR rate,
   with `updated_by` and an audit row; read by the gateway with a short cache; changed in the console.
3. **Promo codes** (`ops.promo_codes`, `ops.promo_redemptions`, migration): the shape in section 3;
   the gateway validates and applies at checkout (`billing/payments.py`) and the You redeem door.
4. **The You bar** (`screens/you/PlanPanel.tsx`): the bar, the reset line, the register.
5. **The console desk**: generosity, the rate, the pace, promo codes.
6. **The time zone**: the learner's zone from the profile (the Sunday-note path already resolves a
   family's zone); the device's zone as the fallback, sent on the first request of the day; the day
   boundary computed server-side, never trusted from the client for the debit.

## 5. Decisions taken so nothing waits; say the word to change any

- The free plan's ₹5 a day.
- Money is internal only: no currency on any learner or parent surface; the bar is the only thing shown.
- The counters stay as abuse caps rather than being deleted.
- Generosity is per plan, so Max can be more generous than Pro later without a deploy.

## Creative work is never on the allowance (owner, 2026-09-08)

*"I don't want to charge the users; bill them only for content and usage."* A learner's daily
allowance counts what is served to that learner: turns, voice, a read page, and the rendering of a
level for their board and grade. The creative layer (`create.core`: concept cores, interaction
design, film choreography, on the create tier) is the platform's cost, marked
`registry.PLATFORM_PAID`, booked to the creative pool on the models desk with its own cap, and
never subtracted from anyone's day. The allowance code asks `registry.platform_paid(capability)`
before it counts anything.

## Who pays for what (owner, 2026-09-08, the second ruling)

*"I don't want to pay for most of it or the generation of internal content, because we are saying
we will keep teaching until they understand, and we aren't the ones paying for that."*

| what | paid by | why |
|---|---|---|
| the blueprint of a topic (`create.blueprint`) and a concept's core (`create.core`), Astra, once per topic, board, grade, version, then cached for every learner | **the platform's creative pool** | made once, shared by everyone, the quality of the brand |
| rendering a level for a cell the first time (`engine.compose`, `engine.simulate`, the films) | **the learner whose ask triggered it**; the cache serves the next learner of that cell for nothing | content the learner asked for; the store makes it nearly free after the first |
| every turn, every re-explanation, every "again", the voice, a read page, the free-text-goal course | **the learner's allowance** | teaching until they understand is usage, and the plan buys usage |

So the platform's share is small and bounded (the creative pool's cap), and "keep teaching until they
understand" is paid by the plan, which is what a plan is for.

**The creative pool warns and never stops (the owner, 2026-09-16).** At 50, 80 and 100 percent of
its daily cap the owner is told. At 100 it does not refuse work, because halting `create.core`
mid-authoring would leave half-made content behind. The owner closes it by hand from the console
if they choose. The free pool is the one that closes on its own.

## The free tier: five rupees a day, on Luna (owner, 2026-09-08)

- Free is **5 rupees a day** by default (a dial on the console, applied live).
- A free learner's turns run on the **free lane**: `routing.lane_tier` steps `turn` down to `tiny`
  (Luna), so five rupees is roughly three hundred short turns instead of thirty. Paid plans run
  turns on Terra.
- **Quality is not where the lane is.** The blueprint, the cores, the films and the mechanics a
  free learner gets are the same Astra-made, judged, cached work a paid learner gets; verify,
  safety, voice, vision and never-narrate are identical; the cost rule still escalates a rejected
  answer. What free buys less of is depth per turn and turns per day, never a wrong answer.
- Money is never shown to a learner or a parent; the bar in the profile is the only trace.

## Best of both worlds: quality is shared, quantity is sold (owner, 2026-09-08)

*"I don't want free users to get low quality content and not be impressed and not upgrade. We should
absolutely impress them on free, but I can't keep giving free service out of goodwill and pay from my
pocket. We need the best of both worlds."*

The rule that gives both:

1. **Everything impressive is made once and shared.** The blueprint, the concept cores, the mechanics,
   the films, the loading scenes, the ink choreography: Astra-made, judged, cached, and served to a free
   learner exactly as to a paid one. Its cost is the platform's, paid once, and spread over every
   learner who ever opens that cell; per learner it rounds to nothing. Free is never a worse Wobo.
2. **What a plan buys is more of Wobo, never a better Wobo.** Free is five rupees of live tutoring a
   day, on Luna, which is about three hundred short turns, far more than a twenty-minute session uses.
   A paid plan buys a bigger day, Terra behind the turns for deeper explanations, more voice, more
   photographed doubts, offline downloads, and the parent's account. The bar in the profile shows a day
   running out, and the upgrade is more time with Wobo, not the real Wobo.
3. **Never a degraded answer.** When the day is spent, Wobo says one kind line and offers tomorrow or
   more, never a thinner answer. A bad answer costs the brand more than a refused one.
4. **The owner's exposure is bounded twice.** Per learner by the daily allowance (a free learner who
   uses every rupee costs at most 150 rupees a month, and most use a fraction), and in total by a
   **free pool cap** on the console: the day's spend on free learners, with a dial and an alert, so
   growth cannot outrun the money. A cohort dial lets the owner change free learners' generosity by
   age of account (for instance a smaller day after sixty days without upgrading), off by default.
5. **What it costs, in numbers:** a Luna turn is about 0.0007 USD; a heavy free session of thirty
   turns is about 2 rupees; the creative pool is a one-time cost per cell. The console shows free
   learners' spend against the free pool every day, so the owner sees the goodwill in rupees, not in
   surprises.
