// Change-data-capture over the Zustand store. Rather than adding sync calls to
// every action, we subscribe once and diff the synced slices, enqueuing outbox
// ops for whatever changed. `start()` establishes a baseline WITHOUT enqueuing
// (the initial upload is handled by the engine's reconcile), then each
// subsequent change emits the delta. Reference checks keep unrelated updates
// cheap; per-record content hashes avoid spurious writes.

import { useMealStore } from '@/store/useMealStore';
import type { AppStore, GroceryItem, MealEntry, SavedRecipe, ServerSnapshot } from '@/store/types';
import { outbox } from './outbox';
import { entityKey } from './types';
import { sectionToTable } from './mappers';
import type { SyncTable } from './types';

interface MealSnap { hash: string; date: string; entry: MealEntry; slotName: string | null }
interface WeightSnap { hash: string }
interface SavedSnap { hash: string; sr: SavedRecipe }
interface GrocerySnap { hash: string; table: SyncTable; name: string; item: GroceryItem }

function slotNameFor(state: AppStore, entry: MealEntry): string | null {
  if (!entry.slotId) return entry.category ?? null;
  return state.profile.mealSlots.find(s => s.id === entry.slotId)?.name ?? null;
}

function mealHash(entry: MealEntry): string {
  return JSON.stringify([
    entry.name, entry.time, entry.slotId, entry.calories,
    entry.macros?.protein, entry.macros?.carbs, entry.macros?.fats,
    entry.status, entry.servings, entry.photoUri,
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
function usersHash(state: AppStore): string {
  const p = state.profile;
  const g = state.goals;
  return JSON.stringify([
    p.email, p.firstName, p.name, p.gender, p.birthday, p.age, p.heightCm,
    p.weightKg, p.targetWeightKg, p.goalType, p.activityLevel, p.paceLbsPerWeek,
    p.dietaryRestrictions, p.allergies, p.trackedNutrients, p.goalDate,
    p.notificationsAllowed,
    g.dailyCalories, g.protein, g.carbs, g.fats, g.waterTargetCups,
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

class Projector {
  private unsub: (() => void) | null = null;
  private prevLogsRef: unknown = null;
  private prevWeightRef: unknown = null;
  private prevSavedRef: unknown = null;
  private prevGroceryRef: unknown = null;
  private prevProfileRef: unknown = null;
  private prevGoalsRef: unknown = null;

  private meals = new Map<string, MealSnap>();
  private weights = new Map<string, WeightSnap>();
  private saved = new Map<string, SavedSnap>();
  private grocery = new Map<string, GrocerySnap>();
  private usersHashValue = '';

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

  // Reset the baseline to current state without enqueuing (used after applying a
  // pulled snapshot so server data isn't echoed straight back).
  rebaseline(): void {
    const s = useMealStore.getState();
    this.meals = buildMeals(s);
    this.weights = buildWeights(s);
    this.saved = buildSaved(s);
    this.grocery = buildGrocery(s);
    this.usersHashValue = usersHash(s);
    this.prevLogsRef = s.logs;
    this.prevWeightRef = s.weightLog;
    this.prevSavedRef = s.savedRecipes;
    this.prevGroceryRef = s.grocery;
    this.prevProfileRef = s.profile;
    this.prevGoalsRef = s.goals;
  }

  // Enqueue upserts for the entire current dataset (first-time upload).
  enqueueAll(): void {
    const s = useMealStore.getState();
    buildMeals(s).forEach((snap, id) => this.upsertMeal(id, snap));
    buildWeights(s).forEach((_snap, date) => this.upsertWeight(date));
    buildSaved(s).forEach((snap) => this.upsertSaved(snap.sr));
    buildGrocery(s).forEach((snap, key) => this.upsertGrocery(key, snap));
    this.upsertUsers();
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

    this.rebaseline();
  }

  private onChange(state: AppStore): void {
    if (!outbox.isActive) return;

    if (state.logs !== this.prevLogsRef || state.profile !== this.prevProfileRef) {
      this.diffMeals(state);
      this.prevLogsRef = state.logs;
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
    this.meals.forEach((_snap, id) => {
      if (!curr.has(id)) {
        outbox.enqueue({ table: 'meal_logs', op: 'delete', entityKey: entityKey.mealLog(id), payload: { mealId: id } });
      }
    });
    this.meals = curr;
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
  private upsertUsers(): void {
    const s = useMealStore.getState();
    outbox.enqueue({ table: 'users', op: 'upsert', entityKey: entityKey.usersSelf(), payload: { profile: s.profile, goals: s.goals } });
  }
}

export const projector = new Projector();
