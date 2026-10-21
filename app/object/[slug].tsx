import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
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
import { formatMoney, formatRelativeTime, formatNumber, unitLabel } from '@/src/lib/format';
import { loadObject, loadObjectOffers, type ObjectDetail, type ObjectSignal } from '@/src/api/client';

const CATEGORY_LABELS: Record<string, string> = {
  restaurants: 'Заведения',
  hotels_airbnb: 'Настаняване',
  supermarket: 'Магазини и храни',
  cafes_bars: 'Кафенета и барове',
  services_tech: 'Услуги',
  vehicles: 'Авто',
  real_estate: 'Имоти',
  shops_places: 'Обекти',
  private_sellers: 'Частни продавачи',
  other: 'Други',
};

// Google връща дните на кирилица и започва от неделя — НЕ по индекса на деня.
const DAYS_BG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

/** Днешният ден на български, както го пише Google. */
function todayNameBg(): string {
  return DAYS_BG[new Date().getDay()] ?? '';
}

/** „8:00ч. to 19:00ч.“ → „8:00 – 19:00“ (Google оставя „to“ на английски). */
function cleanHours(raw: string): string {
  return String(raw ?? '')
    .replace(/\s*ч\./g, '')
    .replace(/\s+to\s+/gi, ' – ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Работното време за днес, ако Google го знае. */
function hoursForToday(hours?: Array<{ day: string; hours: string }> | null): string | undefined {
  if (!Array.isArray(hours) || hours.length === 0) return undefined;
  const today = todayNameBg();
  const hit = hours.find((h) => String(h?.day ?? '').toLowerCase().startsWith(today.slice(0, 5)));
  if (!hit?.hours) return undefined;
  const clean = cleanHours(hit.hours);
  return clean && !/^(затворено|closed)$/i.test(clean) ? clean : 'затворено';
}

/**
 * Отворено ли е в момента — четем първите два часа от днешното работно време.
 * Ако не можем да ги разчетем, връщаме undefined (не твърдим нищо).
 */
function openNowFromToday(today?: string): boolean | undefined {
  if (!today || today === 'затворено') return today ? false : undefined;
  const times = today.match(/(\d{1,2})[:.](\d{2})/g);
  if (!times || times.length < 2) return undefined;
  const toMin = (t: string) => {
    const [h, m] = t.replace('.', ':').split(':').map((x) => Number(x));
    return h * 60 + (m || 0);
  };
  const open = toMin(times[0]);
  const close = toMin(times[1]);
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  // Магазин, който затваря след полунощ (напр. 8:00 – 02:00).
  return close <= open ? now >= open || now <= close : now >= open && now <= close;
}

/**
 * 🏪 Страница на обект (#11).
 * Показва колко пъти хората са сигнализирали, как се е движила цената във времето,
 * всички сигнали за обекта и търговеца (ако има проверена касова бележка).
 */
export default function ObjectScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [data, setData] = useState<ObjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** Показваме работното време за всички дни, а не само за днес. */
  const [showWeek, setShowWeek] = useState(false);

  /**
   * 🔎 Търсене в офертите на ТОЗИ обект/магазин (сървърно, с пагинация).
   *
   * Защо не филтрираме в паметта: страницата получава само първите 80 оферти, а
   * магазин като deichmann.com има 202 — търсенето в паметта щеше да пропуска
   * продукти. Затова питаме сървъра и добавяме „Зареди още“.
   */
  const [offers, setOffers] = useState<ObjectSignal[]>([]);
  const [offersTotal, setOffersTotal] = useState(0);
  const [offersQ, setOffersQ] = useState('');
  const [offersBusy, setOffersBusy] = useState(false);

  /**
   * ↑ „Обратно най-горе“ — същото поведение като в „Поток“ и „Радар“.
   *
   * Защо: с 60–200 оферти човек, който е слязъл надолу, трябва да изтегли целия
   * списък нагоре, за да стигне пак до търсачката. Затова при скрол надолу се
   * показва бутон „↑ Нагоре“, който връща екрана в началото.
   */
  const scrollRef = useRef<ScrollView>(null);
  const [showToTop, setShowToTop] = useState(false);

  const scrollScreenToTop = React.useCallback((animated = true) => {
    try {
      scrollRef.current?.scrollTo({ y: 0, animated });
    } catch {
      /* екранът още не е готов */
    }
    if (typeof document !== 'undefined') {
      // В уеб версията `scrollTo` понякога не стига — дърпаме и истинския скролер.
      try {
        const all = Array.from(document.querySelectorAll('div'));
        for (let i = 0; i < all.length && i < 60; i += 1) {
          const el = all[i] as HTMLElement;
          let oy = '';
          try {
            oy = window.getComputedStyle(el).overflowY;
          } catch {
            oy = '';
          }
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
            el.scrollTop = 0;
            break;
          }
        }
      } catch {
        /* не пречи на разглеждането */
      }
    }
    // Програмното скролване не винаги ражда onScroll (в web) — скриваме бутона на ръка.
    setShowToTop(false);
  }, []);

  const loadOffers = React.useCallback(
    async (q: string, offset: number, append: boolean) => {
      if (!slug) return;
      setOffersBusy(true);
      try {
        const res = await loadObjectOffers(String(slug), { q, limit: 30, offset });
        setOffers((prev) => {
          if (!append) return res.items;
          const seen = new Set(prev.map((o) => o.id));
          return [...prev, ...res.items.filter((o) => !seen.has(o.id))];
        });
        if (!append) setOffersTotal(Number(res.total) || 0);
      } catch {
        if (!append) {
          setOffers([]);
          setOffersTotal(0);
        }
      } finally {
        setOffersBusy(false);
      }
    },
    [slug]
  );

  // Първо зареждане + търсене с изчакване, за да не питаме на всяка буква.
  useEffect(() => {
    const t = setTimeout(() => void loadOffers(offersQ.trim(), 0, false), offersQ ? 350 : 0);
    return () => clearTimeout(t);
  }, [offersQ, loadOffers]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loadObject(String(slug || ''))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || 'Обектът не се зареди.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.greenPrimary} />
        <Text style={styles.muted}>Зареждам обекта…</Text>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.muted}>{error || 'Няма такъв обект.'}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => goBack(router)}>
          <Text style={styles.ghostBtnText}>Назад</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const o = data.object;
  const prices = data.history.map((h) => h.price);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const unit = unitLabel(o.unit_type || undefined);
  const spread = prices.length > 1 ? prices[prices.length - 1] - prices[0] : 0;

  // Обогатяване от Google Maps (#043): рейтинг, отзиви, работно време.
  const place = data.place ?? null;
  const todayH = hoursForToday(place?.hours);
  const openNow = openNowFromToday(todayH);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          // Бутонът се появява чак когато човекът е слязъл надолу (иначе пречи).
          const y = e.nativeEvent.contentOffset.y;
          setShowToTop((prev) => (prev === y > 700 ? prev : y > 700));
        }}
        scrollEventThrottle={64}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBack(router)} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Обект</Text>
          <View style={{ width: 34 }} />
        </View>

        {o.cover_image ? (
          <Image source={{ uri: o.cover_image }} style={styles.cover} resizeMode="cover" />
        ) : null}

        <View style={styles.card}>
          <Text style={styles.name}>{o.place_name}</Text>
          <Text style={styles.sub}>
            {o.city}
            {o.category ? ' · ' + (CATEGORY_LABELS[o.category] || o.category) : ''}
            {o.address ? ' · ' + o.address : ''}
          </Text>

          <View style={styles.pillRow}>
            <View style={[styles.pill, styles.pillGreen]}>
              <Text style={styles.pillText}>{formatNumber(o.signals_count)} оферти</Text>
            </View>
            {o.reporters_count > 1 ? (
              <View style={[styles.pill, styles.pillCyan]}>
                <Text style={styles.pillText}>{formatNumber(o.reporters_count)} души сигнализират</Text>
              </View>
            ) : null}
            {o.helped_total > 0 ? (
              <View style={[styles.pill, styles.pillDim]}>
                <Text style={styles.pillText}>{formatNumber(o.helped_total)}× помогнало</Text>
              </View>
            ) : null}
          </View>

          {/*
            🏬 За онлайн магазин НЕ показваме средна/най-ниска/най-висока цена:
            в каталога има крушка за 0.35 € и машина за 1240 € — числата са верни,
            но нямат смисъл и плашат („защо ми показва 1240 € в червено?“).
            За заведение/магазин на място статистиката си остава полезна.
          */}
          {data.is_shop ? (
            <View>
              <Text style={styles.statLabel}>Онлайн магазин · цени по категории</Text>
              <Text style={styles.hint}>
                Един онлайн магазин продава крушка за 0.35 € и машина за 1240 € — затова обща „средна
                цена“ не значи нищо. Ето истинската картина: по категории.
              </Text>
              {(data.categories_stats ?? []).map((c) => (
                <View key={c.category} style={styles.stat}>
                  <Text style={styles.statValue} numberOfLines={1}>
                    {CATEGORY_LABELS[c.category] || c.category}
                  </Text>
                  <Text style={styles.hint}>
                    {c.posts} оферти · от {Number(c.min_price).toFixed(2)} € до{' '}
                    {Number(c.max_price).toFixed(2)} € · средно {Number(c.avg_price).toFixed(2)} €
                  </Text>
                  {/* 🥇 Значката идва от сървъра и се дава само при честни условия
                      (≥3 оферти, ≥2 магазина за сравнение, ≥5 % по-ниска медиана). */}
                  {c.best_value ? (
                    <View style={styles.bestValueBadge}>
                      <Text style={styles.bestValueText} numberOfLines={2}>
                        🥇 Най-изгодни цени в категорията · −{c.saving_pct}% под следващия
                        {c.shops_compared ? ` (${c.shops_compared} магазина сравнени)` : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
              {(data.categories_stats ?? []).length === 0 ? (
                <Text style={styles.hint}>Още няма внесени оферти с цени.</Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Средна цена</Text>
                <Text style={styles.statValue}>{o.avg_price != null ? formatMoney(o.avg_price) : '—'}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Най-ниска</Text>
                <Text style={[styles.statValue, { color: COLORS.greenBright }]}>
                  {o.min_price != null ? formatMoney(o.min_price) : '—'}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Най-висока</Text>
                <Text style={[styles.statValue, { color: COLORS.redBright }]}>
                  {o.max_price != null ? formatMoney(o.max_price) : '—'}
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.hint}>
            Първа оферта: {formatRelativeTime(o.first_seen)} · последна: {formatRelativeTime(o.last_seen)}
            {o.green_count || o.red_count
              ? ' · ' + o.green_count + ' добри / ' + o.red_count + ' лоши'
              : ''}
          </Text>
        </View>

        {o.merchant_name || o.merchant_tax_id ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🧾 Търговец по касовата бележка</Text>
            <Text style={styles.body}>
              {o.merchant_name || 'Неразчетен търговец'}
              {o.merchant_tax_id ? ' · ЕИК ' + o.merchant_tax_id : ''}
            </Text>
            <Text style={styles.hint}>
              {o.receipts_verified
                ? o.receipts_verified + ' проверени от AI касови бележки'
                : 'Няма проверена от AI касова бележка за този обект'}
            </Text>
          </View>
        ) : null}

        {/* 🏪 Google Maps: рейтинг, отзиви и работно време. Показваме само
            това, което наистина го има — иначе картата не се появява. */}
        {place && (place.rating != null || todayH || place.phone || place.website) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🏪 Рейтинг и работно време</Text>

            {place.rating != null ? (
              <View style={styles.rateRow}>
                <Ionicons name="star" size={17} color={COLORS.goldPrimary} />
                <Text style={styles.rateNum}>{place.rating.toFixed(2)}</Text>
                {place.reviews_count ? (
                  <Text style={styles.rateCount}>
                    · {formatNumber(place.reviews_count)} отзива в Google
                  </Text>
                ) : null}
              </View>
            ) : null}
            {place.place_category ? (
              <Text style={styles.hint}>Категория в Google: {place.place_category}</Text>
            ) : null}

            {todayH ? (
              <View style={styles.hourRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hourDay}>Днес · {todayNameBg()}</Text>
                  <Text style={styles.hourVal}>{todayH}</Text>
                </View>
                {openNow !== undefined ? (
                  <View
                    style={[
                      styles.openBadge,
                      {
                        backgroundColor: openNow ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                        borderColor: openNow ? COLORS.greenBorder : COLORS.redBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.openBadgeText,
                        { color: openNow ? COLORS.greenBright : COLORS.redBright },
                      ]}
                    >
                      {openNow ? 'Отворено сега' : 'Затворено'}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {showWeek && Array.isArray(place.hours) && place.hours.length > 0 ? (
              <View style={styles.weekTable}>
                {place.hours.map((h, i) => (
                  <View key={`${h.day}-${i}`} style={styles.weekRow}>
                    <Text style={styles.weekDay}>{h.day}</Text>
                    <Text style={styles.weekVal}>{cleanHours(h.hours) || '—'}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {Array.isArray(place.hours) && place.hours.length > 0 ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setShowWeek((v) => !v)}
                style={styles.ghostBtnSmall}
              >
                <Text style={styles.ghostBtnSmallText}>
                  {showWeek ? 'Скрий седмицата' : 'Виж цялата седмица'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {place.phone || place.website || place.maps_url ? (
              <View style={styles.linkRow}>
                {place.phone ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => void Linking.openURL('tel:' + place.phone!.replace(/[^+\d]/g, ''))}
                    style={styles.linkChip}
                  >
                    <Ionicons name="call" size={13} color={COLORS.accentCyan} />
                    <Text style={styles.linkChipText}>{place.phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {place.website ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => void Linking.openURL(place.website!)}
                    style={styles.linkChip}
                  >
                    <Ionicons name="globe-outline" size={13} color={COLORS.accentCyan} />
                    <Text style={styles.linkChipText}>Сайт</Text>
                  </TouchableOpacity>
                ) : null}
                {place.maps_url ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => void Linking.openURL(place.maps_url!)}
                    style={styles.linkChip}
                  >
                    <Ionicons name="location-outline" size={13} color={COLORS.accentCyan} />
                    <Text style={styles.linkChipText}>Google Maps</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.hint}>
              Данните са от Google Maps
              {place.updated_at ? ' · обновени ' + formatRelativeTime(place.updated_at) : ''}
            </Text>
          </View>
        ) : null}

        {/* Графиката на „цените във времето“ има смисъл за едно и също нещо
            (кафе, хляб). За онлайн магазин тя смесва крушки и машини → скриваме я. */}
        {data.is_shop ? null : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📉 История на цените</Text>
          {data.history.length === 0 ? (
            <Text style={styles.hint}>Още няма записани цени за този обект.</Text>
          ) : (
            <>
              <View style={styles.chart}>
                {data.history.slice(-24).map((h) => {
                  const height = maxPrice > 0 ? Math.max(6, Math.round((h.price / maxPrice) * 92)) : 6;
                  const cheap = minPrice > 0 && h.price <= minPrice * 1.05;
                  return (
                    <View key={h.id} style={styles.barWrap}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height,
                            backgroundColor: cheap ? COLORS.greenPrimary : COLORS.accentCyan,
                          },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                {formatMoney(minPrice)} – {formatMoney(maxPrice)}
                {spread < 0
                  ? ' · цената е паднала с ' + formatMoney(Math.abs(spread))
                  : spread > 0
                    ? ' · цената се е вдигнала с ' + formatMoney(spread)
                    : ''}
                {unit ? ' · за ' + unit : ''}
              </Text>

              <View style={styles.monthTable}>
                {data.months.slice(-6).map((m) => (
                  <View key={m.month} style={styles.monthRow}>
                    <Text style={styles.monthLabel}>{m.month}</Text>
                    <Text style={styles.monthValue}>
                      средно {formatMoney(m.avg_price)} · {formatMoney(m.min_price)}–{formatMoney(m.max_price)}
                    </Text>
                    <Text style={styles.monthPosts}>{m.posts} сигн.</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            🛒 Всички оферти ({formatNumber(offersTotal || o.signals_count)})
          </Text>

          {/* 🔎 Търсачка В САМИЯ магазин: с 200+ продукта човекът не може да
              намери нищо без нея. Търси на сървъра (заглавие, описание, код). */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={17} color={COLORS.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder={data.is_shop ? 'Търси продукт в магазина (напр. Wera, батерия)…' : 'Търси в офертите на обекта…'}
              placeholderTextColor={COLORS.textMuted}
              value={offersQ}
              onChangeText={setOffersQ}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {offersQ.length > 0 ? (
              <TouchableOpacity onPress={() => setOffersQ('')} hitSlop={10}>
                <Ionicons name="close-circle" size={17} color={COLORS.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {offersQ.trim() ? (
            <Text style={styles.hint}>
              Намерени {formatNumber(offersTotal)} {offersTotal === 1 ? 'оферта' : 'оферти'} за „{offersQ.trim()}“
            </Text>
          ) : null}

          {offers.map((s) => (
            <SignalRow key={s.id} signal={s} onPress={() => router.push(`/post/${s.id}` as never)} />
          ))}

          {offersBusy && offers.length === 0 ? (
            <ActivityIndicator color={COLORS.greenBright} style={{ marginVertical: 18 }} />
          ) : null}

          {!offersBusy && offers.length === 0 ? (
            <Text style={styles.hint}>
              {offersQ.trim() ? 'Няма такава оферта в този магазин.' : 'Още няма публикувани оферти.'}
            </Text>
          ) : null}

          {offers.length > 0 && offers.length < offersTotal ? (
            <TouchableOpacity
              style={styles.ghostBtnSmall}
              activeOpacity={0.85}
              onPress={() => void loadOffers(offersQ.trim(), offers.length, true)}
            >
              <Text style={styles.ghostBtnSmallText}>
                {offersBusy
                  ? 'Зареждам…'
                  : `Зареди още оферти (показвам ${offers.length} от ${offersTotal})`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={[styles.hint, { textAlign: 'center', marginBottom: 24 }]}>
          Всички цени са в €. Данните идват от сигнали на хората — обектът се разпознава по място и град.
        </Text>
      </ScrollView>

      {/* ↑ Обратно най-горе — същото като в „Поток“ и „Радар“, за да не се налага
          човекът да изтегля 60–200 оферти, за да стигне пак до търсачката. */}
      {showToTop ? (
        <TouchableOpacity
          style={styles.toTop}
          activeOpacity={0.85}
          onPress={() => scrollScreenToTop(true)}
          accessibilityLabel="Обратно най-горе"
        >
          <Ionicons name="arrow-up" size={19} color={COLORS.textPrimary} />
          <Text style={styles.toTopText}>Нагоре</Text>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

function SignalRow({ signal, onPress }: { signal: ObjectSignal; onPress: () => void }) {
  const good = signal.polarity === 'green';
  return (
    <TouchableOpacity style={styles.signal} onPress={onPress} activeOpacity={0.85}>
      {signal.image_url ? <Image source={{ uri: signal.image_url }} style={styles.signalImage} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.signalTitle} numberOfLines={2}>
          {signal.title}
        </Text>
        <Text style={styles.signalDesc} numberOfLines={2}>
          {signal.description}
        </Text>
        <View style={styles.pillRow}>
          <View style={[styles.pill, good ? styles.pillGreen : styles.pillRed]}>
            <Text style={styles.pillText}>{formatMoney(signal.price_paid)}</Text>
          </View>
          {signal.price_per_unit ? (
            <View style={[styles.pill, styles.pillDim]}>
              <Text style={styles.pillText}>{formatMoney(signal.price_per_unit)}/{signal.unit_type}</Text>
            </View>
          ) : null}
          {signal.is_fake_promo ? (
            <View style={[styles.pill, styles.pillRed]}>
              <Text style={styles.pillText}>фалшива промоция</Text>
            </View>
          ) : null}
          {signal.is_shrinkflation ? (
            <View style={[styles.pill, styles.pillGold]}>
              <Text style={styles.pillText}>по-малко за същите пари</Text>
            </View>
          ) : null}
          {signal.verified_by_ai ? (
            <View style={[styles.pill, styles.pillCyan]}>
              <Text style={styles.pillText}>проверена бележка</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{formatRelativeTime(signal.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  /* ↑ „Нагоре“ — същото като в „Поток“/„Радар“, за да е еднакво за човека.
     Екранът на обекта няма лента с табове, затова стои по-ниско. */
  toTop: {
    position: 'absolute',
    right: 14,
    bottom: 24,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(11,20,36,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toTopText: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgPrimary, gap: 10 },
  muted: { color: COLORS.textSecondary, fontSize: 14 },
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
  cover: { width: '100%', height: 190, borderRadius: 18, marginBottom: 12, backgroundColor: COLORS.bgCard },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  name: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '800' },
  sub: { color: COLORS.textSecondary, fontSize: 13.5, marginTop: 4 },
  body: { color: COLORS.textPrimary, fontSize: 14.5, marginTop: 6 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', marginBottom: 8 },
  /* 🔎 Търсачка в офертите на обекта/магазина (под заглавието на картата). */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgCardElevated,
  },
  pillGreen: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  pillRed: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  pillGold: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  pillCyan: { backgroundColor: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.30)' },
  pillDim: {},
  pillText: { color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
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
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  /* 🥇 „Най-изгодни цени в категорията“ — значката за онлайн магазин. */
  bestValueBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    backgroundColor: COLORS.goldSoftBg,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bestValueText: { color: COLORS.goldBright, fontSize: 10.5, fontWeight: '800' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 100, marginTop: 6 },
  barWrap: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3, width: '100%' },
  monthTable: { marginTop: 12, gap: 6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthLabel: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700', width: 62 },
  monthValue: { color: COLORS.textPrimary, fontSize: 12.5, flex: 1 },
  monthPosts: { color: COLORS.textMuted, fontSize: 11.5 },
  signal: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  signalImage: { width: 62, height: 62, borderRadius: 12, backgroundColor: COLORS.bgCardElevated },
  signalTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  signalDesc: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  ghostBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  ghostBtnText: { color: COLORS.textPrimary, fontWeight: '700' },

  // 🏪 Google Maps: рейтинг, отзиви, работно време
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rateNum: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '900' },
  rateCount: { color: COLORS.textSecondary, fontSize: 12.5, flexShrink: 1 },
  hourRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  hourDay: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  hourVal: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 2 },
  openBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  openBadgeText: { fontSize: 11.5, fontWeight: '800' },
  weekTable: { marginTop: 10, gap: 5 },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekDay: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700', width: 96 },
  weekVal: { color: COLORS.textPrimary, fontSize: 12.5, flex: 1, textAlign: 'right' },
  ghostBtnSmall: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.bgCardElevated,
  },
  ghostBtnSmallText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.30)',
  },
  linkChipText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '700' },
});
