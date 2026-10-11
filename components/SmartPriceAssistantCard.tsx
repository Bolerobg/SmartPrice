import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { PostItem } from '@/types';

interface SmartPriceAssistantCardProps {
  filteredPosts: PostItem[];
  allPosts: PostItem[];
  searchQuery: string;
  selectedCity: string;
  onApplyQuickQuery: (q: string) => void;
}

const BENCHMARKS: { keywords: string[]; avgPrice: number; unitLabel: string }[] = [];

export const SmartPriceAssistantCard: React.FC<SmartPriceAssistantCardProps> = ({
  filteredPosts,
  allPosts,
  searchQuery,
  selectedCity,
  onApplyQuickQuery,
}) => {
  const [isCheckerOpen, setIsCheckerOpen] = useState(false);
  const [checkItemName, setCheckItemName] = useState('');
  const [checkPriceInput, setCheckPriceInput] = useState('');

  // Статистика за текущите филтрирани публикации
  const stats = useMemo(() => {
    if (filteredPosts.length === 0) return null;

    const prices = filteredPosts.map((p) => p.pricePaid).filter((v) => v > 0);
    const minPost = filteredPosts.reduce(
      (min, p) => (p.pricePaid < min.pricePaid ? p : min),
      filteredPosts[0]
    );
    const maxPost = filteredPosts.reduce(
      (max, p) => (p.pricePaid > max.pricePaid ? p : max),
      filteredPosts[0]
    );
    const avgPrice =
      prices.length > 0
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : 0;

    const greenDeals = filteredPosts.filter((p) => p.polarity === 'green');
    const redTraps = filteredPosts.filter((p) => p.polarity === 'red');
    const verifiedCount = filteredPosts.filter((p) => p.receipt?.verifiedByAi).length;

    const bestDeal =
      greenDeals.sort((a, b) => {
        const diffA = a.referencePrice ? a.referencePrice - a.pricePaid : 0;
        const diffB = b.referencePrice ? b.referencePrice - b.pricePaid : 0;
        return diffB - diffA;
      })[0] || minPost;

    return {
      avgPrice,
      minPost,
      maxPost,
      greenCount: greenDeals.length,
      redCount: redTraps.length,
      verifiedCount,
      bestDeal,
    };
  }, [filteredPosts]);

  // Интелигентна проверка на въведена от потребителя цена
  const priceCheckResult = useMemo(() => {
    const val = Number(checkPriceInput.replace(',', '.'));
    if (!checkPriceInput.trim() || isNaN(val) || val <= 0) return null;

    const q = checkItemName.trim().toLowerCase();

    // 1. Търсим съвпадащи постове или артикули от касови бележки
    const matchingPrices: { price: number; place: string; city: string }[] = [];

    if (q.length >= 2) {
      allPosts.forEach((p) => {
        const postMatches =
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.placeName.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q));

        if (postMatches) {
          matchingPrices.push({
            price: p.pricePaid,
            place: p.placeName,
            city: p.city,
          });
          if (p.referencePrice) {
            matchingPrices.push({
              price: p.referencePrice,
              place: `Референтна (${p.placeName})`,
              city: p.city,
            });
          }
        }

        p.receipt?.items.forEach((item) => {
          if (item.name.toLowerCase().includes(q)) {
            matchingPrices.push({
              price: item.unitPrice,
              place: p.placeName,
              city: p.city,
            });
          }
        });
      });
    }

    // Ако общността няма данни за този продукт, НЕ измисляме „обичайна цена“.
    // Преди тук имаше твърдо зададени стойности (зехтин 24 €, нощувка 120 €),
    // които приложението представяше като факт.
    if (matchingPrices.length === 0) {
      return {
        status: 'unknown' as const,
        headline: '🟡 Нямаме данни за тази цена',
        detail:
          'Общността още не е публикувала цени за този продукт. Публикувай ти — така следващият потребител ще има с какво да сравни.',
        cheapestMatch: null,
      };
    }

    const baselineAvg =
      matchingPrices.reduce((acc, m) => acc + m.price, 0) / matchingPrices.length;
    const baselineLabel = `средната цена в общността (${matchingPrices.length} записа)`;
    const cheapestMatch = matchingPrices.reduce(
      (min, m) => (m.price < min.price ? m : min),
      matchingPrices[0]!
    );

    const ratio = (val - baselineAvg) / baselineAvg;
    const diffPercent = Math.round(Math.abs(ratio) * 100);

    if (ratio <= -0.15) {
      return {
        status: 'green' as const,
        headline: `🟢 ОТЛИЧНА ЦЕНА! (-${diffPercent}% под ${baselineLabel})`,
        detail: `Средната цена е ~${baselineAvg.toFixed(2)} € Спестяваш около ${(baselineAvg - val).toFixed(2)} €!`,
        cheapestMatch,
      };
    }
    if (ratio >= 0.25) {
      return {
        status: 'red' as const,
        headline: `🔴 ВНИМАНИЕ: ВИСОКА НАДЦЕНКА (+${diffPercent}%)`,
        detail: `Обичайната цена е ~${baselineAvg.toFixed(2)} €${
          cheapestMatch
            ? ` В „${cheapestMatch.place}“ (${cheapestMatch.city}) е засечено за ${cheapestMatch.price.toFixed(2)} €`
            : ''
        }`,
        cheapestMatch,
      };
    }

    return {
      status: 'neutral' as const,
      headline: `🟡 НОРМАЛНА ПАЗАРНА ЦЕНА (~${baselineAvg.toFixed(2)} €)`,
      detail: `Цената от ${val.toFixed(2)} € е близка до ${baselineLabel}.`,
      cheapestMatch,
    };
  }, [allPosts, checkItemName, checkPriceInput, stats]);

  return (
    <View style={styles.container}>
      {/* Горен ред: Умен AI Анализ на потока */}
      <View style={styles.topHeader}>
        <View style={styles.aiBadgeRow}>
          <View style={styles.aiPulseDot} />
          <Ionicons name="sparkles" size={13} color={COLORS.accentCyan} />
          <Text style={styles.aiHeaderTitle} numberOfLines={1}>
            УМЕН ЦЕНОВИ АСИСТЕНТ
            {selectedCity !== 'Всички градове' ? ` • ${selectedCity.toUpperCase()}` : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.checkerToggleBtn,
            isCheckerOpen && styles.checkerToggleBtnActive,
          ]}
          onPress={() => setIsCheckerOpen((prev) => !prev)}
          activeOpacity={0.85}
        >
          <Ionicons
            name={isCheckerOpen ? 'chevron-up' : 'calculator-outline'}
            size={13}
            color={COLORS.white}
          />
          <Text style={styles.checkerToggleText}>
            {isCheckerOpen ? 'Скрий калкулатора' : 'Провери цена'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Умни метрики в реално време */}
      {stats && (
        <>
          <View style={styles.metricsRow}>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Средна цена</Text>
              <Text style={styles.metricVal}>
                {stats.avgPrice.toFixed(2)} €
              </Text>
            </View>

            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Най-евтино</Text>
              <Text style={[styles.metricVal, { color: COLORS.greenBright }]}>
                {stats.minPost.pricePaid.toFixed(2)} €
              </Text>
            </View>

            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Най-скъпо</Text>
              <Text style={[styles.metricVal, { color: COLORS.redBright }]}>
                {stats.maxPost.pricePaid.toFixed(2)} €
              </Text>
            </View>

            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>С бележка</Text>
              <Text style={[styles.metricVal, { color: COLORS.goldBright }]}>
                🧾 {stats.verifiedCount}
              </Text>
            </View>
          </View>

          <Text style={styles.smartTipText} numberOfLines={2}>
            💡 <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>AI Съвет:</Text>{' '}
            {searchQuery.trim()
              ? `За „${searchQuery.trim()}“ открихме ${stats.greenCount} оферти и ${stats.redCount} сигнала за капан.`
              : `Най-изгодната находка в момента е в „${stats.bestDeal.placeName}“ (${stats.bestDeal.city}) за ${stats.bestDeal.pricePaid.toFixed(2)} €`}
          </Text>
        </>
      )}

      {/* Интерактивен калкулатор: „Честна ли е тази цена?“ */}
      {isCheckerOpen && (
        <View style={styles.checkerBox}>
          <Text style={styles.checkerTitle}>
            🔍 Бърза AI проверка: Изгодна ли е цената преди да платиш?
          </Text>
          <View style={styles.checkerInputsRow}>
            <TextInput
              style={[styles.checkerInput, { flex: 1.4 }]}
              placeholder="Продукт (напр. кафе, вода, зехтин)"
              placeholderTextColor={COLORS.textMuted}
              value={checkItemName}
              onChangeText={setCheckItemName}
            />
            <TextInput
              style={[styles.checkerInput, { flex: 0.9 }]}
              placeholder="Цена (€)"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
              value={checkPriceInput}
              onChangeText={setCheckPriceInput}
            />
          </View>

          {/* Бързи примери за тестване с 1 клик */}
          <View style={styles.sampleChecksRow}>
            {[
              { label: '☕ Кафе 6.50 €', item: 'кафе', price: '6.50' },
              { label: '💧 Вода 8.00 €', item: 'вода', price: '8.00' },
              { label: '🍲 Обяд 11.50 €', item: 'меню', price: '11.50' },
            ].map((sample) => (
              <TouchableOpacity
                key={sample.label}
                style={styles.sampleCheckChip}
                onPress={() => {
                  setCheckItemName(sample.item);
                  setCheckPriceInput(sample.price);
                  onApplyQuickQuery(sample.item);
                }}
              >
                <Text style={styles.sampleCheckChipText}>{sample.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {priceCheckResult && (
            <View
              style={[
                styles.verdictBox,
                priceCheckResult.status === 'green' && styles.verdictGreen,
                priceCheckResult.status === 'red' && styles.verdictRed,
              ]}
            >
              <Text style={styles.verdictHeadline}>
                {priceCheckResult.headline}
              </Text>
              <Text style={styles.verdictDetail}>{priceCheckResult.detail}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    borderRadius: 15,
    padding: 10,
    marginBottom: 10,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  aiBadgeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  aiPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accentCyan,
  },
  aiHeaderTitle: {
    color: COLORS.accentCyan,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  checkerToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accentIndigo,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    flexShrink: 0,
  },
  checkerToggleBtnActive: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  checkerToggleText: {
    color: COLORS.white,
    fontSize: 10.5,
    fontWeight: '800',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 7,
  },
  metricPill: {
    flex: 1,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  metricLabel: {
    color: COLORS.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
  },
  metricVal: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 2,
  },
  smartTipText: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 16,
  },
  checkerBox: {
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  checkerTitle: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 7,
  },
  checkerInputsRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 7,
  },
  checkerInput: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 12.5,
  },
  sampleChecksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  sampleCheckChip: {
    backgroundColor: COLORS.bgCardElevated,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  sampleCheckChipText: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
  },
  verdictBox: {
    marginTop: 4,
    padding: 9,
    borderRadius: 10,
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  verdictGreen: {
    backgroundColor: COLORS.greenSoftBg,
    borderColor: COLORS.greenBorder,
  },
  verdictRed: {
    backgroundColor: COLORS.redSoftBg,
    borderColor: COLORS.redBorder,
  },
  verdictHeadline: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  verdictDetail: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 16,
  },
});
