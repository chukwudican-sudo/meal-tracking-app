import { COLORS } from '@/constants/theme';
import type { IngredientCategory } from '@/store/types';

// Shared display order + dot color for ingredient categories. Single source of
// truth so the My Kitchen list, the "What can I make?" grouping, and the
// scan-kitchen review checklist all render categories identically.
export const CATEGORY_ORDER: IngredientCategory[] = [
  'Proteins',
  'Carbs & Grains',
  'Fruits & Vegetables',
  'Dairy',
  'Oils & Fats',
  'Spices & Seasonings',
  'Condiments',
  'Other',
];

export const CATEGORY_DOT: Record<IngredientCategory, string> = {
  'Proteins': COLORS.red,
  'Carbs & Grains': '#FFD60A',
  'Fruits & Vegetables': COLORS.green,
  'Dairy': COLORS.blue,
  'Oils & Fats': COLORS.orange,
  'Spices & Seasonings': COLORS.purple,
  'Condiments': '#5AC8FA',
  'Other': COLORS.textSecondary,
};

// Keyword-based categorizer. Will be replaced by AI categorization once
// the AI client is wired up; this map covers the common cases for MVP.
const KEYWORD_MAP: Record<string, IngredientCategory> = {
  // ─── Proteins ───────────────────────────────────────────────────────────
  chicken: 'Proteins',
  'chicken breast': 'Proteins',
  beef: 'Proteins',
  'ground beef': 'Proteins',
  steak: 'Proteins',
  pork: 'Proteins',
  bacon: 'Proteins',
  sausage: 'Proteins',
  ham: 'Proteins',
  turkey: 'Proteins',
  salmon: 'Proteins',
  tuna: 'Proteins',
  shrimp: 'Proteins',
  cod: 'Proteins',
  fish: 'Proteins',
  egg: 'Proteins',
  eggs: 'Proteins',
  tofu: 'Proteins',
  tempeh: 'Proteins',
  lentils: 'Proteins',
  chickpeas: 'Proteins',
  'black beans': 'Proteins',
  'kidney beans': 'Proteins',
  beans: 'Proteins',
  'protein powder': 'Proteins',

  // ─── Carbs & Grains ─────────────────────────────────────────────────────
  rice: 'Carbs & Grains',
  'brown rice': 'Carbs & Grains',
  'white rice': 'Carbs & Grains',
  oats: 'Carbs & Grains',
  oatmeal: 'Carbs & Grains',
  pasta: 'Carbs & Grains',
  noodles: 'Carbs & Grains',
  bread: 'Carbs & Grains',
  tortilla: 'Carbs & Grains',
  tortillas: 'Carbs & Grains',
  quinoa: 'Carbs & Grains',
  couscous: 'Carbs & Grains',
  potato: 'Carbs & Grains',
  potatoes: 'Carbs & Grains',
  'sweet potato': 'Carbs & Grains',
  'rice cakes': 'Carbs & Grains',
  flour: 'Carbs & Grains',
  cereal: 'Carbs & Grains',
  granola: 'Carbs & Grains',

  // ─── Fruits & Vegetables ────────────────────────────────────────────────
  banana: 'Fruits & Vegetables',
  bananas: 'Fruits & Vegetables',
  apple: 'Fruits & Vegetables',
  apples: 'Fruits & Vegetables',
  orange: 'Fruits & Vegetables',
  oranges: 'Fruits & Vegetables',
  berries: 'Fruits & Vegetables',
  strawberries: 'Fruits & Vegetables',
  blueberries: 'Fruits & Vegetables',
  raspberries: 'Fruits & Vegetables',
  grapes: 'Fruits & Vegetables',
  pineapple: 'Fruits & Vegetables',
  mango: 'Fruits & Vegetables',
  lemon: 'Fruits & Vegetables',
  lime: 'Fruits & Vegetables',
  spinach: 'Fruits & Vegetables',
  kale: 'Fruits & Vegetables',
  lettuce: 'Fruits & Vegetables',
  broccoli: 'Fruits & Vegetables',
  cauliflower: 'Fruits & Vegetables',
  carrot: 'Fruits & Vegetables',
  carrots: 'Fruits & Vegetables',
  onion: 'Fruits & Vegetables',
  onions: 'Fruits & Vegetables',
  garlic: 'Fruits & Vegetables',
  ginger: 'Fruits & Vegetables',
  tomato: 'Fruits & Vegetables',
  tomatoes: 'Fruits & Vegetables',
  cucumber: 'Fruits & Vegetables',
  pepper: 'Fruits & Vegetables', // bell pepper context — overridden below for spice
  'bell pepper': 'Fruits & Vegetables',
  zucchini: 'Fruits & Vegetables',
  mushroom: 'Fruits & Vegetables',
  mushrooms: 'Fruits & Vegetables',
  asparagus: 'Fruits & Vegetables',
  cabbage: 'Fruits & Vegetables',
  corn: 'Fruits & Vegetables',
  peas: 'Fruits & Vegetables',
  celery: 'Fruits & Vegetables',

  // ─── Dairy ──────────────────────────────────────────────────────────────
  milk: 'Dairy',
  'almond milk': 'Dairy',
  'oat milk': 'Dairy',
  'soy milk': 'Dairy',
  yogurt: 'Dairy',
  'greek yogurt': 'Dairy',
  cheese: 'Dairy',
  'cheddar cheese': 'Dairy',
  mozzarella: 'Dairy',
  feta: 'Dairy',
  parmesan: 'Dairy',
  butter: 'Dairy',
  cream: 'Dairy',
  'sour cream': 'Dairy',
  'cream cheese': 'Dairy',
  'cottage cheese': 'Dairy',

  // ─── Oils & Fats ────────────────────────────────────────────────────────
  oil: 'Oils & Fats',
  'olive oil': 'Oils & Fats',
  'coconut oil': 'Oils & Fats',
  'vegetable oil': 'Oils & Fats',
  'canola oil': 'Oils & Fats',
  'sesame oil': 'Oils & Fats',
  'avocado oil': 'Oils & Fats',
  avocado: 'Oils & Fats',
  almonds: 'Oils & Fats',
  walnuts: 'Oils & Fats',
  cashews: 'Oils & Fats',
  pecans: 'Oils & Fats',
  'peanut butter': 'Oils & Fats',
  'almond butter': 'Oils & Fats',
  nuts: 'Oils & Fats',
  seeds: 'Oils & Fats',
  'chia seeds': 'Oils & Fats',
  'flax seeds': 'Oils & Fats',

  // ─── Spices & Seasonings ────────────────────────────────────────────────
  salt: 'Spices & Seasonings',
  'black pepper': 'Spices & Seasonings',
  paprika: 'Spices & Seasonings',
  cumin: 'Spices & Seasonings',
  'chili powder': 'Spices & Seasonings',
  oregano: 'Spices & Seasonings',
  basil: 'Spices & Seasonings',
  thyme: 'Spices & Seasonings',
  rosemary: 'Spices & Seasonings',
  cinnamon: 'Spices & Seasonings',
  nutmeg: 'Spices & Seasonings',
  'bay leaf': 'Spices & Seasonings',
  cilantro: 'Spices & Seasonings',
  parsley: 'Spices & Seasonings',
  dill: 'Spices & Seasonings',
  curry: 'Spices & Seasonings',
  'curry powder': 'Spices & Seasonings',
  'garlic powder': 'Spices & Seasonings',
  'onion powder': 'Spices & Seasonings',

  // ─── Condiments ─────────────────────────────────────────────────────────
  'soy sauce': 'Condiments',
  ketchup: 'Condiments',
  mustard: 'Condiments',
  mayo: 'Condiments',
  mayonnaise: 'Condiments',
  vinegar: 'Condiments',
  'balsamic vinegar': 'Condiments',
  'apple cider vinegar': 'Condiments',
  'hot sauce': 'Condiments',
  sriracha: 'Condiments',
  honey: 'Condiments',
  'maple syrup': 'Condiments',
  jam: 'Condiments',
  jelly: 'Condiments',
  hummus: 'Condiments',
  salsa: 'Condiments',
  pesto: 'Condiments',
  'bbq sauce': 'Condiments',
};

export function classifyIngredient(name: string): IngredientCategory {
  const lower = name.trim().toLowerCase();
  if (KEYWORD_MAP[lower]) return KEYWORD_MAP[lower];

  // Substring fallback: try to match any known keyword inside the name
  // (e.g. "boneless chicken thigh" → contains "chicken" → Proteins).
  for (const keyword of Object.keys(KEYWORD_MAP)) {
    if (lower.includes(keyword)) return KEYWORD_MAP[keyword];
  }

  return 'Other';
}

export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase();
}
