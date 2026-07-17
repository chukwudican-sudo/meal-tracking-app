-- Phase 2 sync: seed a small batch of placeholder premade recipes so plan
-- creation and saved-recipe sync can be tested end-to-end before real content
-- exists. These are is_premade=true / user_id=null (world-readable via RLS,
-- admin-managed). The fixed UUIDs match constants/premadeRecipes.ts so the app
-- can reference them without a lookup table. Idempotent: re-running replaces the
-- seeded rows and their children.

-- Recipes ---------------------------------------------------------------------
insert into public.recipes
  (id, user_id, name, calories, protein_grams, carbs_grams, fats_grams,
   cook_time_minutes, difficulty, meal_type, is_premade, source, has_full_recipe)
values
  ('11111111-1111-4111-8111-111111111111', null, 'Oats & Berries',       340, 12, 58,  7,  8, 'Easy',   'Breakfast', true, 'premade', true),
  ('22222222-2222-4222-8222-222222222222', null, 'Greek Yogurt Bowl',    290, 22, 32,  8,  5, 'Easy',   'Breakfast', true, 'premade', true),
  ('33333333-3333-4333-8333-333333333333', null, 'Chicken Caesar Salad', 520, 42, 18, 30, 18, 'Medium', 'Lunch',     true, 'premade', true),
  ('44444444-4444-4444-8444-444444444444', null, 'Quinoa Power Bowl',    540, 22, 64, 20, 25, 'Medium', 'Lunch',     true, 'premade', true),
  ('55555555-5555-4555-8555-555555555555', null, 'Salmon & Rice',        640, 42, 52, 26, 25, 'Hard',   'Dinner',    true, 'premade', true),
  ('66666666-6666-4666-8666-666666666666', null, 'Protein Smoothie',     290, 30, 32,  6,  5, 'Easy',   'Snacks',    true, 'premade', true)
on conflict (id) do update set
  name = excluded.name,
  calories = excluded.calories,
  protein_grams = excluded.protein_grams,
  carbs_grams = excluded.carbs_grams,
  fats_grams = excluded.fats_grams,
  cook_time_minutes = excluded.cook_time_minutes,
  difficulty = excluded.difficulty,
  meal_type = excluded.meal_type,
  is_premade = excluded.is_premade,
  source = excluded.source,
  has_full_recipe = excluded.has_full_recipe;

-- Ingredients (replace children so re-runs stay clean) ------------------------
delete from public.recipe_ingredients where recipe_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
);

insert into public.recipe_ingredients (recipe_id, ingredient_name, quantity, unit, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'Rolled oats',      60,  'g',    0),
  ('11111111-1111-4111-8111-111111111111', 'Milk',             200, 'ml',   1),
  ('11111111-1111-4111-8111-111111111111', 'Blueberries',      80,  'g',    2),
  ('11111111-1111-4111-8111-111111111111', 'Honey',            1,   'tbsp', 3),

  ('22222222-2222-4222-8222-222222222222', 'Greek yogurt',     200, 'g',    0),
  ('22222222-2222-4222-8222-222222222222', 'Granola',          30,  'g',    1),
  ('22222222-2222-4222-8222-222222222222', 'Strawberries',     80,  'g',    2),
  ('22222222-2222-4222-8222-222222222222', 'Honey',            1,   'tsp',  3),

  ('33333333-3333-4333-8333-333333333333', 'Chicken breast',   180, 'g',    0),
  ('33333333-3333-4333-8333-333333333333', 'Romaine lettuce',  120, 'g',    1),
  ('33333333-3333-4333-8333-333333333333', 'Caesar dressing',  30,  'ml',   2),
  ('33333333-3333-4333-8333-333333333333', 'Parmesan',         15,  'g',    3),
  ('33333333-3333-4333-8333-333333333333', 'Croutons',         25,  'g',    4),

  ('44444444-4444-4444-8444-444444444444', 'Quinoa',           80,  'g',    0),
  ('44444444-4444-4444-8444-444444444444', 'Chickpeas',        100, 'g',    1),
  ('44444444-4444-4444-8444-444444444444', 'Cucumber',         60,  'g',    2),
  ('44444444-4444-4444-8444-444444444444', 'Cherry tomatoes',  80,  'g',    3),
  ('44444444-4444-4444-8444-444444444444', 'Olive oil',        1,   'tbsp', 4),
  ('44444444-4444-4444-8444-444444444444', 'Lemon',            0.5, 'units',5),

  ('55555555-5555-4555-8555-555555555555', 'Salmon fillet',    180, 'g',    0),
  ('55555555-5555-4555-8555-555555555555', 'Rice',             100, 'g',    1),
  ('55555555-5555-4555-8555-555555555555', 'Broccoli',         120, 'g',    2),
  ('55555555-5555-4555-8555-555555555555', 'Olive oil',        1,   'tbsp', 3),
  ('55555555-5555-4555-8555-555555555555', 'Lemon',            0.5, 'units',4),

  ('66666666-6666-4666-8666-666666666666', 'Whey protein',     30,  'g',    0),
  ('66666666-6666-4666-8666-666666666666', 'Banana',           1,   'units',1),
  ('66666666-6666-4666-8666-666666666666', 'Milk',             250, 'ml',   2),
  ('66666666-6666-4666-8666-666666666666', 'Peanut butter',    1,   'tsp',  3);

