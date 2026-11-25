import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PageHeader } from '@/components/PageHeader';
import { GoalTimeline } from '@/components/onboarding/GoalTimeline';
import { WeightPicker, type WeightUnitChoice } from '@/components/onboarding/WeightPicker';
import { Screen } from '@/components/Screen';

import { COLORS } from '@/constants/theme';
import {
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  GOAL_LABEL,
  calcTargets,
  clampPace,
  formatWeight,
  goalDirection,
  goalWeightProblem,
  kgToLbs,
  lbsToKg,
  suggestGoalWeightKg,
  type GoalTargets,
} from '@/constants/goalCalc';
import { calcGoalDate } from '@/constants/onboardingCalc';
import type {
  ActivityLevel,
  GoalType,
  UserGoals,
} from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { HealthNote } from '@/components/HealthNote';
import { PaceSlider } from '@/components/PaceSlider';

type StepId = 'Goal' | 'Weight' | 'GoalWeight' | 'Activity' | 'Pace' | 'Timeline' | 'Summary';
// Maintaining has no goal weight, pace or timeline (as in onboarding). The
// goal weight + "you'll reach it by …" steps came in Nov 25: switching e.g.
// gain → lose used to drop the goal weight and its date.
const STEPS_WEIGHT_GOAL: StepId[] = ['Goal', 'Weight', 'GoalWeight', 'Activity', 'Pace', 'Timeline', 'Summary'];
const STEPS_MAINTAIN: StepId[] = ['Goal', 'Weight', 'Activity', 'Summary'];
// The same three goals as onboarding. Lean Bulk left the list: with one pace
// slider it was identical to Gain Muscle (a saved one opens as Gain Muscle).
const GOALS: GoalType[] = ['lose_weight', 'maintain', 'gain_muscle'];
const ACTIVITIES: ActivityLevel[] = [
  'sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active',
];

