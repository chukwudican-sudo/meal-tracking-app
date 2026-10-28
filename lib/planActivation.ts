// One confirmation for activating a plan, shared by Plan detail and Build My
// Plan so the wording and rules can't drift. Activation replaces the current
// plan and every meal from tomorrow onward (see useMealStore#activatePlan);
// today's eaten/own meals and past days are never touched.

import { Alert } from 'react-native';

import { countFutureMeals, useMealStore } from '@/store/useMealStore';

interface Options {
  /** A plan is already active (profile.activePlanName is set). */
  hasCurrentPlan: boolean;
  onActivate: () => void;
  /** Offered only when replacing a current plan. */
  onSaveAndActivate?: () => void;
}

export function confirmPlanActivation({ hasCurrentPlan, onActivate, onSaveAndActivate }: Options): void {
  const { logs, templates } = useMealStore.getState();
  const futureMeals = countFutureMeals(logs, templates);
  const futureLine = futureMeals > 0 ? ' Your meals from tomorrow onward will be replaced too.' : '';

  if (!hasCurrentPlan) {
    if (futureMeals === 0) {
      onActivate();
      return;
    }
    Alert.alert('Replace your upcoming meals?', 'This replaces your meals from tomorrow onward.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Replace', style: 'destructive', onPress: onActivate },
    ]);
    return;
  }

  Alert.alert(
    'Replace your current plan?',
    `This will replace your current plan.${futureLine} Would you like to save your current plan first?`,
    [
      ...(onSaveAndActivate ? [{ text: 'Save and replace', onPress: onSaveAndActivate }] : []),
      { text: 'Replace', style: 'destructive' as const, onPress: onActivate },
      { text: 'Cancel', style: 'cancel' as const },
    ],
  );
}
