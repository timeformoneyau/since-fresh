import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * Supabase client, created lazily.
 *
 * Credentials live in app.json → extra (matching how the expiry proxy is
 * configured), not in a committed source file. When they are absent the app
 * runs fully local-only: isCloudSyncConfigured() returns false, the auth gate
 * is skipped, and the sync engine no-ops. Nothing here throws on a missing
 * config — local-first means the cloud is always optional.
 */

function getConfig(): { url: string; anonKey: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return {
    url: typeof extra.supabaseUrl === 'string' ? extra.supabaseUrl : '',
    anonKey: typeof extra.supabaseAnonKey === 'string' ? extra.supabaseAnonKey : '',
  };
}

export function isCloudSyncConfigured(): boolean {
  const { url, anonKey } = getConfig();
  return url.length > 0 && anonKey.length > 0;
}

let client: SupabaseClient | null = null;

/** Returns the client, or null when credentials are not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isCloudSyncConfigured()) return null;
  if (client) return client;

  const { url, anonKey } = getConfig();
  client = createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** Use where a client is required and the caller has already checked config. */
export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error('Cloud sync is not configured.');
  return c;
}
