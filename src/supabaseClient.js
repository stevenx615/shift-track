import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;

export const syncEnabled = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = syncEnabled
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;
