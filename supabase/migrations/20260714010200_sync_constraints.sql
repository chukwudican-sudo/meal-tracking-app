-- Phase 2 sync: natural-key uniqueness for clean last-write-wins upserts.
-- The client upserts grocery items by (user_id, ingredient_name) and weight
-- entries by (user_id, logged_at) [logged_at is normalized to UTC midnight, so
-- it is effectively one row per user per day]. Unique indexes let PostgREST's
-- on_conflict target these columns.

create unique index if not exists kitchen_items_user_ingredient_uidx
  on public.kitchen_items (user_id, ingredient_name);

create unique index if not exists cart_items_user_ingredient_uidx
  on public.cart_items (user_id, ingredient_name);

create unique index if not exists planned_ingredients_user_ingredient_uidx
  on public.planned_ingredients (user_id, ingredient_name);

create unique index if not exists weight_logs_user_day_uidx
  on public.weight_logs (user_id, logged_at);
