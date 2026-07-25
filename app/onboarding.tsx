import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Line, Polyline, Circle as SvgCircle } from 'react-native-svg';

import { HeightPicker, type HeightUnit } from '@/components/onboarding/HeightPicker';
import { Slider } from '@/components/onboarding/Slider';
import { WeightPicker, type WeightUnitChoice } from '@/components/onboarding/WeightPicker';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { NUTRIENT_META } from '@/constants/nutrients';
import {
  ageFromBirthday,
  calcGoalDate,
  calcOnboardingTargets,
  KG_PER_LB,
  LBS_PER_KG,
  type OnboardingGoal,
} from '@/constants/onboardingCalc';
import { COLORS } from '@/constants/theme';
import { signInWithEmail, signUpWithEmail, useAuth } from '@/lib/auth';
import { engine } from '@/lib/sync/engine';
import type { ActivityLevel, GoalType, NutrientKey } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const APP_NAME = 'NutriTrack';

type StepId =
  | 'welcome' | 'carousel' | 'firstName' | 'goal' | 'gender' | 'birthday'
  | 'height' | 'weight' | 'pause' | 'targetWeight' | 'activity' | 'pace'
  | 'dietary' | 'allergies' | 'nutrients' | 'processing' | 'account'
  | 'accountConfirm' | 'setupLoading' | 'resultsTimeline' | 'resultsNutrition'
  | 'notifications' | 'activation';

const GOAL_OPTIONS: { value: OnboardingGoal; label: string }[] = [
  { value: 'lose',      label: 'I want to lose weight' },
  { value: 'healthier', label: 'I want to eat healthier' },
  { value: 'muscle',    label: 'I want to build muscle' },
];

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary',         label: 'My days are mostly sitting' },
  { value: 'lightly_active',    label: 'I get light movement in' },
  { value: 'moderately_active', label: "I'm active on most days" },
  { value: 'very_active',       label: 'I train or exercise regularly' },
];

const DIETARY_OPTIONS = ['Vegan', 'Vegetarian', 'Pescatarian', 'Halal', 'Kosher', 'Keto', 'Gluten-free', 'Dairy-free', 'None'];
const ALLERGY_OPTIONS = ['Nuts', 'Dairy', 'Gluten', 'Shellfish', 'Soy', 'Eggs', 'Fish', 'None'];
const NUTRIENT_OPTIONS: NutrientKey[] = ['fiber', 'sodium', 'potassium', 'sugar', 'cholesterol', 'iron'];

const GOAL_TO_TYPE: Record<OnboardingGoal, GoalType> = {
  lose: 'lose_weight',
  healthier: 'maintain',
  muscle: 'gain_muscle',
};

const CAROUSEL = [
  { icon: 'scan-outline',      title: 'AI-powered meal scanning',  sub: 'Snap a photo and we log the nutrition for you.' },
  { icon: 'restaurant-outline', title: 'Plans built around you',    sub: 'Personalized meal plans matched to your goals.' },
  { icon: 'trending-up-outline', title: 'Hit your targets',         sub: 'Track your nutrition and see progress every day.' },
];

interface Answers {
  firstName: string;
  goal: OnboardingGoal | null;
  gender: 'male' | 'female' | null;
  birthday: Date | null;
  heightCm: number;
  heightUnit: HeightUnit;
  weightKg: number;
  weightUnit: WeightUnitChoice;
  targetWeightKg: number;
  activity: ActivityLevel | null;
  paceLbsPerWeek: number;
  dietary: string[];
  allergies: string[];
  nutrients: NutrientKey[];
  notificationsAllowed: boolean | null;
  email: string;
}

const DEFAULT_ANSWERS: Answers = {
  firstName: '',
  goal: null,
  gender: null,
  birthday: new Date(1998, 0, 1),
  heightCm: 175,
  heightUnit: 'imperial',
  weightKg: 70,
  weightUnit: 'lbs',
  targetWeightKg: 65,
  activity: null,
  paceLbsPerWeek: 1,
  dietary: [],
  allergies: [],
  nutrients: [],
  notificationsAllowed: null,
  email: '',
};

