import React, { useState } from 'react';
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
import { Link, useRouter } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { ApiError, API_URL } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.includes('@') && password.length > 0 && !isSubmitting;

  const handleLogin = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Входът не успя. Провери дали API-то работи (${API_URL}).`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoBadge}>
          <Ionicons name="pricetags" size={30} color={COLORS.greenBright} />
        </View>
        <Text style={styles.title}>SmartPrice</Text>
        <Text style={styles.subtitle}>
          Реални цени, честни места и разобличени капани — от общността, за общността.
        </Text>

        <Text style={styles.label}>Имейл</Text>
        <TextInput
          style={styles.input}
          placeholder="ime@example.com"
          placeholderTextColor={COLORS.textMuted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleLogin}
        />

        <Text style={styles.label}>Парола</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="твоята парола"
            placeholderTextColor={COLORS.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={19}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={17} color={COLORS.redBright} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={handleLogin}
          disabled={!canSubmit}
          activeOpacity={0.88}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <>
              <Ionicons name="log-in" size={18} color={COLORS.black} />
              <Text style={styles.submitText}>Влез</Text>
            </>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity style={styles.switchBtn}>
            <Text style={styles.switchText}>
              Нямаш профил? <Text style={styles.switchTextAccent}>Регистрирай се</Text>
            </Text>
          </TouchableOpacity>
        </Link>

        <View style={styles.noteBox}>
          <Ionicons name="information-circle-outline" size={15} color={COLORS.textMuted} />
          <Text style={styles.noteText}>
            Профилите и публикациите се пазят в твоята собствена PostgreSQL база на сървъра.
            Няма външни доставчици на идентичност.
          </Text>
        </View>

        <Text style={styles.apiHint}>Сървър: {API_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 22, paddingTop: 72, paddingBottom: 40 },
  logoBadge: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: COLORS.greenSoftBg,
    borderWidth: 1,
    borderColor: COLORS.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { color: COLORS.textPrimary, fontSize: 29, fontWeight: '900', letterSpacing: 0.3 },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 26,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 12,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: COLORS.textPrimary,
    fontSize: 14.5,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, paddingRight: 44 },
  eyeBtn: { position: 'absolute', right: 13, padding: 2 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.redSoftBg,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    borderRadius: 12,
    padding: 11,
    marginTop: 16,
  },
  errorText: { flex: 1, color: COLORS.redBright, fontSize: 12.5, fontWeight: '700' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 22,
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitText: { color: COLORS.black, fontSize: 15, fontWeight: '900' },
  switchBtn: { alignItems: 'center', marginTop: 18, padding: 8 },
  switchText: { color: COLORS.textSecondary, fontSize: 13.5, fontWeight: '600' },
  switchTextAccent: { color: COLORS.greenBright, fontWeight: '900' },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    padding: 11,
    marginTop: 26,
  },
  noteText: { flex: 1, color: COLORS.textMuted, fontSize: 11.5, lineHeight: 17 },
  apiHint: { color: COLORS.textMuted, fontSize: 10.5, textAlign: 'center', marginTop: 18 },
});
