import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

interface Props {
  // Optional override for color/size if needed in different headers.
  color?: string;
}

export function CartIcon({ color = COLORS.textSecondary }: Props) {
  // Badge count = items in Cart that haven't been struck through yet.
  const cartCount = useMealStore(s =>
    Object.values(s.grocery.items).filter(
      i => i.section === 'cart' && !i.struckThrough
    ).length
  );

  return (
    <TouchableOpacity
      onPress={() => router.push('/cart')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.wrap}
      activeOpacity={0.7}
    >
      <Text style={[styles.icon, { color }]}>🛒</Text>
      {cartCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {cartCount > 99 ? '99+' : cartCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
    lineHeight: 22,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: COLORS.red,
    borderWidth: 1.5,
    borderColor: COLORS.bg,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
});
