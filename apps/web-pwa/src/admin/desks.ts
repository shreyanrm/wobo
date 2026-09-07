/**
 * The desks, and — for each — whether anything in this system can actually source it.
 *
 * Four of the seven have a live supplier: the usage ledger (`ops.usage_daily`, written one row
 * per model call and rolled up per day) answers spend, models and pacing, and the health snapshot
 * answers health. Three do not, and each of those says WHY in terms of a module or a table an
 * engineer can open, and WHAT WOULD FILL IT in terms of a piece of work somebody can pick up.
 * None of them draws a chart, seeds a row, or shows a shape with no numbers in it.
 *
 * A desk moves from `none` to `live` by changing this object and writing its reading. Nothing
 * else in the console has to know.
 */

export type DeskId =
  | 'spend'
  | 'models'
  | 'pacing'
  | 'users'
  | 'subscriptions'
  | 'alerts'
  | 'health'
  | 'flag'
  | 'bug'
  | 'support'
  | 'refund';

export type Supply =
  /** Something deployed answers this. `from` is what an operator would chase. */
  | { readonly kind: 'live'; readonly from: string }
  /** Nothing answers it. Both fields are required and neither may be vague. */
  | { readonly kind: 'none'; readonly because: string; readonly wouldFill: string };

export interface Desk {
  readonly id: DeskId;
  readonly name: string;
  /** The question this desk answers, in one line. */
  readonly question: string;
  readonly supply: Supply;
}

/** Spend first, because it is the owner's money and it is the first thing he should see. */
export const DESKS: readonly Desk[] = [
  {
    id: 'spend',
    name: 'Spend',
    question: 'What has the platform spent on models, and how close is that to the day’s ceiling?',
    supply: { kind: 'live', from: 'ops.usage_daily, and the live ceiling from wobo_gateway.spend' },
  },
  {
    id: 'models',
    name: 'Models',
    question: 'Which models answered, how often, at what cost, and how often a fallback took over?',
    supply: { kind: 'live', from: 'ops.usage_daily, grouped by the model that actually answered' },
  },
  {
    id: 'pacing',
    name: 'Pacing',
    question:
      'What does a 1x day get spent on: spoken seconds, video seconds, messages, generations?',
    supply: { kind: 'live', from: 'ops.usage_daily by unit kind, and wobo_gateway.unit_economics' },
  },
  {
    id: 'users',
    name: 'Users',
    question: 'How many learners, how many active, on what plan — and a way to find one.',
    supply: {
      kind: 'none',
      because:
        'There is no operator-side read of the learner population, and this console must not ' +
        'make one for itself: every learner table is behind row-level security scoped to the ' +
        'learner, and a browser bundle holding a service-role key would be the worst possible ' +
        'way to get a count. The ledger counts CALLS and knows learners only as a salted one-way ' +
        'digest, which is deliberately not enough to list anybody.',
      wouldFill:
        'A counts-only rollup behind the console door — how many accounts, how many active in a ' +
        'window, how many on each plan — plus a lookup by opaque learner id returning the least a ' +
        'support task needs: the id, the plan, whether the account is active, when it was last ' +
        'seen. Not a name, not an address, not a word of anyone’s work.',
    },
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    question: 'Active, cancelling and ended — by plan, by period, with the cancellation dates.',
    supply: {
      kind: 'none',
      because:
        'learner.subscriptions exists (migration 0014) but nothing aggregates it for an operator, ' +
        'and its row-level security scopes every row to its own learner, so no call this console ' +
        'can make returns a count. The billing ledger (ops.billing_events, migration 0023) is ' +
        'served at GET /v1/admin/billing by wobo_gateway.billing.payments, newest first with ' +
        'payments on/off and the last webhook seen, but this console does not read it yet.',
      wouldFill:
        'A panel that reads GET /v1/admin/billing (every checkout, provider webhook and cancel as ' +
        'a row, with a keyed handle per learner) beside a rollup of learner.subscriptions by ' +
        'plan, by status and by period end. Read the word "billing" carefully: the ledger says an ' +
        'event happened and what the gateway did with it; the provider is the record of money.',
    },
  },
  {
    id: 'alerts',
    name: 'Alerts',
    question: 'What has fired, how often, and is anything firing right now?',
    supply: {
      kind: 'none',
      because:
        'wobo_gateway.alerts writes one log line per alert and, when ALERT_WEBHOOK_URL is set, ' +
        'posts it. It persists nothing: no table, no buffer that survives a restart, no read ' +
        'path. A history panel here would have to invent the history.',
      wouldFill:
        'Either an alert table the sink writes to on its way out, or a log drain the gateway can ' +
        'query for the wobo.gateway.alert logger. Until one exists the alert history lives in ' +
        'whatever received the webhook, and that is where it should be read.',
    },
  },
  {
    id: 'flag',
    name: 'Flags',
    question: 'What has a learner told us is wrong, confusing, upsetting or unsafe?',
    supply: {
      kind: 'live',
      from: 'ops.reports (migration 0017), written by wobo_gateway.reports at POST /v1/flags',
    },
  },
  {
    id: 'bug',
    name: 'Bug reports',
    question: 'What has somebody inside the product told us is broken?',
    supply: {
      kind: 'live',
      from: 'ops.reports, kind=bug — an intake to triage into GitHub, never a second tracker',
    },
  },
  {
    id: 'support',
    name: 'Support',
    question: 'Who has written in from inside the product and still needs a person?',
    supply: {
      kind: 'live',
      from: 'ops.reports, kind=support — the in-product route only; the contact page is a mailto:',
    },
  },
  {
    id: 'refund',
    name: 'Refund requests',
    question: 'Which charges are being disputed under the five cases the law gives?',
    supply: {
      kind: 'live',
      from: 'ops.reports, kind=refund — the reasons in docs/legal/refund-and-cancellation.md §5',
    },
  },
  {
    id: 'health',
    name: 'Health',
    question: 'Is the gateway up, are the providers answering, what is failing?',
    supply: { kind: 'live', from: 'wobo_gateway.health.snapshot(), read through the console door' },
  },
];

export function desk(id: DeskId): Desk {
  const found = DESKS.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown desk: ${id}`);
  return found;
}
