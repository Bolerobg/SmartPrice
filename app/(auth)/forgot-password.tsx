import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { ApiError } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { COLORS } from '@/constants/theme';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 45;

type Step = 'email' | 'code';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword, resetPassword, resendCode } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const requestCode = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await forgotPassword(email);
      setNotice(result.message);
      setDevCode(result.devCode ?? null);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да изпратя код.');
    } finally {
      setIsBusy(false);
    }
  }, [email, forgotPassword]);

  const handleResend = async () => {
    if (cooldown > 0 || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const result = await resendCode(email, 'password_reset');
      setNotice(result.message);
      setDevCode(result.devCode ?? null);
      setCooldown(RESEND_COOLDOWN_S);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да изпратя нов код.');
    } finally {
      setIsBusy(false);
    }
  };

  const submitNewPassword = async () => {
    if (code.length !== CODE_LENGTH || password.length < 8) return;
    setIsBusy(true);
    setError(null);
    try {
      await resetPassword(email, code, password);
      // Успех → AuthGate ще отвори приложението
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да сменя паролата.');
      setCode('');
      codeRef.current?.focus();
    } finally {
      setIsBusy(false);
    }
  };

  const passwordChecks = [
    { label: 'поне 8 символа', ok: password.length >= 8 },
    { label: 'буква', ok: /[A-Za-zА-Яа-я]/.test(password) },
    { label: 'цифра', ok: /\d/.test(password) },
  ];
  const passwordStrong = passwordChecks.every((c) => c.ok);

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
          <Ionicons
            name={step === 'email' ? 'lock-open-outline' : 'shield-checkmark-outline'}
            size={32}
            color={COLORS.goldBright}
          />
        </View>

        <Text style={styles.title}>
          {step === 'email' ? 'Забравена парола' : 'Нова парола'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'email'
            ? 'Въведи имейла си и ще ти изпратим код за нова парола.'
            : `Въведи кода от писмото и избери нова парола за\n${email}`}
        </Text>

        {/* --- Стъпка 1: имейл --- */}
        {step === 'email' && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Имейл</Text>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={17} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="ime@primer.bg"
                  placeholderTextColor={COLORS.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  editable={!isBusy}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, (!emailValid || isBusy) && { opacity: 0.5 }]}
              onPress={() => void requestCode()}
              disabled={!emailValid || isBusy}
              activeOpacity={0.88}
            >
              {isBusy ? (
                <ActivityIndicator color={COLORS.black} />
              ) : (
                <Text style={styles.primaryBtnText}>Изпрати код</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* --- Стъпка 2: код + нова парола --- */}
        {step === 'code' && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Код от имейла</Text>
              <View style={styles.inputRow}>
                <Ionicons name="keypad-outline" size={17} color={COLORS.textMuted} />
                <TextInput
                  ref={codeRef}
                  style={[styles.input, styles.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={COLORS.textMuted}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                  keyboardType="number-pad"
                  maxLength={CODE_LENGTH}
                  autoFocus
                  editable={!isBusy}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Нова парола</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={17} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Минимум 8 символа"
                  placeholderTextColor={COLORS.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!isBusy}
                />
                <TouchableOpacity onPress={() => setShowPassword((s) => !s)} hitSlop={10}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.checksRow}>
                {passwordChecks.map((c) => (
                  <View key={c.label} style={styles.checkItem}>
                    <Ionicons
                      name={c.ok ? 'checkmark-circle' : 'ellipse-outline'}
                      size={13}
                      color={c.ok ? COLORS.greenBright : COLORS.textMuted}
                    />
                    <Text
                      style={[
                        styles.checkText,
                        c.ok && { color: COLORS.greenBright },
                      ]}
                    >
                      {c.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!passwordStrong || code.length !== CODE_LENGTH || isBusy) && { opacity: 0.5 },
              ]}
              onPress={() => void submitNewPassword()}
              disabled={!passwordStrong || code.length !== CODE_LENGTH || isBusy}
              activeOpacity={0.88}
            >
              {isBusy ? (
                <ActivityIndicator color={COLORS.black} />
              ) : (
                <Text style={styles.primaryBtnText}>Смени паролата и влез</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.ghostBtn, cooldown > 0 && { opacity: 0.5 }]}
              onPress={() => void handleResend()}
              disabled={cooldown > 0 || isBusy}
              activeOpacity={0.8}
            >
              <Text style={styles.ghostBtnText}>
                {cooldown > 0 ? `Нов код след ${cooldown} с` : 'Изпрати нов код'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {error && (
          <View style={[styles.msgBox, styles.errorBox]}>
            <Ionicons name="close-circle" size={16} color={COLORS.redBright} />
            <Text style={[styles.msgText, { color: COLORS.redBright }]}>{error}</Text>
          </View>
        )}

        {notice && step === 'code' && (
          <View style={[styles.msgBox, styles.successBox]}>
            <Ionicons name="mail" size={16} color={COLORS.greenBright} />
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
          style={styles.linkBtn}
          onPress={() =>
            step === 'email' ? router.replace('/(auth)/login') : setStep('email')
          }
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={14} color={COLORS.textMuted} />
          <Text style={styles.linkText}>
            {step === 'email' ? 'Обратно към входа' : 'Смени имейла'}
          </Text>
        </TouchableOpacity>
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
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
    marginBottom: 24,
  },
  field: { width: '100%', marginBottom: 14 },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 13,
    minHeight: 52,
  },
  input: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 15,
    paddingVertical: 12,
  },
  codeInput: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 6,
  },
  checksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 9 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  checkText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  msgBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
    width: '100%',
  },
  errorBox: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  successBox: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  devBox: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  msgText: { flex: 1, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  primaryBtn: {
    backgroundColor: COLORS.goldBright,
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
});
