import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AppUser {
  id: string;
  email: string;
  isDemo: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!AUTH_CONFIGURED) throw new Error("Supabase is not configured; use the demo user instead.");
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

const DEMO_USER_KEY = "chambersai.demoUser";
const FAKE_USER: AppUser = { id: "demo-user", email: "demo@chambersai.local", isDemo: true };

export function getDemoUser(): AppUser | null {
  try {
    return sessionStorage.getItem(DEMO_USER_KEY) ? FAKE_USER : null;
  } catch {
    return null;
  }
}

export function signInAsDemoUser() {
  try {
    sessionStorage.setItem(DEMO_USER_KEY, "1");
  } catch {
    /* ignore: private browsing or blocked storage, session just won't persist across reload */
  }
}

export async function signOut() {
  try {
    sessionStorage.removeItem(DEMO_USER_KEY);
  } catch {
    /* ignore */
  }
  if (AUTH_CONFIGURED) {
    try {
      await getSupabase().auth.signOut();
    } catch {
      /* ignore */
    }
  }
}

export async function getCurrentUser(): Promise<AppUser | null> {
  if (!AUTH_CONFIGURED) return getDemoUser();
  const { data } = await getSupabase().auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "", isDemo: false };
}

export async function getAccessToken(): Promise<string | null> {
  if (!AUTH_CONFIGURED) return null;
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithEmail(email: string, password: string) {
  return getSupabase().auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return getSupabase().auth.signUp({ email, password });
}

export async function signInWithGoogle() {
  return getSupabase().auth.signInWithOAuth({ provider: "google" });
}
