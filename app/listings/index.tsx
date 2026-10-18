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
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { api, type UserListing } from '@/src/api/client';

/**
 * 🏷️ „Моите обяви“ — дашборд за платените частни обяви.
 *
 * Какво вижда човекът:
 *   • колко обяви са активни, колко дни им остават (с цвят: червено < 7 дни);
 *   • колко е похарчил общо и колко души са я гледали;
 *   • с едно натискане: „Продадено“ / „Спри“ / „Пусни пак“ / „Поднови за 2 €“;
 *   • цялата история на всяка обява (кога е пусната, платена, спряна, продадена).
 */

const STATUS_BG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Чернова (не е платена)', color: COLORS.goldBright, bg: 'rgba(245,158,11,0.12)' },
  pending_payment: { label: 'Чака плащане', color: COLORS.goldBright, bg: 'rgba(245,158,11,0.12)' },
  active: { label: 'Активна', color: COLORS.greenBright, bg: 'rgba(34,197,94,0.12)' },
  paused: { label: 'Спряна', color: COLORS.textSecondary, bg: 'rgba(148,163,184,0.12)' },
  sold: { label: 'Продадена', color: COLORS.accentCyan, bg: 'rgba(34,211,238,0.12)' },
  expired: { label: 'Изтекла', color: COLORS.redBright, bg: 'rgba(248,113,113,0.12)' },
  rejected: { label: 'Махната от модератор', color: COLORS.redBright, bg: 'rgba(248,113,113,0.12)' },
};

function money(v: number | null | undefined): string {
  if (v == null) return 'Подарявам';
  return `${Number(v).toFixed(2)} €`;
}

