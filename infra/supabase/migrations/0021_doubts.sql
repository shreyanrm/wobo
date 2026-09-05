-- 0021 — the doubt solver's record: a photographed page of work, and what Wobo read from it.
--
-- The owner, 2026-09-05: a student "can upload or take a photo of their book or whatever they have a
-- doubt about and wobo can annotate on that and explain as well." The gateway half is
-- services/gateway/src/wobo_gateway/doubt.py; this is what it keeps, against the account, per the
-- memory law (docs/MEMORY-LAW.md): the record is the database, the account is the key.
--
-- WHAT A ROW IS. One photographed doubt: the reading (the lines Wobo read, each with its box in page
-- fractions, corrected by the learner), the subject, topic and question, the learner's own words,
-- where it was filed in their syllabus (node_id is the app's topicNodeUuid, so the practice pools and
-- the re-teach ladder find it where a wrong answer on the same topic would be), and the size of the
-- photo. The photo itself is an object in the private `doubt-photos` bucket at `<subject_id>/<id>.jpg`
-- — re-encoded by the gateway with no metadata, downscaled, and SCREENED before it was written: a
-- photo with a face, a name, or an address on it never reaches this table or that bucket.
--
-- WHAT A ROW IS NOT. It is not the answer: the board turn lives in the board store for its resume
-- window and no longer, like every other turn. It is not a transcript of anything the learner typed
-- beyond the bounded `words` beside the photo.
--
-- ERASURE. `POST /v1/me/erase` (wobo_gateway.memory) deletes the rows AND the objects under the
-- learner's prefix in the bucket, and reports both counts. Before this migration the erasure register
-- (docs/conformance/privacy-and-children.md, I36) had every storage bucket down as reached by nothing.
--
-- Bounded in the database, as 0020 is: the caps below are check constraints, so a bug in the gateway
-- cannot let one learner's reading grow without limit.
--
-- RLS is the shape of 0020: the learner may read and delete their own rows with their own token; only
-- the service role writes, because every write goes through the gateway's screen. The bucket is
-- private and mediated server-side, like the three in 0003: no client policy on storage.objects.
--
-- Additive and idempotent. Applying it twice is a no-op.

create table if not exists learner.doubts (
  id text primary key
    constraint doubts_id_shape check (id ~ '^[A-Za-z0-9_-]{8,32}$'),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'read'
    constraint doubts_status check (status in ('read', 'answered')),
  answered_at timestamptz,

  -- the learner's own words beside the photo, bounded
  words text not null default ''
    constraint doubts_words_len check (char_length(words) <= 500),

  -- the reading
  school_subject text not null default ''
    constraint doubts_subject_len check (char_length(school_subject) <= 80),
  topic text not null default ''
    constraint doubts_topic_len check (char_length(topic) <= 80),
  question text not null default ''
    constraint doubts_question_len check (char_length(question) <= 200),
  -- [{id, text, box: [x0, y0, x1, y1] | null}], at most 24 lines
  lines jsonb not null default '[]'::jsonb
    constraint doubts_lines_shape check (jsonb_typeof(lines) = 'array')
    constraint doubts_lines_cap check (learner.jsonb_array_len(lines) <= 24),

  -- the photo, as kept in the bucket at <subject_id>/<id>.jpg
  width integer not null default 0
    constraint doubts_width check (width between 0 and 1600),
  height integer not null default 0
    constraint doubts_height check (height between 0 and 1600),

  -- where it sits in the climb
  node_id text
    constraint doubts_node_len check (node_id is null or char_length(node_id) <= 64),
  node_name text
    constraint doubts_node_name_len check (node_name is null or char_length(node_name) <= 160),
  framework_id text
    constraint doubts_framework_len check (framework_id is null or char_length(framework_id) <= 128)
);

create index if not exists doubts_by_learner on learner.doubts (subject_id, created_at desc);

comment on table learner.doubts is
  'One photographed doubt per row: what Wobo read from the page, corrected by the learner, and where it was filed in their syllabus. The photo is in the doubt-photos bucket at <subject_id>/<id>.jpg. Screened before it was kept; erased with the account.';

alter table learner.doubts enable row level security;

drop policy if exists doubts_own on learner.doubts;
create policy doubts_own on learner.doubts for select to authenticated
  using (subject_id = auth.uid());

drop policy if exists doubts_own_erase on learner.doubts;
create policy doubts_own_erase on learner.doubts for delete to authenticated
  using (subject_id = auth.uid());

grant select, delete on learner.doubts to authenticated;
grant all on learner.doubts to service_role;

-- The bucket. Private, like the three in 0003: every read and write goes through the gateway with
-- the service role, and the object path is the account id, so an erase is one prefix.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doubt-photos', 'doubt-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
