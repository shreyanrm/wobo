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
  | 'allowance'
  | 'pacing'
  | 'users'
  | 'activity'
  | 'mail'
  | 'subscriptions'
  | 'promo'
  | 'alerts'
  | 'health'
  | 'syllabus'
  | 'boardChanges'
  | 'growth'
  | 'flag'
  | 'bug'
  | 'support'
  | 'refund'
  | 'register';

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
    question:
      'What answers what, at what price, who is carrying it right now — and what would it cost ' +
      'to change?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/models — wobo_gateway.routing (the table and the vendors’ prices), ' +
        'registry.py (the jobs on each tier), health.py (who is carrying), and ops.usage_daily ' +
        'for the money. Owner-only writes go back through the same path into ops.settings.',
    },
  },
  {
    id: 'allowance',
    name: 'Allowance',
    question:
      'How generous is a day, what does each plan actually get, and how fast is it being spent?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/allowance — the dials in ops.settings (migrations 0028 and 0030) and ' +
        'ops.learner_day for the pace. Internal only: no learner or parent surface shows money.',
    },
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
        'How many learners came, and when one learner was last seen, is now the Activity desk ' +
        '(learner.activity, migration 0034). What is still missing is the account side: nothing ' +
        'counts accounts or plans for an operator, every learner table is behind row-level ' +
        'security scoped to the learner, and a browser bundle holding a service-role key would be ' +
        'the worst possible way to get a count.',
      wouldFill:
        'A counts-only rollup behind the console door of accounts and of learners on each plan ' +
        '(learner.subscriptions), beside the Activity desk’s counts, and the plan added to its ' +
        'lookup by opaque learner id. Not a name, not an address, not a word of anyone’s work.',
    },
  },
  {
    id: 'activity',
    name: 'Activity',
    question:
      'Who came today, this week and this month, and how many sit on each step of the mail ' +
      'ladder? One learner’s last visit, streak and mail step, for a seat that may look.',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/activity — learner.activity (migration 0034), counted on each learner’s ' +
        'own calendar by learner.activity_census, and the mail.ladder dial. One learner is ' +
        'GET /v1/admin/learners/activity on learner.read, and every look is in the audit trail.',
    },
  },
  {
    id: 'mail',
    name: 'Mail',
    question:
      'Is our mail landing? Complaints against 0.10% and 0.30%, bounces, suppressed addresses, ' +
      'where each seed landed, what Gmail says, and what is paused and why.',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/mail — ops.mail_watch (migration 0036), filled by the provider’s signed ' +
        'events, the seed inboxes and Postmaster Tools (wobo_gateway.mailwatch), and the ' +
        'mail.kinds_paused dial. Lifting a pause is POST /v1/admin/mail/unpause, owner only.',
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
    id: 'promo',
    name: 'Promo codes',
    question: 'Which codes exist, what do they grant, and how many times has each been taken?',
    supply: {
      kind: 'live',
      from:
        'ops.promo_codes and ops.promo_redemptions (migration 0027), served by ' +
        'wobo_gateway.promo — the use count is counted over the redemptions, never a column',
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
    id: 'syllabus',
    name: 'Boards',
    question:
      'What is each board showing a learner and why, what is being read next, what refused — ' +
      'and what has it cost?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/syllabus — curriculum.frameworks, versions and discovery_jobs for the ' +
        'boards and the queue, the labels derived in curriculum/labels.py, what each run cost ' +
        'written onto its own job by the discovery worker, and wobo_gateway.spend for the day.',
    },
  },
  {
    id: 'boardChanges',
    name: 'Board changes',
    question:
      'Who has asked a person to change their board, from what to what, and when did they last ' +
      'change?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/board-changes: ops.board_change_requests (migration 0031) and the three ' +
        'board dials in ops.settings. Operators grant, and the owner turns the dials',
    },
  },
  {
    id: 'growth',
    name: 'Growth',
    question:
      'What should be written next, what was made, where did it go, and who signed up because ' +
      'of it?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/growth: growth.pieces, growth.campaigns and growth.signals (migration ' +
        '0038), the harvest in content/growth, and the growth dials in ops.settings. The owner ' +
        'approves, marks sent and turns the dials',
    },
  },
  {
    id: 'health',
    name: 'Health',
    question: 'Is the gateway up, are the providers answering, what is failing?',
    supply: { kind: 'live', from: 'wobo_gateway.health.snapshot(), read through the console door' },
  },
  {
    id: 'register',
    name: 'Register',
    question:
      'Who has a seat, what each person can actually see and do, who gave it to them, and ' +
      'whose invitation is still waiting?',
    supply: {
      kind: 'live',
      from:
        'GET /v1/admin/admins: ops.admins and ops.admin_capabilities (migrations 0015, 0029 and ' +
        '0037), each seat shown with its effective set. The owner invites, grants, revokes and ' +
        'suspends from here, and every change is a row in ops.admin_audit',
    },
  },
];

export function desk(id: DeskId): Desk {
  const found = DESKS.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown desk: ${id}`);
  return found;
}
