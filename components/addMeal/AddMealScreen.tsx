import { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { APP_LOGO, APP_NAME } from '@/constants/app';
import { useMealStore, toIsoDate } from '@/store/useMealStore';
import { newId } from '@/lib/sync/uuid';
import type { ChatMessage, DayContext, MealDraft } from '@/ai/types';

import { ScanTab } from './ScanTab';
import { AITab } from './AITab';
import { ManualTab } from './ManualTab';
import { SearchTab } from './SearchTab';
import { MealDraftCard } from './MealDraftCard';
import { FixResultScreen } from './FixResultScreen';
import { DisclaimerScreen } from './DisclaimerScreen';
import type { MealEntry } from '@/store/types';

// Stable empty-array reference; see DayDetailModal for the same pattern.
const EMPTY_MEALS: MealEntry[] = [];

type TabId = 'scan' | 'ai' | 'manual' | 'search';

interface Props {
  visible: boolean;
  date: string;
  onClose: () => void;
}

interface PendingDraft {
  draft: MealDraft;
  source: 'scan' | 'ai' | 'manual' | 'search';
  imageUri?: string;
  history?: ChatMessage[];
  librarySourceId?: string;
}

export function AddMealScreen({ visible, date, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabId>('ai');
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [showFix, setShowFix] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const goals = useMealStore(s => s.goals);
  const profile = useMealStore(s => s.profile);
  const library = useMealStore(s => s.library);
  const storedMeals = useMealStore(s => s.logs[date]?.meals);
  const todaysMeals = storedMeals ?? EMPTY_MEALS;

  const context: DayContext = useMemo(
    () => ({
      date,
      goals,
      profile,
      todaysMeals,
      libraryNames: library.map(l => l.name),
    }),
    [date, goals, profile, todaysMeals, library],
  );

  function handleClose() {
    setPending(null);
    setShowFix(false);
    setShowDisclaimer(false);
    setActiveTab('ai');
    onClose();
  }

  function handleSaved() {
    if (pending?.librarySourceId) {
      const { library: lib, updateLibraryMeal } = useMealStore.getState();
      const original = lib.find(m => m.id === pending.librarySourceId);
      if (original) {
        updateLibraryMeal({
          ...original,
          usageCount: original.usageCount + 1,
          lastUsed: toIsoDate(new Date()),
        });
      }
    }
    setPending(null);
    handleClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose}>
      <View style={[styles.full, { paddingTop: insets.top }]}>
        {/* Top header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={12}>
            <Text style={styles.headerBack}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerLogo}>{APP_LOGO}</Text>
            <Text style={styles.headerTitle}>{APP_NAME}</Text>
          </View>
          <TouchableOpacity onPress={() => setShowDisclaimer(true)} hitSlop={12}>
            <Text style={styles.headerMore}>•••</Text>
          </TouchableOpacity>
        </View>

        {/* Active tab content */}
        <View style={styles.tabContent}>
          {activeTab === 'scan' && (
            <ScanTab
              context={context}
              onDraftReady={(draft, src) => {
                // ScanTab's "Log" path bypasses the draft card entirely:
                // it logs the meal directly to today and closes the screen.
                if (src.logImmediately) {
                  // UUID required — meal_logs.id is a uuid column on the server;
                  // a composite string id logs locally but fails to sync.
                  useMealStore.getState().addMealToDay(date, {
                    id: newId(),
                    name: draft.name,
                    time: draft.time,
                    calories: draft.calories,
                    ingredients: [],
                    macros: draft.macros,
                    status: 'pending',
                    isAdHoc: true,
                    photoUri: src.photoUri,
                  });
                  handleClose();
                  return;
                }
                setPending({ draft, source: 'scan', imageUri: src.photoUri });
              }}
            />
          )}
          {activeTab === 'ai' && (
            <AITab context={context} date={date} onLogged={handleClose} />
          )}
          {activeTab === 'manual' && (
            <ManualTab date={date} onCreated={handleClose} />
          )}
          {activeTab === 'search' && (
            <SearchTab onClose={handleClose} />
          )}
        </View>

        {/* Bottom tab bar */}
        <View style={styles.tabBar}>
          <TabButton id="scan"   active={activeTab === 'scan'}   onPress={setActiveTab} icon="⌖" label="Scan" />
          <TabButton id="ai"     active={activeTab === 'ai'}     onPress={setActiveTab} icon="✦" label="AI" />
          <TabButton id="manual" active={activeTab === 'manual'} onPress={setActiveTab} icon="＋" label="Manual" />
          <TabButton id="search" active={activeTab === 'search'} onPress={setActiveTab} icon="⌕" label="Search" />
        </View>

        {/* Draft card overlay */}
        {pending && (
          <Pressable style={styles.overlay} onPress={() => setPending(null)}>
            <Pressable style={styles.overlayInner} onPress={() => {}}>
              <MealDraftCard
                date={date}
                initial={pending.draft}
                mode="create"
                showFix={pending.source === 'scan' || pending.source === 'ai'}
                photoUri={pending.imageUri}
                onFix={() => setShowFix(true)}
                onCancel={() => setPending(null)}
                onSaved={handleSaved}
              />
            </Pressable>
          </Pressable>
        )}

        {/* Fix flow */}
        <FixResultScreen
          visible={showFix}
          context={context}
          currentDraft={pending?.draft ?? { name: '', time: '12:00', calories: 0, macros: { protein: 0, carbs: 0, fats: 0 } }}
          imageUri={pending?.imageUri}
          history={pending?.history ?? []}
          onClose={() => setShowFix(false)}
          onResult={next => {
            setPending(prev => (prev ? { ...prev, draft: next } : prev));
            setShowFix(false);
          }}
        />

        <DisclaimerScreen visible={showDisclaimer} onClose={() => setShowDisclaimer(false)} />
      </View>
    </Modal>
  );
}

function TabButton({
  id,
  active,
  onPress,
  icon,
  label,
}: {
  id: TabId;
  active: boolean;
  onPress: (id: TabId) => void;
  icon: string;
  label: string;
}) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={() => onPress(id)}>
      <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBack: { color: COLORS.text, fontSize: 22, width: 30 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLogo: { fontSize: 20 },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  headerMore: { color: COLORS.text, fontSize: 18, width: 30, textAlign: 'right' },
  tabContent: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  tabIcon: { color: COLORS.textSecondary, fontSize: 22 },
  tabIconActive: { color: COLORS.green },
  tabLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '500' },
  tabLabelActive: { color: COLORS.green, fontWeight: '700' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  overlayInner: {
    width: '100%',
    maxWidth: 460,
  },
});