export default function OnboardingScreen() {
  const updateProfile = useMealStore(s => s.updateProfile);
  const updateGoals = useMealStore(s => s.updateGoals);
  const logWeight = useMealStore(s => s.logWeight);

  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [stepId, setStepId] = useState<StepId>('welcome');
  const [mode, setMode] = useState<'flow' | 'login'>('flow');
  const patch = (p: Partial<Answers>) => setAnswers(a => ({ ...a, ...p }));

  const isWeightGoal = answers.goal === 'lose' || answers.goal === 'muscle';

  // The ordered flow. Conditional screens are only present for weight goals.
  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = ['welcome', 'carousel', 'firstName', 'goal', 'gender', 'birthday', 'height', 'weight', 'pause'];
    if (isWeightGoal) s.push('targetWeight');
    s.push('activity');
    if (isWeightGoal) s.push('pace');
    s.push('dietary', 'allergies', 'nutrients', 'processing', 'account', 'accountConfirm', 'setupLoading');
    if (isWeightGoal) s.push('resultsTimeline');
    s.push('resultsNutrition', 'notifications', 'activation');
    return s;
  }, [isWeightGoal]);

  const index = Math.max(0, steps.indexOf(stepId));
  const progress = steps.length > 1 ? index / (steps.length - 1) : 0;

  const go = (delta: number) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, index + delta))];
    setStepId(next);
  };
  const goTo = (id: StepId) => setStepId(id);

  // ─── Targets (pure; computed for the results screens) ──────────────────────
  const targets = useMemo(() => {
    if (!answers.goal || !answers.gender || !answers.activity || !answers.birthday) return null;
    return calcOnboardingTargets({
      goal: answers.goal,
      gender: answers.gender,
      age: ageFromBirthday(answers.birthday.toISOString().slice(0, 10)),
      heightCm: answers.heightCm,
      weightKg: answers.weightKg,
      activityLevel: answers.activity,
      paceLbsPerWeek: isWeightGoal ? answers.paceLbsPerWeek : null,
    });
  }, [answers, isWeightGoal]);

  const goalDate = useMemo(() => {
    if (!isWeightGoal) return null;
    return calcGoalDate(answers.weightKg, answers.targetWeightKg, answers.paceLbsPerWeek);
  }, [answers.weightKg, answers.targetWeightKg, answers.paceLbsPerWeek, isWeightGoal]);

  // ─── Completion ────────────────────────────────────────────────────────────
  const finish = (buildPlan: boolean) => {
    if (!targets || !answers.goal || !answers.gender || !answers.birthday) return;
    const iso = answers.birthday.toISOString().slice(0, 10);
    const targetWeightKg = isWeightGoal ? answers.targetWeightKg : answers.weightKg;

    updateProfile({
      name: answers.firstName,
      firstName: answers.firstName,
      email: answers.email || undefined,
      gender: answers.gender,
      birthday: iso,
      age: ageFromBirthday(iso),
      heightCm: Math.round(answers.heightCm),
      weightKg: answers.weightKg,
      targetWeightKg,
      goalType: GOAL_TO_TYPE[answers.goal],
      activityLevel: answers.activity ?? undefined,
      paceLbsPerWeek: isWeightGoal ? answers.paceLbsPerWeek : null,
      goalDate,
      weightUnit: answers.weightUnit === 'kg' ? 'kg' : 'lbs',
      dietaryRestrictions: answers.dietary.filter(d => d !== 'None'),
      allergies: answers.allergies.filter(a => a !== 'None'),
      trackedNutrients: answers.nutrients,
      notificationsAllowed: answers.notificationsAllowed ?? false,
      mealRemindersEnabled: answers.notificationsAllowed ?? false,
      onboardingComplete: true,
      pendingFirstPlan: true,
    });
    updateGoals({
      dailyCalories: targets.dailyCalories,
      protein: targets.protein,
      carbs: targets.carbs,
      fats: targets.fats,
      waterTargetCups: targets.waterTargetCups,
      isCalculated: true,
    });
    logWeight(answers.weightKg);

    if (buildPlan) router.replace('/plan/build');
    else router.replace('/(tabs)');
  };

  // Returning-user login. onboardingComplete is a LOCAL-ONLY flag (never stored
  // on the server), so we must set it here to let the user into the tabs — but
  // only once the post-login pull has actually restored their profile. Marking
  // it done unconditionally is what let a wiped/empty local cache slip into the
  // app showing "Add your name" and blank tabs. Drive the reconcile ourselves
  // (rather than passively waiting for SyncProvider's listener to notice the
  // new session) so there's no race and a real failure reason is available.
  // The success tail of a login: mark the local-only onboardingComplete flag and
  // enter the app. Extracted so LoginView can also call it if the account data
  // lands *after* a soft-timeout already surfaced an error (see onLateSuccess).
  const finishLogin = () => {
    updateProfile({ onboardingComplete: true });
    router.replace('/(tabs)');
  };

  const loginComplete = async (userId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const result = await confirmLoginData(userId);
    if (!result.ok) return result;
    finishLogin();
    return { ok: true };
  };

  // Weight display used for the results screens (st treated as lbs).
  const displayWeight = (kg: number) =>
    answers.weightUnit === 'kg' ? `${(Math.round(kg * 10) / 10)} kg` : `${Math.round(kg * LBS_PER_KG)} lbs`;

  // Steps that auto-advance / shouldn't show a back arrow.
  const noBack = stepId === 'welcome' || stepId === 'processing' || stepId === 'accountConfirm' || stepId === 'setupLoading';

  if (mode === 'login') {
    return <LoginView onBack={() => setMode('flow')} onDone={loginComplete} onLateSuccess={finishLogin} />;
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Progress + back */}
      <View style={styles.topBar}>
        {!noBack ? (
          <TouchableOpacity onPress={() => go(-1)} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={20} color={COLORS.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <View style={styles.backBtn} />
      </View>

      {renderStep()}
    </Screen>
  );

  // ─── Step renderer ─────────────────────────────────────────────────────────
  function renderStep() {
    switch (stepId) {
      case 'welcome':
        return <WelcomeStep onStart={() => go(1)} onLogin={() => setMode('login')} />;
      case 'carousel':
        return <CarouselStep onNext={() => go(1)} />;

      case 'firstName':
        return (
          <FormStep
            title="What's your name?"
            explain="We use your name to personalize your experience."
            canNext={answers.firstName.trim().length > 0}
            onNext={() => go(1)}
          >
            <TextInput
              style={styles.input}
              placeholder="Your first name"
              placeholderTextColor={COLORS.textMuted}
              value={answers.firstName}
              onChangeText={t => patch({ firstName: t })}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => answers.firstName.trim() && go(1)}
            />
          </FormStep>
        );

      case 'goal':
        return (
          <CardsStep title="What's your goal?" explain="This helps us calculate your daily nutrition targets.">
            {GOAL_OPTIONS.map(o => (
              <SelectCard
                key={o.value}
                label={o.label}
                selected={answers.goal === o.value}
                onPress={() => { patch({ goal: o.value }); setTimeout(() => go(1), 120); }}
              />
            ))}
          </CardsStep>
        );

      case 'gender':
        return (
          <CardsStep title="What gender were you born with?" explain="Your gender is used to calculate nutritional needs. It helps us adjust your plan accordingly.">
            <View style={styles.genderRow}>
              {(['female', 'male'] as const).map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderCard, answers.gender === g && styles.cardSelected]}
                  onPress={() => { patch({ gender: g }); setTimeout(() => go(1), 120); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.cardText, answers.gender === g && styles.cardTextSelected]}>
                    {g === 'female' ? 'Female' : 'Male'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </CardsStep>
        );

      case 'birthday':
        return (
          <FormStep
            title="When were you born?"
            explain="We ask this because your age influences your energy needs. It helps us adjust your plan accordingly."
            canNext
            onNext={() => go(1)}
          >
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={answers.birthday ?? new Date(1998, 0, 1)}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                themeVariant="dark"
                onChange={(_, d) => d && patch({ birthday: d })}
              />
            </View>
          </FormStep>
        );

      case 'height':
        return (
          <FormStep
            title="How tall are you?"
            explain="We use your height to better understand your body's needs and adjust your plan accordingly."
            canNext
            onNext={() => go(1)}
          >
            <View style={styles.pickerWrap}>
              <HeightPicker
                heightCm={answers.heightCm}
                unit={answers.heightUnit}
                onChange={cm => patch({ heightCm: cm })}
                onUnitChange={u => patch({ heightUnit: u })}
              />
            </View>
          </FormStep>
        );

      case 'weight':
        return (
          <FormStep
            title="What do you weigh now?"
            explain="Your current weight helps us understand your starting point and adjust your plan accordingly."
            canNext
            onNext={() => go(1)}
          >
            <View style={styles.pickerWrap}>
              <WeightPicker
                weightKg={answers.weightKg}
                unit={answers.weightUnit}
                onChange={kg => patch({ weightKg: kg })}
                onUnitChange={u => patch({ weightUnit: u })}
              />
            </View>
          </FormStep>
        );

      case 'pause':
        return (
          <MessageStep
            title="Great — we've got your starting point."
            body="Now we can make your plan smarter and more personal."
            onNext={() => go(1)}
          />
        );

      case 'targetWeight': {
        const warn =
          answers.goal === 'lose' && answers.targetWeightKg > answers.weightKg
            ? "You're trying to lose weight, so your goal weight should be less than your current weight."
            : answers.goal === 'muscle' && answers.targetWeightKg < answers.weightKg
            ? "You're trying to build muscle, so your goal weight should be more than your current weight."
            : null;
        return (
          <FormStep
            title="What is your goal weight?"
            explain="This helps us create a plan that supports your wellbeing and feels right for you."
            canNext
            onNext={() => go(1)}
          >
            <View style={styles.pickerWrap}>
              <WeightPicker
                weightKg={answers.targetWeightKg}
                unit={answers.weightUnit}
                onChange={kg => patch({ targetWeightKg: kg })}
                onUnitChange={u => patch({ weightUnit: u })}
              />
            </View>
            {warn ? <Text style={styles.warn}>{warn}</Text> : null}
          </FormStep>
        );
      }

      case 'activity':
        return (
          <CardsStep title="What is your typical day like?" explain="This helps us personalize your daily recommendations.">
            {ACTIVITY_OPTIONS.map(o => (
              <SelectCard
                key={o.value}
                label={o.label}
                selected={answers.activity === o.value}
                onPress={() => { patch({ activity: o.value }); setTimeout(() => go(1), 120); }}
              />
            ))}
          </CardsStep>
        );

      case 'pace': {
        const min = answers.goal === 'muscle' ? 0.25 : 0.5;
        const max = answers.goal === 'muscle' ? 1.0 : 2.0;
        const t = (answers.paceLbsPerWeek - min) / (max - min);
        const paceLabel = t < 0.34 ? 'Gentle and sustainable' : t < 0.67 ? 'Steady momentum' : 'Ambitious pace';
        const rateText =
          answers.weightUnit === 'kg'
            ? `${(Math.round(answers.paceLbsPerWeek * KG_PER_LB * 100) / 100)} kg / week`
            : `${answers.paceLbsPerWeek} lbs / week`;
        return (
          <FormStep
            title="Desired speed of change?"
            explain="A balanced pace supports consistent progress while keeping life flexible."
            canNext
            onNext={() => go(1)}
          >
            <Text style={styles.paceRate}>{rateText}</Text>
            <View style={{ paddingHorizontal: 4, marginTop: 20 }}>
              <Slider
                min={min}
                max={max}
                step={0.25}
                value={answers.paceLbsPerWeek}
                onChange={v => patch({ paceLbsPerWeek: v })}
              />
            </View>
            <Text style={styles.paceLabel}>{paceLabel}</Text>
          </FormStep>
        );
      }

      case 'dietary':
        return (
          <MultiSelectStep
            title="Any dietary preferences?"
            explain="This helps us suggest meals that match your lifestyle."
            options={DIETARY_OPTIONS}
            selected={answers.dietary}
            onToggle={v => toggleMulti('dietary', v)}
            onNext={() => go(1)}
          />
        );

      case 'allergies':
        return (
          <MultiSelectStep
            title="Any food allergies?"
            explain="We'll make sure your meal suggestions avoid these ingredients."
            options={ALLERGY_OPTIONS}
            selected={answers.allergies}
            onToggle={v => toggleMulti('allergies', v)}
            onNext={() => go(1)}
          />
        );

      case 'nutrients':
        return (
          <MultiSelectStep
            title="Which nutrients matter most to you?"
            explain="We'll track these alongside your main macros so you can see what matters to you."
            options={NUTRIENT_OPTIONS.map(labelForNutrient)}
            selected={answers.nutrients.map(labelForNutrient)}
            onToggle={label => toggleNutrient(nutrientForLabel(label))}
            onNext={() => go(1)}
            onSkip={() => { patch({ nutrients: [] }); go(1); }}
          />
        );

      case 'processing':
        return <ProcessingStep onDone={() => go(1)} />;

      case 'account':
        return (
          <AccountStep
            appName={APP_NAME}
            email={answers.email}
            onEmailChange={e => patch({ email: e })}
            onContinue={() => go(1)}
            onExistingAccount={() => setMode('login')}
          />
        );

      case 'accountConfirm':
        return <ConfirmStep onDone={() => go(1)} />;

      case 'setupLoading':
        return <SetupLoadingStep onDone={() => go(1)} />;

      case 'resultsTimeline':
        return (
          <TimelineStep
            name={answers.firstName}
            currentLabel={displayWeight(answers.weightKg)}
            goalLabel={displayWeight(answers.targetWeightKg)}
            goalDate={goalDate}
            losing={answers.goal === 'lose'}
            onNext={() => go(1)}
          />
        );

      case 'resultsNutrition':
        return <NutritionResultStep calories={targets?.dailyCalories ?? 0} onNext={() => go(1)} />;

      case 'notifications':
        return (
          <NotificationStep
            onAllow={() => { patch({ notificationsAllowed: true }); go(1); }}
            onSkip={() => { patch({ notificationsAllowed: false }); go(1); }}
          />
        );

      case 'activation':
        return (
          <ActivationStep
            onBuild={() => finish(true)}
            onLater={() => finish(false)}
          />
        );

      default:
        return null;
    }
  }

  function toggleMulti(field: 'dietary' | 'allergies', value: string) {
    setAnswers(a => {
      const cur = a[field];
      if (value === 'None') return { ...a, [field]: cur.includes('None') ? [] : ['None'] };
      const without = cur.filter(v => v !== 'None');
      const next = without.includes(value) ? without.filter(v => v !== value) : [...without, value];
      return { ...a, [field]: next };
    });
  }

  function toggleNutrient(key: NutrientKey) {
    setAnswers(a => ({
      ...a,
      nutrients: a.nutrients.includes(key) ? a.nutrients.filter(n => n !== key) : [...a.nutrients, key],
    }));
  }
}

