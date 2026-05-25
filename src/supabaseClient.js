import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;

export const syncEnabled = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = syncEnabled
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
