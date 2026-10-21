import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { matchesUniversalSearch } from '@/lib/smartSearch';
import { api, type BasketComparison } from '@/src/api/client';

export type SmartToolTab = 'basket' | 'shrinkflation' | 'alerts';

interface SmartToolsModalProps {
  visible: boolean;
  initialTab?: SmartToolTab;
  onClose: () => void;
}

interface BasketProduct {
  id: string;
  name: string;
  unitLabel: string;
  selected: boolean;
  /** Цената, която ПОТРЕБИТЕЛЯТ е платил/въвел. Не се измисля от приложението. */
  myPrice: number;
}

/**
 * ВАЖНО: преди тук имаше твърдо зададени цени за Lidl / Kaufland / Billa /
 * Фантастико, които приложението показваше като „НАЙ-ИЗГОДНА КОШНИЦА ДНЕС“.
 * Тези числа бяха измислени. Сега списъкът съдържа само реалните цени,
 * които потребителят въведе, а сравнението се прави с действителните
 * публикации на общността за същия продукт.
 */
const INITIAL_BASKET_PRODUCTS: BasketProduct[] = [
  { id: 'bp-1', name: 'Краве масло 82%', unitLabel: '250 г', selected: true, myPrice: 4.49 },
  { id: 'bp-2', name: 'Прясно мляко 3.6%', unitLabel: '1 л', selected: true, myPrice: 2.39 },
  { id: 'bp-3', name: 'Яйца размер L', unitLabel: '10 бр.', selected: true, myPrice: 4.19 },
  { id: 'bp-4', name: 'Зехтин Extra Virgin', unitLabel: '1 л', selected: true, myPrice: 16.99 },
];

