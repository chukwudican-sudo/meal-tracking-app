-- The 6 server copies of built-in recipes (seeded Jul 14 by
-- 20260714010300_seed_premade_recipes.sql, ids in constants/premadeRecipes.ts)
-- take the USDA numbers the app's recipes use since Nov 18
-- (constants/recipeSeed.ts, checked by `npm run check:recipe-nutrition`).
-- A bookmarked built-in recipe that comes back from the server (reinstall, new
-- phone) reads its calories and macros from these rows. Ingredients and steps
-- are unchanged. Generated from recipeSeed.ts, not typed by hand. Idempotent.

update public.recipes as r set
  calories      = v.calories,
  protein_grams = v.protein,
  carbs_grams   = v.carbs,
  fats_grams    = v.fats
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 440, 15, 79, 8), -- Oats & Berries
  ('22222222-2222-4222-8222-222222222222'::uuid, 340, 25, 36, 11), -- Greek Yogurt Bowl
  ('33333333-3333-4333-8333-333333333333'::uuid, 573, 51, 21, 31), -- Chicken Caesar Salad
  ('44444444-4444-4444-8444-444444444444'::uuid, 580, 20, 81, 21), -- Quinoa Power Bowl
  ('55555555-5555-4555-8555-555555555555'::uuid, 905, 47, 90, 39), -- Salmon & Rice
  ('66666666-6666-4666-8666-666666666666'::uuid, 371, 34, 42, 9)  -- Protein Smoothie
) as v(id, calories, protein, carbs, fats)
where r.id = v.id and r.is_premade;
