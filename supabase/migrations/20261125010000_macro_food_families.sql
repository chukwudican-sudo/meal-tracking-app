-- Build My Plan food families (Nov 25, 2026): the general picks Rice, Beans and
-- Fish (the AI picks the kind per meal, like Chicken and Potato — see
-- CARB_FAMILIES / PROTEIN_FAMILIES in supabase/functions/_shared/
-- mealPromptHelpers.ts), the rice and bean kinds they expand to that the lists
-- lacked, and staples that were missing (yam, plantain, cassava, fufu, garri).
--
-- Scores come from scripts/score-macro-familiarity.ts --names: the same Gemini
-- rules every other row was scored with, run once and written here, so dev
-- and production get identical rows (fixed ids, like the Nov 13 seed).
-- `on conflict do nothing`: an existing row (same id, or the same name per the
-- lower(name) unique index) is skipped, never overwritten. Read-only reference
-- data: grants and policies are unchanged.

-- macro_carbs: 11 rows
insert into public.macro_carbs (id, name, familiarity_score) values
  ('e7313c59-b768-4b53-8a62-b49dcec6baa5', 'Rice', 100),
  ('428e91df-81ff-4f5e-b5f8-e86f42490284', 'Beans', 98),
  ('6b59dc82-45e4-4bff-aef5-c8f2ded03aa2', 'Yam', 82),
  ('3a11e0e1-46a4-4e83-b282-2971791e2f2a', 'Plantain', 80),
  ('bfc2255d-97eb-4ea7-8b27-573199c58e67', 'Basmati Rice', 78),
  ('a7352ce2-e2c0-4e94-a3ba-c7c2187aeb0c', 'Cassava', 78),
  ('f345f17e-ba76-4307-918c-cb3e2fa72e43', 'Jasmine Rice', 75),
  ('10af4999-f118-4b07-945b-cd963714da14', 'Black-Eyed Peas', 70),
  ('c84205fc-f306-4809-a9f8-8abf9b03e78c', 'Parboiled Rice', 55),
  ('193c761b-a438-41ec-8c94-0fe5b2558d8d', 'Fufu', 45),
  ('2b7846e8-745f-4d50-b306-d43510adfebd', 'Garri', 35)
on conflict do nothing;

-- macro_proteins: 1 row
insert into public.macro_proteins (id, name, familiarity_score) values
  ('c2862be2-3237-4d60-973c-c2111af5a218', 'Fish', 98)
on conflict do nothing;
