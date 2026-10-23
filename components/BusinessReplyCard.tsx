import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/src/auth/AuthContext';
import { formatPostedAt } from '@/src/lib/format';
import {
  ApiError,
  businessCanReply,
  businessForPost,
  businessRepliesForPost,
  postBusinessReply,
  type BusinessPublic,
  type BusinessReply,
} from '@/src/api/client';

/**
 * 🏢 Официалният глас на търговеца под една оферта.
 *
 * Защо съществува: приложението показваше само оплакванията на хората. Ако
 * обектът има ПРОВЕРЕН собственик, той получава право на ОФИЦИАЛЕН отговор —
 * „да, вдигнахме цената, ето защо“ / „това е стара снимка, поправете я“.
 * Човекът вижда і другата страна, а търговецът има причина да плаща абонамент.
 *
 * ВАЖНО: един отговор на сигнал (пази се от базата), за да не се превърне в спам.
 */
export function BusinessReplyCard({ postId }: { postId: string }) {
  const { isAuthenticated } = useAuth();
  const [business, setBusiness] = useState<BusinessPublic | null>(null);
  const [replies, setReplies] = useState<BusinessReply[]>([]);
  const [canReply, setCanReply] = useState<{ canReply: boolean; businessId: string | null }>({
    canReply: false,
    businessId: null,
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!postId) return;
    void (async () => {
      try {
        const [biz, list] = await Promise.all([
          businessForPost(postId).catch(() => null),
          businessRepliesForPost(postId).catch(() => []),
        ]);
        if (!alive) return;
        setBusiness(biz);
        setReplies(list);
      } catch {
        /* картата просто не се показва */
      }
    })();
    return () => {
      alive = false;
    };
  }, [postId]);

  useEffect(() => {
    let alive = true;
    if (!postId || !isAuthenticated) {
      setCanReply({ canReply: false, businessId: null });
      return;
    }
    void businessCanReply(postId)
      .then((res) => {
        if (alive) setCanReply({ canReply: res.canReply, businessId: res.businessId });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [postId, isAuthenticated]);

  const send = async () => {
    if (!canReply.businessId) return;
    setError('');
    if (text.trim().length < 20) {
      setError('Отговорът е твърде кратък — напиши поне едно изречение (20+ знака).');
      return;
    }
    setBusy(true);
    try {
      const res = await postBusinessReply(canReply.businessId, postId, text.trim());
      setReplies((prev) => [res.reply, ...prev]);
      setText('');
      setCanReply({ canReply: false, businessId: canReply.businessId });
      setCopied(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Не успях да изпратя отговора. Опитай пак.'
      );
    } finally {
      setBusy(false);
    }
  };

  // Няма проверен търговец и аз не мога да отговарям → нищо не се показва.
  if (!business && !canReply.canReply && replies.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {business ? (
        <View style={styles.badgeRow}>
          <Ionicons name="shield-checkmark" size={15} color={COLORS.greenBright} />
          <Text style={styles.badgeText}>✅ Проверен търговец: {business.legal_name}</Text>
        </View>
      ) : null}

      {replies.map((r) => (
        <View key={r.id} style={styles.replyCard}>
          <View style={styles.replyHead}>
            <View style={styles.officialPill}>
              <Text style={styles.officialPillText}>ОФИЦИАЛЕН ОТГОВОР</Text>
            </View>
            <Text style={styles.replyWho} numberOfLines={1}>
              {r.legal_name}
            </Text>
            <Text style={styles.replyTime}>• {formatPostedAt(r.created_at)}</Text>
          </View>
          <Text style={styles.replyBody}>{r.body}</Text>
        </View>
      ))}

      {canReply.canReply ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Отговори официално (ти си собственикът)</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Напр.: „Цената беше вдигната заради доставката на 1 октомври — ето фактурата.“"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={4}
            maxLength={1500}
          />
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color={COLORS.redBright} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {copied ? (
            <Text style={styles.okText}>✅ Отговорът е публикуван — вижда се от всички.</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.sendBtn, busy && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={send}
          >
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.onPrimary} />
            ) : (
              <Ionicons name="shield-checkmark-outline" size={15} color={COLORS.onPrimary} />
            )}
            <Text style={styles.sendBtnText}>{busy ? 'Изпращам…' : 'Публикувай отговора'}</Text>
          </TouchableOpacity>
          <Text style={styles.formHint}>
            Отговорът се показва с името на фирмата ти и значка „Проверен търговец“. Можеш да
            отговориш точно веднъж на сигнал.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, gap: 10 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '800', flex: 1 },
  replyCard: {
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 14,
    padding: 12,
  },
  replyHead: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  officialPill: {
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  officialPillText: { color: COLORS.onPrimary, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
  replyWho: { color: COLORS.textPrimary, fontSize: 12.5, fontWeight: '900', flexShrink: 1 },
  replyTime: { color: COLORS.textMuted, fontSize: 11 },
  replyBody: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  formCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    padding: 12,
  },
  formTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '900', marginBottom: 8 },
  input: {
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 13,
    minHeight: 84,
    textAlignVertical: 'top',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    borderRadius: 10,
    padding: 9,
    marginTop: 10,
  },
  errorText: { flex: 1, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },
  okText: { color: COLORS.greenBright, fontSize: 12, fontWeight: '800', marginTop: 10 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
  },
  sendBtnText: { color: COLORS.onPrimary, fontSize: 13, fontWeight: '900' },
  formHint: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 15, marginTop: 9 },
});
