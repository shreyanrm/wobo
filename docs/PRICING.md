# Pricing — the canonical table

One place where every price is stated, so the plans page, the checkout, the gift page, the donate
page and the meter cannot drift from one another. Changing a number here is changing it everywhere;
changing it anywhere else is a bug.

## The rule

**A year costs ten months.** The yearly price is shown per month, because that is how a family
compares it, and the real charge is stated underneath as the annual total. Nothing else about a plan
changes with the period: a plan buys more questions in a day and never a capability, and a
subscription covers exactly one learner on every plan and every period.

## The table

| Plan | Period  | Shown per month | Billed            | Per month, elsewhere | Billed, elsewhere |
|------|---------|-----------------|-------------------|----------------------|-------------------|
| Free | —       | ₹0              | never             | $0                   | never             |
| Pro  | Monthly | ₹1,999          | ₹1,999 monthly    | $20                  | $20 monthly       |
| Pro  | Yearly  | ₹1,666          | ₹19,992 annually  | $16.67               | $200 annually     |
| Max  | Monthly | ₹3,999          | ₹3,999 monthly    | $50                  | $50 monthly       |
| Max  | Yearly  | ₹3,333          | ₹39,996 annually  | $41.67               | $500 annually     |

Yearly against twelve monthly payments: Pro saves ₹3,996 a year, Max saves ₹7,992. Both are two
months to within a few rupees, which is why the page may say "two months free" and may not say a
percentage, since a rounded percentage would be a number we cannot show the working for.

**Elsewhere is derived by the same rule**, ten months for twelve: ten times $20 is $200, ten times
$50 is $500, and the per-month figure is the annual total divided by twelve. FOR THE OWNER: the
rupee figures are his (1,666 and 3,333); the dollar figures are derived and are open to being set
differently.

## Where each number is allowed to appear (owner, 2026-09-04)

**The plans page shows the amount and the words, never the total.** Under ₹1,666 it says
"billed annually", in small letters, and nothing else. The annual total is not a selling number; it
is the thing being agreed to, so it appears **at checkout**, where the reader is deciding to pay it
rather than deciding to compare it. The monthly period keeps its own line, "billed monthly", so the
card cannot change height when the switch is used.

| Surface | Shows the per-month amount | Shows the words | Shows the annual total |
|---|---|---|---|
| Plans page | yes | yes | **no** |
| Checkout | yes | yes | **yes, the exact amount and the date of the charge** |
| Gift and Donate | the price for the length chosen | yes | yes, because the whole amount is paid at once |

## What the page does with it

- **Yearly is the default and yearly is listed first.** It is the better deal, and putting the worse
  one in front of it would be the sort of thing this product exists not to do.
- The switch is a two-option control whose indicator only ever translates. Transitioning its width
  would be a layout property animating, which DESIGN.md §0 forbids.
- Every price, every line of small print and the closing sentence read from one choice, so the page
  can never show a yearly price beside a monthly promise.
- Where someone is reading from is inferred from the browser time zone and never asked.

## What depends on it

| Surface | What it takes |
|---|---|
| `screens/plans/prices.ts` | every figure above, and the period the page opens on |
| `screens/plans/copy.ts` | the small print that names the period, and the cancel answer |
| `screens/gift/**` and `docs/copy/growth/gift-page.md` | three, six or twelve months of Pro |
| `screens/donate/**` and `docs/copy/growth/donate-page.md` | a month at the monthly price, a term at three monthly, **a year at the YEARLY price** and not at twelve monthly, because that is what a parent pays for a year |
| `services/gateway/.../budget.py` | nothing. The period changes what is charged, never the allowance |

## Still to build

- [ ] The table above, into `screens/plans/prices.ts`, with the period switch on the real page
- [ ] **The annual total onto the checkout screen** (`screens/plans/Checkout.tsx`), stated as the
      exact amount and the date it will be taken. It must not appear on the plans page
- [ ] A subscription record that stores the period, so the cancel screen can say "till the year you
      paid for ends" rather than guessing
