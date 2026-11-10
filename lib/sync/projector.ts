// Change-data-capture over the Zustand store. Rather than adding sync calls to
// every action, we subscribe once and diff the synced slices, enqueuing outbox
// ops for whatever changed. `start()` establishes a baseline WITHOUT enqueuing
// (the initial upload is handled by the engine's reconcile), then each
// subsequent change emits the delta. Reference checks keep unrelated updates
// cheap; per-record content hashes avoid spurious writes.

import { isPlanTemplate, useMealStore } from '@/store/useMealStore';
import type {
  AppStore, GroceryItem, MealEntry, MealPlan, MealTemplate, SavedRecipe, ServerSnapshot,
} from '@/store/types';
import { outbox } from './outbox';
import { entityKey } from './types';
import { activePlanWire, sectionToTable } from './mappers';
import type { SyncTable } from './types';

interface MealSnap { hash: string; date: string; entry: MealEntry; slotName: string | null }
interface WeightSnap { hash: string }
interface SavedSnap { hash: string; sr: SavedRecipe }
interface GrocerySnap { hash: string; table: SyncTable; name: string; item: GroceryItem }
interface PlanSnap { hash: string; plan: MealPlan; isActive: boolean }
interface TemplateSnap { hash: string; template: MealTemplate }

function slotNameFor(state: AppStore, entry: MealEntry): string | null {
  if (!entry.slotId) return entry.category ?? null;
  return state.profile.mealSlots.find(s => s.id === entry.slotId)?.name ?? null;
}

function mealHash(entry: MealEntry): string {
  return JSON.stringify([
    entry.name, entry.time, entry.slotId, entry.calories,
    entry.macros?.protein, entry.macros?.carbs, entry.macros?.fats,
    entry.status, entry.servings, entry.photoUri, entry.photoPath, entry.nutrients,
    (entry.ingredients ?? []).map(i => [i.name, i.quantity, i.unit, i.calories]),
  ]);
}
function savedHash(sr: SavedRecipe): string {
  return JSON.stringify([
    sr.name, sr.category, sr.calories, sr.cookTimeMin, sr.macros, sr.difficulty,
    sr.source, sr.favourited, sr.recipeId,
    (sr.ingredients ?? []).map(i => [i.name, i.quantity, i.unit]),
    sr.steps,
  ]);
}
function groceryHash(item: GroceryItem): string {
  return JSON.stringify([item.name, item.section, item.category, item.struckThrough]);
}
function planHash(plan: MealPlan, isActive: boolean): string {
  return JSON.stringify([
    plan.name,
    isActive, // an activation flip must re-push so is_active moves server-side
    plan.category,
    plan.description,
    plan.disclaimer,
    plan.days.map(day => (day ?? []).map(m => [m.slotName, m.time, m.recipeId, m.recipeName, m.servings ?? 1])),
  ]);
}
function usersHash(state: AppStore): string {
  const p = state.profile;
  const g = state.goals;
  return JSON.stringify([
    p.email, p.firstName, p.name, p.gender, p.birthday, p.age, p.heightCm,
    p.weightKg, p.targetWeightKg, p.goalType, p.activityLevel, p.paceLbsPerWeek,
    p.dietaryRestrictions, p.allergies, p.trackedNutrients, p.goalDate,
    p.notificationsAllowed, p.activePlanName,
    p.lastName, p.weightUnit, p.mealSlots, p.mealRemindersEnabled, p.remindMinutesBefore,
    p.aiConsent, p.aiConsentAt,
    g.dailyCalories, g.protein, g.carbs, g.fats, g.waterTargetCups, g.secondaryTargets,
  ]);
}

