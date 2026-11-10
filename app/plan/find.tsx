// Find Your Plan (Nov 10): 5 tap-only questions → the premade plans that fit,
// best first, with "why it fits" lines. Matching is on-device and rule-based
// (lib/findPlan.ts — no AI, instant, free). Start uses the same flow as
// Explore (startPlanWithConfirm). Ends with the "None of these fit? Try Build
// My Plan instead" bridge from Alex's original spec.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { usePreventRemove, useNavigation } from '@react-navigation/native';

import {
  BEST_MATCH_MIN, matchPlans, startingAnswers,
  type FindAvoid, type FindGoal, type FindMeals, type FindPlanAnswers, type FindStyle, type FindTime,
} from '@/lib/findPlan';
import { startPlanWithConfirm } from '@/lib/planActivation';
import { useMealStore } from '@/store/useMealStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Option<T extends string> = { value: T; icon: IoniconName; title: string; sub?: string };

const GOALS: Option<FindGoal>[] = [
  { value: 'lose', icon: 'flame-outline', title: 'Lose weight', sub: 'Steady, sustainable deficit' },
  { value: 'maintain', icon: 'swap-horizontal-outline', title: 'Maintain', sub: 'Keep things balanced' },
  { value: 'muscle', icon: 'barbell-outline', title: 'Build muscle', sub: 'More protein, more fuel' },
  { value: 'healthy', icon: 'leaf-outline', title: 'Eat healthier', sub: 'Better food, no strict numbers' },
];
const STYLES: Option<FindStyle>[] = [
  { value: 'balanced', icon: 'restaurant-outline', title: 'Balanced', sub: 'A bit of everything' },
  { value: 'protein', icon: 'barbell-outline', title: 'High protein', sub: 'Protein at every meal' },
  { value: 'lowcarb', icon: 'nutrition-outline', title: 'Low carb', sub: 'Fewer grains and sugars' },
  { value: 'keto', icon: 'water-outline', title: 'Keto', sub: 'Very low carb, higher fat' },
  { value: 'med', icon: 'fish-outline', title: 'Mediterranean', sub: 'Fish, olive oil, vegetables' },
  { value: 'fiber', icon: 'leaf-outline', title: 'High fiber', sub: 'Gut-friendly whole foods' },
];
const MEALS: Option<FindMeals>[] = [
  { value: '3', icon: 'sunny-outline', title: '3 meals', sub: 'Breakfast, lunch, dinner' },
  { value: '5', icon: 'time-outline', title: '3 meals + snacks', sub: 'Smaller, more often' },
  { value: 'any', icon: 'sparkles-outline', title: 'No preference' },
];
const TIMES: Option<FindTime>[] = [
  { value: 'quick', icon: 'flash-outline', title: 'Quick', sub: 'Most meals under 20 min' },
  { value: 'some', icon: 'timer-outline', title: 'Some time', sub: '20–40 min is fine' },
  { value: 'any', icon: 'heart-outline', title: 'I enjoy cooking', sub: "Time isn't an issue" },
];
// Step 4 has two groups so a diet doesn't read as something to avoid:
// "I eat…" (one of these, or none) and "I avoid…" (any number).
const DIETS: { value: FindAvoid; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescetarian', label: 'Pescetarian' },
];
const DIET_VALUES = DIETS.map(d => d.value);
const AVOIDS: { value: FindAvoid; label: string }[] = [
  { value: 'no_fish', label: 'Fish' },
  { value: 'no_shellfish', label: 'Shellfish' },
  { value: 'no_red_meat', label: 'Red meat' },
  { value: 'no_pork', label: 'Pork' },
  { value: 'no_dairy', label: 'Dairy' },
  { value: 'no_eggs', label: 'Eggs' },
  { value: 'gluten_free', label: 'Gluten' },
  { value: 'no_nuts', label: 'Nuts' },
  { value: 'no_soy', label: 'Soy' },
];

const TINTS = [COLORS.green, COLORS.blue, COLORS.purple, COLORS.orange, COLORS.red, COLORS.textSecondary];
const STEPS = ['Your goal', 'Eating style', 'Your day', 'Food to avoid', 'Cooking'] as const;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/plan');
}

