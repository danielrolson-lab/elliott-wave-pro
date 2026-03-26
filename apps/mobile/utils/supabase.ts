/**
 * utils/supabase.ts
 *
 * Supabase client initialised from Expo public env vars.
 * MMKV is used as the auth storage backend so sessions survive app restarts.
 *
 * Required env vars (add to apps/mobile/.env):
 *   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
 */

import { createClient } from '@supabase/supabase-js';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'supabase-auth' });

/** Supabase-compatible storage adapter backed by MMKV. */
const mmkvStorage = {
  getItem: (key: string): string | null => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string): void => mmkv.set(key, value),
  removeItem: (key: string): void => mmkv.delete(key),
};

const SUPABASE_URL      = process.env['EXPO_PUBLIC_SUPABASE_URL']      ?? '';
const SUPABASE_ANON_KEY = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage:            mmkvStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});
