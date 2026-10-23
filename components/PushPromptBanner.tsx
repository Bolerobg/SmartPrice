import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { useAuth } from '@/src/auth/AuthContext';
import { enablePush, pushStatus, pushSupported } from '@/lib/pushClient';
import { pushPromptNever, pushPromptTick } from '@/src/api/client';

/**
 * 🔔 Умна покана „включи известията“ — СЛЕД първа полза.
 *
 * Защо съществува: известията работеха, но абонати бяха 0. Проблемът не беше в
 * техниката, а в момента на питане — картата стоеше в „Профил“ и никой не я
 * виждаше, а питане още при регистрация дразни.
 *
 * Правилата (по искане на собственика: да не досажда):
 *   • питаме чак когато човекът е показал, че ползва приложението (сървърът брои);
 *   • не питаме повече от веднъж на 14 дни (сървърът пази кога е показвана);
 *   • не питаме, ако вече е абониран или е казал „не ми показвай“;
 *   • има „По-късно“ и „Не, благодаря“ — и двете се уважават.
 *
 * Самата покана обяснява КАКВО ще получава („находките в твоя град, веднъж
 * седмично“), а не просто „искаш ли известия“.
 */
export function PushPromptBanner() {
  const { isAuthenticated } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    if (!isAuthenticated || !pushSupported()) return;

    void (async () => {
      // Ако вече са включени — няма какво да питаме.
      if ((await pushStatus().catch(() => 'off')) !== 'off') return;
      const res = await pushPromptTick();
      if (!alive) return;
      if (res.shouldPrompt) setShow(true);
    })();

    return () => {
      alive = false;
    };
  }, [isAuthenticated]);

  if (!show) return null;

  const turnOn = async () => {
    setBusy(true);
    setNote('');
    const res = await enablePush();
    setBusy(false);
    if (res.ok) {
      setNote('✅ Готово! Ще ти пишем, когато има нови находки за твоя град.');
      setTimeout(() => setShow(false), 2600);
    } else {
      setNote(res.message);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="notifications" size={18} color={COLORS.accentCyan} />
        <Text style={styles.title}>Да ти пращаме ли находките за твоя град?</Text>
      </View>

      <Text style={styles.text}>
        Веднъж седмично, само най-доброто. Без реклами и без спам — изключваш го с едно
        натискане, когато поискаш.
      </Text>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btnOk, busy && { opacity: 0.6 }]}
          activeOpacity={0.85}
          disabled={busy}
          onPress={turnOn}
        >
          {busy ? (
            <ActivityIndicator size="small" color={COLORS.onPrimary} />
          ) : (
            <Ionicons name="notifications-outline" size={15} color={COLORS.onPrimary} />
          )}
          <Text style={styles.btnOkText}>Включи известията</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnGhost} onPress={() => setShow(false)}>
          <Text style={styles.btnGhostText}>По-късно</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnGhost}
          onPress={() => {
            void pushPromptNever();
            setShow(false);
          }}
        >
          <Text style={styles.btnGhostText}>Не, благодаря</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.accentCyanBorder ?? COLORS.borderSubtle,
    borderRadius: 16,
    padding: 13,
    marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: '900' },
  text: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 7 },
  note: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 9 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 11, flexWrap: 'wrap' },
  btnOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  btnOkText: { color: COLORS.onPrimary, fontSize: 12.5, fontWeight: '900' },
  btnGhost: {
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnGhostText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '800' },
});
