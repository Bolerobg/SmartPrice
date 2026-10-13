import React, { useEffect, useState } from 'react';
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
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { CityPickerDropdown } from '@/components/CityPickerDropdown';
import { COLORS } from '@/constants/theme';
import { ApiError, API_URL, api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  // Ако човекът е дошъл по линк с код за покана (?ref=ABC123), попълваме го сам.
  const params = useLocalSearchParams<{ ref?: string }>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('София');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // --- Поканален цикъл: код от приятел ---
  const [refCode, setRefCode] = useState(
    typeof params.ref === 'string' ? params.ref.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : ''
  );
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [refState, setRefState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

  useEffect(() => {
    const code = refCode.trim();
    if (code.length < 4) {
      setRefState('idle');
      setInviterName(null);
      return;
    }
    let alive = true;
    setRefState('checking');
    const timer = setTimeout(() => {
      api
        .checkReferralCode(code)
        .then((res) => {
          if (!alive) return;
          setRefState(res.valid ? 'valid' : 'invalid');
          setInviterName(res.valid ? (res.inviterName ?? null) : null);
        })
        .catch(() => {
          if (alive) setRefState('invalid');
        });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refCode]);

  const passwordIssue =
    password.length === 0
      ? null
      : password.length < 8
        ? 'Поне 8 символа'
        : !/[A-Za-zА-Яа-я]/.test(password) || !/[0-9]/.test(password)
          ? 'Поне една буква и една цифра'
          : null;

  const canSubmit =
    name.trim().length >= 2 &&
    email.includes('@') &&
    password.length >= 8 &&
    !passwordIssue &&
    !isSubmitting;

  const handleRegister = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await register({
        email,
        password,
        name,
        city,
        ref: refCode.trim() || undefined,
        refChannel: params.ref ? 'invite-link' : undefined,
      });
      // Профилът още не е потвърден → завеждаме потребителя на екрана с кода.
      router.replace({
        pathname: '/(auth)/verify',
        params: {
          email: result.email,
          bonus: result.referralApplied ? (result.referralInviterName ?? '') : undefined,
        },
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Регистрацията не успя. Провери дали API-то работи (${API_URL}).`
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
        <Text style={styles.title}>Създай профил</Text>
        <Text style={styles.slogan}>Помагаме си взаимно. Безплатно.</Text>
        <Text style={styles.subtitle}>
          Публикувай реални цени, сканирай касови бележки и предпази другите от капани.
        </Text>

        {/* Ако още не е гледал презентацията — тук е последният шанс преди формата */}
        <TouchableOpacity
          style={styles.tourBtn}
          onPress={() => router.push('/tour?review=1&cta=register')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Виж как работи приложението"
        >
          <Ionicons name="play-circle" size={19} color={COLORS.accentCyan} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tourBtnText}>Още не знаеш как работи?</Text>
            <Text style={styles.tourBtnSub}>Виж 10 екрана с примери — 30 секунди</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>

        <Text style={styles.label}>Име</Text>
        <TextInput
          style={styles.input}
          placeholder="напр. Иван Петров"
          placeholderTextColor={COLORS.textMuted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

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
        />

        <Text style={styles.label}>Парола</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="поне 8 символа, буква и цифра"
            placeholderTextColor={COLORS.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
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
        {passwordIssue && <Text style={styles.hintWarn}>{passwordIssue}</Text>}

        <Text style={styles.label}>Град</Text>
        <CityPickerDropdown
          selectedCity={city}
          onSelectCity={setCity}
          includeAllOption={false}
          label="Твоят град"
        />

        {/* Код от приятел — по избор. И двамата получавате по 100 точки. */}
        <Text style={styles.label}>Код от приятел (по избор)</Text>
        <TextInput
          style={[
            styles.input,
            refState === 'valid' && { borderColor: COLORS.greenBright },
            refState === 'invalid' && { borderColor: COLORS.goldBright },
          ]}
          placeholder="напр. A1B2C3"
          placeholderTextColor={COLORS.textMuted}
          value={refCode}
          onChangeText={(text) => setRefCode(text.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
        />
        {refState === 'checking' ? (
          <Text style={styles.refHint}>Проверявам кода…</Text>
        ) : refState === 'valid' && inviterName ? (
          <Text style={styles.refOk}>
            ✓ {inviterName} те кани. Щом потвърдиш имейла си, и двамата получавате по 100 точки.
          </Text>
        ) : refState === 'invalid' ? (
          <Text style={styles.refBad}>Няма такъв код — можеш да продължиш и без него.</Text>
        ) : (
          <Text style={styles.refHint}>Имаш ли код от приятел? Въведи го и двамата печелите точки.</Text>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={17} color={COLORS.redBright} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={handleRegister}
          disabled={!canSubmit}
          activeOpacity={0.88}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <>
              <Ionicons name="person-add" size={18} color={COLORS.black} />
              <Text style={styles.submitText}>Създай профил</Text>
            </>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.switchBtn}>
            <Text style={styles.switchText}>
              Вече имаш профил? <Text style={styles.switchTextAccent}>Влез</Text>
            </Text>
          </TouchableOpacity>
        </Link>

        <Text style={styles.apiHint}>Сървър: {API_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgPrimary },
  scroll: { padding: 22, paddingTop: 60, paddingBottom: 40 },
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
  title: { color: COLORS.textPrimary, fontSize: 27, fontWeight: '900', letterSpacing: 0.3 },
  slogan: {
    color: COLORS.accentCyan,
    fontSize: 15.5,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 8,
  },
  tourBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.5)',
    backgroundColor: 'rgba(6,182,212,0.10)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  tourBtnText: { color: COLORS.accentCyan, fontSize: 13.5, fontWeight: '900' },
  tourBtnSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 22,
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
  refHint: { color: COLORS.textMuted, fontSize: 11.5, marginTop: 6, fontWeight: '700' },
  refOk: { color: COLORS.greenBright, fontSize: 11.5, marginTop: 6, fontWeight: '800', lineHeight: 16 },
  refBad: { color: COLORS.goldBright, fontSize: 11.5, marginTop: 6, fontWeight: '800', lineHeight: 16 },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, paddingRight: 44 },
  eyeBtn: { position: 'absolute', right: 13, padding: 2 },
  hintWarn: { color: COLORS.goldBright, fontSize: 11.5, marginTop: 6, fontWeight: '700' },
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
  apiHint: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 22,
  },
});