// ─── Shared layout pieces ──────────────────────────────────────────────────────

function StepTitle({ title, explain }: { title: string; explain?: string }) {
  return (
    <>
      <Text style={styles.title}>{title}</Text>
      {explain ? <Text style={styles.explainTop}>{explain}</Text> : null}
    </>
  );
}

function FormStep({
  title, explain, children, canNext, onNext,
}: {
  title: string; explain: string; children: React.ReactNode; canNext: boolean; onNext: () => void;
}) {
  return (
    <View style={styles.body}>
      <StepTitle title={title} />
      <View style={styles.formContent}>{children}</View>
      <Text style={styles.explain}>{explain}</Text>
      <PrimaryButton label="Next" disabled={!canNext} onPress={onNext} />
    </View>
  );
}

function CardsStep({ title, explain, children }: { title: string; explain: string; children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <StepTitle title={title} />
      <View style={{ marginTop: 20, gap: 12 }}>{children}</View>
      <Text style={styles.explain}>{explain}</Text>
    </ScrollView>
  );
}

function MultiSelectStep({
  title, explain, options, selected, onToggle, onNext, onSkip,
}: {
  title: string; explain: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; onNext: () => void; onSkip?: () => void;
}) {
  return (
    <View style={styles.body}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
        <StepTitle title={title} />
        <View style={{ marginTop: 20, gap: 10 }}>
          {options.map(o => (
            <SelectCard key={o} label={o} selected={selected.includes(o)} onPress={() => onToggle(o)} multi />
          ))}
        </View>
        <Text style={styles.explain}>{explain}</Text>
      </ScrollView>
      {onSkip ? (
        <TouchableOpacity onPress={onSkip} style={styles.skipLink}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      ) : null}
      <PrimaryButton label="Next" onPress={onNext} />
    </View>
  );
}

