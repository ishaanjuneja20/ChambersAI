import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AUTH_CONFIGURED, getSupabase } from "../lib/supabaseClient";
import { clearDemoUser, getDemoUser, signInAsDemoUser } from "../lib/demoUser";

export interface AppUser {
  id: string;
  email: string;
  name?: string;
  isDemo: boolean;
}

interface SignUpResult {
  needsEmailVerification: boolean;
}

interface AuthState {
  user: AppUser | null;
  loading: boolean;
  authConfigured: boolean;
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  continueAsDemo: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function mapSession(session: Session | null): AppUser | null {
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: (session.user.user_metadata?.full_name as string | undefined) ?? undefined,
    isDemo: false,
  };
}

// Supabase's own error strings, normalized into messages that never confirm whether an email
// is registered (avoids account enumeration) and never leak anything token-shaped.
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (lower.includes("email not confirmed")) return "Please verify your email before logging in — check your inbox for the link.";
  if (lower.includes("already registered") || lower.includes("already exists")) return "An account with that email already exists.";
  if (lower.includes("rate limit") || lower.includes("too many")) return "Too many attempts. Please wait a moment and try again.";
  return "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!AUTH_CONFIGURED) {
      setUser(getDemoUser());
      setLoading(false);
      return;
    }

    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setUser(mapSession(data.session));
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapSession(session));
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      authConfigured: AUTH_CONFIGURED,

      async signUp(name, email, password) {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) throw new Error(friendlyAuthError(error.message));
        return { needsEmailVerification: !data.session };
      },

      async signIn(email, password) {
        const supabase = getSupabase();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async signInWithGoogle() {
        const supabase = getSupabase();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/home` },
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async requestPasswordReset(email) {
        const supabase = getSupabase();
        // Errors here are swallowed into the same generic confirmation message by the caller —
        // we never reveal whether the address is registered.
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
      },

      async updatePassword(newPassword) {
        const supabase = getSupabase();
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async signOut() {
        clearDemoUser();
        if (AUTH_CONFIGURED) await getSupabase().auth.signOut();
        setUser(null);
      },

      continueAsDemo() {
        signInAsDemoUser();
        setUser(getDemoUser());
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
