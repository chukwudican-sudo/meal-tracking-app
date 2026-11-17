// Runs Apple's age signal check once per install at launch (lib/ageSignal.ts)
// and, only if it says the person is under 18, covers the whole app with a
// short "adults only" message (MyFitnessPal-style wording). Everyone else
// never sees anything. No button that closes the app: App Review treats an
// app that exits itself as a crash.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/theme';
import { APP_NAME } from '@/constants/app';
import { checkAgeSignal, MINIMUM_AGE } from '@/lib/ageSignal';
import { openAppleAgeRangeHelp } from '@/lib/openLink';

export function AgeGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkAgeSignal().then(minor => { if (!cancelled && minor) setBlocked(true); });
    return () => { cancelled = true; };
  }, []);

  if (!blocked) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <View style={styles.icon}>
        <Ionicons name="heart-outline" size={40} color={COLORS.green} />
      </View>
      <Text style={styles.title}>{APP_NAME} is for adults</Text>
      <Text style={styles.body}>You must be {MINIMUM_AGE} or older to use {APP_NAME}.</Text>
      <Text style={styles.note}>The age range shared by your Apple Account is under {MINIMUM_AGE}.</Text>
      <Text style={styles.link} onPress={() => { void openAppleAgeRangeHelp(); }} accessibilityRole="link">
        Learn more
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(74,222,128,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginTop: 24, textAlign: 'center' },
  body: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  note: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 16, textAlign: 'center' },
  link: { color: COLORS.green, fontSize: 15, fontWeight: '600', marginTop: 20, paddingVertical: 10, paddingHorizontal: 16 },
});
