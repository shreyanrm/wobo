-- 0038 — the growth desk: pieces, campaigns, signals, the sign-up count, and one column on the
-- account.
--
-- docs/GROWTH-DESK.md §4 (the desk) and §3 (publish then syndicate). The gateway keeps all of it
-- (services/gateway src/wobo_gateway/growth/). §4.4 names this file's job: "every piece gets one
-- durable campaign id, used as utm_id, of the shape channel-yyyymm-slug-nn. The gateway writes that
-- id on the account at sign-up, once, and the cookie dies there." (The law file calls it 0024; that
-- number went to ops.settings before this was written, and 0038 is the next free one.)
--
--   growth.pieces      one source piece per slug: its body, the gate's verdict, when the origin was
--                      posted and when it was seen indexed. The indexed stamp is what releases
--                      every other copy of the piece, and it cannot precede the posted stamp.
--   growth.campaigns   one row per post, keyed on its campaign id. The id, the piece, the shape, the
--                      channel, the month and the attempt are fixed at insert and never change, and a
--                      row is never deleted: a campaign id that has been on a link is durable.
--                      Only the status and its stamps move. Reddit and Quora are refused by a check,
--                      because no row may ever exist for either (§2, tier 3).
--   growth.signals     what the daily gather read that is not a file: Search Console's near misses
--                      (a query, a page, counts), how often a concept was served (a concept id and a
--                      count), and a person's pasted questions. No person is in any row.
--   growth.signups     a view: sign-ups per campaign id. Counts only.
--   learner.profiles_cache.campaign_id
--                      written by the gateway with the service role, only where it is empty, and a
--                      trigger refuses any second value. It is NOT in the learner's column grants
--                      (0014 grants insert and update column by column), so a browser that read the
--                      link can never write it.
--
-- WHAT IS DELIBERATELY NOT HERE: no visitor id, no device id, no click id, no address, no IP, and
-- no event per visit. §1: the learner side is never measured by a third party, and the first-party
-- record is worth less than a tracking cookie by construction.
--
-- APPLIES AFTER 0002 (learner.profiles_cache), 0014 (its column grants), 0025 (the growth schema,
-- closed by default privilege and exposed to PostgREST by 0026). Additive and idempotent: applying
-- it twice is a no-op. THE OWNER APPLIES THIS; nothing in the repo applies a migration.

create schema if not exists growth;
revoke all on schema growth from public;
revoke all on schema growth from anon;
revoke all on schema growth from authenticated;
grant usage on schema growth to service_role;


