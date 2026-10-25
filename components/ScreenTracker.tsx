import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { isStandalone, track } from '@/src/lib/funnel';

/**
 * 👥 КОЙ КЪДЕ ОТВАРЯ — за статистиката в админ панела.
 *
 * Праща името на екрана към сървъра при всяко отваряне. Не показва нищо и не
 * пречи: праща се „на заден план“, а при грешка мълчи. Влиза само за влезли
 * хора (за гости няма какво да броим).
 *
 * Отбив: същият екран в рамките на минута не се праща пак — иначе превключване
 * на табове ще надуе статистиката с хиляди еднакви записа.
 */
export const ScreenTracker = () => {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const last = useRef<{ screen: string; at: number } | null>(null);
  const started = useRef(false);

  // 📈 Пътят на потребителя — БЕЗ вход. Гостът също се брои: „дойде“,
  // „сложи иконата на телефона“, „отвори първата оферта“ и „влезе“.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void track('visit');
    if (isStandalone()) void track('install');
  }, []);

  useEffect(() => {
    if (isAuthenticated) void track('signup');
  }, [isAuthenticated]);

  useEffect(() => {
    if (pathname && pathname.startsWith('/post/')) void track('first_view');
  }, [pathname]);

  // 👥 Кой къде отваря — само за влезли (екран по екран, със отбив от минута).
  useEffect(() => {
    if (!isAuthenticated || !pathname) return;
    const now = Date.now();
    if (last.current && last.current.screen === pathname && now - last.current.at < 60_000) return;
    last.current = { screen: pathname, at: now };
    const platform = Platform.OS === 'web' ? 'web' : Platform.OS;
    void api.activity(pathname, platform).catch(() => undefined);
  }, [pathname, isAuthenticated]);

  return null;
};

export default ScreenTracker;
