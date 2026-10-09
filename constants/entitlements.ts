// Single source of truth for the RevenueCat entitlement identifier that
// unlocks Pro features. Must exactly match the entitlement configured in the
// RevenueCat dashboard — confirmed via purchase logs to be 'MealApp Pro', not
// 'Pro'.
//
// Imported by both the client (store/useEntitlementStore.ts) and the
// revenuecat-webhook edge function (supabase/functions/revenuecat-webhook/
// index.ts) specifically so there's only one place to update if this ever
// changes — two independently hardcoded copies of this string is what
// caused them to silently drift out of sync before.
//
// This file must stay dependency-free (no imports from anything else in the
// app or from npm packages) since it's imported directly by a Deno edge
// function that can't resolve React Native/Node-only modules.
export const PRO_ENTITLEMENT_ID = 'MealApp Pro';