-- Steps ----------------------------------------------------------------------
delete from public.recipe_steps where recipe_id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
);

insert into public.recipe_steps (recipe_id, step_number, instruction_text) values
  ('11111111-1111-4111-8111-111111111111', 1, 'Combine oats and milk in a saucepan over medium heat.'),
  ('11111111-1111-4111-8111-111111111111', 2, 'Simmer 5 minutes, stirring, until thickened.'),
  ('11111111-1111-4111-8111-111111111111', 3, 'Top with blueberries and drizzle with honey.'),

  ('22222222-2222-4222-8222-222222222222', 1, 'Spoon yogurt into a bowl.'),
  ('22222222-2222-4222-8222-222222222222', 2, 'Top with granola and sliced strawberries.'),
  ('22222222-2222-4222-8222-222222222222', 3, 'Drizzle with honey.'),

  ('33333333-3333-4333-8333-333333333333', 1, 'Season and pan-sear chicken 5 minutes per side; rest then slice.'),
  ('33333333-3333-4333-8333-333333333333', 2, 'Toss lettuce with dressing.'),
  ('33333333-3333-4333-8333-333333333333', 3, 'Top with chicken, parmesan, and croutons.'),

  ('44444444-4444-4444-8444-444444444444', 1, 'Cook quinoa per package, then cool.'),
  ('44444444-4444-4444-8444-444444444444', 2, 'Combine with chickpeas, cucumber, and tomatoes.'),
  ('44444444-4444-4444-8444-444444444444', 3, 'Dress with olive oil, lemon juice, salt.'),

  ('55555555-5555-4555-8555-555555555555', 1, 'Cook rice per package.'),
  ('55555555-5555-4555-8555-555555555555', 2, 'Pan-sear salmon 3 minutes per side; season with salt, pepper, lemon.'),
  ('55555555-5555-4555-8555-555555555555', 3, 'Steam broccoli 5 minutes.'),
  ('55555555-5555-4555-8555-555555555555', 4, 'Plate together.'),

  ('66666666-6666-4666-8666-666666666666', 1, 'Combine all ingredients in a blender.'),
  ('66666666-6666-4666-8666-666666666666', 2, 'Blend 30 seconds until smooth.');

-- Free-tier access: exactly 5 of the 6 are free (the smoothie is premium) ------
insert into public.premade_recipe_access (recipe_id, is_free) values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true),
  ('33333333-3333-4333-8333-333333333333', true),
  ('44444444-4444-4444-8444-444444444444', true),
  ('55555555-5555-4555-8555-555555555555', true),
  ('66666666-6666-4666-8666-666666666666', false)
on conflict (recipe_id) do update set is_free = excluded.is_free;
