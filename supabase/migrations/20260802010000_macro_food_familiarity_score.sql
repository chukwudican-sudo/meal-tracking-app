-- Familiarity score for the Build My Plan macro picker.
--
-- A one-time Gemini pass (scripts/score-macro-familiarity.ts) scores each food
-- 0-100 on how commonly known and eaten it is by everyday people across diverse
-- global diets (a reasoned familiarity judgment, not real consumption stats).
-- The picker sorts by this score so recognizable staples (chicken breast, eggs,
-- rice) surface first instead of obscure items that sort alphabetically early.
--
-- Nullable: rows added later via the Table Editor start unscored and sort last
-- (order by ... nulls last) until a re-run of the scoring script fills them in.

alter table public.macro_proteins add column familiarity_score smallint
  check (familiarity_score between 0 and 100);
alter table public.macro_carbs add column familiarity_score smallint
  check (familiarity_score between 0 and 100);
alter table public.macro_fats add column familiarity_score smallint
  check (familiarity_score between 0 and 100);