function whenBg(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function MyListingsScreen() {
  const router = useRouter();
  const [data, setData] = useState<{ stats: Record<string, number>; items: UserListing[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.myListings();
      setData(res);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const act = async (id: string, action: 'pause' | 'resume' | 'sold') => {
    setBusy(id + action);
    try {
      await api.listingAction(id, action);
      setNote(
        action === 'sold'
          ? 'Браво! Обявата е отбелязана като продадена — вече не се показва на другите.'
          : action === 'pause'
            ? 'Обявата е спряна. Пусни я пак, когато решиш.'
            : 'Обявата пак е активна.'
      );
      await load();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  /** Подновяване: отваряме плащането и после проверяваме дали е минало. */
  const renew = async (id: string) => {
    setBusy(id + 'renew');
    try {
      const co = await api.listingCheckout(id, 'renew');
      if (co.checkoutUrl) {
        const { Linking } = await import('react-native');
        await Linking.openURL(co.checkoutUrl);
      }
      setNote(
        `Плащането е за ${co.amountEur.toFixed(2)} €. След като платиш в браузъра, върни се тук и натисни „Провери плащането“.`
      );
      setPendingSession(co.sessionId);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const [pendingSession, setPendingSession] = useState('');

  const confirm = async () => {
    if (!pendingSession) return;
    setBusy('confirm');
    try {
      const res = await api.confirmListingPayment(pendingSession);
      setNote(res.ok ? `Готово! Обявата е активна${res.daysLeft ? ` още ${res.daysLeft} дни` : ''}.` : res.reason || 'Още не е платено.');
      if (res.ok) {
        setPendingSession('');
        await load();
      }
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.greenPrimary} />
        <Text style={styles.muted}>Зареждам обявите…</Text>
      </SafeAreaView>
    );
  }

  const items = data?.items ?? [];
  const stats = data?.stats ?? {};

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={COLORS.greenPrimary} />}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Моите обяви</Text>
          <TouchableOpacity onPress={() => router.push('/listings/new' as never)} style={styles.back}>
            <Ionicons name="add" size={22} color={COLORS.greenBright} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 Как вървят</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Активни</Text>
              <Text style={[styles.statValue, { color: COLORS.greenBright }]}>{stats.active ?? 0}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Продадени</Text>
              <Text style={[styles.statValue, { color: COLORS.accentCyan }]}>{stats.sold ?? 0}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Гледания</Text>
              <Text style={styles.statValue}>{stats.views ?? 0}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Платено</Text>
              <Text style={styles.statValue}>{money(stats.spentEur ?? 0)}</Text>
            </View>
          </View>
          {stats.drafts ? (
            <Text style={styles.hint}>
              Имаш {stats.drafts} обяви, които чакат плащане — отвори ги и довърши, за да станат видими.
            </Text>
          ) : null}
        </View>

        {note ? (
          <View style={styles.card}>
            <Text style={styles.noteText}>{note}</Text>
            {pendingSession ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => void confirm()} disabled={busy === 'confirm'}>
                {busy === 'confirm' ? (
                  <ActivityIndicator color={COLORS.black} />
                ) : (
                  <Text style={styles.primaryBtnText}>Провери плащането</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {items.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Още нямаш обяви</Text>
            <Text style={styles.muted}>
              Имаш нещо втора ръка? Пусни го за 2 € и стои 60 дни. Снимки до 5, а като го продадеш — спираш го с
              едно натискане.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/listings/new' as never)}>
              <Text style={styles.primaryBtnText}>Пусни обява за 2 €</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {items.map((l) => {
          const st = STATUS_BG[l.status] ?? STATUS_BG.draft;
          const days = l.daysLeft ?? null;
          const urgent = l.status === 'active' && days !== null && days <= 7;
          return (
            <View key={l.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.title} numberOfLines={2}>
                  {l.title}
                </Text>
                <View style={[styles.pill, { backgroundColor: st.bg, borderColor: st.color }]}>
                  <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>

              <Text style={styles.muted}>
                {money(l.price_eur)} · {l.city}
                {l.neighborhood ? `, ${l.neighborhood}` : ''} · пусната {whenBg(l.created_at)}
              </Text>

              {l.status === 'active' && days !== null ? (
                <Text style={[styles.days, urgent && { color: COLORS.redBright }]}>
                  {days > 0 ? `Остават ${days} дни` : 'Изтича днес'}
                  {urgent ? ' — поднови, за да не изчезне' : ''}
                </Text>
              ) : null}
              {l.status === 'expired' ? (
                <Text style={[styles.days, { color: COLORS.redBright }]}>
                  Изтекла на {l.paid_until ? whenBg(l.paid_until) : '—'}. Поднови за 2 € и пак е 60 дни.
                </Text>
              ) : null}

              <Text style={styles.hint}>
                👁 {l.views_count} гледания · {l.images?.length ?? 0} снимки
                {l.renewals ? ` · подновявана ${l.renewals}×` : ''}
              </Text>

              <View style={styles.actions}>
                {(l.status === 'draft' || l.status === 'pending_payment') && (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGold]}
                    onPress={() => router.push(`/listings/new?id=${l.id}` as never)}
                  >
                    <Text style={styles.btnText}>💳 Плати 2 € и пусни</Text>
                  </TouchableOpacity>
                )}
                {l.status === 'active' && (
                  <>
                    <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={() => void act(l.id, 'sold')}>
                      <Text style={styles.btnText}>✅ Продадено</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btn} onPress={() => void act(l.id, 'pause')}>
                      <Text style={styles.btnText}>⏸ Спри</Text>
                    </TouchableOpacity>
                  </>
                )}
                {l.status === 'paused' && (
                  <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={() => void act(l.id, 'resume')}>
                    <Text style={styles.btnText}>▶️ Пусни пак</Text>
                  </TouchableOpacity>
                )}
                {(l.status === 'expired' || (l.status === 'active' && urgent)) && (
                  <TouchableOpacity style={[styles.btn, styles.btnGold]} onPress={() => void renew(l.id)}>
                    <Text style={styles.btnText}>🔄 Поднови за 2 €</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgPrimary, gap: 10 },
  muted: { color: COLORS.textSecondary, fontSize: 13.5, marginTop: 4 },
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  headerTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', marginBottom: 10 },
  statsRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  statLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  statValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 3 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800', flex: 1 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '800' },
  days: { color: COLORS.goldBright, fontSize: 13, fontWeight: '800', marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.bgCardElevated,
  },
  btnOk: { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: COLORS.greenBorder },
  btnGold: { backgroundColor: 'rgba(245,158,11,0.14)', borderColor: COLORS.goldBorder },
  btnText: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800' },
  primaryBtn: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.greenPrimary,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 14, fontWeight: '900' },
  noteText: { color: COLORS.textPrimary, fontSize: 13.5, lineHeight: 19 },
});