export default function FindYourPlanScreen() {
  const insets = useSafeAreaInsets();
  const profile = useMealStore(s => s.profile);
  const plans = useMealStore(s => s.plans);
  const recipes = useMealStore(s => s.recipes);
  const calorieTarget = useMealStore(s => s.goals.dailyCalories);
  const savedAnswers = useMealStore(s => s.findPlanAnswers);
  const activePlanName = useMealStore(s => s.profile.activePlanName);
  const setFindPlanAnswers = useMealStore(s => s.setFindPlanAnswers);

  // Last time's answers (plus any diet/allergy added to the profile since),
  // else pre-filled from the profile.
  const [answers, setAnswers] = useState<FindPlanAnswers>(() => startingAnswers(profile, savedAnswers));
  const [step, setStep] = useState(0); // 0–4 questions, 5 = results

  const matches = useMemo(
    () => (step === STEPS.length ? matchPlans(plans, recipes, answers, calorieTarget).slice(0, 3) : []),
    [step, plans, recipes, answers, calorieTarget],
  );

  const set = <K extends keyof FindPlanAnswers>(key: K, value: FindPlanAnswers[K]) =>
    setAnswers(a => ({ ...a, [key]: value }));

  // Saved at every step, so leaving halfway keeps what was answered.
  const next = () => {
    setFindPlanAnswers(answers);
    setStep(s => s + 1);
  };
  const back = () => (step === 0 ? goBack() : setStep(s => s - 1));
  // Swipe-back / Android back go one question back too, not out of the quiz.
  // Questions only: on the results page, Start plan (dismissAll) and Build My
  // Plan (replace) must be able to leave.
  // Anything else that leaves (a tapped notification going Home) goes through.
  const navigation = useNavigation();
  usePreventRemove(step > 0 && step < STEPS.length, ({ data }) => {
    if (data.action.type === 'GO_BACK' || data.action.type === 'POP') setStep(s => s - 1);
    else navigation.dispatch(data.action);
  });

  const onResults = step === STEPS.length;
  const footerPad = Math.max(insets.bottom, 16) + 16;
  const best = matches[0];
  const strong = !!best && best.score >= BEST_MATCH_MIN;

  return (
    <Screen edges={['top']}>
      <PageHeader title={onResults ? 'Your matches' : 'Find Your Plan'} onBack={back} />

      {!onResults ? (
        <>
          <View
            style={styles.progress}
            accessibilityRole="progressbar"
            accessibilityLabel={`Question ${step + 1} of ${STEPS.length}`}
          >
            {STEPS.map((_, k) => (
              <View key={k} style={[styles.progressBar, k <= step && styles.progressOn]} />
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.stepLabel}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</Text>

            {step === 0 ? (
              <Question title="What's your main goal?" sub="From your profile — change it if you like.">
                <OptionList options={GOALS} isOn={v => answers.goal === v} onPick={v => set('goal', v)} />
              </Question>
            ) : null}

            {step === 1 ? (
              <Question title="How do you like to eat?" sub="Pick any that sound good.">
                <OptionList
                  options={STYLES}
                  multi
                  isOn={v => answers.styles.includes(v)}
                  onPick={v => set('styles', answers.styles.includes(v) ? answers.styles.filter(x => x !== v) : [...answers.styles, v])}
                />
              </Question>
            ) : null}

            {step === 2 ? (
              <Question title="How many times a day do you eat?">
                <OptionList options={MEALS} isOn={v => answers.meals === v} onPick={v => set('meals', v)} />
              </Question>
            ) : null}

            {step === 3 ? (
              <Question
                title="Any diet or foods to skip?"
                sub="From your profile. Plans that don't fit are never suggested."
              >
                <Text style={styles.groupLabel}>I eat…</Text>
                <View style={styles.chips}>
                  {DIETS.map(d => {
                    const on = answers.avoid.includes(d.value);
                    return (
                      <Chip
                        key={d.value}
                        label={d.label}
                        on={on}
                        radio
                        // One diet at a time; tap again to clear.
                        onPress={() => set('avoid', [
                          ...answers.avoid.filter(x => !DIET_VALUES.includes(x)),
                          ...(on ? [] : [d.value]),
                        ])}
                      />
                    );
                  })}
                </View>

                <Text style={[styles.groupLabel, { marginTop: 20 }]}>I avoid…</Text>
                <View style={styles.chips}>
                  {AVOIDS.map(a => {
                    const on = answers.avoid.includes(a.value);
                    return (
                      <Chip
                        key={a.value}
                        label={a.label}
                        on={on}
                        onPress={() => set('avoid', on ? answers.avoid.filter(x => x !== a.value) : [...answers.avoid, a.value])}
                      />
                    );
                  })}
                </View>
                <View style={styles.hintRow}>
                  <Ionicons name="checkmark-circle-outline" size={15} color={COLORS.textSecondary} />
                  <Text style={styles.hint}>Nothing to skip? Just tap Next.</Text>
                </View>
              </Question>
            ) : null}

            {step === 4 ? (
              <Question title="How much time for cooking?">
                <OptionList options={TIMES} isOn={v => answers.time === v} onPick={v => set('time', v)} />
              </Question>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerPad }]}>
            <TouchableOpacity
              style={[styles.primary, step === 1 && answers.styles.length === 0 && styles.primaryDim]}
              onPress={next}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, step === 1 && answers.styles.length === 0 && styles.primaryTextDim]}>
                {step === STEPS.length - 1 ? 'See my matches' : step === 1 && answers.styles.length === 0 ? 'No preference' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: footerPad + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {matches.length > 0 ? (
            <>
              <Text style={styles.title}>
                {strong
                  ? matches.length === 1 ? 'We found 1 plan for you' : `We found ${matches.length} plans for you`
                  : 'Closest plans we have'}
              </Text>
              <Text style={styles.sub}>
                {strong
                  ? 'Best match first. You can change anything after you start.'
                  : "None is a strong match, but these come closest. Build My Plan can make one that fits."}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>No premade plan fits yet</Text>
              <Text style={styles.sub}>
                Every premade plan includes something you avoid. Build My Plan makes one around your choices instead.
              </Text>
            </>
          )}

          {matches.map((m, k) => {
            // Already running: no "Start" (it would offer to replace the plan
            // with itself), same as the plan page.
            const isCurrent = !!activePlanName && m.plan.name === activePlanName;
            return (
            <View key={m.plan.id} style={[styles.card, k === 0 && strong && styles.cardBest]}>
              <View style={styles.tags}>
                {k === 0 && strong ? <Text style={styles.badge}>BEST MATCH</Text> : null}
                {isCurrent ? <Text style={styles.currentTag}>YOUR CURRENT PLAN</Text> : null}
              </View>
              <View style={styles.cardTop}>
                <Text style={styles.planName} numberOfLines={2}>{m.plan.name}</Text>
                <Text style={styles.match}>{m.score}% match</Text>
              </View>
              <Text style={styles.stats}>
                {m.caloriesPerDay ? `${m.caloriesPerDay.toLocaleString()} kcal/day · ` : ''}
                {m.mealsPerDay} meals/day · 7 days
              </Text>
              <View style={styles.reasons}>
                {m.reasons.map(r => (
                  <View key={r} style={styles.reason}>
                    <Ionicons name="checkmark" size={15} color={COLORS.green} />
                    <Text style={styles.reasonText}>{r}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.cardBtns}>
                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => router.push({ pathname: '/plan/[id]', params: { id: m.plan.id } })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.viewText}>View plan</Text>
                </TouchableOpacity>
                {!isCurrent ? (
                  <TouchableOpacity style={styles.startBtn} onPress={() => startPlanWithConfirm(m.plan)} activeOpacity={0.85}>
                    <Text style={styles.startText}>Start plan</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            );
          })}

          <View style={styles.bridge}>
            <Text style={styles.bridgeTitle}>{matches.length > 0 ? 'None of these fit?' : 'Make your own instead'}</Text>
            <Text style={styles.bridgeSub}>Build My Plan creates a week around the foods you pick.</Text>
            <TouchableOpacity
              style={styles.bridgeBtn}
              onPress={() => router.replace('/plan/build')}
              activeOpacity={0.8}
            >
              <Text style={styles.bridgeBtnText}>Try Build My Plan instead</Text>
              <Ionicons name="arrow-forward" size={16} color={COLORS.green} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => setStep(0)} style={styles.redo} hitSlop={8}>
            <Text style={styles.redoText}>Change my answers</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </Screen>
  );
}

function Chip({ label, on, radio, onPress }: { label: string; on: boolean; radio?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: on }}
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Question({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : <View style={{ height: 14 }} />}
      {children}
    </View>
  );
}

function OptionList<T extends string>({
  options, isOn, onPick, multi,
}: { options: Option<T>[]; isOn: (v: T) => boolean; onPick: (v: T) => void; multi?: boolean }) {
  return (
    <View style={styles.options}>
      {options.map((o, k) => {
        const on = isOn(o.value);
        const tint = TINTS[k % TINTS.length];
        return (
          <TouchableOpacity
            key={o.value}
            style={[styles.option, on && styles.optionOn]}
            onPress={() => onPick(o.value)}
            activeOpacity={0.8}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on }}
          >
            <View style={[styles.optionIcon, { backgroundColor: tint + '24' }]}>
              <Ionicons name={o.icon} size={19} color={tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>{o.title}</Text>
              {o.sub ? <Text style={styles.optionSub}>{o.sub}</Text> : null}
            </View>
            <View style={[styles.check, on && styles.checkOn]}>
              {on ? <Ionicons name="checkmark" size={14} color="#06210F" /> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 4 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.elevated },
  progressOn: { backgroundColor: COLORS.green },
  body: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  stepLabel: {
    color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.9,
    textTransform: 'uppercase', marginBottom: 8,
  },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4, lineHeight: 29, marginBottom: 6 },
  sub: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20 },

  options: { gap: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  optionOn: { backgroundColor: COLORS.green + '1A', borderColor: COLORS.green + '8C' },
  optionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  optionSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },

  groupLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.green + '1F', borderColor: COLORS.green + '8C' },
  chipText: { color: COLORS.text, fontSize: 14 },
  chipTextOn: { color: COLORS.green, fontWeight: '600' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  hint: { color: COLORS.textSecondary, fontSize: 12.5 },

  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  primary: { height: 52, borderRadius: 26, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  primaryDim: { backgroundColor: COLORS.elevated },
  primaryText: { color: '#06210F', fontSize: 16, fontWeight: '700' },
  primaryTextDim: { color: COLORS.text },

  card: {
    borderRadius: 20, padding: 16, marginBottom: 12,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  cardBest: { backgroundColor: COLORS.green + '14', borderColor: COLORS.green + '59' },
  tags: { flexDirection: 'row', gap: 6 },
  badge: {
    alignSelf: 'flex-start', color: '#06210F', backgroundColor: COLORS.green, fontSize: 11, fontWeight: '800',
    letterSpacing: 0.3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', marginBottom: 8,
  },
  currentTag: {
    alignSelf: 'flex-start', color: COLORS.blue, backgroundColor: COLORS.blue + '24', fontSize: 11, fontWeight: '800',
    letterSpacing: 0.3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', marginBottom: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  planName: { flex: 1, color: COLORS.text, fontSize: 17, fontWeight: '700' },
  match: {
    color: COLORS.green, backgroundColor: COLORS.green + '24', fontSize: 12, fontWeight: '700',
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: 'hidden',
  },
  stats: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 8, marginBottom: 10 },
  reasons: { gap: 5, marginBottom: 12 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reasonText: { color: COLORS.text, fontSize: 13 },
  cardBtns: { flexDirection: 'row', gap: 8 },
  viewBtn: {
    flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.elevated, borderWidth: 1, borderColor: COLORS.border,
  },
  viewText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  startBtn: { flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.green },
  startText: { color: '#06210F', fontSize: 14, fontWeight: '700' },

  bridge: {
    marginTop: 6, borderRadius: 20, padding: 18, alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)',
  },
  bridgeTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  bridgeSub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  bridgeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 18, borderRadius: 21,
    borderWidth: 1, borderColor: COLORS.green + '80',
  },
  bridgeBtnText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  redo: { alignSelf: 'center', marginTop: 18 },
  redoText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