-- ---------------------------------------------------------------------------------------------
-- growth.pieces
-- ---------------------------------------------------------------------------------------------
create table if not exists growth.pieces (
  slug text primary key,
  topic_slug text not null,
  title text not null default '',
  drafted_on date not null,
  -- The gate's answer (growth/piece.py check). A piece that did not pass is kept with its reasons
  -- and never has a campaign row.
  publishable boolean not null default false,
  verdict jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,
  origin_url text,
  published_at timestamptz,
  indexed_at timestamptz,
  -- How the page was seen indexed: Search Console's verdict, or a person's note.
  index_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pieces_slug_is_a_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  constraint pieces_topic_is_a_slug check (topic_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint pieces_origin_is_ours check (origin_url is null or origin_url ~ '^https://heywobo\.com/blog/[a-z0-9-]+$'),
  -- Publish, then index. An indexed stamp with no published stamp, or before it, is impossible.
  constraint pieces_indexed_after_published check (
    indexed_at is null or (published_at is not null and indexed_at >= published_at)
  )
);

comment on table growth.pieces is
  'One source piece per slug, its verdict, and the two stamps that release its copies.';


-- ---------------------------------------------------------------------------------------------
-- growth.campaigns
-- ---------------------------------------------------------------------------------------------
create table if not exists growth.campaigns (
  -- channel-yyyymm-slug-nn. The utm_id on the post's link, and the value an account carries.
  id text primary key,
  piece_slug text not null references growth.pieces (slug),
  shape text not null,
  channel text not null,
  tier text not null,
  month text not null,
  attempt smallint not null,
  status text not null,
  body jsonb not null default '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  released_at timestamptz,
  posted_at timestamptz,
  external_ref text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_id_is_a_campaign check (
    id ~ '^[a-z][a-z-]{0,23}-[0-9]{6}-[a-z0-9]+(-[a-z0-9]+)*-[0-9]{2}$' and char_length(id) <= 96
  ),
  constraint campaigns_shape_is_known check (shape in ('blog', 'medium', 'document', 'thread', 'short')),
  constraint campaigns_channel_is_known check (channel in (
    'blog', 'telegram', 'threads', 'instagram', 'facebook', 'linkedin', 'youtube', 'x',
    'medium', 'pinterest', 'newsletter', 'business-profile'
  )),
  -- Tier 3. No row, ever, not a draft and not a queue entry (docs/GROWTH-DESK.md §2).
  constraint campaigns_never_reddit_or_quora check (channel not in ('reddit', 'quora')),
  constraint campaigns_tier_is_known check (tier in ('script', 'person')),
  constraint campaigns_status_is_known check (status in (
    'drafted', 'awaiting_approval', 'approved', 'posted', 'queued_for_person',
    'sent_by_person', 'held', 'failed', 'withdrawn'
  )),
  constraint campaigns_month_is_a_month check (month ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  constraint campaigns_attempt_is_two_digits check (attempt between 1 and 99),
  constraint campaigns_id_matches_its_parts check (
    id = channel || '-' || month || '-' || piece_slug || '-' || lpad(attempt::text, 2, '0')
  ),
  constraint campaigns_ref_is_short check (external_ref is null or char_length(external_ref) <= 300),
  constraint campaigns_error_is_short check (error is null or char_length(error) <= 1000)
);

create index if not exists campaigns_piece_idx on growth.campaigns (piece_slug);
create index if not exists campaigns_status_idx on growth.campaigns (status, channel);

comment on table growth.campaigns is
  'One post per row, keyed on its durable campaign id. Only the status moves; nothing is deleted.';

-- A copy of a piece is never released before its origin is live, enforced here as well as in the
-- gateway: a campaign that is not the blog cannot become approved, queued, posted or sent while
-- its piece has no indexed stamp.
create or replace function growth.campaigns_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live boolean;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'growth.campaigns rows are never deleted: a campaign id on a link is durable'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.piece_slug is distinct from old.piece_slug
       or new.shape is distinct from old.shape
       or new.channel is distinct from old.channel
       or new.tier is distinct from old.tier
       or new.month is distinct from old.month
       or new.attempt is distinct from old.attempt then
      raise exception 'a campaign id, its piece, its shape and its channel never change'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status in ('posted', 'sent_by_person', 'withdrawn') and new.status is distinct from old.status then
      raise exception 'a finished post does not move again'
        using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  if new.channel <> 'blog'
     and new.status in ('awaiting_approval', 'approved', 'posted', 'queued_for_person', 'sent_by_person') then
    select p.indexed_at is not null and p.published_at is not null
      into live
      from growth.pieces p
     where p.slug = new.piece_slug;
    if not coalesce(live, false) then
      raise exception 'publish then syndicate: % waits until the blog post is indexed', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_guard_write on growth.campaigns;
create trigger campaigns_guard_write
  before insert or update on growth.campaigns
  for each row execute function growth.campaigns_guard();

drop trigger if exists campaigns_guard_delete on growth.campaigns;
create trigger campaigns_guard_delete
  before delete on growth.campaigns
  for each row execute function growth.campaigns_guard();

drop trigger if exists campaigns_no_truncate on growth.campaigns;
create trigger campaigns_no_truncate
  before truncate on growth.campaigns
  for each statement execute function growth.campaigns_guard();

create or replace function growth.pieces_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pieces_touch on growth.pieces;
create trigger pieces_touch
  before update on growth.pieces
  for each row execute function growth.pieces_touch();


-- ---------------------------------------------------------------------------------------------
-- growth.signals
-- ---------------------------------------------------------------------------------------------
create table if not exists growth.signals (
  id bigint generated always as identity primary key,
  day date not null,
  source text not null,
  query text not null default '',
  page text not null default '',
  concept text not null default '',
  impressions integer not null default 0,
  clicks integer not null default 0,
  position numeric(6, 2),
  count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint signals_one_per_day unique (day, source, query, page, concept),
  constraint signals_source_is_known check (source in ('search-console', 'our-learners', 'person')),
  constraint signals_query_is_short check (char_length(query) <= 300),
  -- A path on our own site, never a full address and never a query string.
  constraint signals_page_is_a_path check (page = '' or page ~ '^/[A-Za-z0-9._~/%-]{0,299}$'),
  constraint signals_concept_is_short check (char_length(concept) <= 200),
  constraint signals_counts_are_counts check (impressions >= 0 and clicks >= 0 and count >= 0)
);

create index if not exists signals_day_idx on growth.signals (day desc, source);

comment on table growth.signals is
  'What the daily gather read: queries, pages and concepts with counts. No person in any row.';


-- ---------------------------------------------------------------------------------------------
-- The account column: written once, by the gateway.
-- ---------------------------------------------------------------------------------------------
alter table learner.profiles_cache
  add column if not exists campaign_id text;

alter table learner.profiles_cache drop constraint if exists profiles_cache_campaign_is_a_campaign;
alter table learner.profiles_cache
  add constraint profiles_cache_campaign_is_a_campaign check (
    campaign_id is null
    or (campaign_id ~ '^[a-z][a-z-]{0,23}-[0-9]{6}-[a-z0-9]+(-[a-z0-9]+)*-[0-9]{2}$'
        and char_length(campaign_id) <= 96)
  );

comment on column learner.profiles_cache.campaign_id is
  'The piece that brought this account, as its utm_id, written by the gateway once at sign-up.';

create or replace function learner.campaign_is_written_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.campaign_id is not null and new.campaign_id is distinct from old.campaign_id then
    raise exception 'an account''s campaign is written once and never changed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_cache_campaign_once on learner.profiles_cache;
create trigger profiles_cache_campaign_once
  before update of campaign_id on learner.profiles_cache
  for each row execute function learner.campaign_is_written_once();

-- The learner's grants are column lists (0014) and this column is in neither. Revoked again by
-- name anyway, so a later blanket grant cannot quietly hand it to a browser.
revoke insert (campaign_id), update (campaign_id) on learner.profiles_cache from authenticated;
revoke insert (campaign_id), update (campaign_id) on learner.profiles_cache from anon;


-- ---------------------------------------------------------------------------------------------
-- growth.signups: counts per campaign, and nothing that points back at an account.
-- ---------------------------------------------------------------------------------------------
create or replace view growth.signups
with (security_invoker = true)
as
  select campaign_id, count(*)::integer as signups
    from learner.profiles_cache
   where campaign_id is not null
   group by campaign_id;

comment on view growth.signups is 'Sign-ups per campaign id. Counts only.';


-- ---------------------------------------------------------------------------------------------
-- Grants: the service role only. Nothing here is readable from a browser.
-- ---------------------------------------------------------------------------------------------
revoke all on growth.pieces, growth.campaigns, growth.signals, growth.signups
  from public, anon, authenticated;
grant select, insert, update on growth.pieces to service_role;
grant select, insert, update on growth.campaigns to service_role;
grant select, insert on growth.signals to service_role;
grant usage, select on sequence growth.signals_id_seq to service_role;
grant select on growth.signups to service_role;

alter table growth.pieces enable row level security;
alter table growth.campaigns enable row level security;
alter table growth.signals enable row level security;

notify pgrst, 'reload schema';
