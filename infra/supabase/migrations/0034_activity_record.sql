-- 0034 — the activity record: when each learner last came, and what they did (wave 56).
--
-- The owner, 2026-09-16: "make sure you have a record of application activity and stuff". The
-- mail cadence in docs/EMAILS-AND-ANIMATIONS.md stands on it: at least three a week, a step-down
-- with time away that never falls below one a month, and a "come back" mail never on a day the
-- learner came. None of that could be true. `learner.meter_state` (0002) was written by nothing,
-- `learner.sessions` (0002) was written by nothing, and the mail read thirty days back, so a
-- learner gone forty-five days looked exactly like one who never came.
--
-- WHAT THIS RECORD IS FOR, AND WHAT IT IS NEVER FOR. It exists to teach, and to write the
-- learner's own mail: the day they last came, the hour they usually come, their streak, the
-- chapter they are in and the thing they last cracked. It is never shared, never used for
-- advertising, and never read by a third party. DPDP Act 2023 s.9(3) bars tracking or behavioural
-- monitoring of a child for any other purpose, and this file keeps to the side of that line the
-- product stands on: no campaign, no device, no address, no open, no click, and no transcript.
-- The console sees counts, and one learner's four facts (last came, days this month, streak, mail
-- step) behind the learner panel and its audit trail; it never sees a title or a moment.
--
-- ONE RECORD, THREE TABLES, ONE WRITER.
--   * learner.meter_state (0002) — one row per learner per day they came, dated on THEIR clock.
--     `budget_consumed` now counts learning units that day (a stretch of talking to Wobo, a card
--     reported, a module finished); a row at 0 is a day they opened the app and learned nothing.
--     `day_had_real_win` is a day a module was finished or a topic mastered. The per-day budget
--     it was named for moved to the gateway's allowance and was never written here, so
--     `budget_total` is 0 by default and means nothing.
--   * learner.sessions (0002) — written at last, not removed: the app opens and closes a session
--     through the gateway (POST /v1/me/activity), the same seam the mind, the mail dials and the
--     doubts use, because the app's direct-to-database path runs only in live-persist mode and
--     production is not in it. A session id is the device's own uuid, so a retried start is the
--     same session, and only its own learner can close it.
--   * learner.activity (new) — one row per learner: first came, last came (ever, with no
--     horizon), their zone, days active, streak and best streak, the hour they usually start,
--     the last day they learned, the latest twelve moments, where they are in the chapter, and
--     how many sessions. The daily mail job reads one row per family, in batches, by key.
--   All three are written by `learner.note_activity`, which only the gateway's service role may
--   run. A learner's own token may read its rows (the record is theirs to see) and may delete its
--   day rows and sessions (the SDK's own erase does), and may write none of them: a token that
--   could write its own streak could write its own mail schedule.
--
-- RETENTION, stated with the numbers the gateway keeps (wobo_gateway/activity.py):
--   * day rows: 400 days. A year of "days this month" and "came on this date" plus a month's lag.
--   * sessions: 90 days. When a learner was here and on what surface is the most behavioural
--     fact in the record, so it is kept the shortest.
--   * the learner.activity row: for the life of the account. It is one row, it is the only true
--     "last came" there is, and the step-down to once a month depends on it existing after the
--     day rows have gone.
--   `learner.expire_activity` sweeps the first two; the gateway calls it at most once a day.
--   POST /v1/me/erase deletes every row of all three for the learner who asked
--   (services/gateway memory.py), and the SDK's register names them.
--
-- Additive and idempotent. Applying it twice is a no-op.

-- ---------------------------------------------------------------------------------------------
-- The day ledger and the sessions: one writer from here on.
-- ---------------------------------------------------------------------------------------------
alter table learner.meter_state alter column budget_total set default 0;

comment on table learner.meter_state is
  'One row per learner per day they came, dated on their own clock (0034). Written by '
  'learner.note_activity only. Kept 400 days. Swept by POST /v1/me/erase.';
comment on column learner.meter_state.budget_consumed is
  'Learning units that day: a stretch of talking to Wobo, a card reported, a module finished. '
  '0 means they came and did not learn.';
comment on column learner.meter_state.day_had_real_win is
  'A module finished or a topic mastered that day.';
comment on column learner.meter_state.budget_total is
  'Unused since 0034; the per-day budget lives in the gateway allowance. Always 0.';

drop policy if exists meter_state_own on learner.meter_state;
drop policy if exists meter_state_own_read on learner.meter_state;
drop policy if exists meter_state_own_erase on learner.meter_state;
create policy meter_state_own_read on learner.meter_state for select to authenticated
  using (subject_id = auth.uid());
create policy meter_state_own_erase on learner.meter_state for delete to authenticated
  using (subject_id = auth.uid());
revoke insert, update on learner.meter_state from anon, authenticated;

comment on table learner.sessions is
  'A learner''s visits: when a session started and ended, and on which surface (0034). Written '
  'by learner.note_activity only, from the app through the gateway. Kept 90 days. Swept by '
  'POST /v1/me/erase.';

drop policy if exists sessions_own on learner.sessions;
drop policy if exists sessions_own_read on learner.sessions;
drop policy if exists sessions_own_erase on learner.sessions;
create policy sessions_own_read on learner.sessions for select to authenticated
  using (subject_id = auth.uid());
create policy sessions_own_erase on learner.sessions for delete to authenticated
  using (subject_id = auth.uid());
revoke insert, update on learner.sessions from anon, authenticated;

-- 0002's reference function wrote a session from a client token. Nothing ever called it, and
-- keeping it callable would leave a second writer beside note_activity.
revoke execute on function learner.op_start_session(jsonb) from authenticated;

-- ---------------------------------------------------------------------------------------------
-- learner.activity — one row per learner.
-- ---------------------------------------------------------------------------------------------
create table if not exists learner.activity (
  subject_id uuid primary key,
  first_came_on date not null,
  last_came_at timestamptz not null,
  last_came_on date not null,
  timezone text not null default 'UTC',
  days_active integer not null default 0,
  streak_days integer not null default 0,
  streak_best integer not null default 0,
  hours jsonb not null default '{}'::jsonb,
  last_learned_on date,
  moments jsonb not null default '[]'::jsonb,
  progress jsonb,
  sessions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_counts_are_counts
    check (days_active >= 0 and streak_days >= 0 and streak_best >= streak_days and sessions >= 0),
  constraint activity_zone_is_a_name check (char_length(timezone) between 1 and 64),
  constraint activity_hours_is_small
    check (jsonb_typeof(hours) = 'object' and octet_length(hours::text) <= 512),
  constraint activity_moments_are_bounded
    check (jsonb_typeof(moments) = 'array' and jsonb_array_length(moments) <= 12),
  constraint activity_progress_is_one_place
    check (progress is null or (jsonb_typeof(progress) = 'object' and octet_length(progress::text) <= 1024)),
  constraint activity_days_are_in_order check (first_came_on <= last_came_on)
);

comment on table learner.activity is
  'One row per learner: when they first and last came (ever), their zone, days active, streak, '
  'the hour they usually start, the latest twelve learning moments and where they are in the '
  'chapter. To teach and to write their own mail; never shared, never advertising, never a third '
  'party (DPDP s.9(3)). Kept for the life of the account; swept by POST /v1/me/erase.';
comment on column learner.activity.hours is
  'How many days they STARTED in each local hour, halved when the total passes 60 so a changed '
  'routine wins. The mail goes at the hour they usually learn.';
comment on column learner.activity.moments is
  'The latest twelve moments a mail may speak about, newest first: {kind, ref, title, at}, kind '
  'module_finished or topic_mastered.';
comment on column learner.activity.progress is
  'Where they are in the chapter: {ref, title, done, total, at}. Cleared when that module is '
  'finished.';

create index if not exists activity_last_came_idx on learner.activity (last_came_on);

drop trigger if exists activity_set_updated_at on learner.activity;
create trigger activity_set_updated_at before update on learner.activity
  for each row execute function learner.set_updated_at();

alter table learner.activity enable row level security;

drop policy if exists activity_own_read on learner.activity;
create policy activity_own_read on learner.activity for select to authenticated
  using (subject_id = auth.uid());

-- 0002's default privileges hand every new learner table to `authenticated` for writing. This one
-- is read-only to its learner and written by the gateway alone.
revoke insert, update, delete on learner.activity from anon, authenticated;
grant select on learner.activity to authenticated;
grant all on learner.activity to service_role;

-- ---------------------------------------------------------------------------------------------
-- learner.note_activity — the one writer. One call per event, atomic.
--
-- The same rule as `wobo_gateway.activity.fold`, which is the specification and is tested:
--   * the day is the learner's own, from their zone; a zone that is not a zone is UTC;
--   * a day row that was not there before is a new day (days_active + 1, and the hour they
--     started is counted);
--   * a later day extends the streak when it is the next day and restarts it otherwise; the same
--     day keeps it; an earlier day (a queued offline event) never moves it or the last visit;
--   * a module finished or a topic mastered goes to the front of the moments, replacing the same
--     kind of the same thing, and the list keeps twelve;
--   * a progress report replaces the chapter unless it is older than the one held; finishing that
--     module clears it.
-- ---------------------------------------------------------------------------------------------
create or replace function learner.note_activity(
  p_subject uuid,
  p_kind text,
  p_at timestamptz,
  p_zone text default 'UTC',
  p_ref text default null,
  p_title text default null,
  p_done integer default null,
  p_total integer default null,
  p_session uuid default null,
  p_surface text default null
)
returns learner.activity language plpgsql security invoker set search_path = '' as $$
declare
  v_zone text := left(coalesce(nullif(p_zone, ''), 'UTC'), 64);
  v_local timestamp;
  v_day date;
  v_hour integer;
  v_ref text := left(coalesce(p_ref, ''), 128);
  v_title text := left(coalesce(p_title, ''), 120);
  v_units integer :=
    case when p_kind in ('turn', 'module_finished', 'topic_mastered', 'progress') then 1 else 0 end;
  v_win boolean := p_kind in ('module_finished', 'topic_mastered');
  v_new_day boolean;
  v_new_session boolean := false;
  v_count integer;
  v_row learner.activity;
  v_streak integer;
  v_hours jsonb;
  v_moments jsonb;
  v_progress jsonb;
begin
  if p_subject is null or p_at is null then
    raise exception 'note_activity: a subject and a moment are required';
  end if;
  if p_kind not in (
    'turn', 'session_start', 'session_end', 'module_finished', 'topic_mastered', 'progress'
  ) then
    raise exception 'note_activity: unknown kind %', p_kind;
  end if;

  begin
    v_local := p_at at time zone v_zone;
  exception when others then
    v_zone := 'UTC';
    v_local := p_at at time zone 'UTC';
  end;
  v_day := v_local::date;
  v_hour := extract(hour from v_local)::integer;

  -- The day row. Whether it was inserted or updated is the new-day fact.
  insert into learner.meter_state as m (subject_id, date, budget_total, budget_consumed, day_had_real_win)
  values (p_subject, v_day, 0, v_units, v_win)
  on conflict (subject_id, date) do update
    set budget_consumed = m.budget_consumed + excluded.budget_consumed,
        day_had_real_win = m.day_had_real_win or excluded.day_had_real_win
  returning (xmax = 0) into v_new_day;

  -- The session, idempotent on the device's own id.
  if p_kind = 'session_start' and p_session is not null then
    insert into learner.sessions (id, subject_id, surface, started_at)
    values (p_session, p_subject, coalesce(p_surface, 'pwa'), p_at)
    on conflict (id) do nothing;
    get diagnostics v_count = row_count;
    v_new_session := v_count > 0;
  elsif p_kind = 'session_end' and p_session is not null then
    update learner.sessions set ended_at = greatest(started_at, p_at)
     where id = p_session and subject_id = p_subject and ended_at is null;
  end if;

  -- The summary row: seeded empty if this is the learner's first event, then locked and folded.
  insert into learner.activity (subject_id, first_came_on, last_came_at, last_came_on, timezone)
  values (p_subject, v_day, p_at, v_day, v_zone)
  on conflict (subject_id) do nothing;
  select * into v_row from learner.activity where subject_id = p_subject for update;

  if v_day > v_row.last_came_on then
    v_streak := case when v_day = v_row.last_came_on + 1 then v_row.streak_days + 1 else 1 end;
  elsif v_day = v_row.last_came_on then
    v_streak := greatest(v_row.streak_days, 1);
  else
    v_streak := v_row.streak_days;
  end if;

  v_hours := v_row.hours;
  if v_new_day then
    v_hours := jsonb_set(
      v_hours,
      array[v_hour::text],
      to_jsonb(coalesce((v_hours ->> v_hour::text)::integer, 0) + 1)
    );
    if (select coalesce(sum(value::integer), 0) from jsonb_each_text(v_hours)) > 60 then
      v_hours := coalesce(
        (select jsonb_object_agg(key, value::integer / 2)
           from jsonb_each_text(v_hours) where value::integer / 2 > 0),
        '{}'::jsonb
      );
    end if;
  end if;

  v_moments := v_row.moments;
  if v_win then
    v_moments := (
      select coalesce(jsonb_agg(ranked.e order by ranked.rank), '[]'::jsonb)
      from (
        select both_lists.e, row_number() over (order by both_lists.n) as rank
        from (
          select jsonb_build_object('kind', p_kind, 'ref', v_ref, 'title', v_title, 'at', p_at) as e,
                 0::bigint as n
          union all
          select held.e, held.n
            from jsonb_array_elements(v_row.moments) with ordinality as held(e, n)
           where not (held.e ->> 'kind' = p_kind and held.e ->> 'ref' = v_ref)
        ) both_lists
      ) ranked
      where ranked.rank <= 12
    );
  end if;

  v_progress := v_row.progress;
  if p_kind = 'progress' and coalesce(p_total, 0) > 0
     and (v_row.progress is null or p_at >= (v_row.progress ->> 'at')::timestamptz) then
    v_progress := jsonb_build_object(
      'ref', v_ref,
      'title', v_title,
      'done', least(greatest(coalesce(p_done, 0), 0), p_total),
      'total', p_total,
      'at', p_at
    );
  elsif p_kind = 'module_finished' and v_row.progress ->> 'ref' = v_ref then
    v_progress := null;
  end if;

  update learner.activity set
    first_came_on = least(v_row.first_came_on, v_day),
    last_came_at = greatest(v_row.last_came_at, p_at),
    last_came_on = greatest(v_row.last_came_on, v_day),
    timezone = case when p_at >= v_row.last_came_at then v_zone else v_row.timezone end,
    days_active = greatest(v_row.days_active + case when v_new_day then 1 else 0 end, 1),
    streak_days = v_streak,
    streak_best = greatest(v_row.streak_best, v_streak),
    hours = v_hours,
    last_learned_on = case when v_units > 0 then greatest(v_row.last_learned_on, v_day)
                           else v_row.last_learned_on end,
    moments = v_moments,
    progress = v_progress,
    sessions = v_row.sessions + case when v_new_session then 1 else 0 end
  where subject_id = p_subject
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function learner.note_activity(uuid, text, timestamptz, text, text, text, integer, integer, uuid, text) from public;
revoke all on function learner.note_activity(uuid, text, timestamptz, text, text, text, integer, integer, uuid, text) from anon, authenticated;
grant execute on function learner.note_activity(uuid, text, timestamptz, text, text, text, integer, integer, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- learner.activity_census — the console's counts, on each learner's own calendar.
--
-- `p_bounds` is the ladder dial (wobo_gateway.activity.ladder): the last day of each step but the
-- last, ascending. A learner's step is how many bounds their days away exceed, so four bounds make
-- five steps and the last one never ends. Counts only: nobody is named.
-- ---------------------------------------------------------------------------------------------
create or replace function learner.activity_census(p_bounds integer[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  with away as (
    select greatest(0, (now() at time zone a.timezone)::date - a.last_came_on) as days
      from learner.activity a
  ),
  stepped as (
    select away.days,
           (select count(*) from unnest(p_bounds) as b(bound) where away.days > b.bound) as step
      from away
  )
  select jsonb_build_object(
    'learners', (select count(*) from stepped),
    'today', (select count(*) from stepped where days = 0),
    'week', (select count(*) from stepped where days < 7),
    'month', (select count(*) from stepped where days < 30),
    'steps', coalesce(
      (select jsonb_object_agg(g.step::text, g.n)
         from (select step, count(*) as n from stepped group by step) g),
      '{}'::jsonb
    )
  )
$$;

revoke all on function learner.activity_census(integer[]) from public;
revoke all on function learner.activity_census(integer[]) from anon, authenticated;
grant execute on function learner.activity_census(integer[]) to service_role;

-- ---------------------------------------------------------------------------------------------
-- learner.expire_activity — the retention above, kept. Never touches learner.activity.
-- ---------------------------------------------------------------------------------------------
create or replace function learner.expire_activity(
  p_day_keep integer default 400,
  p_session_keep integer default 90
)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_days integer;
  v_sessions integer;
begin
  delete from learner.meter_state
   where date < (now() at time zone 'utc')::date - greatest(p_day_keep, 35);
  get diagnostics v_days = row_count;
  delete from learner.sessions
   where started_at < now() - make_interval(days => greatest(p_session_keep, 7));
  get diagnostics v_sessions = row_count;
  return v_days + v_sessions;
end
$$;

revoke all on function learner.expire_activity(integer, integer) from public;
revoke all on function learner.expire_activity(integer, integer) from anon, authenticated;
grant execute on function learner.expire_activity(integer, integer) to service_role;

notify pgrst, 'reload schema';