function MessageStep({ title, body, onNext }: { title: string; body: string; onNext: () => void }) {
  return (
    <View style={[styles.body, styles.centered]}>
      <Text style={styles.bigTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="Next" onPress={onNext} />
    </View>
  );
}

function SelectCard({
  label, selected, onPress, multi,
}: { label: string; selected: boolean; onPress: () => void; multi?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.cardText, selected && styles.cardTextSelected]}>{label}</Text>
      {multi ? (
        <Ionicons
          name={selected ? 'checkbox' : 'square-outline'}
          size={20}
          color={selected ? COLORS.green : COLORS.textMuted}
        />
      ) : null}
    </TouchableOpacity>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Individual screens with local behavior ────────────────────────────────────

function WelcomeStep({ onStart, onLogin }: { onStart: () => void; onLogin: () => void }) {
  return (
    <View style={[styles.body, styles.centered]}>
      <View style={{ flex: 1 }} />
      <View style={styles.logoCircle}>
        <Ionicons name="nutrition" size={48} color={COLORS.green} />
      </View>
      <Text style={styles.appName}>{APP_NAME}</Text>
      <Text style={styles.tagline}>Eat smarter. Reach your goals.</Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="Get Started" onPress={onStart} />
      <TouchableOpacity onPress={onLogin} style={styles.textLink}>
        <Text style={styles.textLinkText}>Log In</Text>
      </TouchableOpacity>
    </View>
  );
}

function CarouselStep({ onNext }: { onNext: () => void }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const pageW = width - 40; // account for 20px horizontal padding
  return (
    <View style={styles.body}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / pageW))}
      >
        {CAROUSEL.map((c, i) => (
          <View key={i} style={[styles.slide, { width: pageW }]}>
            <View style={styles.slideIcon}>
              <Ionicons name={c.icon as any} size={64} color={COLORS.green} />
            </View>
            <Text style={styles.slideTitle}>{c.title}</Text>
            <Text style={styles.slideSub}>{c.sub}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {CAROUSEL.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>
      <PrimaryButton label={page === CAROUSEL.length - 1 ? 'Next' : 'Next'} onPress={onNext} />
    </View>
  );
}

function ProcessingStep({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const messages = ['Analyzing your goals...', 'Calculating your targets...', 'Building your personalized plan...'];
  const msgIdx = Math.min(messages.length - 1, Math.floor(pct / 34));
  useEffect(() => {
    const start = Date.now();
    const total = 3800;
    const id = setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - start) / total) * 100));
      setPct(p);
      if (p >= 100) { clearInterval(id); setTimeout(onDone, 250); }
    }, 60);
    return () => clearInterval(id);
  }, [onDone]);
  return (
    <View style={[styles.body, styles.centered]}>
      <ProgressRing progress={pct / 100} size={140} strokeWidth={10}>
        <Text style={styles.ringPct}>{pct}%</Text>
      </ProgressRing>
      <Text style={[styles.bodyText, { marginTop: 28 }]}>{messages[msgIdx]}</Text>
    </View>
  );
}

