import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/src/auth/AuthContext';
import {
  disablePush,
  enablePush,
  pushStatus,
  pushSupported,
  sendTestPush,
} from '@/lib/pushClient';

/**
 * 🔔 Известия в браузъра (Web Push) — включване/изключване и тест.
 * Показва се само на web (в мобилното приложение нативното push е отделна настройка).
 */
export function PushNotificationsCard() {
  const { isAuthenticated } = useAuth();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'unsupported'>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    pushStatus()
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => {
        if (alive) setState('unsupported');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!pushSupported() || state === 'unsupported' || !isAuthenticated) return null;

  const toggle = async () => {
    setBusy(true);
    setNote('');
    const res = state === 'on' ? await disablePush() : await enablePush();
    setNote(res.message);
    setState(await pushStatus());
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const res = await sendTestPush();
    setNote(res.message);
    setBusy(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>🔔 Известия при по-ниска цена</Text>
        <View style={[styles.pill, state === 'on' ? styles.pillOn : styles.pillOff]}>
          <Text style={styles.pillText}>{state === 'on' ? 'включени' : 'изключени'}</Text>
        </View>
      </View>
      <Text style={styles.hint}>
        Когато цена падне под твоята граница, ще получиш известие в браузъра/телефона — без да чакаш имейл.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, state === 'on' ? styles.btnGhost : styles.btnOk]} onPress={toggle} disabled={busy}>
          {busy ? <ActivityIndicator color={COLORS.textPrimary} /> : (
            <Text style={styles.btnText}>{state === 'on' ? 'Изключи известията' : 'Включи известията'}</Text>
          )}
        </TouchableOpacity>
        {state === 'on' ? (
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={test} disabled={busy}>
            <Text style={styles.btnText}>Пробвай сега</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // ВАЖНО: картата е пълноширока и стои в колона (не в редица с бутони).
  // Ако попадне в `flexDirection: 'row'` (напр. monetizationActions), в React Native Web
  // ширината става по СЪДЪРЖАНИЕ и картата излиза извън екрана (flexShrink по подразбиране е 0).
  card: {
    backgroundColor: COLORS.bgCardElevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    padding: 14,
    marginTop: 9,
    marginBottom: 9,
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 0,
  },
  title: { color: COLORS.textPrimary, fontSize: 15.5, fontWeight: '800', flex: 1, flexShrink: 1, minWidth: 0 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, flexShrink: 0 },
  pillOn: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  pillOff: { backgroundColor: COLORS.bgCard, borderColor: COLORS.borderSubtle },
  pillText: { color: COLORS.textPrimary, fontSize: 11.5, fontWeight: '700' },
  hint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '45%',
    minWidth: 0,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnOk: { backgroundColor: COLORS.greenSoftBg, borderColor: COLORS.greenBorder },
  btnGhost: { backgroundColor: COLORS.bgSecondary, borderColor: COLORS.borderStrong },
  btnText: { color: COLORS.textPrimary, fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  note: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 8, flexShrink: 1 },
});
