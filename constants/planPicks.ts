// Most items Build My Plan sends per preference list. The picker stops at these
// and the request trims to them, so nothing is ever dropped silently. The
// generate-plan-shortlist edge function enforces its own copy as a safety net
// (supabase/functions/generate-plan-shortlist: MAX_MACRO_ITEMS etc.).
export const PLAN_PICK_LIMITS = {
  proteins: 15,
  carbs: 15,
  fats: 15,
  cuisines: 20,
  loves: 20,
  avoid: 20,
} as const;
