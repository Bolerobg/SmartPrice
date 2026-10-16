import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatPostedAtLong, formatRelativeTime } from '@/src/lib/format';
import {
  computePriceStats,
  entryLabel,
  freshnessLabel,
  priceTrendLabel,
} from '@/lib/priceHistory';
import type { PostItem } from '@/types';

interface Props {
  post: PostItem;
}

/**
 * „История на цената“ + „Беше ли на място?“.
 *
 * Офертата не е снимка — цената се променя. Тук всеки вижда как се е движила
 * и може да я потвърди или поправи, ако е минал оттам. Това е и най-силният
 * двигател на доверие: една оферта, проверена днес от човек, тежи повече от
 * сто оферти без нито една проверка.
 */
export const PriceHistoryCard: React.FC<Props> = ({ post }) => {
  /**
   * Онлайн магазин ли е офертата. Тогава думите са други: човек не „отива на
   * място“, а отваря сайта — затова питаме „вярна ли е цената в сайта“ и
   * пишем „потвърдена в сайта“, не „на място“.
   */
  const online = Boolean(post.sourceUrl);
  const { confirmPriceValidToday, reportUpdatedPrice, userProfile } = useApp();

  const stats = useMemo(() => computePriceStats(post), [post]);

  const [showAll, setShowAll] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isGreen = post.polarity === 'green';
  const accent = isGreen ? COLORS.greenBright : COLORS.redBright;

  const visibleEntries = showAll ? stats.entries : stats.entries.slice(-4);
  const hiddenCount = stats.entries.length - visibleEntries.length;

  const deltaColor =
    stats.direction === 'down'
      ? COLORS.greenBright
      : stats.direction === 'up'
        ? COLORS.redBright
        : COLORS.textSecondary;

  const staleDays = stats.daysSinceCheck ?? 999;
  const isStale = staleDays >= 14;
  const neverChecked = stats.daysSinceCheck === null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPriceValidToday(post.id);
      const total = userProfile?.reputationPoints;
      setFeedback(
        `🎉 Благодарим! +10 точки доверие${total ? ` (общо ${total})` : ''} — ` +
          `следващият, който отиде, ще знае, че цената е вярна.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не успя да се запише. Опитай пак.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitPrice = async () => {
    const value = Number(newPrice.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Напиши валидна цена, например 6.50');
      return;
    }
    if (Math.abs(value - post.pricePaid) < 0.005) {
      setError('Това е същата цена — натисни „Цената е същата“.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportUpdatedPrice(post.id, value);
      setIsEditing(false);
      setNewPrice('');
      const diff = value - post.pricePaid;
      const total = userProfile?.reputationPoints;
      const pointsLine = `+15 точки доверие${total ? ` (общо ${total})` : ''}`;
      const whoLine =
        stats.contributorsCount > 0
          ? ` Ти си ${stats.contributorsCount + 1}-вият, който проверява тази оферта.`
          : '';
      setFeedback(
        diff > 0
          ? `🎉 Записахме новата цена — поскъпна с ${diff.toFixed(2)} €. ${pointsLine}.${whoLine}`
          : `🎉 Записахме новата цена — поевтиня с ${Math.abs(diff).toFixed(2)} €. ${pointsLine}.${whoLine}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не успя да се запише. Опитай пак.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      {/* ------------------------------------------------ Заглавие */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name="stats-chart" size={16} color={COLORS.accentCyan} />
          <Text style={styles.title}>История на цената</Text>
        </View>
        {stats.changesCount > 0 && (
          <View style={styles.changesPill}>
            <Text style={styles.changesPillText}>
              {stats.changesCount}{' '}
              {stats.changesCount === 1 ? 'промяна' : 'промени'}
            </Text>
          </View>
        )}
      </View>

      {/* ------------------------------------------------ Три числа */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Сега</Text>
          <Text style={[styles.statValue, { color: accent }]}>
            {stats.currentPrice.toFixed(2)} €
          </Text>
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statLabel}>От началото</Text>
          <Text style={[styles.statValue, { color: deltaColor }]}>
            {stats.direction === 'same'
              ? 'без промяна'
              : `${stats.delta > 0 ? '+' : '−'}${Math.abs(stats.delta).toFixed(2)} €`}
          </Text>
          {stats.direction !== 'same' && (
            <Text style={[styles.statSub, { color: deltaColor }]}>
              {stats.deltaPercent > 0 ? '+' : ''}
              {stats.deltaPercent}%
            </Text>
          )}
        </View>

        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Проверена</Text>
          <Text
            style={[
              styles.statValue,
              {
                color: stats.isFresh
                  ? COLORS.greenBright
                  : isStale
                    ? COLORS.goldBright
                    : COLORS.textSecondary,
                fontSize: 12.5,
              },
            ]}
          >
            {stats.daysSinceCheck === null
              ? 'никога'
              : stats.daysSinceCheck === 0
                ? 'днес'
                : stats.daysSinceCheck === 1
                  ? 'вчера'
                  : `преди ${stats.daysSinceCheck} дни`}
          </Text>
          {stats.contributorsCount > 0 && (
            <Text style={styles.statSub}>
              {stats.contributorsCount}{' '}
              {stats.contributorsCount === 1 ? 'човек' : 'души'}
            </Text>
          )}
        </View>
      </View>

      {/* ------------------------------------------------ Изречение с посоката */}
      {priceTrendLabel(stats) && (
        <View style={[styles.trendLine, { borderColor: deltaColor }]}>
          <Ionicons
            name={stats.direction === 'down' ? 'trending-down' : 'trending-up'}
            size={15}
            color={deltaColor}
          />
          <Text style={[styles.trendText, { color: deltaColor }]}>
            {stats.direction === 'down'
              ? `Тази оферта е поевтиняла с ${Math.abs(stats.delta).toFixed(2)} €, откакто е публикувана.`
              : `Тази оферта е поскъпнала с ${stats.delta.toFixed(2)} €, откакто е публикувана.`}
          </Text>
        </View>
      )}

      {/* ------------------------------------------------ Хронология */}
      <View style={styles.timeline}>
        {visibleEntries.map((entry, index) => {
          const meta = entryLabel(entry, online);
          const dotColor =
            meta.color === 'green'
              ? COLORS.greenBright
              : meta.color === 'amber'
                ? COLORS.goldBright
                : COLORS.accentCyan;

          return (
            <View key={entry.id} style={styles.entryRow}>
              <View style={styles.entryRail}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                {index < visibleEntries.length - 1 && <View style={styles.rail} />}
              </View>

              <View style={styles.entryBody}>
                <View style={styles.entryTop}>
                  <Text style={styles.entryTitle}>{meta.title}</Text>
                  <Text style={styles.entryPrice}>{entry.price.toFixed(2)} €</Text>
                </View>
                <Text style={styles.entryMeta} numberOfLines={1}>
                  {entry.reportedBy} · {formatPostedAtLong(entry.recordedAt)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {hiddenCount > 0 && (
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => setShowAll(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.moreBtnText}>
            Виж цялата история ({stats.entries.length} записа)
          </Text>
        </TouchableOpacity>
      )}

      {/* ------------------------------------------------ Беше ли на място */}
      <View style={[styles.contribute, isStale && styles.contributeStale]}>
        <View style={styles.contributeHead}>
          <Text style={styles.contributeTitle}>
            {neverChecked
              ? online
                ? 'Никой още не е проверил цената в сайта'
                : 'Никой още не е проверил тази цена'
              : isStale
                ? `Никой не е проверявал от ${staleDays} дни`
                : online
                  ? 'Вярна ли е цената в сайта?'
                  : 'Беше ли на място?'}
          </Text>
          <Text style={styles.contributeSub}>
            {online
              ? 'Отвори продукта в сайта и кажи дали цената е същата. Помагаш на всички след теб.'
              : isStale || neverChecked
                ? 'Ако минеш оттам — кажи ни дали още е вярна. Помагаш на всички след теб.'
                : '10 секунди. Следващият, който отиде, ще знае вярната цена.'}
          </Text>
        </View>

        {feedback ? (
          <View style={styles.feedbackBox}>
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        ) : post.userConfirmedValidToday && !isEditing ? (
          <View style={styles.doneBox}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.greenBright} />
            <Text style={styles.doneText}>
              {online
                ? 'Ти потвърди цената в сайта днес. Благодарим!'
                : 'Ти провери тази цена днес. Благодарим!'}
            </Text>
          </View>
        ) : isEditing ? (
          <View style={styles.editBox}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={newPrice}
                onChangeText={setNewPrice}
                placeholder={online ? 'Цената в сайта сега, напр. 6.50' : 'Новата цена, напр. 6.50'}
                placeholderTextColor={COLORS.textMuted}
                keyboardType="decimal-pad"
                autoFocus
              />
              <Text style={styles.inputSuffix}>€</Text>
            </View>
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                onPress={() => void handleSubmitPrice()}
                disabled={busy}
                activeOpacity={0.88}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={COLORS.black} />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={15} color={COLORS.black} />
                    <Text style={styles.primaryBtnText}>
                      {online ? 'Запази цената от сайта' : 'Запази новата цена'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => {
                  setIsEditing(false);
                  setNewPrice('');
                  setError(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.ghostBtnText}>Отказ</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, busy && { opacity: 0.6 }]}
                onPress={() => void handleConfirm()}
                disabled={busy}
                activeOpacity={0.88}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={COLORS.greenBright} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={17} color={COLORS.greenBright} />
                    <Text style={styles.confirmBtnText}>
                      {online ? 'Цената в сайта е същата' : 'Цената е същата'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.changeBtn}
                onPress={() => {
                  setIsEditing(true);
                  setFeedback(null);
                  setError(null);
                }}
                activeOpacity={0.88}
              >
                <Ionicons name="create-outline" size={17} color={COLORS.goldBright} />
                <Text style={styles.changeBtnText}>
                  {online ? 'Друга е в сайта' : 'Промени се'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.rewardHint}>
              ✅ Потвърждаване: +10 т. · ✏️ Нова цена: +15 т. точки доверие
            </Text>
          </>
        )}

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={14} color={COLORS.redBright} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.footNote}>
        {freshnessLabel(stats, online)} ·{' '}
        {stats.entries.length > 0
          ? `последно: ${formatRelativeTime(stats.entries[stats.entries.length - 1]!.recordedAt)}`
          : 'няма записи'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 18,
    padding: 15,
    marginTop: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: COLORS.textPrimary, fontSize: 14.5, fontWeight: '900' },
  changesPill: {
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  changesPillText: { color: COLORS.goldBright, fontSize: 10.5, fontWeight: '800' },

  statsRow: { flexDirection: 'row', gap: 9 },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 15, fontWeight: '900', marginTop: 4 },
  statSub: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', marginTop: 2 },

  trendLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 11,
    backgroundColor: COLORS.bgCardElevated,
  },
  trendText: { flex: 1, fontSize: 11.5, fontWeight: '800', lineHeight: 16 },

  timeline: { marginTop: 14 },
  entryRow: { flexDirection: 'row', gap: 11 },
  entryRail: { alignItems: 'center', width: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  rail: { flex: 1, width: 2, backgroundColor: COLORS.borderSubtle, marginTop: 3 },
  entryBody: { flex: 1, paddingBottom: 13 },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  entryTitle: { flex: 1, color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800' },
  entryPrice: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '900' },
  entryMeta: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 3 },

  moreBtn: { alignItems: 'center', paddingVertical: 9 },
  moreBtnText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800' },

  contribute: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 15,
    padding: 13,
    marginTop: 6,
  },
  contributeStale: {
    borderColor: COLORS.goldBorder,
    backgroundColor: COLORS.goldSoftBg,
  },
  contributeHead: { marginBottom: 12 },
  contributeTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '900' },
  contributeSub: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    lineHeight: 16.5,
    marginTop: 4,
  },
  actionRow: { flexDirection: 'row', gap: 9 },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 13,
    minHeight: 46,
  },
  confirmBtnText: { color: COLORS.greenBright, fontSize: 12.5, fontWeight: '900' },
  changeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 13,
    minHeight: 46,
  },
  changeBtnText: { color: COLORS.goldBright, fontSize: 12.5, fontWeight: '900' },
  rewardHint: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 10,
  },

  editBox: { gap: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    paddingVertical: 11,
  },
  inputSuffix: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '900' },
  editActions: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: COLORS.goldBright,
    borderRadius: 13,
    minHeight: 46,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 13, fontWeight: '900' },
  ghostBtn: { paddingHorizontal: 14, minHeight: 46, justifyContent: 'center' },
  ghostBtnText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '800' },

  feedbackBox: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 12,
    padding: 11,
  },
  feedbackText: { color: COLORS.greenBright, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  doneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 12,
    padding: 11,
  },
  doneText: { flex: 1, color: COLORS.greenBright, fontSize: 12, fontWeight: '800' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  errorText: { flex: 1, color: COLORS.redBright, fontSize: 11.5, fontWeight: '700' },

  footNote: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 12,
  },
});
