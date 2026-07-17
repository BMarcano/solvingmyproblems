import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Fail loudly in the console instead of throwing at module load, which would
  // white-screen the app. Without these the app still renders and reads still
  // work while the server-side gate is off (GATING_ENABLED unset).
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — auth, credits and the paywall are disabled. " +
      "Set them in .env.local locally, or in the Vercel dashboard for a deploy."
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
