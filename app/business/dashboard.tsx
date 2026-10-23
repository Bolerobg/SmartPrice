import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { formatPostedAt } from '@/src/lib/format';
import {
  api,
  businessRepliesForPosts,
  myBusinesses,
  type BusinessMine,
  type BusinessReply,
} from '@/src/api/client';
import type { PostItem } from '@/types';

/**
 * 📊 Таблото на търговеца.
 *
 * Защо е важно: търговецът не бива да „плаща и да се надява“. Тук той вижда
 * точно какво пише за обекта му и на кой сигнал още не е отговорил — с бутон
 * „Официален отговор“, който го праща на самата оферта.
 */
export default function BusinessDashboardScreen() {
  const router = useRouter();
  const [items, setItems] = useState<BusinessMine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  /** Сигналите на обекта + кои вече имат официален отговор. */
  const [signals, setSignals] = useState<Record<string, PostItem[]>>({});
  const [replies, setReplies] = useState<Record<string, BusinessReply[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await myBusinesses();
      setItems(res.items);
      setError('');

      // За всеки ПРОВЕРЕН обект теглим последните сигнали и кои са отговорени.
      const verified = res.items.filter((b) => b.status === 'verified');
      const feedBySlug: Record<string, PostItem[]> = {};
      await Promise.all(
        verified.map(async (b) => {
          try {
            const feed = await api.feed({ place: b.venue_slug, limit: 20 });
            feedBySlug[b.venue_slug] = feed.items;
          } catch {
            feedBySlug[b.venue_slug] = [];
          }
        })
      );
      const ids = Object.values(feedBySlug).flatMap((list) => list.map((p) => p.id));
      const grouped = ids.length ? await businessRepliesForPosts(ids).catch(() => ({})) : {};
      setSignals(feedBySlug);
      setReplies(grouped);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не успях да заредя таблото. Опитай пак.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={COLORS.greenBright}
          />
        }
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Моят бизнес</Text>
          <View style={{ width: 22 }} />
        </View>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.greenBright} />
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={15} color={COLORS.redBright} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!loading && items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="storefront-outline" size={34} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Още нямаш заявен обект</Text>
            <Text style={styles.emptyText}>
              Отвори обекта си в „Радар“ (или от оферта за него) и натисни
              „🏢 Това е моят бизнес“. Ако ЕИК съвпадне с касова бележка от обекта,
              одобрението става веднага.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => router.push('/radar' as never)}
            >
              <Ionicons name="compass-outline" size={16} color={COLORS.onPrimary} />
              <Text style={styles.primaryBtnText}>Към Радара</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {items.map((b) => {
          const verified = b.status === 'verified';
          const pending = b.status === 'pending';
          const rejected = b.status === 'rejected';
          const list = signals[b.venue_slug] ?? [];
          const answered = replies;
          return (
            <View key={b.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeName} numberOfLines={2}>
                    {b.place_name}
                  </Text>
                  {b.city ? <Text style={styles.placeSub}>📍 {b.city}</Text> : null}
                </View>
                <View
                  style={[
                    styles.statusPill,
                    verified ? styles.pillGreen : pending ? styles.pillGold : styles.pillRed,
                  ]}
                >
                  <Text style={styles.statusPillText}>
                    {verified ? '✅ Проверен' : pending ? '⏳ Чака' : '❌ Отхвърлен'}
                  </Text>
                </View>
              </View>

              <Text style={styles.metaLine}>🏢 {b.legal_name}</Text>
              {b.tax_id ? <Text style={styles.metaLine}>ЕИК: {b.tax_id}</Text> : null}
              {b.auto_approved ? (
                <Text style={[styles.metaLine, { color: COLORS.greenBright }]}>
                  Проверено автоматично по ЕИК от касова бележка
                </Text>
              ) : null}

              {pending ? (
                <Text style={styles.note}>
                  Заявката е при екипа. Отговорът идва на {b.contact_email} — обикновено до
                  1 работен ден.
                </Text>
              ) : null}

              {rejected ? (
                <Text style={[styles.note, { color: COLORS.redBright }]}>
                  Отхвърлено: {b.reject_reason || 'без посочена причина'}. Можеш да подадеш
                  заявката отново с по-ясно доказателство.
                </Text>
              ) : null}

              {verified ? (
                <>
                  <View style={styles.statsRow}>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{b.replies_count}</Text>
                      <Text style={styles.statLabel}>отговора</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{list.length}</Text>
                      <Text style={styles.statLabel}>последни сигнала</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>
                        {b.paid_until ? '💰' : '🆓'}
                      </Text>
                      <Text style={styles.statLabel}>
                        {b.paid_until ? 'абонат' : 'без абонамент'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={styles.ghostBtn}
                      activeOpacity={0.85}
                      onPress={() =>
                        router.push(`/place/${b.venue_slug}?name=${encodeURIComponent(b.place_name)}` as never)
                      }
                    >
                      <Ionicons name="list-outline" size={14} color={COLORS.accentCyan} />
                      <Text style={[styles.ghostBtnText, { color: COLORS.accentCyan }]}>
                        Всички оферти
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {list.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>Сигнали за твоя обект</Text>
                      {list.slice(0, 8).map((p) => {
                        const has = (answered[p.id] ?? []).length > 0;
                        return (
                          <View key={p.id} style={styles.signalRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.signalTitle} numberOfLines={2}>
                                {p.title}
                              </Text>
                              <Text style={styles.signalMeta}>
                                {Number(p.pricePaid).toFixed(2)} € • {formatPostedAt(p.createdAt ?? '')}
                                {p.polarity === 'red' ? ' • 🚩 не ходи' : ' • ✅ изгодно'}
                              </Text>
                            </View>
                            {has ? (
                              <View style={styles.donePill}>
                                <Text style={styles.donePillText}>✅ отговорено</Text>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={styles.replyBtn}
                                activeOpacity={0.85}
                                onPress={() => router.push(`/post/${p.id}` as never)}
                              >
                                <Text style={styles.replyBtnText}>Отговори</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                      <Text style={styles.hintSmall}>
                        Отваряш сигнала → бутон „Официален отговор“ под него. Отговорът се
                        показва с името на фирмата ти и значка „Проверен търговец“.
                      </Text>
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Провереният търговец може да отговори ОФИЦИАЛНО на всеки сигнал за своя обект —
            точно веднъж на сигнал. Измислени или обидни отговори се махат от екипа.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  placeName: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900' },
  placeSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4 },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillGreen: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  pillGold: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  pillRed: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  statusPillText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: '900' },
  metaLine: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 6, fontWeight: '700' },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: {
    flex: 1,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  statValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '900' },
  statLabel: { color: COLORS.textMuted, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '900' },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    paddingVertical: 10,
  },
  signalTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  signalMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  replyBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  replyBtnText: { color: COLORS.onPrimary, fontSize: 12, fontWeight: '900' },
  donePill: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  donePillText: { color: COLORS.textPrimary, fontSize: 10.5, fontWeight: '900' },
  hintSmall: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  empty: {
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 22,
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '900' },
  emptyText: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.primary,
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 6,
  },
  primaryBtnText: { color: COLORS.onPrimary, fontSize: 13.5, fontWeight: '900' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    borderRadius: 12,
    padding: 11,
    marginBottom: 12,
  },
  errorText: { flex: 1, color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18 },
  footer: { marginTop: 14 },
  footerText: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, textAlign: 'center' },
});