export default function EditGoalScreen() {
  const profile = useMealStore(s => s.profile);
  const goals   = useMealStore(s => s.goals);
  const updateProfile = useMealStore(s => s.updateProfile);
  const updateGoals   = useMealStore(s => s.updateGoals);
  const logWeight     = useMealStore(s => s.logWeight);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);

  const isImperial = (profile.weightUnit ?? 'lbs') === 'lbs';

  const savedGoal: GoalType = profile.goalType === 'lean_bulk' ? 'gain_muscle' : profile.goalType ?? 'maintain';

  const [step, setStep] = useState(0);
  const [goalType, setGoalType]    = useState<GoalType>(savedGoal);
  // The field shows whole numbers; untouched, it stands for the exact saved
  // weight (so Confirm doesn't round 154.7 to 155 or log a fake weigh-in).
  const [initialWeightStr] = useState(() =>
    profile.weightKg != null
      ? isImperial
        ? Math.round(kgToLbs(profile.weightKg)).toString()
        : Math.round(profile.weightKg).toString()
      : ''
  );
  const [weightStr, setWeightStr]  = useState(initialWeightStr);
  const [activity, setActivity]    = useState<ActivityLevel>(profile.activityLevel ?? 'moderately_active');

  // Pace slider (lb/week): starts at the saved pace (1 if none, as in
  // onboarding), so walking through with no changes keeps the numbers. The
  // value used is clamped to the goal's range (a 2 lb loss pace → 1 for muscle).
  const [paceLbs, setPaceLbs] = useState<number | null>(profile.paceLbsPerWeek ?? null);
  const paceLbsPerWeek = clampPace(goalType, paceLbs);

  const steps = goalType === 'maintain' ? STEPS_MAINTAIN : STEPS_WEIGHT_GOAL;
  const stepId = steps[Math.min(step, steps.length - 1)];

  // Cached results from Step 5; null until the summary step is reached.
  const [targets, setTargets] = useState<GoalTargets | null>(null);
  // Manual override fields shown on summary step when user taps "Tweak".
  const [tweaking, setTweaking] = useState(false);
  const [tweakedTargets, setTweakedTargets] = useState<GoalTargets | null>(null);

  const weightKg = useMemo(() => {
    if (weightStr === initialWeightStr && profile.weightKg != null) return profile.weightKg;
    const n = Number(weightStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return isImperial ? lbsToKg(n) : n;
  }, [weightStr, initialWeightStr, profile.weightKg, isImperial]);

  // Goal weight (losing / gaining only). Set when its step opens — today's
  // weight may just have changed — until the user turns the wheel: the saved
  // goal when it's for this direction and still ahead ("eat healthier" saves
  // a copy of the current weight — not a goal), else a suggestion.
  const dir = goalDirection(goalType);
  const [goalWeightKg, setGoalWeightKg] = useState<number | null>(null);
  const goalTouchedRef = useRef(false);
  const startingGoalWeight = (): number | null => {
    if (dir === 0 || weightKg == null) return null;
    const saved = profile.targetWeightKg;
    if (goalDirection(savedGoal) === dir && saved != null && !goalWeightProblem(goalType, weightKg, saved)) return saved;
    return suggestGoalWeightKg(weightKg, profile.heightCm, goalType, isImperial);
  };
  // The wheel's own unit toggle only changes how this step shows the number.
  const [pickerUnit, setPickerUnit] = useState<WeightUnitChoice>(isImperial ? 'lbs' : 'kg');
  const goalWarning = dir !== 0 && goalWeightKg != null && weightKg != null
    ? goalWeightProblem(goalType, weightKg, goalWeightKg)
    : null;
  const goalDate = dir !== 0 && goalWeightKg != null && weightKg != null
    ? calcGoalDate(weightKg, goalWeightKg, paceLbsPerWeek)
    : null;

  const chooseGoal = (g: GoalType) => {
    // A new direction gets a fresh goal-weight suggestion.
    if (goalDirection(g) !== dir) goalTouchedRef.current = false;
    setGoalType(g);
  };

  const canProceed = useMemo(() => {
    if (stepId === 'Weight') return weightKg != null;
    if (stepId === 'GoalWeight') return goalWeightKg != null && !goalWarning;
    return true;
  }, [stepId, weightKg, goalWeightKg, goalWarning]);

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
    if (steps[step + 1] === 'GoalWeight' && !goalTouchedRef.current) {
      setGoalWeightKg(startingGoalWeight());
    }
    if (steps[step + 1] === 'Summary') {
      // About to reach Summary — compute targets.
      const ageVal = profile.age ?? 30;
      const heightVal = profile.heightCm ?? 175;
      const result = calcTargets({
        weightKg: weightKg!,
        targetWeightKg: dir !== 0 ? goalWeightKg : null,
        heightCm: heightVal,
        age: ageVal,
        gender: profile.gender ?? 'other',
        activityLevel: activity,
        goalType,
        paceLbsPerWeek,
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
          text: 'No, keep current plan',
          onPress: () => persist(finalTargets, false),
        },
        {
          text: 'Yes, build new plan',
          style: 'destructive',
          onPress: () => persist(finalTargets, true),
        },
      ]
    );
  };

  const persist = (t: GoalTargets, updatePlan: boolean) => {
    // The goal weight, pace and the goal date they imply are saved with the
    // goal, so the profile always matches the numbers it produced. Maintaining
    // keeps the current weight as the target, as onboarding does.
    updateProfile({
      goalType,
      activityLevel: activity,
      paceLbsPerWeek,
      goalDate,
      targetWeightKg: (dir === 0 ? weightKg : goalWeightKg) ?? undefined,
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

    if (updatePlan) {
      // Auto-save the current plan (nothing lost) before building a new one.
      // Only a running plan: the user's own repeating meals aren't a plan (and
      // are kept by plan activation), so saving them made junk "Auto-saved
      // Plan" entries (Nov 25 review).
      if (profile.activePlanName) {
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        saveCurrentPlanAs(`Auto-saved Plan – ${today}`);
      }
      // Replace this route so Back from Build My Plan returns to Profile,
      // not to the stale Edit Goal flow.
      router.replace('/plan/build');
    } else {
      router.back();
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader
        title="Edit Goal"
        onBack={handleBack}
        style={styles.header}
        right={
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        }
      />

      {/* Progress dots */}
      <View style={styles.progressRow}>
        {steps.map((_, idx) => (
          <View
            key={idx}
            style={[styles.progressDot, idx <= step && styles.progressDotActive]}
          />
        ))}
      </View>

      {/* Scrolls the field you type in above the keyboard ("Tweak manually"
          rows sit low on small phones). */}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        {stepId === 'Goal' && (
          <>
            <StepHeader title="What's your goal?" sub="Pick what you're working toward right now." />
            {GOALS.map(g => (
              <TouchableOpacity
                key={g}
                style={[styles.tile, goalType === g && styles.tileActive]}
                onPress={() => chooseGoal(g)}
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

        {stepId === 'Weight' && (
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

        {stepId === 'GoalWeight' && goalWeightKg != null && (
          <>
            <StepHeader title="What is your goal weight?" sub="Pick where you'd like to get to." />
            <View style={styles.pickerWrap}>
              <WeightPicker
                weightKg={goalWeightKg}
                unit={pickerUnit}
                onChange={kg => { goalTouchedRef.current = true; setGoalWeightKg(kg); }}
                onUnitChange={setPickerUnit}
              />
            </View>
            {goalWarning ? <Text style={styles.warn}>{goalWarning}</Text> : null}
          </>
        )}

        {stepId === 'Activity' && (
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

        {stepId === 'Pace' && (
          <>
            <StepHeader title="How fast?" sub={paceSubtitle(goalType)} />
            <PaceSlider
              goalType={goalType}
              value={paceLbsPerWeek}
              imperial={isImperial}
              onChange={setPaceLbs}
            />
          </>
        )}

        {stepId === 'Timeline' && goalWeightKg != null && weightKg != null && (
          <GoalTimeline
            name={profile.firstName ?? ''}
            currentLabel={formatWeight(weightKg, isImperial)}
            goalLabel={formatWeight(goalWeightKg, isImperial)}
            goalDate={goalDate}
            losing={dir < 0}
          />
        )}

        {stepId === 'Summary' && targets && (
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
            <HealthNote style={{ marginTop: 14 }} />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canProceed && styles.primaryBtnDisabled]}
          disabled={!canProceed}
          onPress={stepId === 'Summary' ? handleConfirm : handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>
            {stepId === 'Summary' ? 'Confirm' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </Screen>
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
  return g === 'lose_weight' ? 'How aggressive should the deficit be?' : 'How aggressive should the surplus be?';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

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
  pickerWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  warn: { color: COLORS.red, fontSize: 13, textAlign: 'center', marginTop: 12 },

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
