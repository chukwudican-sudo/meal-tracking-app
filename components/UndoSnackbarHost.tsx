import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { COLORS } from '@/constants/theme';
import { useUndoStore } from '@/store/useUndoStore';

export function UndoSnackbarHost() {
  const active = useUndoStore(s => s.active);
  const runUndo = useUndoStore(s => s.runUndo);
  const dismissUndo = useUndoStore(s => s.dismissUndo);

  if (!active) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.snackbar}>
        <Text style={styles.message} numberOfLines={2}>
          {active.message}
        </Text>
        <TouchableOpacity onPress={runUndo} style={styles.actionButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.actionText}>UNDO</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={dismissUndo} style={styles.closeButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  snackbar: {
    backgroundColor: '#171719',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  message: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  actionButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  actionText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeButton: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  closeText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
});