// Apple / Google native sign-in requires a custom dev build (they don't run in
// Expo Go), so they're scaffolded here and wired later. Email/Password is live.
function comingSoon(provider: string) {
  Alert.alert(
    `${provider} sign-in coming soon`,
    `${provider} Sign In needs a native build and will be enabled before launch. For now, please continue with email.`,
  );
}

function AccountStep({
  appName, email, onEmailChange, onContinue, onExistingAccount,
}: { appName: string; email: string; onEmailChange: (e: string) => void; onContinue: () => void; onExistingAccount: () => void }) {
  const [emailForm, setEmailForm] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const valid = email.includes('@') && pw.length >= 6 && pw === pw2;

  const handleCreate = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    const { error: err, needsVerification, alreadyRegistered } = await signUpWithEmail(email, pw);
    setLoading(false);
    if (alreadyRegistered) {
      // Don't re-arm onboarding/verify banner for an existing account — offer login.
      setExistingAccount(true);
      setError(err);
      return;
    }
    if (err) {
      setError(err);
      return;
    }
    // Email confirmation is enabled: show a verify state, then let the user
    // continue the flow. (Their data persists locally; the account activates
    // once they verify and sign in.)
    if (needsVerification) {
      setVerificationSent(true);
      return;
    }
    onContinue();
  };

  if (verificationSent) {
    return (
      <View style={[styles.body, styles.centered]}>
        <Ionicons name="mail-unread-outline" size={56} color={COLORS.green} />
        <Text style={[styles.bigTitle, { marginTop: 20 }]}>Check your email</Text>
        <Text style={styles.bodyText}>
          We sent a verification link to {email}. Tap it to activate your account. You can keep going in the meantime.
        </Text>
        <View style={{ flex: 1 }} />
        <PrimaryButton label="Continue" onPress={onContinue} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Your personalized plan is ready.</Text>
      <Text style={styles.explainTop}>Create an account to begin your progress.</Text>

      <View style={{ marginTop: 28, gap: 12 }}>
        <AuthButton icon="logo-apple" label="Continue with Apple" onPress={() => comingSoon('Apple')} />
        <AuthButton icon="logo-google" label="Continue with Google" onPress={() => comingSoon('Google')} />
        <AuthButton icon="mail-outline" label="Continue with Email" onPress={() => setEmailForm(v => !v)} />
      </View>

      {emailForm ? (
        <View style={{ marginTop: 16, gap: 10 }}>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email}
            onChangeText={e => { setExistingAccount(false); onEmailChange(e); }} />
          <TextInput style={styles.input} placeholder="Password (min 6 characters)" placeholderTextColor={COLORS.textMuted}
            secureTextEntry value={pw} onChangeText={setPw} />
          <TextInput style={styles.input} placeholder="Confirm password" placeholderTextColor={COLORS.textMuted}
            secureTextEntry value={pw2} onChangeText={setPw2} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {existingAccount ? (
            <PrimaryButton label="Log in instead" onPress={onExistingAccount} />
          ) : (
            <PrimaryButton
              label={loading ? 'Creating account…' : 'Create Account'}
              disabled={!valid || loading}
              onPress={handleCreate}
            />
          )}
        </View>
      ) : null}

      <Text style={styles.legal}>
        By continuing, you agree to {appName}'s <Text style={styles.legalLink}>Terms & Conditions</Text> and{' '}
        <Text style={styles.legalLink}>Privacy Policy</Text>
      </Text>
    </ScrollView>
  );
}

