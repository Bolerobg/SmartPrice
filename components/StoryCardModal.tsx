import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { copyText, shareStoryCard } from '@/lib/share';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Адрес на генерираната карта (PNG 1080×1920). */
  cardUrl: string;
  /** Текст, който отива заедно с картинката. */
  message: string;
  /** Кратко заглавие над картата. */
  title?: string;
}

/**
 * Карта „Спестих X €“ — готов PNG за Stories / Viber / WhatsApp.
 *
 * Картата се рисува на сървъра, затова тук само я показваме и я подаваме
 * нататък. На мобилен браузър споделяме САМАТА картинка (директно в Stories),
 * иначе я сваляме във файл.
 */
export const StoryCardModal: React.FC<Props> = ({ visible, onClose, cardUrl, message, title }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible) {
      setNote(null);
      setCopied(false);
      setFailed(false);
    }
  }, [visible, cardUrl]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await shareStoryCard(cardUrl, message);
      setNote(
        result === 'shared'
          ? 'Готово! Избра приложението — качи картата в Stories.'
          : result === 'downloaded'
            ? 'Картата е свалaна като smartprice-karta.png — качи я в Stories от галерията.'
            : 'Картата се отвори в нов раздел — задръж върху нея, за да я запазиш.'
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Споделянето не успя.');
    } finally {
      setBusy(false);
    }
  }, [cardUrl, message]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(cardUrl);
    setCopied(ok);
    setNote(
      ok
        ? 'Линкът към картата е копиран — можеш да го пратиш навсякъде.'
        : 'Браузърът не разреши копиране. Задръж върху линка по-долу.'
    );
  }, [cardUrl]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title ?? 'Карта за Stories'}</Text>
              <Text style={styles.subtitle}>
                1080×1920 — готово за Stories, Reels, Viber и WhatsApp
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
            <View style={styles.previewWrap}>
              {!failed ? (
                <Image
                  source={{ uri: cardUrl }}
                  style={styles.preview}
                  resizeMode="contain"
                  onError={() => setFailed(true)}
                />
              ) : (
                <View style={[styles.preview, styles.previewFallback]}>
                  <Ionicons name="image-outline" size={32} color={COLORS.textMuted} />
                  <Text style={styles.fallbackText}>Картата не се зареди. Опитай отново.</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => void handleShare()}
              disabled={busy}
              activeOpacity={0.88}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.black} size="small" />
              ) : (
                <Ionicons name="share-social" size={18} color={COLORS.black} />
              )}
              <Text style={styles.primaryBtnText}>
                {Platform.OS === 'web' ? 'Сподели / свали картата' : 'Сподели картата'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.copyRow} onPress={() => void handleCopy()} activeOpacity={0.85}>
              <Ionicons
                name={copied ? 'checkmark-circle' : 'link-outline'}
                size={17}
                color={copied ? COLORS.greenBright : COLORS.accentCyan}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.copyTitle, copied && { color: COLORS.greenBright }]}>
                  {copied ? 'Линкът е копиран ✓' : 'Копирай линка към картата'}
                </Text>
                <Text style={styles.copyLink} numberOfLines={1} selectable>
                  {cardUrl}
                </Text>
              </View>
            </TouchableOpacity>

            {note ? (
              <View style={styles.noteBox}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.accentCyan} />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ) : null}

            <Text style={styles.hint}>
              Картата носи твоя код за покана и QR — всеки, който я види, може да влезе през
              нея. Затова е най-силният начин да доведеш нови хора.
            </Text>
          </ScrollView>

          <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.ghostBtnText}>Затвори</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.78)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.bgPrimary,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 18,
    maxHeight: '94%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderSubtle,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgCardElevated,
  },
  previewWrap: {
    marginTop: 16,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    backgroundColor: COLORS.bgCard,
  },
  preview: { width: '100%', aspectRatio: 9 / 16, backgroundColor: COLORS.bgCard },
  previewFallback: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  fallbackText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 14.5, fontWeight: '900' },
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
    marginTop: 12,
  },
  copyTitle: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  copyLink: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.accentCyanSoftBg,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  noteText: { flex: 1, color: COLORS.textPrimary, fontSize: 11.5, lineHeight: 16.5, fontWeight: '700' },
  hint: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: 12, marginBottom: 6 },
  ghostBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  ghostBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
});
