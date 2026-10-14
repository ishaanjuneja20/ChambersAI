import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type AppUser, getCurrentUser, signInAsDemoUser, signOut as doSignOut, AUTH_CONFIGURED } from "../lib/auth";

interface AuthState {
  user: AppUser | null;
  loading: boolean;
  authConfigured: boolean;
  continueAsDemo: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setUser(await getCurrentUser());
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const continueAsDemo = () => {
    signInAsDemoUser();
    void refresh();
  };

  const signOut = async () => {
    await doSignOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authConfigured: AUTH_CONFIGURED, continueAsDemo, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
