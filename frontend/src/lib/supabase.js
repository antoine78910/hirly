import { createClient } from "@supabase/supabase-js";

/** Project root only — not PostgREST (`/rest/v1`) or Auth API (`/auth/v1`). */
export function normalizeSupabaseProjectUrl(url) {
  if (!url || typeof url !== "string") return "";
  let normalized = url.trim().replace(/\/+$/, "");
  normalized = normalized.replace(/\/rest\/v1\/?$/i, "").replace(/\/auth\/v1\/?$/i, "");
  return normalized;
}

function normalizeSupabaseAnonKey(key) {
  if (!key || typeof key !== "string") return "";
  return key.trim();
}

const rawSupabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseUrl = normalizeSupabaseProjectUrl(rawSupabaseUrl);
const supabaseAnonKey = normalizeSupabaseAnonKey(process.env.REACT_APP_SUPABASE_ANON_KEY);

if (
  typeof process !== "undefined"
  && process.env.NODE_ENV !== "test"
  && rawSupabaseUrl
  && supabaseUrl !== rawSupabaseUrl.trim().replace(/\/+$/, "")
) {
  console.warn(
    "[supabase] REACT_APP_SUPABASE_URL should be the project root (https://<ref>.supabase.co), not /rest/v1.",
  );
}

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        flowType: "pkce",
      },
    })
  : null;
