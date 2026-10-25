// One Supabase client for the dashboard. The URL and the PUBLISHABLE key are public by design (RLS and EXECUTE
// grants protect the data — DECISIONS.md 2026-10-25); they come from the build environment, never from the repo.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing');

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export const SUPABASE_URL = url;
export const PUBLISHABLE_KEY = key;
