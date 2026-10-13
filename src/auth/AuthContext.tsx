import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  api,
  ApiError,
  loadTokens,
  saveTokens,
  setUnauthorizedHandler,
  type RegisterResponse,
} from '@/src/api/client';
import type { UserProfile } from '@/types';

interface AuthContextValue {
  /** true = още проверяваме запазената сесия */
  isBootstrapping: boolean;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  /**
   * Регистрация. НЕ влиза в профила — връща отговора, за да заведе
   * потребителя на екрана с кода от имейла.
   */
  register: (input: {
    email: string;
    password: string;
    name: string;
    city?: string;
    /** Код за покана от приятел (по избор) — носи точки и на двамата. */
    ref?: string;
    refChannel?: string;
  }) => Promise<RegisterResponse>;
  /** Потвърждава имейла с кода и влиза директно. */
  verifyEmail: (email: string, code: string) => Promise<void>;
  /** Иска нов код. */
  resendCode: (
    email: string,
    purpose: 'email_verify' | 'password_reset'
  ) => Promise<{ message: string; alreadyVerified: boolean; devCode?: string }>;
  /** Заявка за код за нова парола. */
  forgotPassword: (email: string) => Promise<{ message: string; devCode?: string }>;
  /** Задава нова парола с кода и влиза директно. */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  setProfile: (profile: UserProfile) => void;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Възстановяване на сесията при стартиране на приложението
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const tokens = await loadTokens();
      if (!tokens) {
        if (!cancelled) setIsBootstrapping(false);
        return;
      }
      try {
        const { profile: fresh } = await api.me();
        if (!cancelled) setProfileState(fresh);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await saveTokens(null);
        }
        // при мрежова грешка оставяме токените — може да е временно
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Когато API-то върне 401 след неуспешен refresh → изхвърляме потребителя
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setProfileState(null);
      setError('Сесията е изтекла. Влез отново.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const adoptSession = useCallback(
    async (result: { accessToken: string; refreshToken: string; profile: UserProfile }) => {
      await saveTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      setProfileState(result.profile);
    },
    []
  );

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const result = await api.login({ email: email.trim().toLowerCase(), password });
      await adoptSession(result);
    },
    [adoptSession]
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      name: string;
      city?: string;
      /** Код за покана от приятел (по избор). */
      ref?: string;
      refChannel?: string;
    }) => {
      setError(null);
      const result = await api.register({
        ...input,
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        ref: input.ref?.trim() || undefined,
      });
      // Тук НЕ влизаме — профилът още не е потвърден.
      return result;
    },
    []
  );

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      setError(null);
      const result = await api.verifyEmail({ email: email.trim().toLowerCase(), code });
      await adoptSession(result);
    },
    [adoptSession]
  );

  const resendCode = useCallback(
    async (email: string, purpose: 'email_verify' | 'password_reset') => {
      const result = await api.resendCode({ email: email.trim().toLowerCase(), purpose });
      return {
        message: result.message,
        alreadyVerified: Boolean(result.alreadyVerified),
        devCode: result.devCode,
      };
    },
    []
  );

  const forgotPassword = useCallback(async (email: string) => {
    const result = await api.forgotPassword({ email: email.trim().toLowerCase() });
    return { message: result.message, devCode: result.devCode };
  }, []);

  const resetPassword = useCallback(
    async (email: string, code: string, newPassword: string) => {
      setError(null);
      const result = await api.resetPassword({
        email: email.trim().toLowerCase(),
        code,
        newPassword,
      });
      await adoptSession(result);
    },
    [adoptSession]
  );

  const logout = useCallback(async () => {
    await saveTokens(null);
    setProfileState(null);
    setError(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { profile: fresh } = await api.me();
    setProfileState(fresh);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isBootstrapping,
      profile,
      isAuthenticated: Boolean(profile),
      error,
      login,
      register,
      verifyEmail,
      resendCode,
      forgotPassword,
      resetPassword,
      logout,
      setProfile: setProfileState,
      refreshProfile,
      clearError: () => setError(null),
    }),
    [
      isBootstrapping,
      profile,
      error,
      login,
      register,
      verifyEmail,
      resendCode,
      forgotPassword,
      resetPassword,
      logout,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth трябва да се използва вътре в AuthProvider');
  return ctx;
};
