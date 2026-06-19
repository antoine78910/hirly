import { createClient } from "@supabase/supabase-js";

const normalizeSupabaseUrl = (value) => {
  const url = (value || "").trim().replace(/\/+$/, "");
  return url.replace(/\/rest\/v1$/i, "").replace(/\/auth\/v1$/i, "");
};

const supabaseUrl = normalizeSupabaseUrl(process.env.REACT_APP_SUPABASE_URL);
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
