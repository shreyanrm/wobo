-- Deterministic dev seed (mock-first). The mock subject is the dev identity (DEV_AUTH=true).
-- The seeded learner is a placeholder, never a person (DESIGN.md §0: no invented names). No real institutions; ₹999 / ₹8,999 elsewhere.
insert into learner.profiles_cache (subject_id, display_name, grade, board, consent_tier)
values ('00000000-0000-7000-8000-000000000001', 'Learner', '7', 'CBSE', 'un_elevated')
on conflict (subject_id) do update set display_name = excluded.display_name;

insert into learner.meter_state (subject_id, date, budget_total, budget_consumed)
values ('00000000-0000-7000-8000-000000000001', current_date, 3, 0)
on conflict (subject_id, date) do nothing;
