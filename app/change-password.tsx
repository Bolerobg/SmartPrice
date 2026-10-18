import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/src/lib/navigation';
import { COLORS } from '@/constants/theme';
import { api, ApiError } from '@/src/api/client';

/**
 * Смяна на паролата, докато си влязъл.
 *
 * Иска текущата парола (за да не може някой с откраднат телефон да заключи
 * човека навън), проверява новата по същите правила като сървъра и я сменя.
 * Ако човекът не помни старата — долу има линк към „Забравена парола?“.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const checks = [
    { label: 'поне 8 символа', ok: next.length >= 8 },
    { label: 'буква', ok: /[A-Za-zА-Яа-я]/.test(next) },
    { label: 'цифра', ok: /\d/.test(next) },
  ];
  const strong = checks.every((c) => c.ok);
  const matches = next.length > 0 && next === repeat;
  const different = next.length > 0 && next !== current;
  const ready = current.length > 0 && strong && matches && different;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не успях да сменя паролата. Опитай пак.');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    icon: keyof typeof Ionicons.glyphMap,
    placeholder: string,
    autoFocus = false
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, autoFocus && styles.inputRowFocus]}>
        <Ionicons name={icon} size={17} color={COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          autoFocus={autoFocus}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.back} onPress={() => goBack(router)} hitSlop={12}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textPrimary} />
            <Text style={styles.backText}>Назад</Text>
          </TouchableOpacity>

          <View style={styles.iconCircle}>
            <Ionicons
              name={done ? 'checkmark-circle' : 'lock-closed-outline'}
              size={30}
              color={done ? COLORS.greenBright : COLORS.goldBright}
            />
          </View>

          <Text style={styles.title}>{done ? 'Готово!' : 'Смяна на паролата'}</Text>
          <Text style={styles.subtitle}>
            {done
              ? 'Паролата е сменена. Използвай новата при следващо влизане.'
              : 'Въведи текущата си парола и избери нова.'}
          </Text>

          {done ? (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => goBack(router)}
              activeOpacity={0.88}
            >
              <Ionicons name="checkmark" size={18} color={COLORS.black} />
              <Text style={styles.primaryBtnText}>Разбрах</Text>
            </TouchableOpacity>
          ) : (
            <>
              {field('Текуща парола', current, setCurrent, 'lock-open-outline', 'Паролата, с която влизаш сега', true)}
              {field('Нова парола', next, setNext, 'lock-closed-outline', 'Минимум 8 символа')}

              <View style={styles.checksRow}>
                {checks.map((c) => (
                  <View key={c.label} style={styles.checkItem}>
                    <Ionicons
                      name={c.ok ? 'checkmark-circle' : 'ellipse-outline'}
                      size={13}
                      color={c.ok ? COLORS.greenBright : COLORS.textMuted}
                    />
                    <Text style={[styles.checkText, c.ok && { color: COLORS.greenBright }]}>
                      {c.label}
                    </Text>
                  </View>
                ))}
              </View>

              {field('Повтори новата парола', repeat, setRepeat, 'lock-closed-outline', 'Същата парола още веднъж')}

              {repeat.length > 0 && !matches ? (
                <View style={[styles.msgBox, styles.errorBox]}>
                  <Ionicons name="alert-circle-outline" size={16} color={COLORS.redBright} />
                  <Text style={styles.errorText}>Двете нови пароли не са еднакви.</Text>
                </View>
              ) : null}

              {different ? null : (
                <View style={[styles.msgBox, styles.warnBox]}>
                  <Ionicons name="information-circle-outline" size={16} color={COLORS.goldBright} />
                  <Text style={styles.warnText}>Новата парола трябва да е различна от старата.</Text>
                </View>
              )}

              <TouchableOpacity
                onPress={() => setShow((s) => !s)}
                style={styles.showRow}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={show ? 'eye-off-outline' : 'eye-outline'}
                  size={15}
                  color={COLORS.textMuted}
                />
                <Text style={styles.showText}>{show ? 'Скрий паролите' : 'Покажи паролите'}</Text>
              </TouchableOpacity>

              {error ? (
                <View style={[styles.msgBox, styles.errorBox]}>
                  <Ionicons name="alert-circle-outline" size={16} color={COLORS.redBright} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.primaryBtn, (!ready || busy) && styles.primaryBtnDisabled]}
                onPress={() => void submit()}
                disabled={!ready || busy}
                activeOpacity={0.88}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.black} />
                ) : (
                  <>
                    <Ionicons name="key" size={17} color={COLORS.black} />
                    <Text style={styles.primaryBtnText}>Смени паролата</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.forgotRow}
                onPress={() => router.push('/(auth)/forgot-password' as never)}
                activeOpacity={0.7}
              >
                <Ionicons name="help-circle-outline" size={15} color={COLORS.textMuted} />
                <Text style={styles.forgotText}>
                  Не помниш старата? Изпрати код на имейла
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bgPrimary },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
    alignItems: 'center',
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  backText: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '800' },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: COLORS.bgCardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
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
    marginBottom: 22,
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
  inputRowFocus: { borderColor: COLORS.goldBorder },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: 15, paddingVertical: 12 },
  checksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: -4, marginBottom: 14, width: '100%' },
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
    marginBottom: 12,
    width: '100%',
  },
  errorBox: { backgroundColor: COLORS.redSoftBg, borderColor: COLORS.redBorder },
  errorText: { flex: 1, color: COLORS.redBright, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  warnBox: { backgroundColor: COLORS.goldSoftBg, borderColor: COLORS.goldBorder },
  warnText: { flex: 1, color: COLORS.goldBright, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  showText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.greenBright,
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: COLORS.black, fontSize: 15.5, fontWeight: '900' },
  forgotRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18 },
  forgotText: { color: COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
});
