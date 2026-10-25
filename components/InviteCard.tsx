import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { api, type ReferralSummary } from '@/src/api/client';
import { buildInviteMessage, copyText, openShareTargetRaw, SHARE_TARGETS } from '@/lib/share';
import type { UserProfile } from '@/types';

interface Props {
  /** Профилът (оттам идва напредъкът към значките за покани). */
  profile?: UserProfile | null;
  /** Отваря картата за Stories (ако е подадено, показваме бутона). */
  onOpenCard?: () => void;
  /** Компактен вариант — за долния лист „Сподели“. */
  compact?: boolean;
  /** Гост (не е влязъл). Тогава НЕ показваме грешка, а покана да влезе. */
  guest?: boolean;
}

const INVITE_CHANNELS = ['whatsapp', 'viber', 'telegram'] as const;

/**
 * „Покани приятел“ — сърцето на поканалния цикъл.
 *
 * Прави две неща, които карат човек да покани:
 *   1. Казва ЯСНО какво печели той (100 точки = двойно, значи статус в ранглистата).
 *   2. Дава кода и линка в един клик до Viber/WhatsApp/Telegram — не го кара да
 *      обяснява какво е приложението.
 */
export const InviteCard: React.FC<Props> = ({ profile, onOpenCard, compact, guest }) => {
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .referrals()
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch(() => {
        if (alive) setSummary(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const link = summary?.link ?? '';
  const points = summary?.pointsPerInvite ?? 100;
  const message = link ? buildInviteMessage(link, points) : '';

  const handleCopy = useCallback(async () => {
    if (!link) return;
    const ok = await copyText(link);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
    setNote(ok ? 'Линкът с кода е копиран.' : 'Браузърът не разреши копиране.');
  }, [link]);

  const handleChannel = useCallback(
    async (key: string) => {
      const target = SHARE_TARGETS.find((t) => t.key === key);
      if (!target || !link) return;
      try {
        await openShareTargetRaw(target, link, message);
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Каналът не се отвори.');
      }
    },
    [link, message]
  );

  // Следваща значка за покани — за да има цел пред очите.
  const referralBadges = (profile?.badges ?? [])
    .filter((b) => b.metric === 'referrals' && b.threshold)
    .sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));
  const nextBadge = referralBadges.find((b) => !b.unlocked);
  const rewarded = summary?.rewarded ?? profile?.referralsRewarded ?? 0;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <Ionicons name="person-add" size={18} color={COLORS.onPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Покани приятел — и двамата печелите</Text>
          <Text style={styles.subtitle}>
            По {points} точки доверие (двойно) за теб и за него, щом си потвърди имейла.
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.greenBright} style={{ marginTop: 16 }} />
      ) : !link ? (
        guest ? (
          <Text style={styles.guestHint}>
            Влез в профила си, за да получиш своя код и линк. Тогава и двамата с приятеля ти
            получавате по {points} точки доверие, щом той потвърди имейла си. Проверката на
            цени не иска профил — поканата иска.
          </Text>
        ) : (
          <Text style={styles.error}>
            Кодът не се зареди. Провери връзката и опитай пак.
          </Text>
        )
      ) : (
        <>
          <View style={styles.codeRow}>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>ТВОЯТ КОД</Text>
              <Text style={styles.code}>{summary?.code}</Text>
            </View>
            <TouchableOpacity style={styles.copyBtn} onPress={() => void handleCopy()} activeOpacity={0.85}>
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={16}
                color={copied ? COLORS.greenBright : COLORS.accentCyan}
              />
              <Text style={[styles.copyBtnText, copied && { color: COLORS.greenBright }]}>
                {copied ? 'Копирано' : 'Копирай линка'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.countersRow}>
            <View style={styles.counter}>
              <Text style={[styles.counterVal, { color: COLORS.greenBright }]}>{rewarded}</Text>
              <Text style={styles.counterLbl}>дойдоха по мой код</Text>
            </View>
            <View style={styles.counter}>
              <Text style={[styles.counterVal, { color: COLORS.goldBright }]}>
                {summary?.pointsEarned ?? 0}
              </Text>
              <Text style={styles.counterLbl}>точки от покани</Text>
            </View>
            <View style={styles.counter}>
              <Text style={styles.counterVal}>{summary?.pending ?? 0}</Text>
              <Text style={styles.counterLbl}>чакат имейл</Text>
            </View>
          </View>

          <View style={styles.channelsRow}>
            {INVITE_CHANNELS.map((key) => {
              const target = SHARE_TARGETS.find((t) => t.key === key);
              if (!target) return null;
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.channelBtn}
                  onPress={() => void handleChannel(key)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.channelIcon, { backgroundColor: target.color }]}>
                    <Ionicons name={target.icon as never} size={18} color={COLORS.white} />
                  </View>
                  <Text style={styles.channelLabel}>{target.label}</Text>
                </TouchableOpacity>
              );
            })}
            {onOpenCard ? (
              <TouchableOpacity style={styles.channelBtn} onPress={onOpenCard} activeOpacity={0.85}>
                <View style={[styles.channelIcon, { backgroundColor: COLORS.greenPrimary }]}>
                  <Ionicons name="image" size={18} color={COLORS.white} />
                </View>
                <Text style={styles.channelLabel}>Карта</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {nextBadge && nextBadge.threshold ? (
            <View style={styles.progressBox}>
              <Ionicons name="flag" size={14} color={COLORS.goldBright} />
              <Text style={styles.progressText}>
                Следваща значка: <Text style={styles.progressStrong}>{nextBadge.title}</Text> — още{' '}
                {Math.max(0, nextBadge.threshold - rewarded)} покани
              </Text>
            </View>
          ) : null}

          {!compact && summary && summary.invitedUsers.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.listLabel}>ПОКАНЕНИ ОТ ТЕБ</Text>
              {summary.invitedUsers.slice(0, 5).map((u) => (
                <View key={u.id} style={styles.listRow}>
                  <Ionicons
                    name={u.status === 'rewarded' ? 'checkmark-circle' : 'time-outline'}
                    size={16}
                    color={u.status === 'rewarded' ? COLORS.greenBright : COLORS.textMuted}
                  />
                  <Text style={styles.listName} numberOfLines={1}>
                    {u.name}
                  </Text>
                  <Text
                    style={[
                      styles.listStatus,
                      u.status === 'rewarded' && { color: COLORS.greenBright },
                    ]}
                  >
                    {u.status === 'rewarded' ? `+${u.points} точки` : 'чака имейл'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 22,
    padding: 18,
    marginTop: 16,
  },
  cardCompact: { marginTop: 20, padding: 15 },
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.greenBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17.5, marginTop: 4 },
  error: { color: COLORS.goldBright, fontSize: 12, marginTop: 14, fontWeight: '700' },
  guestHint: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18.5, marginTop: 14 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  codeBox: {
    flex: 1,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  codeLabel: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '900', letterSpacing: 1.2 },
  code: {
    color: COLORS.greenBright,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  copyBtnText: { color: COLORS.accentCyan, fontSize: 12, fontWeight: '800' },
  countersRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  counter: { flex: 1, alignItems: 'center' },
  counterVal: { color: COLORS.textPrimary, fontSize: 17.5, fontWeight: '900' },
  counterLbl: { color: COLORS.textMuted, fontSize: 9.5, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  channelsRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  channelBtn: { flex: 1, alignItems: 'center' },
  channelIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLabel: { color: COLORS.textSecondary, fontSize: 10.5, fontWeight: '700', marginTop: 6 },
  progressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9.5,
    marginTop: 16,
  },
  progressText: { flex: 1, color: COLORS.goldBright, fontSize: 11.5, fontWeight: '700' },
  progressStrong: { fontWeight: '900' },
  list: { marginTop: 16 },
  listLabel: {
    color: COLORS.textMuted,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  listName: { flex: 1, color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '700' },
  listStatus: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  note: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 12, fontWeight: '700' },
});