function buildMeals(state: AppStore): Map<string, MealSnap> {
  const map = new Map<string, MealSnap>();
  for (const [date, log] of Object.entries(state.logs)) {
    (log?.meals ?? []).forEach(entry => {
      // Built-in demo/sample meals are never uploaded — they'd otherwise appear
      // in a brand-new account's cloud data as if they were real logs.
      if (entry.seed) return;
      map.set(entry.id, { hash: mealHash(entry), date, entry, slotName: slotNameFor(state, entry) });
    });
  }
  return map;
}
function buildWeights(state: AppStore): Map<string, WeightSnap> {
  return new Map(state.weightLog.map(e => [e.date, { hash: String(e.weightKg) }]));
}
function buildSaved(state: AppStore): Map<string, SavedSnap> {
  return new Map(state.savedRecipes.map(sr => [sr.id, { hash: savedHash(sr), sr }]));
}
function buildGrocery(state: AppStore): Map<string, GrocerySnap> {
  const map = new Map<string, GrocerySnap>();
  for (const item of Object.values(state.grocery.items)) {
    const table = sectionToTable(item.section);
    if (!table) continue; // 'none' not represented server-side
    map.set(item.key, { hash: groceryHash(item), table, name: item.name, item });
  }
  return map;
}
function buildPlans(state: AppStore): Map<string, PlanSnap> {
  const map = new Map<string, PlanSnap>();
  const activeName = state.profile.activePlanName;
  for (const plan of state.savedPlans) {
    // Only user plans sync; the premade catalog is read-only seed data.
    if (plan.source === 'premade') continue;
    const isActive = !!activeName && plan.name === activeName;
    map.set(plan.id, { hash: planHash(plan, isActive), plan, isActive });
  }
  return map;
}

// Water per date (ml). Days holding the first-launch demo meals are skipped:
// their sample water isn't the user's.
function buildWater(state: AppStore): Map<string, number> {
  const map = new Map<string, number>();
  for (const [date, log] of Object.entries(state.logs)) {
    if (!log || !(log.waterMl > 0) || log.meals.some(m => m.seed)) continue;
    map.set(date, log.waterMl);
  }
  return map;
}
// Only the user's own templates; a plan rebuilds its own.
function buildTemplates(state: AppStore): Map<string, TemplateSnap> {
  const map = new Map<string, TemplateSnap>();
  state.templates.forEach(t => {
    if (!isPlanTemplate(t)) map.set(t.id, { hash: JSON.stringify(t), template: t });
  });
  return map;
}

const PHOTO_DELETE_DELAY_MS = 15_000;

class Projector {
  private unsub: (() => void) | null = null;
  private prevLogsRef: unknown = null;
  private prevWeightRef: unknown = null;
  private prevSavedRef: unknown = null;
  private prevGroceryRef: unknown = null;
  private prevProfileRef: unknown = null;
  private prevGoalsRef: unknown = null;
  private prevSavedPlansRef: unknown = null;
  private prevTemplatesRef: unknown = null;
  private prevActivePlanName: string | undefined = undefined;

  private meals = new Map<string, MealSnap>();
  private weights = new Map<string, WeightSnap>();
  private saved = new Map<string, SavedSnap>();
  private grocery = new Map<string, GrocerySnap>();
  private plans = new Map<string, PlanSnap>();
  private water = new Map<string, number>();
  private templates = new Map<string, TemplateSnap>();
  private usersHashValue = '';
  private applying = false;

