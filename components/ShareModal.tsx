import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import {
  buildShareMessage,
  buildShareText,
  copyPostLink,
  hasSystemShare,
  openShareTarget,
  postUrl,
  postVerdict,
  shareViaSystem,
  SHARE_TARGETS,
} from '@/lib/share';
import { storyCardUrl } from '@/src/api/client';
import { InviteCard } from '@/components/InviteCard';
import { StoryCardModal } from '@/components/StoryCardModal';
import type { PostItem } from '@/types';

interface Props {
  post: PostItem | null;
  onClose: () => void;
}

/**
 * Долен лист за споделяне на оферта.
 *
 * Показва се ВИНАГИ, когато няма системен share диалог (десктоп браузър), за
 * да не остане бутонът „Сподели“ без ефект. На телефон системният диалог е
 * първият бутон, а готовите приложения са под него.
 */
export const ShareModal: React.FC<Props> = ({ post, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const systemShare = hasSystemShare();

  useEffect(() => {
    if (post) {
      setCopied(false);
      setError(null);
      setCardOpen(false);
    }
  }, [post]);

  const handleSystem = useCallback(async () => {
    if (!post) return;
    try {
      await shareViaSystem(post);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не успя да отвори споделянето.');
    }
  }, [post, onClose]);

  const handleTarget = useCallback(
    async (key: string) => {
      if (!post) return;
      const target = SHARE_TARGETS.find((t) => t.key === key);
      if (!target) return;
      try {
        await openShareTarget(target, post);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : `${target.label} не се отвори.`);
      }
    },
    [post, onClose]
  );

  const handleCopy = useCallback(async () => {
    if (!post) return;
    const ok = await copyPostLink(post);
    if (ok) {
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2600);
    } else {
      setError(
        'Браузърът не разреши копиране. Задръж върху линка по-долу, за да го избереш и копираш ръчно.'
      );
    }
  }, [post]);

  if (!post) return null;

  // Колко е спестил човекът спрямо обичайната цена — това е числото на картата.
  const saved =
    post.referencePrice && post.referencePrice > post.pricePaid
      ? post.referencePrice - post.pricePaid
      : 0;
  const cardUrl = saved > 0 ? storyCardUrl({ postId: post.id }) : '';

  const isGreen = post.polarity === 'green';
  const accent = isGreen ? COLORS.greenBright : COLORS.redBright;
  const accentSoft = isGreen ? COLORS.greenSoftBg : COLORS.redSoftBg;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <View style={[styles.verdictPill, { backgroundColor: accentSoft, borderColor: accent }]}>
              <Text style={[styles.verdictText, { color: accent }]}>{postVerdict(post)}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {post.title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            📍 {post.placeName} · {post.city}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
            {systemShare && (
              <TouchableOpacity style={styles.systemBtn} onPress={handleSystem} activeOpacity={0.88}>
                <Ionicons name="share-outline" size={18} color={COLORS.onPrimary} />
                <Text style={styles.systemBtnText}>Сподели с друго приложение…</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.sectionLabel}>Изпрати директно в</Text>

            <View style={styles.grid}>
              {SHARE_TARGETS.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={styles.gridItem}
                  onPress={() => void handleTarget(t.key)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.gridIcon, { backgroundColor: t.color }]}>
                    <Ionicons name={t.icon as never} size={22} color={COLORS.white} />
                  </View>
                  <Text style={styles.gridLabel} numberOfLines={1}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.copyRow} onPress={handleCopy} activeOpacity={0.85}>
              <Ionicons
                name={copied ? 'checkmark-circle' : 'link-outline'}
                size={17}
                color={copied ? COLORS.greenBright : COLORS.accentCyan}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.copyTitle, copied && { color: COLORS.greenBright }]}>
                  {copied ? 'Линкът е копиран ✓' : 'Копирай линка'}
                </Text>
                <Text style={styles.copyLink} numberOfLines={1} selectable>
                  {postUrl(post.id)}
                </Text>
              </View>
            </TouchableOpacity>

            {cardUrl ? (
              <TouchableOpacity
                style={styles.cardRow}
                onPress={() => setCardOpen(true)}
                activeOpacity={0.85}
              >
                <View style={[styles.cardIcon, { backgroundColor: accentSoft, borderColor: accent }]}>
                  <Ionicons name="image" size={20} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Карта „Спестих {saved.toFixed(2)} €“ за Stories</Text>
                  <Text style={styles.cardSub}>
                    Готова картинка 1080×1920 — с твоя код за покана и QR
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            ) : null}

            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Ето какво ще получат:</Text>
              <Text style={styles.previewText}>{buildShareText(post)}</Text>
            </View>

            {/* Поканален цикъл: тук човекът вече е в „настроение за споделяне“ */}
            <InviteCard compact />

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color={COLORS.goldBright} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>Затвори</Text>
          </TouchableOpacity>
        </View>
      </View>

      {cardUrl ? (
        <StoryCardModal
          visible={cardOpen}
          onClose={() => setCardOpen(false)}
          cardUrl={cardUrl}
          message={buildShareMessage(post)}
          title={`Карта „Спестих ${saved.toFixed(2)} €“`}
        />
      ) : null}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgPrimary,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 18,
    maxHeight: '92%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderSubtle,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdictPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  verdictText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCardElevated,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 16.5,
    fontWeight: '900',
    marginTop: 12,
    letterSpacing: -0.2,
  },
  subtitle: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 5 },
  systemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accentCyan,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  systemBtnText: { color: COLORS.onPrimary, fontSize: 14.5, fontWeight: '900' },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  gridItem: { width: '25%', alignItems: 'center' },
  gridIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: {
    color: COLORS.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 7,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 22,
  },
  copyTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  copyLink: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  previewBox: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    padding: 13,
    marginTop: 12,
  },
  previewLabel: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  previewText: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18.5 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '900' },
  cardSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.goldSoftBg,
    borderWidth: 1,
    borderColor: COLORS.goldBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  errorText: { flex: 1, color: COLORS.goldBright, fontSize: 11.5, lineHeight: 16.5, fontWeight: '700' },
  ghostBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 6 },
  ghostBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
});
