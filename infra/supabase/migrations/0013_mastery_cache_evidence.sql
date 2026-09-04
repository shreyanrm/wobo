-- 0013 — mastery_cache carries the evidence its band was derived from.
--
-- The table has existed since 0002 and nothing ever wrote to it: evidence lived in a Map inside the
-- KGtoPG reference and died on reload, so "we keep teaching them until they master a topic" started
-- over every session. The client writes it now (packages/sdk/src/mastery.ts), and a band alone is
-- not enough to resume with — two correct answers have to still count as two after a reload, or the
-- learner climbs the same topic forever.
--
-- Each element of `evidence` is { event_id, correct, independence, at }. event_id is the dedupe key
-- end to end, so a replayed outbox event is counted exactly once. The array is capped client-side.
--
-- Additive and idempotent. The client tolerates a database that has not applied this yet: the write
-- degrades to the band-only row shape and the evidence stays in localStorage until it lands.
-- RLS is unchanged: mastery_cache_own (0002) already keys every row to auth.uid().
alter table learner.mastery_cache
  add column if not exists evidence jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