export const SmartToolsModal: React.FC<SmartToolsModalProps> = ({
  visible,
  initialTab = 'basket',
  onClose,
}) => {
  const router = useRouter();
  const { posts, priceAlerts, addPriceAlert, removePriceAlert, togglePriceAlert } =
    useApp();

  const [activeTab, setActiveTab] = useState<SmartToolTab>(initialTab);

  // Състояния за Таб 1: Умна Кошница
  const [basketItems, setBasketItems] = useState<BasketProduct[]>(
    INITIAL_BASKET_PRODUCTS
  );
  const [customBasketName, setCustomBasketName] = useState('');
  const [customBasketPrice, setCustomBasketPrice] = useState('');

  /**
   * 🏪 Сравнение на ЦЕЛИЯ списък по вериги (внесените цени от Кауфланд, Метро…).
   *
   * Защо не се смята тук, в паметта: заредената лента е 60 оферти, а в базата
   * има 53 000 цени от вериги — сравнението трябва да пита сървъра. Човекът
   * вижда „този списък струва 42.30 € в Метро“, „45.10 € в Кауфланд“ и
   * „най-евтина комбинация: Метро + Билла = 39.80 €“.
   */
  const [chainCompare, setChainCompare] = useState<BasketComparison | null>(null);
  const [chainCompareBusy, setChainCompareBusy] = useState(false);
  const [basketCity, setBasketCity] = useState('Всички градове');

  // Състояния за Таб 2: Шринкфлация & Цена за 1 кг/л
  const [pkgAWeight, setPkgAWeight] = useState('400');
  const [pkgAPrice, setPkgAPrice] = useState('8.90');
  const [pkgBWeight, setPkgBWeight] = useState('500');
  const [pkgBPrice, setPkgBPrice] = useState('9.90');
  const [unitMode, setUnitMode] = useState<'g_kg' | 'ml_l'>('g_kg');

  // Състояния за Таб 3: Ценови Аларми
  const [alertKeyword, setAlertKeyword] = useState('');
  const [alertMaxPrice, setAlertMaxPrice] = useState('');
  const [alertCity, setAlertCity] = useState('Всички градове');
  const [alertPolarity, setAlertPolarity] = useState<'green' | 'red' | 'any'>(
    'green'
  );

  React.useEffect(() => {
    if (visible && initialTab) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  // Питаме сървъра за сравнението по вериги (само когато табът е отворен).
  const basketKey = basketItems
    .filter((i) => i.selected)
    .map((i) => i.name)
    .join('|');
  React.useEffect(() => {
    if (!visible || activeTab !== 'basket') return;
    const titles = basketItems.filter((i) => i.selected).map((i) => i.name.trim()).filter(Boolean);
    if (!titles.length) {
      setChainCompare(null);
      return;
    }
    let alive = true;
    setChainCompareBusy(true);
    const timer = setTimeout(() => {
      api
        .basketCompare({
          items: titles.map((title) => ({ title })),
          city: basketCity !== 'Всички градове' ? basketCity : undefined,
        })
        .then((res) => {
          if (alive) setChainCompare(res);
        })
        .catch(() => {
          if (alive) setChainCompare(null);
        })
        .finally(() => {
          if (alive) setChainCompareBusy(false);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [visible, activeTab, basketKey, basketCity, basketItems]);

  // Сравнение с РЕАЛНИТЕ цени от публикациите на общността
  const basketComparison = useMemo(() => {
    const selected = basketItems.filter((i) => i.selected);

    const rows = selected.map((item) => {
      const keyword = item.name.toLowerCase().split(/\s+/)[0] ?? item.name.toLowerCase();
      const community = posts
        .filter((p) => matchesUniversalSearch(p, keyword) && p.pricePaid > 0)
        .map((p) => ({ price: p.pricePaid, place: p.placeName, city: p.city }));

      const cheapest =
        community.length > 0
          ? community.reduce((min, c) => (c.price < min.price ? c : min), community[0]!)
          : null;

      return {
        item,
        communityCount: community.length,
        cheapest,
        saving: cheapest && cheapest.price < item.myPrice ? item.myPrice - cheapest.price : 0,
      };
    });

    const myTotal = selected.reduce((acc, i) => acc + i.myPrice, 0);
    const totalPotentialSaving = rows.reduce((acc, r) => acc + r.saving, 0);
    const itemsWithCommunityData = rows.filter((r) => r.communityCount > 0).length;

    return { selectedCount: selected.length, rows, myTotal, totalPotentialSaving, itemsWithCommunityData };
  }, [basketItems, posts]);

  const handleAddCustomBasketItem = () => {
    const name = customBasketName.trim();
    const price = Number(customBasketPrice.replace(',', '.'));
    if (!name) return;
    if (!Number.isFinite(price) || price <= 0) return;

    // Пазим САМО цената, която потребителят е въвел — без измислени вариации по вериги.
    const newItem: BasketProduct = {
      id: `bp-${Date.now()}`,
      name,
      unitLabel: '1 бр.',
      selected: true,
      myPrice: Number(price.toFixed(2)),
    };
    setBasketItems((prev) => [newItem, ...prev]);
    setCustomBasketName('');
    setCustomBasketPrice('');
  };

  // Изчисления за Шринкфлация (Таб 2)
  const shrinkAnalysis = useMemo(() => {
    const wA = Number(pkgAWeight.replace(',', '.'));
    const pA = Number(pkgAPrice.replace(',', '.'));
    const wB = Number(pkgBWeight.replace(',', '.'));
    const pB = Number(pkgBPrice.replace(',', '.'));

    if (isNaN(wA) || wA <= 0 || isNaN(pA) || pA <= 0) return null;

    const perKgA = (pA / wA) * 1000;
    const perKgB =
      !isNaN(wB) && wB > 0 && !isNaN(pB) && pB > 0
        ? (pB / wB) * 1000
        : null;

    let isShrinkTrap = false;
    let diffPct = 0;

    if (perKgB !== null) {
      diffPct = Math.round(((perKgA - perKgB) / perKgB) * 100);
      if (wA < wB && perKgA > perKgB) {
        isShrinkTrap = true;
      }
    }

    return {
      perKgA,
      perKgB,
      isShrinkTrap,
      diffPct,
    };
  }, [pkgAWeight, pkgAPrice, pkgBWeight, pkgBPrice]);

  // Съвпаденията идват изчислени от сървъра (реални данни от базата)
  const alertsWithMatches = useMemo(
    () =>
      priceAlerts.map((alert) => ({
        alert,
        matches: alert.isActive ? alert.matches : [],
      })),
    [priceAlerts]
  );

  const handleCreateAlert = async () => {
    if (!alertKeyword.trim()) return;
    const maxP = Number(alertMaxPrice.replace(',', '.'));
    try {
      await addPriceAlert({
        keyword: alertKeyword.trim(),
        maxPrice: !isNaN(maxP) && maxP > 0 ? maxP : undefined,
        city: alertCity,
        polarity: alertPolarity,
      });
      setAlertKeyword('');
      setAlertMaxPrice('');
    } catch {
      // грешката се показва от контекста
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.handleBar} />

          {/* Заглавие */}
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="sparkles" size={20} color={COLORS.goldBright} />
              <Text style={styles.headerTitle} numberOfLines={1}>
                Умни Потребителски Инструменти
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* 3 Таба */}
          <View style={styles.tabsBar}>
            <TouchableOpacity
              style={[
                styles.tabBtn,
                activeTab === 'basket' && styles.tabBtnActive,
              ]}
              onPress={() => setActiveTab('basket')}
            >
              <Ionicons
                name="cart"
                size={15}
                color={
                  activeTab === 'basket' ? COLORS.greenBright : COLORS.textSecondary
                }
              />
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'basket' && {
                    color: COLORS.greenBright,
                    fontWeight: '800',
                  },
                ]}
                numberOfLines={1}
              >
                Списък
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                activeTab === 'shrinkflation' && styles.tabBtnActive,
              ]}
              onPress={() => setActiveTab('shrinkflation')}
            >
              <Ionicons
                name="scale"
                size={15}
                color={
                  activeTab === 'shrinkflation'
                    ? COLORS.goldBright
                    : COLORS.textSecondary
                }
              />
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'shrinkflation' && {
                    color: COLORS.goldBright,
                    fontWeight: '800',
                  },
                ]}
                numberOfLines={1}
              >
                Шринкфлация
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabBtn,
                activeTab === 'alerts' && styles.tabBtnActive,
              ]}
              onPress={() => setActiveTab('alerts')}
            >
              <Ionicons
                name="notifications"
                size={15}
                color={
                  activeTab === 'alerts'
                    ? COLORS.accentCyan
                    : COLORS.textSecondary
                }
              />
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'alerts' && {
                    color: COLORS.accentCyan,
                    fontWeight: '800',
                  },
                ]}
                numberOfLines={1}
              >
                Аларми ({priceAlerts.filter((a) => a.isActive).length})
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
          >
            {/* ТАБ 1: МОЯТ СПИСЪК ЗА ПАЗАРУВАНЕ */}
            {activeTab === 'basket' && (
              <View style={{ gap: 12 }}>
                <View style={styles.winnerBanner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.winnerSmallLabel}>
                      🛒 МОЯТ СПИСЪК ({basketComparison.selectedCount} продукта)
                    </Text>
                    <Text style={styles.winnerStoreName}>
                      Общо по твоите цени: {basketComparison.myTotal.toFixed(2)} €
                    </Text>
                    {basketComparison.itemsWithCommunityData > 0 ? (
                      <Text style={styles.winnerSavingsSub}>
                        За{' '}
                        <Text style={{ color: COLORS.greenBright, fontWeight: '900' }}>
                          {basketComparison.itemsWithCommunityData}
                        </Text>{' '}
                        от тях общността има по-ниска цена — можеш да спестиш до{' '}
                        <Text style={{ color: COLORS.greenBright, fontWeight: '900' }}>
                          {basketComparison.totalPotentialSaving.toFixed(2)} €
                        </Text>
                      </Text>
                    ) : (
                      <Text style={styles.winnerSavingsSub}>
                        Няма публикации на общността за тези продукти още. Твоите цени се пазят
                        само на това устройство.
                      </Text>
                    )}
                  </View>
                </View>

                {/* 🏪 Сравнение на ЦЕЛИЯ списък по вериги — с реалните внесени цени
                    (Метро, Кауфланд, Билла…). Смята се на сървъра, защото работи
                    върху всички 53 000 цени, не само върху заредената лента. */}
                <View style={styles.chainCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="storefront" size={15} color={COLORS.accentCyan} />
                    <Text style={styles.chainCardTitle}>Колко струва списъкът във веригите</Text>
                  </View>
                  <CityPickerDropdown
                    selectedCity={basketCity}
                    onSelectCity={setBasketCity}
                    includeAllOption
                    label="Град за сравнението"
                  />

                  {chainCompareBusy ? (
                    <ActivityIndicator color={COLORS.accentCyan} style={{ marginVertical: 10 }} />
                  ) : null}

                  {!chainCompareBusy && chainCompare && chainCompare.chains.length > 0 ? (
                    <>
                      {chainCompare.chains.slice(0, 6).map((c) => {
                        const isBest = chainCompare.best?.chain === c.chain;
                        return (
                          <View key={c.chain} style={[styles.chainRow, isBest && styles.chainRowBest]}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.chainName} numberOfLines={1}>
                                {c.chain}
                                {isBest ? ' · най-евтино' : ''}
                              </Text>
                              <Text style={styles.chainMeta}>
                                {c.found} от {chainCompare.itemsTotal} продукта
                                {c.missing ? ` · ${c.missing} липсват` : ''}
                              </Text>
                            </View>
                            <Text style={[styles.chainTotal, isBest && { color: COLORS.greenBright }]}>
                              {c.total.toFixed(2)} €
                            </Text>
                          </View>
                        );
                      })}

                      {chainCompare.bestPair && chainCompare.pairSaving ? (
                        <Text style={styles.chainPairLine}>
                          🛒 Най-добра комбинация: {chainCompare.bestPair.chains[0]} +{' '}
                          {chainCompare.bestPair.chains[1]} = {chainCompare.bestPair.total.toFixed(2)} €
                          {' '}(спестяваш {chainCompare.pairSaving.toFixed(2)} €)
                        </Text>
                      ) : null}

                      <Text style={styles.chainNote}>
                        Липсващите продукти не влизат в сметката — виждаш колко от списъка има във
                        всяка верига. Цените са сверени от веригите, само в избрания град.
                      </Text>
                    </>
                  ) : null}

                  {!chainCompareBusy && (!chainCompare || chainCompare.chains.length === 0) ? (
                    <Text style={styles.chainNote}>
                      Не намирам тези продукти във веригите. Пробвай по-просто име — например
                      „прясно мляко“ вместо „мляко 3.6% 1л“.
                    </Text>
                  ) : null}
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxTitle}>ℹ️ Как работят тези цени</Text>
                  <Text style={styles.infoBoxSub}>
                    Списъкът пази цените, които ТИ въвеждаш. Сравнението се прави с реалните
                    публикации на другите потребители — приложението не измисля цени за вериги.
                  </Text>
                </View>

                {/* Сравнение с реалните цени от общността */}
                {basketComparison.rows.length > 0 && (
                  <View style={styles.storesGrid}>
                    {basketComparison.rows.map((row) => (
                      <View
                        key={row.item.id}
                        style={[
                          styles.storeTotalCard,
                          row.saving > 0 && {
                            borderColor: COLORS.greenPrimary,
                            backgroundColor: COLORS.greenSoftBg,
                          },
                        ]}
                      >
                        <Text style={styles.storeCardRank} numberOfLines={1}>
                          {row.item.name}
                        </Text>
                        <Text style={styles.storeCardTitle}>Твоята цена</Text>
                        <Text style={styles.storeCardPrice}>
                          {row.item.myPrice.toFixed(2)} €
                        </Text>
                        {row.cheapest ? (
                          <>
                            <Text
                              style={[
                                styles.storeCardRank,
                                { marginTop: 6, color: COLORS.textMuted },
                              ]}
                              numberOfLines={2}
                            >
                              {row.saving > 0 ? 'По-евтино при' : 'Общността отчита'}:{' '}
                              {row.cheapest.place}
                            </Text>
                            <Text
                              style={[
                                styles.storeCardPrice,
                                { fontSize: 13, color: row.saving > 0 ? COLORS.greenBright : COLORS.textSecondary },
                              ]}
                            >
                              {row.cheapest.price.toFixed(2)} €
                            </Text>
                          </>
                        ) : (
                          <Text
                            style={[
                              styles.storeCardRank,
                              { marginTop: 6, color: COLORS.textMuted },
                            ]}
                          >
                            Няма данни от общността
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Добави свой продукт към списъка */}
                <View style={styles.addCustomRow}>
                  <TextInput
                    style={[styles.input, { flex: 1.5 }]}
                    placeholder="Добави продукт (напр. Сирене 1кг)..."
                    placeholderTextColor={COLORS.textMuted}
                    value={customBasketName}
                    onChangeText={setCustomBasketName}
                  />
                  <TextInput
                    style={[styles.input, { flex: 0.8 }]}
                    placeholder="Цена €"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="decimal-pad"
                    value={customBasketPrice}
                    onChangeText={setCustomBasketPrice}
                  />
                  <TouchableOpacity
                    style={styles.addBtn}
                    onPress={handleAddCustomBasketItem}
                  >
                    <Ionicons name="add" size={20} color={COLORS.black} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeading}>
                  Избери продуктите в твоя списък за пазаруване:
                </Text>

                {basketItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.basketItemRow,
                      item.selected && styles.basketItemRowActive,
                    ]}
                    onPress={() =>
                      setBasketItems((prev) =>
                        prev.map((p) =>
                          p.id === item.id ? { ...p, selected: !p.selected } : p
                        )
                      )
                    }
                    activeOpacity={0.82}
                  >
                    <Ionicons
                      name={item.selected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={
                        item.selected ? COLORS.greenBright : COLORS.textMuted
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.basketItemName}>
                        {item.name}{' '}
                        <Text style={{ color: COLORS.textMuted, fontSize: 11.5 }}>
                          ({item.unitLabel})
                        </Text>
                      </Text>
                      <Text style={styles.basketItemPrices}>
                        Твоята цена: {item.myPrice.toFixed(2)} €
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ТАБ 2: ДЕТЕКТОР НА ШРИНКФЛАЦИЯ & ЦЕНА ЗА 1 КГ/Л */}
            {activeTab === 'shrinkflation' && (
              <View style={{ gap: 12 }}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxTitle}>
                    📉 Провери дали „промоцията“ не е скрита шринкфлация!
                  </Text>
                  <Text style={styles.infoBoxSub}>
                    Много производители намаляват грамажа (напр. от 500 г на 400 г
                    или 380 г), за да изглежда цената на етикета по-ниска, докато
                    цената за 1 кг всъщност е по-висока.
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[
                      styles.unitPill,
                      unitMode === 'g_kg' && styles.unitPillActive,
                    ]}
                    onPress={() => setUnitMode('g_kg')}
                  >
                    <Text
                      style={[
                        styles.unitPillText,
                        unitMode === 'g_kg' && { color: COLORS.goldBright },
                      ]}
                    >
                      ⚖️ Грамове → Цена за 1 кг
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.unitPill,
                      unitMode === 'ml_l' && styles.unitPillActive,
                    ]}
                    onPress={() => setUnitMode('ml_l')}
                  >
                    <Text
                      style={[
                        styles.unitPillText,
                        unitMode === 'ml_l' && { color: COLORS.goldBright },
                      ]}
                    >
                      🍾 Милилитри → Цена за 1 л
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Пакет А срещу Пакет Б */}
                <View style={styles.comparePackagesCard}>
                  <Text style={styles.pkgHeader}>
                    📦 Продукт А (напр. „Промо“ малка разфасовка)
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>
                        Количество ({unitMode === 'g_kg' ? 'грама' : 'мл'}):
                      </Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={pkgAWeight}
                        onChangeText={setPkgAWeight}
                        placeholder="400"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>Цена на етикета (€):</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={pkgAPrice}
                        onChangeText={setPkgAPrice}
                        placeholder="8.90"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <Text style={styles.pkgHeader}>
                    📦 Продукт Б (Стандартна разфасовка за сравнение)
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>
                        Количество ({unitMode === 'g_kg' ? 'грама' : 'мл'}):
                      </Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={pkgBWeight}
                        onChangeText={setPkgBWeight}
                        placeholder="500"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>Цена на етикета (€):</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={pkgBPrice}
                        onChangeText={setPkgBPrice}
                        placeholder="9.90"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>
                </View>

                {shrinkAnalysis && (
                  <View
                    style={[
                      styles.shrinkResultCard,
                      {
                        borderColor: shrinkAnalysis.isShrinkTrap
                          ? COLORS.redBorder
                          : COLORS.greenBorder,
                        backgroundColor: shrinkAnalysis.isShrinkTrap
                          ? COLORS.redSoftBg
                          : COLORS.greenSoftBg,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: shrinkAnalysis.isShrinkTrap
                          ? COLORS.redBright
                          : COLORS.greenBright,
                        fontSize: 13.5,
                        fontWeight: '900',
                      }}
                    >
                      {shrinkAnalysis.isShrinkTrap
                        ? `🚨 ЗАСЕЧЕНА ШРИНКФЛАЦИЯ! Продукт А е с +${shrinkAnalysis.diffPct}% по-скъп за ${
                            unitMode === 'g_kg' ? '1 кг' : '1 л'
                          }!`
                        : `✅ Реална цена за ${
                            unitMode === 'g_kg' ? '1 кг' : '1 л'
                          }:`}
                    </Text>

                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginTop: 8,
                      }}
                    >
                      <View>
                        <Text style={styles.smallLabel}>Продукт А реална цена:</Text>
                        <Text
                          style={{
                            color: COLORS.textPrimary,
                            fontSize: 17,
                            fontWeight: '900',
                          }}
                        >
                          {shrinkAnalysis.perKgA.toFixed(2)} €/
                          {unitMode === 'g_kg' ? 'кг' : 'л'}
                        </Text>
                      </View>

                      {shrinkAnalysis.perKgB !== null && (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.smallLabel}>
                            Продукт Б реална цена:
                          </Text>
                          <Text
                            style={{
                              color: COLORS.textPrimary,
                              fontSize: 17,
                              fontWeight: '900',
                            }}
                          >
                            {shrinkAnalysis.perKgB.toFixed(2)} €/
                            {unitMode === 'g_kg' ? 'кг' : 'л'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ТАБ 3: ЦЕНОВИ АЛАРМИ */}
            {activeTab === 'alerts' && (
              <View style={{ gap: 12 }}>
                <View style={styles.comparePackagesCard}>
                  <Text style={styles.pkgHeader}>
                    🔔 Създай нова Ценова Аларма
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Продукт или обект (напр. Зехтин, Масло, Кафе, Созопол)..."
                    placeholderTextColor={COLORS.textMuted}
                    value={alertKeyword}
                    onChangeText={setAlertKeyword}
                  />

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>
                        Макс. цена (€, по избор):
                      </Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="напр. 18.00"
                        placeholderTextColor={COLORS.textMuted}
                        value={alertMaxPrice}
                        onChangeText={setAlertMaxPrice}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smallLabel}>Тип сигнал:</Text>
                      <View style={{ flexDirection: 'row', gap: 5 }}>
                        <TouchableOpacity
                          style={[
                            styles.unitPill,
                            alertPolarity === 'green' && {
                              borderColor: COLORS.greenPrimary,
                              backgroundColor: COLORS.greenSoftBg,
                            },
                          ]}
                          onPress={() => setAlertPolarity('green')}
                        >
                          <Text style={{ color: COLORS.greenBright, fontSize: 11, fontWeight: '800' }}>
                            🟢 Оферта
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.unitPill,
                            alertPolarity === 'red' && {
                              borderColor: COLORS.redPrimary,
                              backgroundColor: COLORS.redSoftBg,
                            },
                          ]}
                          onPress={() => setAlertPolarity('red')}
                        >
                          <Text style={{ color: COLORS.redBright, fontSize: 11, fontWeight: '800' }}>
                            🔴 Капан
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  <View style={{ marginTop: 6 }}>
                    <CityPickerDropdown
                      selectedCity={alertCity}
                      onSelectCity={setAlertCity}
                      includeAllOption
                      label="За кой град:"
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.createAlertBtn}
                    onPress={handleCreateAlert}
                  >
                    <Ionicons
                      name="notifications-circle"
                      size={18}
                      color={COLORS.white}
                    />
                    <Text style={styles.createAlertBtnText}>
                      Активирай Ценова Аларма
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeading}>
                  Твоите активни аларми и намерени сигнали:
                </Text>

                {alertsWithMatches.map(({ alert, matches }) => (
                  <View key={alert.id} style={styles.alertCard}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                        onPress={() => togglePriceAlert(alert.id)}
                      >
                        <Ionicons
                          name={
                            alert.isActive
                              ? 'notifications'
                              : 'notifications-off-outline'
                          }
                          size={18}
                          color={
                            alert.isActive
                              ? COLORS.accentCyan
                              : COLORS.textMuted
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.alertTitle}>
                            „{alert.keyword}“{' '}
                            {alert.maxPrice ? `под ${alert.maxPrice} €` : ''}
                          </Text>
                          <Text style={styles.alertMeta}>
                            📍 {alert.city} •{' '}
                            {alert.polarity === 'green'
                              ? '🟢 Оферти'
                              : alert.polarity === 'red'
                              ? '🔴 Капани'
                              : 'Всички'}{' '}
                            • Намерени: {matches.length}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => removePriceAlert(alert.id)}
                        style={{ padding: 6 }}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={17}
                          color={COLORS.textMuted}
                        />
                      </TouchableOpacity>
                    </View>

                    {matches.length > 0 && (
                      <View style={{ marginTop: 8, gap: 5 }}>
                        {matches.slice(0, 2).map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            style={styles.matchRow}
                            onPress={() => {
                              onClose();
                              router.push(`/post/${m.id}`);
                            }}
                          >
                            <Text
                              style={styles.matchRowTitle}
                              numberOfLines={1}
                            >
                              {m.polarity === 'green' ? '🟢' : '🔴'} {m.title}
                            </Text>
                            <Text style={styles.matchRowPrice}>
                              {m.pricePaid.toFixed(2)} € →
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 14, 0.86)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgSecondary,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    maxHeight: '90%',
  },
  handleBar: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.borderStrong,
    alignSelf: 'center',
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 16.5,
    fontWeight: '900',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: COLORS.bgCardElevated,
  },
  tabBtnText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  scrollBody: {
    paddingBottom: 24,
  },
  winnerBanner: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 16,
    padding: 13,
  },
  winnerSmallLabel: {
    color: COLORS.greenBright,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  winnerStoreName: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  winnerSavingsSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  storesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  storeTotalCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 13,
    padding: 10,
  },
  storeCardRank: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  storeCardTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  storeCardPrice: {
    color: COLORS.textPrimary,
    fontSize: 15.5,
    fontWeight: '900',
    marginTop: 3,
  },
  addCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  addBtn: {
    backgroundColor: COLORS.greenPrimary,
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeading: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  basketItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 13,
    padding: 11,
  },
  basketItemRowActive: {
    borderColor: COLORS.greenBorder,
  },
  basketItemName: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  basketItemPrices: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  /* 🏪 Сравнение на списъка по вериги (внесените цени от Кауфланд, Метро…). */
  chainCard: {
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  chainCardTitle: { color: COLORS.accentCyan, fontSize: 13, fontWeight: '800' },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  chainRowBest: {
    borderColor: COLORS.greenPrimary,
    backgroundColor: COLORS.greenSoftBg,
  },
  chainName: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  chainMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 1 },
  chainTotal: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900' },
  chainPairLine: {
    color: COLORS.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 2,
  },
  chainNote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15 },
  infoBox: {
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    padding: 12,
  },
  infoBoxTitle: {
    color: COLORS.goldBright,
    fontSize: 13,
    fontWeight: '800',
  },
  infoBoxSub: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginTop: 3,
    lineHeight: 16,
  },
  unitPill: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  unitPillActive: {
    borderColor: COLORS.goldPrimary,
    backgroundColor: COLORS.goldSoftBg,
  },
  unitPillText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  comparePackagesCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  pkgHeader: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  smallLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.borderSubtle,
    marginVertical: 4,
  },
  shrinkResultCard: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 13,
  },
  createAlertBtn: {
    backgroundColor: COLORS.accentIndigo,
    borderRadius: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
  },
  createAlertBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
  alertCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    padding: 12,
  },
  alertTitle: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  alertMeta: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  matchRowTitle: {
    color: COLORS.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    flex: 1,
  },
  matchRowPrice: {
    color: COLORS.greenBright,
    fontSize: 11.5,
    fontWeight: '900',
  },
});
