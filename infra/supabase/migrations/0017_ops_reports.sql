-- 0017 — ops.reports: the four queues the console's desks read.
--
-- APPLIES AFTER the admin register (`ops.admins`, `ops.admin_sessions`, `ops.admin_audit`) and
-- after the usage ledger, both of which create the `ops` schema and set its posture. This file
-- adds ONE table to that schema and changes nothing about it. It must not be applied before the
-- register: the desks that read this table hang off that door, and `acted_by` names a row there.
--
-- WHY IT EXISTS. The owner asked for a console showing, among much else, "flags, bugs ... refund
-- requests or support chat". Four of those had nothing behind them anywhere in this repo: no flag
-- table, no bug intake, no support queue, no refund queue. A console over nothing is a console
-- that lies, and this repo's hardest standing rule is that no panel may show a number it cannot
-- source. So the record comes first and the desks read it. This table starts EMPTY and nothing
-- backfills it.
--
-- THE FLAG IS THE POINT. `docs/legal/community-and-flags.md` §2 and
-- `docs/copy/help-centre/product-features/12-flagging-something-wrong.md` both say, honestly, that
-- there is no flag control in Wobo and that the mailbox is the whole route. That was written
-- because the promise of a flag had been made and not kept. With this table, the intake endpoint
-- (`services/gateway reports.py`) and the queue (`desks_api.py`), the promise can be kept instead:
-- a control on a lesson, a board or a diagram, a state a person moves it through, and a name
-- against every move. The control itself lives in the learner app and is not in this change.
--
-- ONE TABLE FOR FOUR DESKS, decided rather than defaulted. A flag, a bug report, a support message
-- and a refund request have the same life: somebody tells us something, a person looks at it, a
-- person acts, it closes, and every step is attributable. Four tables would be four copies of the
-- same lifecycle and four places for the states to drift apart. `kind` separates them, `reason` is
-- checked against a closed list PER KIND, and `about` carries the few pointers only one kind
-- needs. The day a desk grows a lifecycle of its own is the day it earns its own table.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * No bug tracker. The owner has GitHub and it is better than anything written here. A row with
--     `kind = 'bug'` is an INTAKE — a way for somebody inside the product to say "this is broken"
--     and have it reach a person — and the desk's job is to triage it into GitHub. There is no
--     assignee, no milestone, no label and no comment thread, and there should never be one.
--   * No support chat. There is one mailbox, support@heywobo.com, by the owner's ruling, and a
--     live chat is a staffing commitment rather than a feature. `kind = 'support'` records what
--     arrived through the routes that exist so nothing is missed.
--   * No discretionary refund. `docs/legal/refund-and-cancellation.md` §5 is explicit: we do not
--     refund as a gesture of goodwill, and cancelling is the answer to a change of mind. The
--     `refund` reasons below are EXACTLY the cases that document says are owed by law. There is no
--     "changed my mind" value, because a queue that accepts one implies a policy we do not have.
--   * No learner content. `about` is a small allow-list of pointers written by the gateway, and
--     `note` is what the person chose to type. Neither is a transcript, and the same rule the
--     usage ledger states in its own header applies here: a table that can be turned back into a
--     reading history of a child is a different and far more dangerous object than a queue.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- The register creates this; repeated here so the file can be read on its own and so applying it
-- against a project that somehow lacks the schema does not fail on the first statement.
create schema if not exists ops;

