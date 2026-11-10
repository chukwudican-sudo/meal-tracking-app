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
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/theme';
import { APP_LOGO, APP_NAME } from '@/constants/app';
import { useMealStore, toIsoDate, initialMealStatus } from '@/store/useMealStore';
import { newId } from '@/lib/sync/uuid';
import type { ChatMessage, DayContext, MealDraft } from '@/ai/types';

import { ScanTab } from './ScanTab';
import { AITab } from './AITab';
import { ManualTab } from './ManualTab';
import { SearchTab } from './SearchTab';
import { useCloseOnOverlayReset } from '@/lib/overlays';
import { MealDraftCard } from './MealDraftCard';
import { FixResultScreen } from './FixResultScreen';
import { DisclaimerScreen } from './DisclaimerScreen';
import { PageHeader } from '@/components/PageHeader';
import { PaywallModalHost } from '@/components/paywall/PaywallModalHost';
import { ToastHost } from '@/components/ToastHost';
import type { MealEntry } from '@/store/types';
import { AIConsentHost } from '@/components/AIConsentHost';

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
  // Manual: the "+" screen or the form. Lifted here so the one header's back
  // arrow steps form → "+" screen → close (no second header in the form).
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const onManualForm = activeTab === 'manual' && manualFormOpen;
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
    setManualFormOpen(false);
    onClose();
  }

  // A tapped notification opens its page above this modal (lib/overlays).
  useCloseOnOverlayReset(visible, handleClose);

  function handleBack() {
    if (onManualForm) setManualFormOpen(false);
    else handleClose();
  }

  function switchTab(tab: TabId) {
    setManualFormOpen(false);
    setActiveTab(tab);
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
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleBack}>
      {/* The Scan tab is a full-bleed camera with its own close/help buttons,
          so it skips the safe-area padding and this header. */}
      <View style={[styles.full, { paddingTop: activeTab === 'scan' ? 0 : insets.top }]}>
        {/* Top header */}
        {activeTab !== 'scan' && (
          <PageHeader
            style={styles.header}
            onBack={handleBack}
            title={onManualForm ? 'New meal' : undefined}
            center={onManualForm ? undefined : (
              <View style={styles.headerCenter}>
                <Text style={styles.headerLogo}>{APP_LOGO}</Text>
                <Text style={styles.headerTitle}>{APP_NAME}</Text>
              </View>
            )}
            right={
              <TouchableOpacity
                onPress={() => setShowDisclaimer(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="About these estimates"
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={COLORS.text} />
              </TouchableOpacity>
            }
          />
        )}

        {/* Active tab content */}
        <View style={styles.tabContent}>
          {activeTab === 'scan' && (
            <ScanTab
              context={context}
              onClose={handleClose}
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
                    // The scan's item list — the meal's Fix context later.
                    ingredients: src.ingredients ?? [],
                    macros: draft.macros,
                    status: initialMealStatus(date, draft.time),
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
            <ManualTab date={date} onCreated={handleClose} formOpen={manualFormOpen} onFormOpenChange={setManualFormOpen} />
          )}
          {activeTab === 'search' && (
            <SearchTab onClose={handleClose} />
          )}
        </View>

        {/* Bottom tab bar */}
        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <TabButton id="scan"   active={activeTab === 'scan'}   onPress={switchTab} icon="scan-outline"     label="Scan" />
          <TabButton id="ai"     active={activeTab === 'ai'}     onPress={switchTab} icon="sparkles-outline" label="AI" />
          <TabButton id="manual" active={activeTab === 'manual'} onPress={switchTab} icon="add"              label="Manual" />
          <TabButton id="search" active={activeTab === 'search'} onPress={switchTab} icon="search"           label="Search" />
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
        {/* Toasts + paywall render inside this modal, or they'd land behind it. */}
        <PaywallModalHost active={visible} />
        <AIConsentHost active={visible} />
        <ToastHost />
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
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={() => onPress(id)}>
      <Ionicons name={icon} size={22} color={active ? COLORS.green : COLORS.textSecondary} />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLogo: { fontSize: 20 },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
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
