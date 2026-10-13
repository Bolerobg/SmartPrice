import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { COLORS } from '@/constants/theme';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 45;
const CODE_TTL_S = 15 * 60;

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VerifyScreen() {
  const router = useRouter();
  const { email: emailParam, bonus } = useLocalSearchParams<{ email?: string; bonus?: string }>();
  const email = (emailParam ?? '').trim().toLowerCase();

  const { verifyEmail, resendCode } = useAuth();

  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [ttl, setTtl] = useState(CODE_TTL_S);
  const [isResending, setIsResending] = useState(false);

  const inputRef = useRef<TextInput>(null);

  // Обратно броене за нов код
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Обратно броене за валидността на кода
  useEffect(() => {
    if (ttl <= 0) return;
    const t = setInterval(() => setTtl((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [ttl]);

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== CODE_LENGTH || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        await verifyEmail(email, value);
        // Успех → AuthGate сам ще отвори приложението
        router.replace('/(tabs)');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Не успях да потвърдя кода.');
        setCode('');
        inputRef.current?.focus();
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, isSubmitting, router, verifyEmail]
  );

  const onChangeCode = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH) void submit(digits);
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resendCode(email, 'email_verify');
      setNotice(result.message);
      setDevCode(result.devCode ?? null);
      setCooldown(RESEND_COOLDOWN_S);
      setTtl(CODE_TTL_S);
      setCode('');
      if (!result.alreadyVerified) inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да изпратя нов код.');
    } finally {
      setIsResending(false);
    }
  };

  const boxes = useMemo(
    () =>
      Array.from({ length: CODE_LENGTH }, (_, i) => {
        const filled = i < code.length;
        const active = i === code.length;
        return (
          <View
            key={i}
            style={[
              styles.codeBox,
              filled && styles.codeBoxFilled,
              active && styles.codeBoxActive,
            ]}
          >
            <Text style={styles.codeDigit}>{code[i] ?? ''}</Text>
          </View>
        );
      }),
    [code]
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconCircle}>
          <Ionicons name="mail-unread-outline" size={34} color={COLORS.accentCyan} />
        </View>

        <Text style={styles.title}>Провери имейла си</Text>
        {bonus ? (
          <View style={styles.bonusBox}>
            <Ionicons name="gift" size={16} color={COLORS.greenBright} />
            <Text style={styles.bonusText}>
              {bonus} те покани. Щом потвърдиш имейла си, ДВАМАта получавате по 100 точки доверие.
            </Text>
          </View>
        ) : null}

        <Text style={styles.subtitle}>
          Изпратихме 6-цифрен код на{'\n'}
          <Text style={styles.emailText}>{email || 'твоя имейл'}</Text>
        </Text>

        {/* Скрит вход, който движи шестте квадратчета */}
        <TouchableOpacity
          activeOpacity={1}
          style={styles.codeRow}
          onPress={() => inputRef.current?.focus()}
        >
          {boxes}
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChangeCode}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoFocus
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            style={styles.hiddenInput}
            editable={!isSubmitting}
          />
        </TouchableOpacity>

        <View style={styles.timerRow}>
          <Ionicons
            name={ttl > 0 ? 'time-outline' : 'alert-circle-outline'}
            size={14}
            color={ttl > 0 ? COLORS.textMuted : COLORS.goldBright}
          />
          <Text style={[styles.timerText, ttl <= 0 && { color: COLORS.goldBright }]}>
            {ttl > 0
              ? `Кодът е валиден още ${formatClock(ttl)}`
              : 'Кодът изтече — поискай нов'}
          </Text>
        </View>

        {isSubmitting && (
          <View style={styles.infoBox}>
            <ActivityIndicator size="small" color={COLORS.accentCyan} />
            <Text style={styles.infoText}>Проверявам кода…</Text>
          </View>
        )}

        {error && (
          <View style={[styles.msgBox, styles.errorBox]}>
            <Ionicons name="close-circle" size={16} color={COLORS.redBright} />
            <Text style={[styles.msgText, { color: COLORS.redBright }]}>{error}</Text>
          </View>
        )}

        {notice && (
          <View style={[styles.msgBox, styles.successBox]}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.greenBright} />
            <Text style={[styles.msgText, { color: COLORS.greenBright }]}>{notice}</Text>
          </View>
        )}

        {devCode && (
          <View style={[styles.msgBox, styles.devBox]}>
            <Ionicons name="construct-outline" size={16} color={COLORS.goldBright} />
            <Text style={[styles.msgText, { color: COLORS.goldBright }]}>
              Дев режим — кодът е {devCode}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, isSubmitting && { opacity: 0.5 }]}
          onPress={() => void submit(code)}
          disabled={isSubmitting || code.length !== CODE_LENGTH}
          activeOpacity={0.88}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <Text style={styles.primaryBtnText}>Потвърди и влез</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.ghostBtn, (cooldown > 0 || isResending) && { opacity: 0.5 }]}
          onPress={() => void handleResend()}
          disabled={cooldown > 0 || isResending}
          activeOpacity={0.8}
        >
          {isResending ? (
            <ActivityIndicator size="small" color={COLORS.textSecondary} />
          ) : (
            <Text style={styles.ghostBtnText}>
              {cooldown > 0 ? `Нов код след ${cooldown} с` : 'Изпрати нов код'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => router.replace('/(auth)/login')}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={14} color={COLORS.textMuted} />
          <Text style={styles.linkText}>Обратно към входа</Text>
        </TouchableOpacity>

        <View style={styles.hintBox}>
          <Text style={styles.hintTitle}>Не виждаш писмото?</Text>
          <Text style={styles.hintText}>
            Провери папка „Спам“ или „Промоции“. Писмото идва от SmartPrice и е с тема,
            която започва с 6-цифрения код.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bgPrimary },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
    alignItems: 'center',
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  emailText: { color: COLORS.accentCyan, fontWeight: '800' },
  bonusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 14,
  },
  bonusText: { flex: 1, color: COLORS.greenBright, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  codeRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 26,
    marginBottom: 4,
    width: '100%',
    justifyContent: 'center',
  },
  codeBox: {
    // Гъвкава ширина: на тесен екран квадратчетата се свиват, вместо да
    // излизат извън екрана. Преди бяха твърдо 46px × 6 = 316px + отстъпи,
    // което не се събираше хоризонтално на по-малки телефони.
    flex: 1,
    maxWidth: 48,
    minWidth: 34,
    height: 58,
    borderRadius: 13,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1.5,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: {
    borderColor: COLORS.accentCyan,
    backgroundColor: COLORS.bgCardElevated,
  },
  codeBoxActive: { borderColor: COLORS.accentIndigo },
  codeDigit: {
    color: COLORS.textPrimary,
    fontSize: 26,
    fontWeight: '900',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 4,
  },
  timerText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  infoText: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' },
  msgBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    width: '100%',
  },
  errorBox: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  successBox: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  devBox: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  msgText: { flex: 1, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  primaryBtn: {
    backgroundColor: COLORS.accentCyan,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    width: '100%',
    minHeight: 54,
  },
  primaryBtnText: { color: COLORS.black, fontSize: 15.5, fontWeight: '900' },
  ghostBtn: {
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    minHeight: 48,
  },
  ghostBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '800' },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    padding: 6,
  },
  linkText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  hintBox: {
    marginTop: 26,
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    width: '100%',
  },
  hintTitle: { color: COLORS.textSecondary, fontSize: 12.5, fontWeight: '900' },
  hintText: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: 5 },
});