create table if not exists ops.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- new: nobody has opened it. looked_at: a person has read it and it is not noise.
  -- acted_on: the thing was done (the content fixed, the issue filed, the charge returned).
  -- closed: finished, including "nothing to do here".
  state text not null default 'new',
  -- A code from the closed list checked below, never free text. The desk sorts and counts on it,
  -- and a closed list is also what stops a child's report from becoming a text box we then have to
  -- store, screen and defend.
  reason text not null,
  -- The person's own words, optional and bounded. A learner may say nothing at all: a flag with a
  -- reason and no note is a complete report, and the control in the app must not require typing.
  note text,
  -- Who raised it, when we know. Null for anything that arrives without a session. This is the
  -- opaque auth subject and nothing else: no name, no school, no address.
  learner_id uuid,
  -- Only when the person asked to be written back to, which is why the two kinds a person answers
  -- carry one and a flag never does.
  contact_email text,
  -- What it was about, in fields a desk can show: which surface, which piece of content, which
  -- subject. Written by the gateway from an allow-list (reports.normalise_about). It is NOT a copy
  -- of the learner's work and must never become one.
  about jsonb not null default '{}'::jsonb,
  -- Where it came in: the learner app, the public contact page, the mailbox (typed in by a person),
  -- or a direct call in development.
  source text not null default 'app',
  -- Set by the gateway at intake, from the reason, for the two flag reasons that mean a child may
  -- be upset or at risk. The desk puts these at the top and nothing else may outrank them.
  urgent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Who moved it last, by their auth subject, and the address the queue reads back as. Both are
  -- denormalised from ops.admins for the reason ops.admin_audit denormalises its actor: removing a
  -- person must not remove the record of what they did. No foreign key, for the same reason.
  acted_by uuid,
  acted_by_email text,
  acted_at timestamptz,
  -- What they did, in a sentence, for the next person to read. Required on a refund request that
  -- has been settled, because that is the one queue where money is involved.
  resolution text,

  constraint reports_kind_is_known check (kind in ('flag', 'bug', 'support', 'refund')),
  constraint reports_state_is_known check (state in ('new', 'looked_at', 'acted_on', 'closed')),
  constraint reports_source_is_known check (source in ('app', 'contact', 'email', 'api')),
  constraint reports_note_is_bounded check (note is null or char_length(note) <= 2000),
  constraint reports_resolution_is_bounded
    check (resolution is null or char_length(resolution) <= 2000),
  constraint reports_contact_email_looks_like_one
    check (contact_email is null or
           contact_email ~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$'),
  constraint reports_about_is_an_object check (jsonb_typeof(about) = 'object'),

  -- The reason belongs to the kind. This is where the four desks actually differ, and it is
  -- checked here so a route with a bug in it cannot file a refund request under a flag's reason.
  constraint reports_reason_belongs_to_kind check (
    (kind = 'flag' and reason in (
      -- Wobo taught something incorrect, or drew it wrong.
      'wrong',
      -- Not wrong, but the learner could not follow it.
      'confusing',
      -- It upset them. A person reads this before anything else in the queue.
      'upsetting',
      -- It should not have been said to a child at all.
      'unsafe',
      -- Right in general, wrong for their board or their class.
      'not_my_syllabus',
      'other'))
    or (kind = 'bug' and reason in (
      'broken', 'slow', 'lost_work', 'wont_load', 'other'))
    or (kind = 'support' and reason in (
      'account', 'plan', 'parent_link', 'privacy', 'other'))
    -- Exactly the cases docs/legal/refund-and-cancellation.md §5 says are owed by law: a charge
    -- after cancelling, a duplicate charge, an unauthorised charge, a service we did not supply,
    -- and the EU/EEA/UK cooling-off right. Nothing may be added here without that document
    -- changing first.
    or (kind = 'refund' and reason in (
      'charged_after_cancelling', 'charged_twice', 'not_authorised', 'not_supplied',
      'cooling_off'))
  ),

  -- A report that has moved names who moved it and when. There is no anonymous triage.
  constraint reports_moved_names_who
    check (state = 'new' or (acted_by is not null and acted_at is not null)),
  constraint reports_new_names_nobody
    check (state <> 'new' or (acted_by is null and acted_at is null)),
  -- Money: a settled refund request says in words what was done about the charge.
  constraint reports_settled_refund_says_what_happened
    check (kind <> 'refund' or state in ('new', 'looked_at')
           or (resolution is not null and char_length(resolution) >= 3)),
  -- Only a flag can be urgent, and only for the two reasons that mean a child may be at risk, so
  -- nothing can be made to outrank a child saying they were upset.
  constraint reports_urgent_is_a_safety_flag
    check (not urgent or (kind = 'flag' and reason in ('upsetting', 'unsafe')))
);

-- The queue as a desk reads it: one kind, one state, newest first.
create index if not exists reports_desk_idx on ops.reports (kind, state, created_at desc);
-- The two reasons that jump the queue, wherever they are and whatever state they are still in.
create index if not exists reports_urgent_idx on ops.reports (created_at desc)
  where urgent and state in ('new', 'looked_at');
-- Flood control at intake counts one learner's recent rows.
create index if not exists reports_learner_idx on ops.reports (learner_id, created_at desc);

create or replace function ops.reports_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reports_set_updated_at on ops.reports;
create trigger reports_set_updated_at before update on ops.reports
  for each row execute function ops.reports_set_updated_at();

-- ------------------------------------------------------------------------------------------------
-- The same two locks the rest of `ops` carries, stated here rather than inherited by hope. The
-- register grants `usage` on the schema to `authenticated` so an admin can read ONE table (the
-- trail) through a policy; this table is not that one, so the privileges are revoked by name and
-- RLS is enabled with NO POLICY, which is deny-all for every role that does not bypass it. The
-- gateway reaches it with the service-role key and nothing else does.
-- ------------------------------------------------------------------------------------------------
alter table ops.reports enable row level security;
revoke all on ops.reports from public, anon, authenticated;
grant select, insert, update on ops.reports to service_role;
-- No DELETE, deliberately. A report is a record that somebody told us something; closing it is a
-- state, not a removal, and a queue an operator can empty is a queue that can hide a flag.

comment on table ops.reports is
  'The four intake queues: flag, bug, support, refund. One lifecycle, one desk shape. Written by '
  'the gateway (reports.py), read by the console (desks_api.py). Never contains learner content.';
comment on column ops.reports.urgent is
  'A child said something upset them or was unsafe. Set at intake, pages at once, tops the queue.';
comment on column ops.reports.about is
  'Pointers only, from a gateway allow-list. Never a transcript and never the learner''s work.';

notify pgrst, 'reload schema';
