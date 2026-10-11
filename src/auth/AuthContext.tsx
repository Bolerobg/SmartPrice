import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiError, loadTokens, saveTokens, setUnauthorizedHandler } from '@/src/api/client';
import type { UserProfile } from '@/types';

interface AuthContextValue {
  /** null = още проверяваме запазената сесия */
  isBootstrapping: boolean;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; name: string; city?: string }) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const result = await api.login({ email: email.trim().toLowerCase(), password });
    await saveTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setProfileState(result.profile);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name: string; city?: string }) => {
      setError(null);
      const result = await api.register({
        ...input,
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
      });
      await saveTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      setProfileState(result.profile);
    },
    []
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
      logout,
      setProfile: setProfileState,
      refreshProfile,
      clearError: () => setError(null),
    }),
    [isBootstrapping, profile, error, login, register, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth трябва да се използва вътре в AuthProvider');
  return ctx;
};
