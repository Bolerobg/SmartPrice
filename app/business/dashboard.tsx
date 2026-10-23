import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { formatPostedAt } from '@/src/lib/format';
import { VERIFIED_BADGE_ICON } from '@/src/lib/badges';
import {
  api,
  businessOffers,
  businessPayments,
  businessPlanConfig,
  businessRepliesForPosts,
  businessStats,
  confirmBusinessPaid,
  createBusinessOffer,
  deleteBusinessOffer,
  myBusinesses,
  setBusinessOfferStatus,
  subscribeBusiness,
  type BusinessMine,
  type BusinessOffer,
  type BusinessPayment,
  type BusinessPlanConfig,
  type BusinessReply,
  type VenueStats,
} from '@/src/api/client';
import type { PostItem } from '@/types';

/** „2026-11-15“ → „15.11.2026“ (български формат; сървърът дава ISO). */
function bgDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * 📊 Таблото на търговеца.
 *
 * Защо е важно: търговецът не бива да „плаща и да се надява“. Тук той вижда
 * какво пише за обекта му, на кой сигнал още не е отговорил, колко души гледат
 * обекта, и пуска оферта — с бутони, не с обещания.
 *
 * Планът (19 €/мес) се плаща през Stripe оттук: бутонът отваря checkout,
 * а след връщане (`?paid=1&session_id=…`) проверяваме и опресняваме.
 */