function AuthButton({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.authBtn} onPress={onPress} activeOpacity={0.85}>
      <Ionicons name={icon} size={20} color={COLORS.text} />
      <Text style={styles.authBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function ConfirmStep({ onDone }: { onDone: () => void }) {
  useEffect(() => { const id = setTimeout(onDone, 1500); return () => clearTimeout(id); }, [onDone]);
  return (
    <View style={[styles.body, styles.centered]}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={56} color="#000" />
      </View>
      <Text style={[styles.bigTitle, { marginTop: 20 }]}>You're all set!</Text>
    </View>
  );
}

function SetupLoadingStep({ onDone }: { onDone: () => void }) {
  useEffect(() => { const id = setTimeout(onDone, 2500); return () => clearTimeout(id); }, [onDone]);
  return (
    <View style={[styles.body, styles.centered]}>
      <Ionicons name="sparkles-outline" size={56} color={COLORS.green} />
      <Text style={[styles.bigTitle, { marginTop: 20 }]}>We're setting everything up for you</Text>
      <Text style={styles.bodyText}>Customizing your health plan...</Text>
      <ActivityIndicator color={COLORS.green} size="large" style={{ marginTop: 24 }} />
    </View>
  );
}

function TimelineStep({
  name, currentLabel, goalLabel, goalDate, losing, onNext,
}: {
  name: string; currentLabel: string; goalLabel: string; goalDate: string | null; losing: boolean; onNext: () => void;
}) {
  const { width } = useWindowDimensions();
  const w = width - 40;
  const h = 140;
  const y1 = losing ? 30 : h - 30;
  const y2 = losing ? h - 30 : 30;
  const dateText = goalDate
    ? new Date(goalDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'your target date';
  const months = useMemo(() => {
    const arr: string[] = [];
    const d = new Date();
    for (let i = 0; i < 4; i++) { arr.push(d.toLocaleDateString('en-US', { month: 'short' })); d.setMonth(d.getMonth() + 1); }
    return arr;
  }, []);
  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <Svg width={w} height={h}>
        <Line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke={COLORS.border} strokeWidth={1} />
        <Polyline points={`0,${y1} ${w},${y2}`} fill="none" stroke={COLORS.green} strokeWidth={3} strokeLinecap="round" />
        <SvgCircle cx={0} cy={y1} r={5} fill={COLORS.green} />
        <SvgCircle cx={w} cy={y2} r={6} fill={COLORS.green} />
      </Svg>
      <View style={styles.monthRow}>
        {months.map((m, i) => <Text key={i} style={styles.monthLabel}>{m}</Text>)}
      </View>

      <Text style={styles.resultLabel}>Your goal weight</Text>
      <Text style={styles.resultBig}>{goalLabel}</Text>
      <View style={styles.motivTag}><Text style={styles.motivTagText}>You can do it!</Text></View>

      <Text style={[styles.resultLabel, { marginTop: 24 }]}>Your personalized plan</Text>
      <Text style={styles.resultPlan}>
        {name || 'You'}, you will reach your goal by {dateText}.
      </Text>
      <Text style={styles.resultSub}>From {currentLabel} → {goalLabel}</Text>

      <PrimaryButton label="Continue" onPress={onNext} />
    </ScrollView>
  );
}

function NutritionResultStep({ calories, onNext }: { calories: number; onNext: () => void }) {
  return (
    <View style={[styles.body, styles.centered]}>
      <ProgressRing progress={1} size={200} strokeWidth={14}>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.ringRemaining}>Remaining</Text>
          <Text style={styles.ringCalories}>{calories}</Text>
          <Text style={styles.ringGoal}>Goal {calories} kcal</Text>
        </View>
      </ProgressRing>
      <Text style={[styles.bigTitle, { marginTop: 32 }]}>Progress gets easier when the goal is simple.</Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="Continue" onPress={onNext} />
    </View>
  );
}

function NotificationStep({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <View style={[styles.body, styles.centered]}>
      <View style={{ flex: 1 }} />
      <Ionicons name="notifications-outline" size={56} color={COLORS.green} />
      <Text style={[styles.bigTitle, { marginTop: 20 }]}>Stay on track with meal reminders.</Text>
      <Text style={styles.bodyText}>Timely reminders help you stay consistent and hit your targets.</Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="Allow notifications" onPress={onAllow} />
      <TouchableOpacity onPress={onSkip} style={styles.textLink}>
        <Text style={styles.textLinkText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

function ActivationStep({ onBuild, onLater }: { onBuild: () => void; onLater: () => void }) {
  return (
    <View style={[styles.body, styles.centered]}>
      <View style={{ flex: 1 }} />
      <Ionicons name="restaurant-outline" size={56} color={COLORS.green} />
      <Text style={[styles.bigTitle, { marginTop: 20 }]}>Ready to build your first meal plan?</Text>
      <Text style={styles.bodyText}>We'll suggest meals based on your goals, preferences, and targets.</Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="Build My Plan" onPress={onBuild} />
      <TouchableOpacity onPress={onLater} style={styles.textLink}>
        <Text style={styles.textLinkText}>I'll do this later</Text>
      </TouchableOpacity>
    </View>
  );
}

function LoginView({
  onBack,
  onDone,
  onLateSuccess,
}: {
  onBack: () => void;
  onDone: (userId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onLateSuccess: () => void;
}) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { session } = useAuth();
  const hasProfile = useMealStore(s => !!s.profile.firstName);
  const attemptedRef = useRef(false);
  const finishedRef = useRef(false);

  // Recover from a "stuck" error. confirmLoginData uses a soft timeout, so it can
  // return a failure (e.g. "couldn't load your account data") while the in-flight
  // reconcile is still running and then succeeds moments later. When that late
  // success lands — the session is valid AND the profile is now restored — clear
  // the (now-false) error and enter the app instead of stranding the user on it.
  // Gated on an actual login attempt so it never hijacks a user who merely opened
  // this screen while already signed in, and fires at most once.
  useEffect(() => {
    if (!attemptedRef.current || finishedRef.current) return;
    if (error && session && hasProfile) {
      finishedRef.current = true;
      setError(null);
      setLoading(false);
      onLateSuccess();
    }
  }, [error, session, hasProfile, onLateSuccess]);

  const handleLogin = async () => {
    if (!email.includes('@') || pw.length < 1 || loading) return;
    attemptedRef.current = true;
    setLoading(true);
    setError(null);
    const { error: err, userId } = await signInWithEmail(email, pw);
    if (err || !userId) {
      setLoading(false);
      setError(err ?? 'Sign-in succeeded but no account id was returned. Please try again.');
      return;
    }
    // Keep the spinner up while the post-login pull restores the account. onDone
    // navigates into the app on success; on failure the account had no data to
    // restore, so we stay here and surface the real reason rather than empty tabs.
    const result = await onDone(userId);
    if (result.ok) {
      finishedRef.current = true;
    } else {
      setLoading(false);
      setError(result.error);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <View style={styles.backBtn} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Welcome back</Text>
        <View style={{ marginTop: 24, gap: 10 }}>
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor={COLORS.textMuted}
            secureTextEntry value={pw} onChangeText={setPw} />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity onPress={() => router.push('/auth/forgot-password')} style={styles.forgotLink} hitSlop={8}>
            <Text style={styles.forgotLinkText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1 }} />
        <PrimaryButton
          label={loading ? 'Logging in…' : 'Log In'}
          disabled={!email.includes('@') || pw.length < 1 || loading}
          onPress={handleLogin}
        />
      </View>

      {loading ? (
        <View style={styles.loginOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={COLORS.green} />
          <Text style={styles.loginOverlayText}>Signing you in…</Text>
        </View>
      ) : null}
    </Screen>
  );
}

// ─── Login data gate ───────────────────────────────────────────────────────────

// After a returning user signs in, kick off the sync engine's reconcile and wait
// for the account data to actually land. The reliable success signal is the
// pulled profile appearing in the store — watched via a store subscription —
// NOT engine.onSignIn() resolving. Depending on that promise was fragile: in
// some login races (a concurrent SyncProvider reconcile, or a tunnel-triggered
// JS reload orphaning the tracked promise) it stayed pending well past the pull,
// tripping the 20s timeout even though the pull had finished in ~1.5s and the
// profile was already in the store. Reasons we resolve:
//   • 'restored' — profile.firstName is set (the pull merged real data in)
//   • 'empty'    — the reconcile finished but no profile came back (new/empty acct)
//   • 'timeout'  — neither happened within the bound (hung network)
const LOGIN_PULL_TIMEOUT_MS = 20_000;

async function confirmLoginData(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hasProfile = () => !!useMealStore.getState().profile.firstName;

  // Kick the reconcile. We deliberately don't gate success on this promise
  // resolving (see note above); it's only used as a fast "empty account" signal.
  const reconcileDone = engine.onSignIn(userId).catch(() => {});

  if (hasProfile()) return { ok: true };

  const outcome = await new Promise<'restored' | 'empty' | 'timeout'>(resolve => {
    let settled = false;
    const finish = (v: 'restored' | 'empty' | 'timeout') => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(v);
    };
    // Succeed the instant the pulled profile lands in the store.
    const unsub = useMealStore.subscribe(s => {
      if (s.profile.firstName) finish('restored');
    });
    const timer = setTimeout(() => finish('timeout'), LOGIN_PULL_TIMEOUT_MS);
    // Guard the tiny window between the initial check and subscribing, in case
    // the snapshot landed in between (subscribe only fires on future updates).
    if (hasProfile()) finish('restored');
    // If the reconcile completes and there's still no profile, fail fast rather
    // than waiting out the full timeout — this is a genuinely empty account.
    void reconcileDone.then(() => finish(hasProfile() ? 'restored' : 'empty'));
  });

  if (outcome === 'restored') return { ok: true };

  if (outcome === 'empty') {
    const { lastError } = engine.getSnapshot();
    const reason = lastError ?? 'the pull completed but no profile came back for this account';
    // eslint-disable-next-line no-console
    console.warn(`[login] no profile restored for ${userId}: ${reason}`);
    return { ok: false, error: reason };
  }

  // eslint-disable-next-line no-console
  console.warn(`[login] account pull timed out for ${userId}`);
  return { ok: false, error: "We couldn't load your account data. Check your connection and try again." };
}

// ─── Nutrient label helpers ────────────────────────────────────────────────────

function labelForNutrient(key: NutrientKey): string {
  return NUTRIENT_META.find(n => n.key === key)?.label ?? key;
}
function nutrientForLabel(label: string): NutrientKey {
  return NUTRIENT_META.find(n => n.label === label)?.key ?? 'fiber';
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.green, borderRadius: 2 },

  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  centered: { alignItems: 'center' },
  formContent: { flex: 1, justifyContent: 'center' },

  title: { color: COLORS.text, fontSize: 26, fontWeight: '700', lineHeight: 32 },
  bigTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', textAlign: 'center', lineHeight: 30, marginTop: 8 },
  explainTop: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8 },
  explain: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 16, marginBottom: 12 },
  bodyText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 },

  input: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 14, color: COLORS.text, fontSize: 16,
  },
  errorText: { color: COLORS.red, fontSize: 13, marginTop: 2 },
  forgotLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  forgotLinkText: { color: COLORS.green, fontSize: 14, fontWeight: '600' },
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loginOverlayText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },

  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 18, paddingVertical: 20,
  },
  cardSelected: { borderColor: COLORS.green, backgroundColor: COLORS.green + '14' },
  cardText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  cardTextSelected: { color: COLORS.green },

  genderRow: { flexDirection: 'row', gap: 12 },
  genderCard: {
    flex: 1, alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 14,
    borderWidth: 1.5, borderColor: COLORS.border, paddingVertical: 32,
  },

  pickerWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },

  warn: { color: COLORS.red, fontSize: 13, textAlign: 'center', marginTop: 12 },

  paceRate: { color: COLORS.text, fontSize: 28, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  paceLabel: { color: COLORS.green, fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 18 },

  primaryBtn: { backgroundColor: COLORS.green, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  textLink: { alignItems: 'center', paddingVertical: 14 },
  textLinkText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },

  skipLink: { alignItems: 'center', paddingVertical: 8 },
  skipText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },

  // Welcome
  logoCircle: {
    width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.green + '1F', alignSelf: 'center',
  },
  appName: { color: COLORS.text, fontSize: 32, fontWeight: '800', textAlign: 'center', marginTop: 20 },
  tagline: { color: COLORS.textSecondary, fontSize: 16, textAlign: 'center', marginTop: 8 },

  // Carousel
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  slideIcon: {
    width: 120, height: 120, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.green + '14', marginBottom: 40,
  },
  slideTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  slideSub: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { backgroundColor: COLORS.green, width: 22 },

  // Processing / results
  ringPct: { color: COLORS.text, fontSize: 30, fontWeight: '800' },
  ringRemaining: { color: COLORS.textSecondary, fontSize: 13 },
  ringCalories: { color: COLORS.text, fontSize: 44, fontWeight: '800' },
  ringGoal: { color: COLORS.textSecondary, fontSize: 13 },

  monthRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  monthLabel: { color: COLORS.textMuted, fontSize: 11 },
  resultLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 20 },
  resultBig: { color: COLORS.text, fontSize: 34, fontWeight: '800', marginTop: 4 },
  motivTag: { alignSelf: 'flex-start', backgroundColor: COLORS.green + '22', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 },
  motivTagText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  resultPlan: { color: COLORS.text, fontSize: 17, fontWeight: '600', marginTop: 6, lineHeight: 24 },
  resultSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8 },

  // Account
  authBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 15,
  },
  authBtnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  legal: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
  legalLink: { color: COLORS.green },

  checkCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
  },
});
