import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';

/**
 * 🔄 Самообновяване на приложението (само web/PWA).
 *
 * Защо: приложението се инсталира като PWA на телефона и държи стария JS пакет
 * в собствения си кеш. Проверено на живо (19.10.2026): поправката на черния
 * списък в „Радар“ беше качена и работеше, но на телефона човекът виждаше
 * старата версия с дни, защото никой не му казваше, че има нов билд.
 *
 * Как: nginx сервира `/version.json` (номер на билда, никога не се кешира —
 * вж. `web/nginx.conf`). При старт запомняме номера, а после при връщане в
 * приложението и на всеки 5 минути го проверяваме пак. Ако е друг — показваме
 * дискретна лента „Налично е обновление“, която презарежда приложението.
 */
export const UpdateNotice: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const bootVersion = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    let alive = true;

    const check = async (first: boolean) => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { v?: string };
        const v = data?.v ?? null;
        if (!v) return;
        if (first || bootVersion.current === null) {
          bootVersion.current = v; // версията, с която сме тръгнали
          return;
        }
        if (v !== bootVersion.current && alive) setAvailable(true);
      } catch {
        // няма връзка — просто не проверяваме този път
      }
    };

    void check(true);
    const timer = setInterval(() => void check(false), 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!available) return null;

  return (
    <TouchableOpacity
      style={styles.wrap}
      activeOpacity={0.9}
      onPress={() => {
        if (typeof window !== 'undefined') window.location.reload();
      }}
    >
      <Ionicons name="refresh" size={16} color={COLORS.bgPrimary} />
      <Text style={styles.text}>Налично е обновление — натисни тук</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 78,
    zIndex: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accentCyan,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: { color: COLORS.bgPrimary, fontSize: 12.5, fontWeight: '900' },
});
