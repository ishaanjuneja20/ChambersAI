// Fake logged-in user used only when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are empty, so the
// app still runs end to end without a real backend. Nothing here touches Supabase.
const DEMO_KEY = "chambersai.demoUser";

export interface DemoUser {
  id: "demo-user";
  email: "demo@chambersai.local";
  name: "Sample User";
  isDemo: true;
}

const DEMO_USER: DemoUser = { id: "demo-user", email: "demo@chambersai.local", name: "Sample User", isDemo: true };

export function getDemoUser(): DemoUser | null {
  try {
    return sessionStorage.getItem(DEMO_KEY) === "1" ? DEMO_USER : null;
  } catch {
    return null;
  }
}

export function signInAsDemoUser() {
  try {
    sessionStorage.setItem(DEMO_KEY, "1");
  } catch {
    /* ignore: private browsing or blocked storage, session just won't persist across reload */
  }
}

export function clearDemoUser() {
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}
