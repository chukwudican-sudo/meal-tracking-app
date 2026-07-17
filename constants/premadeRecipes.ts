// Maps the local premade recipe slugs (from constants/recipeSeed.ts) to the
// fixed Supabase UUIDs seeded by supabase/migrations/0004_seed_premade_recipes.sql.
// When a user saves one of these premade recipes, the sync layer references the
// seeded server recipe by UUID instead of duplicating it into the user's own
// `recipes` rows. Any premade recipe NOT in this map falls back to a per-user
// copy at sync time, so partial coverage is safe.
export const PREMADE_RECIPE_UUIDS: Record<string, string> = {
  'rcp-bf-oats-berries': '11111111-1111-4111-8111-111111111111',
  'rcp-bf-greek-yogurt-bowl': '22222222-2222-4222-8222-222222222222',
  'rcp-ln-chicken-caesar': '33333333-3333-4333-8333-333333333333',
  'rcp-ln-quinoa-bowl': '44444444-4444-4444-8444-444444444444',
  'rcp-dn-salmon-rice': '55555555-5555-4555-8555-555555555555',
  'rcp-sn-protein-smoothie': '66666666-6666-4666-8666-666666666666',
};

export function premadeUuidForSlug(slug: string | undefined | null): string | null {
  if (!slug) return null;
  return PREMADE_RECIPE_UUIDS[slug] ?? null;
}
