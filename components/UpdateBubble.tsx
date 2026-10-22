import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS } from '@/constants/theme';

/**
 * 🫧 „Има нова версия на сайта“ — балонче с бутон „Обнови“.
 *
 * Защо е нужно: приложение, добавено на началния екран (PWA), НЕ се обновява
 * само. То държи стария bundle (service worker) и човек вижда стари екрани и
 * стари бъгове, без никакъв знак, че има нова версия. Затова тук сравняваме
 * името на заредения `entry-<хеш>.js` с това, което сървърът дава СЕГА, и ако
 * се различават — показваме балонче „Обнови“.
 *
 * Проверката е лека: тегли само index.html (няколко KB, no-store) на всеки
 * 60 секунди и при връщане към таба. Нищо не се праща към сървъра.
 */
const CHECK_EVERY_MS = 60_000;
const DISMISS_KEY = '@smartprice_update_dismissed_v1';

function currentEntryName(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('script[src*="/_expo/static/js/web/entry-"]') as
    | HTMLScriptElement
    | null;
  if (!el || !el.src) return null;
  const m = String(el.src).match(/entry-[a-f0-9]+\.js/i);
  return m ? m[0] : null;
}

export function UpdateBubble() {
  const [visible, setVisible] = useState(false);
  const [nextEntry, setNextEntry] = useState<string | null>(null);
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const mine = currentEntryName();
      if (!mine) return;
      const res = await fetch(`/index.html?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/entry-[a-f0-9]+\.js/i);
      if (!m) return;
      if (m[0] !== mine) {
        // Ако човекът вече е натиснал „По-късно“ за ТОЗИ конкретен хеш — не досаждаме.
        const dismissed = await AsyncStorage.getItem(DISMISS_KEY).catch(() => null);
        if (dismissed === m[0]) return;
        setNextEntry(m[0]);
        setVisible(true);
      }
    } catch {
      /* няма мрежа — просто ще опитаме пак след минута */
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!visible) return null;

  const reload = () => {
    try {
      // Нов bundle → нов index.html, без стария от кеша.
      window.location.reload();
    } catch {
      /* нищо */
    }
  };

  const later = async () => {
    setVisible(false);
    if (nextEntry) await AsyncStorage.setItem(DISMISS_KEY, nextEntry).catch(() => {});
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bubble}>
        <Ionicons name="cloud-download-outline" size={18} color={COLORS.goldBright} />
        <Text style={styles.text}>Има нова версия</Text>
        <Pressable onPress={reload} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>Обнови</Text>
        </Pressable>
        <Pressable onPress={() => void later()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={16} color={COLORS.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 78,
    alignItems: 'center',
    zIndex: 9999,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.97)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  btn: {
    backgroundColor: COLORS.goldPrimary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  btnText: {
    color: '#1F2937',
    fontSize: 12.5,
    fontWeight: '900',
  },
  close: {
    padding: 4,
  },
});
