import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Skeleton } from '@/components/Skeleton';
import { COLORS } from '@/constants/theme';
import { useInboxStore } from '@/store/useInboxStore';

// Bell inbox: messages from Macrotri (fun facts, feature updates), newest
// first. Opening it marks everything as seen on this phone.
export default function NotificationsScreen() {
  const items = useInboxStore(s => s.items);
  const loaded = useInboxStore(s => s.loaded);
  const loading = useInboxStore(s => s.loading);
  const error = useInboxStore(s => s.error);
  const refresh = useInboxStore(s => s.refresh);
  const markAllSeen = useInboxStore(s => s.markAllSeen);

  // Which ones were new when the page opened — so the dots don't vanish the
  // instant they're marked seen.
  const seenReady = useInboxStore(s => s.seenReady);
  const lastSeenAt = useInboxStore(s => s.lastSeenAt);
  // Captured once "seen" is known, so the dots stay for this visit even
  // though opening the page marks everything as seen.
  const [openedSeenAt, setOpenedSeenAt] = useState<string | null | undefined>(
    () => (useInboxStore.getState().seenReady ? useInboxStore.getState().lastSeenAt : undefined),
  );
  useEffect(() => {
    if (seenReady && openedSeenAt === undefined) setOpenedSeenAt(lastSeenAt);
  }, [seenReady, lastSeenAt, openedSeenAt]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (seenReady && openedSeenAt !== undefined && items.length > 0) markAllSeen();
  }, [items, seenReady, openedSeenAt, markAllSeen]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={loading && loaded} onRefresh={() => { void refresh(); }} tintColor={COLORS.textSecondary} />
        }
      >
        {!loaded && loading ? (
          <View style={styles.list}>
            {[0, 1, 2].map(i => (
              <View key={i} style={styles.card}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="100%" height={12} style={{ marginTop: 10 }} />
                <Skeleton width="80%" height={12} style={{ marginTop: 6 }} />
              </View>
            ))}
          </View>
        ) : error && items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Couldn&apos;t load messages</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <TouchableOpacity onPress={() => { void refresh(); }} style={styles.retryBtn} activeOpacity={0.8}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="notifications-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
            <Text style={styles.emptyBody}>Updates and tips from Macrotri will show up here.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {error ? (
              <TouchableOpacity onPress={() => { void refresh(); }} activeOpacity={0.8} style={styles.errorBar}>
                <Text style={styles.errorText}>{error} Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}
            {items.map(a => {
              const isNew = openedSeenAt !== undefined && (!openedSeenAt || a.createdAt > openedSeenAt);
              return (
                <View key={a.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    {isNew ? <View style={styles.newDot} /> : null}
                    <Text style={styles.cardTitle} numberOfLines={2}>{a.title}</Text>
                    <Text style={styles.cardDate}>{formatDate(a.createdAt)}</Text>
                  </View>
                  <Text style={styles.cardBody}>{a.body}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },

  scroll: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  list: { gap: 12 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.green },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardDate: { color: COLORS.textMuted, fontSize: 12 },
  cardBody: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },

  errorBar: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { color: COLORS.red, fontSize: 13 },

  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24, gap: 6 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.elevated,
  },
  retryText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
});
