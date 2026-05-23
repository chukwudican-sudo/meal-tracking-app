import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Modal,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import type { MealDraft } from '@/ai/types';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { SavedMeal } from '@/store/types';

type SearchMode = 'database' | 'library';

interface OFFProduct {
  code: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, number>;
}

interface Props {
  onDraftReady: (draft: MealDraft, meta?: { libraryId?: string }) => void;
}

// Stable empty reference — avoids useSyncExternalStore infinite loop
const EMPTY_LIBRARY: SavedMeal[] = [];

export function SearchTab({ onDraftReady }: Props) {
  const [mode, setMode] = useState<SearchMode>('database');

  // ── Database state ────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OFFProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<OFFProduct | null>(null);
  const [grams, setGrams] = useState('100');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Library state ─────────────────────────────────────────────────────────
  const [libQuery, setLibQuery] = useState('');
  const storedLibrary = useMealStore(s => s.library);
  const library = storedLibrary ?? EMPTY_LIBRARY;
  const removeFromLibrary = useMealStore(s => s.removeFromLibrary);
  const saveToLibrary = useMealStore(s => s.saveToLibrary);
  const showUndo = useUndoStore(s => s.showUndo);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function runSearch(term: string) {
    setLoading(true);
    try {
      const url =
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}` +
        `&search_simple=1&action=process&json=1&page_size=20`;
      const res = await fetch(url);
      const json = await res.json();
      const products: OFFProduct[] = (json.products ?? []).filter(
        (p: OFFProduct) => p.product_name && p.nutriments?.['energy-kcal_100g'],
      );
      setResults(products);
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setLoading(false);
    }
  }

  function confirmPick() {
    if (!picked) return;
    const g = Math.max(0, Number(grams) || 0);
    const factor = g / 100;
    const n = picked.nutriments ?? {};
    const draft: MealDraft = {
      name: (picked.product_name || 'Picked product').slice(0, 60),
      time: nowHHMM(),
      calories: Math.round((n['energy-kcal_100g'] ?? 0) * factor),
      macros: {
        protein: Math.round((n.proteins_100g ?? 0) * factor),
        carbs: Math.round((n.carbohydrates_100g ?? 0) * factor),
        fats: Math.round((n.fat_100g ?? 0) * factor),
      },
    };
    setPicked(null);
    setGrams('100');
    onDraftReady(draft);
  }

  function handleLibraryReuse(meal: SavedMeal) {
    const draft: MealDraft = {
      name: meal.name,
      time: nowHHMM(),
      calories: meal.calories,
      macros: meal.macros,
    };
    onDraftReady(draft, { libraryId: meal.id });
  }

  function handleLibraryDelete(meal: SavedMeal) {
    removeFromLibrary(meal.id);
    showUndo({
      message: `Removed "${meal.name}" from library`,
      undo: () => saveToLibrary(meal),
    });
  }

  const filteredLibrary = libQuery.trim()
    ? library.filter(m => m.name.toLowerCase().includes(libQuery.toLowerCase()))
    : library;

  return (
    <View style={styles.full}>
      {/* Mode toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'database' && styles.toggleActive]}
          onPress={() => setMode('database')}
        >
          <Text style={[styles.toggleText, mode === 'database' && styles.toggleTextActive]}>
            Database
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'library' && styles.toggleActive]}
          onPress={() => setMode('library')}
        >
          <Text style={[styles.toggleText, mode === 'library' && styles.toggleTextActive]}>
            My Library
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Database mode ─────────────────────────────────────────────────── */}
      {mode === 'database' && (
        <View style={styles.full}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search foods (e.g. chicken breast)"
              placeholderTextColor={COLORS.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.green} />
            </View>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <View style={styles.center}>
              <Text style={styles.muted}>No results yet — try another term.</Text>
            </View>
          )}

          {!loading && !query.trim() && (
            <View style={styles.center}>
              <Text style={styles.hint}>Search the Open Food Facts database for nutrition info.</Text>
            </View>
          )}

          <FlatList
            data={results}
            keyExtractor={item => item.code}
            contentContainerStyle={styles.listBody}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => setPicked(item)}>
                <Text numberOfLines={1} style={styles.rowName}>
                  {item.product_name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.brands ? `${item.brands} · ` : ''}
                  {Math.round(item.nutriments?.['energy-kcal_100g'] ?? 0)} kcal/100g
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ── Library mode ──────────────────────────────────────────────────── */}
      {mode === 'library' && (
        <View style={styles.full}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={libQuery}
              onChangeText={setLibQuery}
              placeholder="Filter saved meals..."
              placeholderTextColor={COLORS.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {filteredLibrary.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.hint}>
                {library.length === 0
                  ? 'No saved meals yet.\nToggle "Save to library" when adding a meal.'
                  : 'No matches.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredLibrary}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listBody}
              renderItem={({ item }) => (
                <View style={styles.libRow}>
                  <TouchableOpacity
                    style={styles.libMain}
                    onPress={() => handleLibraryReuse(item)}
                    activeOpacity={0.7}
                  >
                    <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowMeta}>
                      {item.calories} kcal · {item.macros.protein}g P · {item.macros.carbs}g C · {item.macros.fats}g F
                    </Text>
                    <Text style={styles.rowUsage}>
                      {item.usageCount > 0 ? `Used ${item.usageCount}×` : 'Not used yet'}
                      {item.lastUsed ? `  ·  ${formatLastUsed(item.lastUsed)}` : ''}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleLibraryDelete(item)}
                    hitSlop={10}
                    style={styles.libDeleteBtn}
                  >
                    <Text style={styles.libDeleteText}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Grams modal (database mode) */}
      <Modal visible={!!picked} animationType="fade" transparent onRequestClose={() => setPicked(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{picked?.product_name}</Text>
            <Text style={styles.modalSub}>How many grams?</Text>
            <TextInput
              style={styles.modalInput}
              value={grams}
              onChangeText={setGrams}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setPicked(null);
                  setGrams('100');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmPick}>
                <Text style={styles.modalConfirmText}>Use this</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatLastUsed(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 30) return `${diff}d ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}y ago`;
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },

  toggleRow: {
    flexDirection: 'row',
    margin: 12,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleActive: { backgroundColor: COLORS.green },
  toggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  toggleTextActive: { color: '#0E1A12', fontWeight: '700' },

  searchRow: { paddingHorizontal: 12, paddingBottom: 12 },
  searchInput: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  center: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
  },
  muted: { color: COLORS.textSecondary, fontSize: 13 },
  hint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  listBody: { paddingHorizontal: 12, paddingBottom: 18 },

  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  libRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  libMain: { flex: 1 },
  rowUsage: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  libDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libDeleteText: { color: COLORS.textSecondary, fontSize: 12 },

  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 18,
    gap: 10,
  },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalSub: { color: COLORS.textSecondary, fontSize: 12 },
  modalInput: {
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modalCancel: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalConfirm: {
    flex: 1.4,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.green,
  },
  modalConfirmText: { color: '#0E1A12', fontWeight: '700' },
});