export default function BusinessDashboardScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paid?: string; session_id?: string }>();

  const [items, setItems] = useState<BusinessMine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [planCfg, setPlanCfg] = useState<BusinessPlanConfig | null>(null);
  const [note, setNote] = useState('');

  const [signals, setSignals] = useState<Record<string, PostItem[]>>({});
  const [replies, setReplies] = useState<Record<string, BusinessReply[]>>({});
  const [stats, setStats] = useState<Record<string, VenueStats | null>>({});
  const [offers, setOffers] = useState<Record<string, BusinessOffer[]>>({});
  const [payments, setPayments] = useState<Record<string, BusinessPayment[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Формата за нова оферта (по един бизнес наведнъж — това е рядко действие).
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [offerTitle, setOfferTitle] = useState('');
  const [offerDesc, setOfferDesc] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerOldPrice, setOfferOldPrice] = useState('');
  const [offerUntil, setOfferUntil] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await myBusinesses();
      setItems(res.items);
      setError('');

      const verified = res.items.filter((b) => b.status === 'verified');

      // Сигналите на всеки проверен обект + кои вече имат официален отговор.
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

      // Статистика, оферти и плащания — само за проверените (те са смислените).
      const st: Record<string, VenueStats | null> = {};
      const of: Record<string, BusinessOffer[]> = {};
      const pay: Record<string, BusinessPayment[]> = {};
      await Promise.all(
        verified.map(async (b) => {
          st[b.id] = await businessStats(b.id).catch(() => null);
          of[b.id] = await businessOffers(b.id).catch(() => []);
          pay[b.id] = await businessPayments(b.id).catch(() => []);
        })
      );
      setStats(st);
      setOffers(of);
      setPayments(pay);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не успях да заредя таблото. Опитай пак.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void businessPlanConfig()
      .then(setPlanCfg)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Връщане от Stripe: `?paid=1&session_id=…`.
   * Webhook-ът обикновено вече е минал, но проверяваме изрично — човекът не
   * бива да вижда „не е платено“, докато чака.
   */
  useEffect(() => {
    const sessionId = String(params.session_id || '');
    const paid = String(params.paid || '');
    if (!sessionId || paid !== '1') {
      if (paid === '0') setNote('Плащането беше отказано. Може да опиташ пак, когато решиш.');
      return;
    }
    void (async () => {
      setNote('Проверявам плащането…');
      try {
        const list = await myBusinesses();
        for (const b of list.items) {
          await confirmBusinessPaid(b.id, sessionId).catch(() => undefined);
        }
        setNote('✅ Плащането е потвърдено — планът е активен.');
        await load();
      } catch {
        setNote('Плащането мина, но още се обработва. Дръпни надолу след минута.');
      }
    })();
  }, [params.paid, params.session_id, load]);

  const activate = async (b: BusinessMine, months = 1) => {
    setBusyId(b.id);
    setNote('');
    try {
      const res = await subscribeBusiness(b.id, months);
      if (res.checkoutUrl) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.location.href = res.checkoutUrl;
        } else {
          await Linking.openURL(res.checkoutUrl);
        }
        setNote('Отворих плащането в Stripe. След успех се върни тук.');
      } else {
        setNote(res.message);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Не успях да пусна плащането.');
    } finally {
      setBusyId(null);
    }
  };

  const submitOffer = async (b: BusinessMine) => {
    setBusyId(b.id);
    setNote('');
    try {
      const price = offerPrice.trim() ? Number(offerPrice.replace(',', '.')) : undefined;
      const oldPrice = offerOldPrice.trim() ? Number(offerOldPrice.replace(',', '.')) : undefined;
      await createBusinessOffer(b.id, {
        title: offerTitle.trim(),
        description: offerDesc.trim() || undefined,
        price,
        oldPrice,
        validUntil: offerUntil.trim() || undefined,
      });
      setOfferFor(null);
      setOfferTitle('');
      setOfferDesc('');
      setOfferPrice('');
      setOfferOldPrice('');
      setOfferUntil('');
      setNote('✅ Офертата е публикувана — вижда се в твоя обект.');
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Не успях да пусна офертата.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleOffer = async (offer: BusinessOffer) => {
    try {
      await setBusinessOfferStatus(offer.id, offer.status === 'active' ? 'hidden' : 'active');
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Не успях да променя офертата.');
    }
  };

  const removeOffer = (offer: BusinessOffer) => {
    const doDelete = async () => {
      try {
        await deleteBusinessOffer(offer.id);
        await load();
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Не успях да изтрия офертата.');
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm('Да изтрия ли офертата?')) void doDelete();
      return;
    }
    Alert.alert('Изтриване', 'Да изтрия ли офертата?', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Изтрий', style: 'destructive', onPress: () => void doDelete() },
    ]);
  };

  const unreadCount = (b: BusinessMine) =>
    (signals[b.venue_slug] ?? []).filter((p) => (replies[p.id] ?? []).length === 0).length;

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

        {note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>{note}</Text>
          </View>
        ) : null}

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
          const st = stats[b.id] ?? null;
          const myOffers = offers[b.id] ?? [];
          const myPayments = payments[b.id] ?? [];
          const unanswered = unreadCount(b);

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
                  {/* 💰 Планът — най-важният блок в таблото. */}
                  <View
                    style={[
                      styles.planBox,
                      b.plan_active ? styles.planActive : styles.planFree,
                    ]}
                  >
                    <View style={styles.planHead}>
                      {b.plan_active ? (
                        /* 🏅 Значката „Проверен търговец“ — същата като в приложението. */
                        <Image
                          source={{ uri: VERIFIED_BADGE_ICON }}
                          style={styles.badgeMini}
                          resizeMode="contain"
                        />
                      ) : (
                        <Ionicons name="lock-open-outline" size={16} color={COLORS.goldPrimary} />
                      )}
                      <Text style={styles.planTitle}>
                        {b.plan_active ? 'План „Проверен търговец“ — активен' : 'Безплатен план'}
                      </Text>
                    </View>
                    <Text style={styles.planText}>
                      {b.plan_active
                        ? `Неограничени отговори, оферти и статистика. Платен до ${bgDay(
                            b.paid_until
                          )}.`
                        : `Включва ${
                            planCfg?.freeRepliesPerMonth ?? 1
                          } официален отговор на месец. Планът дава неограничени отговори, оферти и статистика.`}
                    </Text>

                    {!b.plan_active && planCfg?.includes?.length ? (
                      <View style={{ marginTop: 8, gap: 3 }}>
                        {planCfg.includes.map((line) => (
                          <Text key={line} style={styles.planLine}>
                            • {line}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {planCfg?.enabled ? (
                      <View style={styles.planBtns}>
                        <TouchableOpacity
                          style={[styles.activateBtn, busyId === b.id && { opacity: 0.6 }]}
                          activeOpacity={0.85}
                          disabled={busyId === b.id}
                          onPress={() => void activate(b, 1)}
                        >
                          {busyId === b.id ? (
                            <ActivityIndicator size="small" color={COLORS.onPrimary} />
                          ) : (
                            <Ionicons name="card-outline" size={15} color={COLORS.onPrimary} />
                          )}
                          <Text style={styles.activateBtnText}>
                            {b.plan_active
                              ? `Удължи с 1 месец (${planCfg ? planCfg.priceEur : 19} €)`
                              : `Активирай за ${planCfg ? planCfg.priceEur : 19} €/мес`}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.ghostBtn}
                          activeOpacity={0.85}
                          disabled={busyId === b.id}
                          onPress={() => void activate(b, 12)}
                        >
                          <Text style={styles.ghostBtnText}>
                            {planCfg ? planCfg.priceEur * 12 : 228} € / 12 мес
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.planLine}>
                        Плащанията не са конфигурирани на сървъра (липсва Stripe ключ).
                      </Text>
                    )}
                  </View>

                  {/* 📊 Статистиката — „ето защо си струва“. */}
                  <View style={styles.statsRow}>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{st ? st.views_today : '—'}</Text>
                      <Text style={styles.statLabel}>гледания днес</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{st ? st.views_30d : '—'}</Text>
                      <Text style={styles.statLabel}>гледания 30 дни</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{st ? st.signals_count : '—'}</Text>
                      <Text style={styles.statLabel}>сигнала</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>{st?.avg_rating ? st.avg_rating.toFixed(1) : '—'}</Text>
                      <Text style={styles.statLabel}>оценка</Text>
                    </View>
                  </View>

                  {/* 🏷️ Оферти */}
                  <Text style={styles.sectionTitle}>🏷️ Оферти от търговеца</Text>
                  {myOffers.length === 0 ? (
                    <Text style={styles.hintSmall}>
                      Още нямаш оферта. Пусни промоция — вижда се от всички, които отварят
                      обекта ти (в общата лента НЕ влиза, за да не се бърка с находките).
                    </Text>
                  ) : (
                    myOffers.map((o) => (
                      <View key={o.id} style={styles.offerRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.offerTitle} numberOfLines={2}>
                            {o.title}
                          </Text>
                          <Text style={styles.offerMeta}>
                            {o.price != null ? `${o.price.toFixed(2)} €` : 'без цена'}
                            {o.old_price != null ? ` · вместо ${o.old_price.toFixed(2)} €` : ''}
                            {o.valid_until ? ` · до ${bgDay(o.valid_until)}` : ''}
                          </Text>
                          <Text
                            style={[
                              styles.offerState,
                              o.status === 'active' && !o.expired
                                ? { color: COLORS.greenBright }
                                : { color: COLORS.textMuted },
                            ]}
                          >
                            {o.expired
                              ? 'изтекла'
                              : o.status === 'active'
                                ? 'активна — вижда се'
                                : 'скрита'}
                          </Text>
                        </View>
                        <TouchableOpacity style={styles.miniBtn} onPress={() => void toggleOffer(o)}>
                          <Text style={styles.miniBtnText}>
                            {o.status === 'active' ? 'Скрий' : 'Пусни'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.miniBtnDanger} onPress={() => removeOffer(o)}>
                          <Ionicons name="trash-outline" size={13} color={COLORS.redBright} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}

                  {offerFor === b.id ? (
                    <View style={styles.formCard}>
                      <Text style={styles.formTitle}>Нова оферта</Text>
                      <TextInput
                        style={styles.input}
                        value={offerTitle}
                        onChangeText={setOfferTitle}
                        placeholder="Напр. „Пилешко филе 4.99 € тази седмица“"
                        placeholderTextColor={COLORS.textMuted}
                        maxLength={120}
                      />
                      <TextInput
                        style={[styles.input, { minHeight: 66, textAlignVertical: 'top' }]}
                        value={offerDesc}
                        onChangeText={setOfferDesc}
                        placeholder="Описание (по избор)"
                        placeholderTextColor={COLORS.textMuted}
                        multiline
                        maxLength={1000}
                      />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={offerOldPrice}
                          onChangeText={setOfferOldPrice}
                          placeholder="Вместо (€)"
                          placeholderTextColor={COLORS.textMuted}
                          keyboardType="decimal-pad"
                          maxLength={10}
                        />
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={offerPrice}
                          onChangeText={setOfferPrice}
                          placeholder="Нова цена (€)"
                          placeholderTextColor={COLORS.textMuted}
                          keyboardType="decimal-pad"
                          maxLength={10}
                        />
                      </View>
                      <TextInput
                        style={styles.input}
                        value={offerUntil}
                        onChangeText={setOfferUntil}
                        placeholder="Валидна до (ГГГГ-ММ-ДД, по избор)"
                        placeholderTextColor={COLORS.textMuted}
                        maxLength={10}
                      />
                      <View style={styles.planBtns}>
                        <TouchableOpacity
                          style={[styles.activateBtn, busyId === b.id && { opacity: 0.6 }]}
                          disabled={busyId === b.id}
                          onPress={() => void submitOffer(b)}
                        >
                          <Text style={styles.activateBtnText}>Публикувай</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.ghostBtn} onPress={() => setOfferFor(null)}>
                          <Text style={styles.ghostBtnText}>Отказ</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.ghostBtn}
                      onPress={() => {
                        setOfferFor(b.id);
                        setNote('');
                      }}
                    >
                      <Ionicons name="add-circle-outline" size={14} color={COLORS.accentCyan} />
                      <Text style={[styles.ghostBtnText, { color: COLORS.accentCyan }]}>
                        Пусни оферта
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* 💬 Сигнали без отговор */}
                  <Text style={styles.sectionTitle}>
                    💬 Сигнали за твоя обект{unanswered > 0 ? ` · ${unanswered} без отговор` : ''}
                  </Text>
                  {list.length === 0 ? (
                    <Text style={styles.hintSmall}>Още няма сигнали за този обект.</Text>
                  ) : (
                    list.slice(0, 8).map((p) => {
                      const has = (replies[p.id] ?? []).length > 0;
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
                              onPress={() => router.push(`/post/${p.id}` as never)}
                            >
                              <Text style={styles.replyBtnText}>Отговори</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })
                  )}
                  <Text style={styles.hintSmall}>
                    Отваряш сигнала → бутон „Официален отговор“ под него. Отговорът се показва
                    с името на фирмата ти и значка „Проверен търговец“.
                  </Text>

                  {myPayments.length > 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>🧾 Плащания</Text>
                      {myPayments.slice(0, 5).map((pay) => (
                        <Text key={pay.id} style={styles.payLine}>
                          {pay.paid_at ? pay.paid_at.slice(0, 10) : pay.created_at.slice(0, 10)} ·{' '}
                          {Number(pay.amount).toFixed(2)} {pay.currency} ·{' '}
                          {pay.status === 'succeeded' ? '✅ платено' : pay.status === 'pending' ? '⏳ чака' : '❌ неуспешно'}
                        </Text>
                      ))}
                    </>
                  ) : null}

                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={styles.ghostBtn}
                      onPress={() =>
                        router.push(
                          `/place/${b.venue_slug}?name=${encodeURIComponent(b.place_name)}` as never
                        )
                      }
                    >
                      <Ionicons name="list-outline" size={14} color={COLORS.accentCyan} />
                      <Text style={[styles.ghostBtnText, { color: COLORS.accentCyan }]}>
                        Виж обекта както го виждат хората
                      </Text>
                    </TouchableOpacity>
                  </View>
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
  statusPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  pillGreen: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  pillGold: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  pillRed: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  statusPillText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: '900' },
  metaLine: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 6, fontWeight: '700' },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  noteBox: {
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    borderRadius: 12,
    padding: 11,
    marginBottom: 12,
  },
  noteText: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18 },
  planBox: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  planActive: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  planFree: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '900' },
  badgeMini: { width: 18, height: 18 },
  planText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6 },
  planLine: { color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 17 },
  planBtns: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  activateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  activateBtnText: { color: COLORS.onPrimary, fontSize: 12.5, fontWeight: '900' },
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
  statValue: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  statLabel: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  ghostBtnText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '900' },
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
  replyBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
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
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    paddingVertical: 10,
  },
  offerTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '800' },
  offerMeta: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2 },
  offerState: { fontSize: 11, fontWeight: '800', marginTop: 2 },
  miniBtn: {
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  miniBtnText: { color: COLORS.textPrimary, fontSize: 11, fontWeight: '800' },
  miniBtnDanger: {
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  formCard: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  formTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '900', marginBottom: 8 },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 13,
    marginBottom: 8,
  },
  payLine: { color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 17 },
  hintSmall: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
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
