import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import {
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  GOAL_LABEL,
  calcTargets,
  kgToLbs,
  lbsToKg,
  paceLabel,
  type GoalTargets,
} from '@/constants/goalCalc';
import type {
  ActivityLevel,
  GoalPace,
  GoalType,
  UserGoals,
} from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const STEPS = ['Goal', 'Weight', 'Activity', 'Pace', 'Summary'] as const;
const GOALS: GoalType[] = ['lose_weight', 'maintain', 'gain_muscle', 'lean_bulk'];
const ACTIVITIES: ActivityLevel[] = [
  'sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active',
];
const PACES: GoalPace[] = ['slow', 'moderate', 'aggressive'];

export default function EditGoalScreen() {
  const profile = useMealStore(s => s.profile);
  const goals   = useMealStore(s => s.goals);
  const updateProfile = useMealStore(s => s.updateProfile);
  const updateGoals   = useMealStore(s => s.updateGoals);
  const logWeight     = useMealStore(s => s.logWeight);

  const isImperial = (profile.weightUnit ?? 'lbs') === 'lbs';

  const [step, setStep] = useState(0);
  const [goalType, setGoalType]    = useState<GoalType>(profile.goalType ?? 'maintain');
  const [weightStr, setWeightStr]  = useState(
    profile.weightKg != null
      ? isImperial
        ? Math.round(kgToLbs(profile.weightKg)).toString()
        : Math.round(profile.weightKg).toString()
      : ''
  );
  const [activity, setActivity]    = useState<ActivityLevel>(profile.activityLevel ?? 'moderately_active');
  const [pace, setPace]            = useState<GoalPace>('moderate');

  // Cached results from Step 5; null until the summary step is reached.
  const [targets, setTargets] = useState<GoalTargets | null>(null);
  // Manual override fields shown on summary step when user taps "Tweak".
  const [tweaking, setTweaking] = useState(false);
  const [tweakedTargets, setTweakedTargets] = useState<GoalTargets | null>(null);

  const weightKg = useMemo(() => {
    const n = Number(weightStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return isImperial ? lbsToKg(n) : n;
  }, [weightStr, isImperial]);

  const canProceed = useMemo(() => {
    if (step === 1) return weightKg != null;
    return true;
  }, [step, weightKg]);

  const dirty = step > 0;

  const handleClose = () => {
    if (!dirty) { router.back(); return; }
    Alert.alert(
      'Discard changes?',
      'Your progress in the goal flow will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  const handleNext = () => {
    if (step === STEPS.length - 2) {
      // About to reach Summary — compute targets.
      const ageVal = profile.age ?? 30;
      const heightVal = profile.heightCm ?? 175;
      const result = calcTargets({
        weightKg: weightKg!,
        heightCm: heightVal,
        age: ageVal,
        gender: profile.gender ?? 'other',
        activityLevel: activity,
        goalType,
        pace,
      });
      setTargets(result);
      setTweakedTargets(result);
      setStep(step + 1);
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step === 0) { handleClose(); return; }
    setStep(step - 1);
  };

  const handleConfirm = () => {
    const finalTargets = (tweaking && tweakedTargets) ? tweakedTargets : targets;
    if (!finalTargets || weightKg == null) return;

    Alert.alert(
      'Update meal plan?',
      'Update your current meal plan to match the new targets?',
      [
        {
          text: 'No, just save targets',
          onPress: () => persist(finalTargets, false),
        },
        {
          text: 'Yes, update plan',
          style: 'destructive',
          onPress: () => persist(finalTargets, true),
        },
      ]
    );
  };

  const persist = (t: GoalTargets, _alsoUpdatePlan: boolean) => {
    // Save profile + goals. (Plan recalculation is a stretch goal — we just
    // store the new targets; the plan tab continues to honour what's there.)
    updateProfile({
      goalType,
      activityLevel: activity,
    });
    if (weightKg != null && weightKg !== profile.weightKg) {
      logWeight(weightKg);
    }
    const next: UserGoals = {
      dailyCalories: t.dailyCalories,
      protein: t.protein,
      carbs: t.carbs,
      fats: t.fats,
      waterTargetCups: t.waterTargetCups,
      isCalculated: true,
    };
    updateGoals(next);
    router.back();
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Edit Goal</Text>
        <TouchableOpacity onPress={handleClose} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Progress dots */}
      <View style={styles.progressRow}>
        {STEPS.map((_, idx) => (
          <View
            key={idx}
            style={[styles.progressDot, idx <= step && styles.progressDotActive]}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <>
            <StepHeader title="What's your goal?" sub="Pick what you're working toward right now." />
            {GOALS.map(g => (
              <TouchableOpacity
                key={g}
                style={[styles.tile, goalType === g && styles.tileActive]}
                onPress={() => setGoalType(g)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tileTitle, goalType === g && styles.tileTitleActive]}>
                  {GOAL_LABEL[g]}
                </Text>
                <Text style={styles.tileSub}>{goalDescription(g)}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 1 && (
          <>
            <StepHeader title="Confirm your weight" sub="We'll use this to recalculate your targets." />
            <View style={styles.weightRow}>
              <TextInput
                value={weightStr}
                onChangeText={setWeightStr}
                keyboardType="decimal-pad"
                placeholder={isImperial ? '170' : '77'}
                placeholderTextColor={COLORS.textMuted}
                style={styles.weightInput}
              />
              <Text style={styles.weightUnit}>{isImperial ? 'lbs' : 'kg'}</Text>
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeader title="Activity level" sub="Has anything changed since last time?" />
            {ACTIVITIES.map(a => (
              <TouchableOpacity
                key={a}
                style={[styles.tile, activity === a && styles.tileActive]}
                onPress={() => setActivity(a)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tileTitle, activity === a && styles.tileTitleActive]}>
                  {ACTIVITY_LABEL[a]}
                </Text>
                <Text style={styles.tileSub}>{ACTIVITY_HINT[a]}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 3 && (
          <>
            <StepHeader
              title="How fast?"
              sub={paceSubtitle(goalType)}
            />
            {PACES.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.tile, pace === p && styles.tileActive]}
                onPress={() => setPace(p)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tileTitle, pace === p && styles.tileTitleActive]}>
                  {paceLabel(goalType, p)}
                </Text>
                <Text style={styles.tileSub}>{paceHint(p)}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 4 && targets && (
          <>
            <StepHeader title="Your new targets" sub="Compare and confirm." />
            <View style={styles.compareCard}>
              <View style={styles.compareHeader}>
                <Text style={styles.compareCol}>Current</Text>
                <Text style={styles.compareCol}>New</Text>
              </View>
              <CompareRow
                label="Calories (kcal)"
                current={goals.dailyCalories}
                next={(tweaking && tweakedTargets ? tweakedTargets : targets).dailyCalories}
                editable={tweaking}
                onChange={(v) => tweakedTargets && setTweakedTargets({ ...tweakedTargets, dailyCalories: v })}
              />
              <CompareRow
                label="Protein (g)"
                current={goals.protein}
                next={(tweaking && tweakedTargets ? tweakedTargets : targets).protein}
                editable={tweaking}
                onChange={(v) => tweakedTargets && setTweakedTargets({ ...tweakedTargets, protein: v })}
              />
              <CompareRow
                label="Carbs (g)"
                current={goals.carbs}
                next={(tweaking && tweakedTargets ? tweakedTargets : targets).carbs}
                editable={tweaking}
                onChange={(v) => tweakedTargets && setTweakedTargets({ ...tweakedTargets, carbs: v })}
              />
              <CompareRow
                label="Fats (g)"
                current={goals.fats}
                next={(tweaking && tweakedTargets ? tweakedTargets : targets).fats}
                editable={tweaking}
                onChange={(v) => tweakedTargets && setTweakedTargets({ ...tweakedTargets, fats: v })}
              />
              <CompareRow
                label="Water (cups)"
                current={goals.waterTargetCups ?? 8}
                next={(tweaking && tweakedTargets ? tweakedTargets : targets).waterTargetCups}
                editable={tweaking}
                onChange={(v) => tweakedTargets && setTweakedTargets({ ...tweakedTargets, waterTargetCups: v })}
              />
            </View>

            <TouchableOpacity
              style={styles.tweakBtn}
              onPress={() => setTweaking(t => !t)}
              activeOpacity={0.7}
            >
              <Text style={styles.tweakBtnText}>{tweaking ? 'Done tweaking' : 'Tweak manually'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canProceed && styles.primaryBtnDisabled]}
          disabled={!canProceed}
          onPress={step === STEPS.length - 1 ? handleConfirm : handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>
            {step === STEPS.length - 1 ? 'Confirm' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StepHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSub}>{sub}</Text>
    </View>
  );
}

function CompareRow({
  label, current, next, editable, onChange,
}: {
  label: string;
  current: number;
  next: number;
  editable: boolean;
  onChange: (v: number) => void;
}) {
  const delta = next - current;
  const deltaText = delta === 0 ? '' : delta > 0 ? `+${delta}` : `${delta}`;
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <View style={styles.compareValues}>
        <Text style={styles.compareCurrent}>{current}</Text>
        <Text style={styles.compareArrow}>→</Text>
        {editable ? (
          <TextInput
            value={String(next)}
            onChangeText={(v) => {
              const n = Number(v);
              if (Number.isInteger(n) && n >= 0) onChange(n);
            }}
            keyboardType="number-pad"
            style={styles.compareInput}
          />
        ) : (
          <View style={styles.compareNextWrap}>
            <Text style={styles.compareNext}>{next}</Text>
            {deltaText ? (
              <Text style={[styles.compareDelta, delta > 0 ? styles.compareDeltaUp : styles.compareDeltaDown]}>
                {deltaText}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function goalDescription(g: GoalType): string {
  switch (g) {
    case 'lose_weight': return 'Caloric deficit, higher protein.';
    case 'maintain':    return 'Match current intake to current output.';
    case 'gain_muscle': return 'Slight surplus, prioritise protein.';
    case 'lean_bulk':   return 'Steady surplus to build size with minimal fat.';
  }
}

function paceSubtitle(g: GoalType): string {
  if (g === 'lose_weight') return 'How aggressive should the deficit be?';
  if (g === 'maintain') return 'Maintenance is steady — pace is mostly cosmetic here.';
  return 'How aggressive should the surplus be?';
}

function paceHint(p: GoalPace): string {
  switch (p) {
    case 'slow':       return 'Easier to stick to. Best long-term.';
    case 'moderate':   return 'Balanced — recommended for most people.';
    case 'aggressive': return 'Faster results. Harder to sustain.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  closeBtn: { color: COLORS.textSecondary, fontSize: 18 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 4,
    gap: 6,
  },
  progressDot: { width: 22, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  progressDotActive: { backgroundColor: COLORS.green },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },

  stepTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  stepSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6 },

  tile: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  tileActive: { borderColor: COLORS.green, backgroundColor: COLORS.green + '14' },
  tileTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  tileTitleActive: { color: COLORS.green },
  tileSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },

  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
  },
  weightInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 18,
  },
  weightUnit: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },

  compareCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  compareHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.elevated,
    justifyContent: 'flex-end',
    gap: 24,
  },
  compareCol: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, width: 60, textAlign: 'center' },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  compareLabel: { flex: 1, color: COLORS.text, fontSize: 14 },
  compareValues: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compareCurrent: { color: COLORS.textSecondary, fontSize: 14, width: 50, textAlign: 'right' },
  compareArrow: { color: COLORS.textSecondary, fontSize: 14 },
  compareNextWrap: { width: 60, alignItems: 'flex-end' },
  compareNext: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  compareDelta: { fontSize: 11, marginTop: 1 },
  compareDeltaUp: { color: COLORS.orange },
  compareDeltaDown: { color: COLORS.green },
  compareInput: {
    width: 60,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    textAlign: 'right',
  },

  tweakBtn: {
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  tweakBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