  start(): void {
    this.rebaseline();
    if (!this.unsub) {
      this.unsub = useMealStore.subscribe(state => this.onChange(state as AppStore));
    }
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  // Apply server data without capturing it as edits. Zustand notifies
  // subscribers synchronously inside set(), so a rebaseline afterwards is too
  // late: every pulled record had already been queued for upload again (a
  // fresh-install restore re-sent ~150 rows, Nov 4). The baseline then moves
  // to the applied state, so only later real edits are captured.
  applyWithoutCapture(apply: () => void): void {
    this.applying = true;
    try {
      apply();
    } finally {
      this.applying = false;
      this.rebaseline();
    }
  }

  // Reset the baseline to current state without enqueuing (used after applying a
  // pulled snapshot so server data isn't echoed straight back).
  rebaseline(): void {
    const s = useMealStore.getState();
    this.meals = buildMeals(s);
    this.weights = buildWeights(s);
    this.saved = buildSaved(s);
    this.grocery = buildGrocery(s);
    this.plans = buildPlans(s);
    this.water = buildWater(s);
    this.templates = buildTemplates(s);
    this.usersHashValue = usersHash(s);
    this.prevLogsRef = s.logs;
    this.prevWeightRef = s.weightLog;
    this.prevSavedRef = s.savedRecipes;
    this.prevGroceryRef = s.grocery;
    this.prevProfileRef = s.profile;
    this.prevGoalsRef = s.goals;
    this.prevSavedPlansRef = s.savedPlans;
    this.prevTemplatesRef = s.templates;
    this.prevActivePlanName = s.profile.activePlanName;
  }

  // Enqueue upserts for the entire current dataset (first-time upload).
  enqueueAll(): void {
    const s = useMealStore.getState();
    buildMeals(s).forEach((snap, id) => this.upsertMeal(id, snap));
    buildWeights(s).forEach((_snap, date) => this.upsertWeight(date));
    buildSaved(s).forEach((snap) => this.upsertSaved(snap.sr));
    buildGrocery(s).forEach((snap, key) => this.upsertGrocery(key, snap));
    buildPlans(s).forEach((snap) => this.upsertPlan(snap));
    buildWater(s).forEach((ml, date) => this.upsertWater(date, ml));
    buildTemplates(s).forEach(snap => this.upsertTemplate(snap.template));
    this.upsertUsers();
    this.rebaseline();
  }

  // One-time upload of photos added before meal photos synced (Nov 9): any
  // meal with a local photo never uploaded. Unreadable files are skipped at
  // push time (the meal still syncs).
  enqueuePhotoBackfill(): void {
    buildMeals(useMealStore.getState()).forEach((snap, id) => {
      const e = snap.entry;
      if (e.photoUri && e.photoUri !== e.photoUploadedFrom) this.upsertMeal(id, snap);
    });
  }

  // One-time upload of what this phone already had before settings, water,
  // own templates and secondary nutrients started syncing (Nov 6): the
  // baseline already holds them, so they'd otherwise only go up when next
  // edited. Run once per account per install, by the engine.
  enqueueSyncUpgradeBackfill(): void {
    const s = useMealStore.getState();
    this.upsertUsers();
    buildWater(s).forEach((ml, date) => this.upsertWater(date, ml));
    buildTemplates(s).forEach(snap => this.upsertTemplate(snap.template));
    buildMeals(s).forEach((snap, id) => {
      if (snap.entry.nutrients && Object.keys(snap.entry.nutrients).length > 0) this.upsertMeal(id, snap);
    });
    this.rebaseline();
  }

  // Enqueue upserts for local records absent from the just-pulled server data.
  // Used on same-account reconcile so records that never reached the server
  // (offline creates, or rows healed to new UUIDs by the store migration) get
  // uploaded rather than silently stranded on-device.
  enqueueMissing(snapshot: ServerSnapshot): void {
    const s = useMealStore.getState();

    const serverMealIds = new Set<string>();
    Object.values(snapshot.logsByDate ?? {}).forEach(meals =>
      (meals ?? []).forEach(m => serverMealIds.add(m.id)),
    );
    buildMeals(s).forEach((snap, id) => {
      if (!serverMealIds.has(id)) this.upsertMeal(id, snap);
    });

    const serverWeightDates = new Set((snapshot.weightLog ?? []).map(w => w.date));
    buildWeights(s).forEach((_snap, date) => {
      if (!serverWeightDates.has(date)) this.upsertWeight(date);
    });

    const serverSavedIds = new Set((snapshot.savedRecipes ?? []).map(r => r.id));
    buildSaved(s).forEach(snap => {
      if (!serverSavedIds.has(snap.sr.id)) this.upsertSaved(snap.sr);
    });

    const serverGroceryKeys = new Set((snapshot.groceryItems ?? []).map(it => it.key));
    buildGrocery(s).forEach((snap, key) => {
      if (!serverGroceryKeys.has(key)) this.upsertGrocery(key, snap);
    });

    // Accounts from before users.active_plan_name existed (or a pointer never
    // uploaded): send it once, or a reinstall can't bring the plan back.
    if (snapshot.usersActivePlanName !== undefined) {
      // Also rewrites a never-written null as '' when no plan is running.
      if (activePlanWire(s.profile.activePlanName) !== snapshot.usersActivePlanName) this.upsertUsers();
    }

    const serverPlanIds = new Set((snapshot.plans ?? []).map(pl => pl.id));
    buildPlans(s).forEach(snap => {
      if (!serverPlanIds.has(snap.plan.id)) this.upsertPlan(snap);
    });

    const serverWater = snapshot.waterByDate ?? {};
    buildWater(s).forEach((ml, date) => {
      if (!(date in serverWater)) this.upsertWater(date, ml);
    });
    const serverTemplateIds = new Set((snapshot.templates ?? []).map(t => t.id));
    buildTemplates(s).forEach(snap => {
      if (!serverTemplateIds.has(snap.template.id)) this.upsertTemplate(snap.template);
    });

    this.rebaseline();
  }

  private onChange(state: AppStore): void {
    if (!outbox.isActive || this.applying) return;

    if (state.logs !== this.prevLogsRef || state.profile !== this.prevProfileRef) {
      this.diffMeals(state);
      if (state.logs !== this.prevLogsRef) this.diffWater(state);
      this.prevLogsRef = state.logs;
    }
    if (state.templates !== this.prevTemplatesRef) {
      this.diffTemplates(state);
      this.prevTemplatesRef = state.templates;
    }
    if (state.weightLog !== this.prevWeightRef) {
      this.diffWeights(state);
      this.prevWeightRef = state.weightLog;
    }
    if (state.savedRecipes !== this.prevSavedRef) {
      this.diffSaved(state);
      this.prevSavedRef = state.savedRecipes;
    }
    if (state.grocery !== this.prevGroceryRef) {
      this.diffGrocery(state);
      this.prevGroceryRef = state.grocery;
    }
    // Plans change when the catalog changes OR the active pointer flips (the
    // latter lives on profile.activePlanName, so gate on its value not the ref).
    if (state.savedPlans !== this.prevSavedPlansRef || state.profile.activePlanName !== this.prevActivePlanName) {
      this.diffPlans(state);
      this.prevSavedPlansRef = state.savedPlans;
      this.prevActivePlanName = state.profile.activePlanName;
    }
    if (state.profile !== this.prevProfileRef || state.goals !== this.prevGoalsRef) {
      const h = usersHash(state);
      if (h !== this.usersHashValue) {
        this.usersHashValue = h;
        this.upsertUsers();
      }
      this.prevProfileRef = state.profile;
      this.prevGoalsRef = state.goals;
    }
  }

  // ── diff helpers ──────────────────────────────────────────────────────────

  private diffMeals(state: AppStore): void {
    const curr = buildMeals(state);
    curr.forEach((snap, id) => {
      if (this.meals.get(id)?.hash !== snap.hash) this.upsertMeal(id, snap);
    });
    this.meals.forEach((prev, id) => {
      const next = curr.get(id);
      if (!next) {
        outbox.enqueue({ table: 'meal_logs', op: 'delete', entityKey: entityKey.mealLog(id), payload: { mealId: id } });
      }
      // The cloud photo this meal pointed at is no longer used (photo
      // replaced or removed, or the meal deleted): remove the file too.
      // Held back 15s so Undo (5s) can bring the meal and its photo back.
      const oldPhoto = prev.entry.photoPath;
      if (oldPhoto && next?.entry.photoPath !== oldPhoto) {
        outbox.enqueue({
          table: 'meal_photos', op: 'delete', entityKey: entityKey.photo(oldPhoto),
          payload: { path: oldPhoto }, delayMs: PHOTO_DELETE_DELAY_MS,
        });
      }
    });
    // A photo back in use (Undo restored its meal): cancel its pending delete.
    curr.forEach((next, id) => {
      const path = next.entry.photoPath;
      if (path && this.meals.get(id)?.entry.photoPath !== path) outbox.discard(entityKey.photo(path));
    });
    this.meals = curr;
  }

  private diffWater(state: AppStore): void {
    const curr = buildWater(state);
    curr.forEach((ml, date) => {
      if (this.water.get(date) !== ml) this.upsertWater(date, ml);
    });
    // Back to 0 (or the day removed): write 0 — water has no delete.
    this.water.forEach((_ml, date) => {
      if (!curr.has(date)) this.upsertWater(date, 0);
    });
    this.water = curr;
  }

  private diffTemplates(state: AppStore): void {
    const curr = buildTemplates(state);
    curr.forEach((snap, id) => {
      if (this.templates.get(id)?.hash !== snap.hash) this.upsertTemplate(snap.template);
    });
    this.templates.forEach((_snap, id) => {
      if (!curr.has(id)) {
        outbox.enqueue({ table: 'meal_templates', op: 'delete', entityKey: entityKey.template(id), payload: { templateId: id } });
      }
    });
    this.templates = curr;
  }

  private diffWeights(state: AppStore): void {
    const curr = buildWeights(state);
    curr.forEach((snap, date) => {
      if (this.weights.get(date)?.hash !== snap.hash) this.upsertWeight(date);
    });
    this.weights.forEach((_snap, date) => {
      if (!curr.has(date)) {
        outbox.enqueue({ table: 'weight_logs', op: 'delete', entityKey: entityKey.weightLog(date), payload: { date } });
      }
    });
    this.weights = curr;
  }

  private diffSaved(state: AppStore): void {
    const curr = buildSaved(state);
    curr.forEach((snap) => {
      if (this.saved.get(snap.sr.id)?.hash !== snap.hash) this.upsertSaved(snap.sr);
    });
    this.saved.forEach((snap, id) => {
      if (!curr.has(id)) {
        outbox.enqueue({ table: 'saved_recipes', op: 'delete', entityKey: entityKey.savedRecipe(id), payload: { savedRecipe: snap.sr } });
      }
    });
    this.saved = curr;
  }

  private diffPlans(state: AppStore): void {
    const curr = buildPlans(state);
    curr.forEach((snap, id) => {
      if (this.plans.get(id)?.hash !== snap.hash) this.upsertPlan(snap);
    });
    this.plans.forEach((snap, id) => {
      if (!curr.has(id)) {
        outbox.enqueue({ table: 'plans', op: 'delete', entityKey: entityKey.plan(id), payload: { plan: snap.plan } });
      }
    });
    this.plans = curr;
  }

  private diffGrocery(state: AppStore): void {
    const curr = buildGrocery(state);
    curr.forEach((snap, key) => {
      const prev = this.grocery.get(key);
      if (!prev) {
        this.upsertGrocery(key, snap);
      } else if (prev.table !== snap.table) {
        // Moved sections: delete from old table, upsert into new.
        outbox.enqueue({ table: prev.table, op: 'delete', entityKey: entityKey.grocery(prev.table, key), payload: { name: prev.name } });
        this.upsertGrocery(key, snap);
      } else if (prev.hash !== snap.hash) {
        this.upsertGrocery(key, snap);
      }
    });
    this.grocery.forEach((prev, key) => {
      if (!curr.has(key)) {
        outbox.enqueue({ table: prev.table, op: 'delete', entityKey: entityKey.grocery(prev.table, key), payload: { name: prev.name } });
      }
    });
    this.grocery = curr;
  }

  // ── enqueue shortcuts ─────────────────────────────────────────────────────

  private upsertMeal(id: string, snap: MealSnap): void {
    outbox.enqueue({
      table: 'meal_logs', op: 'upsert', entityKey: entityKey.mealLog(id),
      payload: { date: snap.date, entry: snap.entry, slotName: snap.slotName },
    });
  }
  private upsertWeight(date: string): void {
    const entry = useMealStore.getState().weightLog.find(e => e.date === date);
    if (!entry) return;
    outbox.enqueue({ table: 'weight_logs', op: 'upsert', entityKey: entityKey.weightLog(date), payload: { entry } });
  }
  private upsertSaved(sr: SavedRecipe): void {
    outbox.enqueue({ table: 'saved_recipes', op: 'upsert', entityKey: entityKey.savedRecipe(sr.id), payload: { savedRecipe: sr } });
  }
  private upsertGrocery(key: string, snap: GrocerySnap): void {
    outbox.enqueue({ table: snap.table, op: 'upsert', entityKey: entityKey.grocery(snap.table, key), payload: { item: snap.item } });
  }
  private upsertPlan(snap: PlanSnap): void {
    outbox.enqueue({
      table: 'plans', op: 'upsert', entityKey: entityKey.plan(snap.plan.id),
      payload: { plan: snap.plan, isActive: snap.isActive },
    });
  }
  private upsertWater(date: string, ml: number): void {
    outbox.enqueue({ table: 'progress_daily', op: 'upsert', entityKey: entityKey.water(date), payload: { date, ml } });
  }
  private upsertTemplate(template: MealTemplate): void {
    outbox.enqueue({
      table: 'meal_templates', op: 'upsert', entityKey: entityKey.template(template.id), payload: { template },
    });
  }
  private upsertUsers(): void {
    const s = useMealStore.getState();
    outbox.enqueue({ table: 'users', op: 'upsert', entityKey: entityKey.usersSelf(), payload: { profile: s.profile, goals: s.goals } });
  }
}

export const projector = new Projector();
