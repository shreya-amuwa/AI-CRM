import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'amuwa_supabase_url';
const STORAGE_ANON_KEY = 'amuwa_supabase_anon_key';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConfigured: boolean;
  source: 'env' | 'custom' | 'none';
}

export const DEFAULT_SUPABASE_URL = 'https://sawufdziibpsmpxyerqe.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhd3VmZHppaWJwc21weHllcnFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjcxMzcsImV4cCI6MjEwNTkwMzEzN30.O1fWCRVd6C5jvzPco61wOL2Z6oAMXXFXB9H1ylT9L4g';

export function getSupabaseConfig(): SupabaseConfig {
  const storedUrl = (localStorage.getItem(STORAGE_URL_KEY) || '').trim();
  const storedKey = (localStorage.getItem(STORAGE_ANON_KEY) || '').trim();

  if (storedUrl && storedKey) {
    return {
      url: storedUrl,
      anonKey: storedKey,
      isConfigured: true,
      source: 'custom'
    };
  }

  const metaEnv = (import.meta as any)?.env || {};
  const envUrl = (metaEnv.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const envKey = (metaEnv.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY).trim();

  if (envUrl && envKey) {
    return {
      url: envUrl,
      anonKey: envKey,
      isConfigured: true,
      source: 'env'
    };
  }

  return {
    url: DEFAULT_SUPABASE_URL,
    anonKey: DEFAULT_SUPABASE_KEY,
    isConfigured: true,
    source: 'env'
  };
}

let clientInstance: SupabaseClient | null = null;
const listeners = new Set<(config: SupabaseConfig) => void>();

function initClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (config.isConfigured && config.url && config.anonKey) {
    try {
      clientInstance = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        },
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });
      return clientInstance;
    } catch (err) {
      console.error('[Supabase] Failed to initialize client:', err);
      clientInstance = null;
      return null;
    }
  }
  clientInstance = null;
  return null;
}

export function getSupabase(): SupabaseClient | null {
  if (!clientInstance) {
    initClient();
  }
  return clientInstance;
}

export function setSupabaseConfig(url: string, anonKey: string): boolean {
  try {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    const cleanKey = anonKey.trim();
    localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
    localStorage.setItem(STORAGE_ANON_KEY, cleanKey);
    initClient();
    const config = getSupabaseConfig();
    listeners.forEach(fn => fn(config));
    return true;
  } catch (err) {
    console.error('[Supabase] Failed to set config:', err);
    return false;
  }
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
  clientInstance = null;
  const config = getSupabaseConfig();
  listeners.forEach(fn => fn(config));
}

export function subscribeToSupabaseConfig(listener: (config: SupabaseConfig) => void): () => void {
  listeners.add(listener);
  listener(getSupabaseConfig());
  return () => {
    listeners.delete(listener);
  };
}

export async function testSupabaseConnection(overrideUrl?: string, overrideKey?: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = getSupabaseConfig();
    const testUrl = (overrideUrl || config.url).trim().replace(/\/+$/, '');
    const testKey = (overrideKey || config.anonKey).trim();

    if (!testUrl || !testKey) {
      return { success: false, message: 'Project URL and Anon API Key are required.' };
    }

    const testClient = createClient(testUrl, testKey);
    // Ping by checking table
    const { error } = await testClient.from('crm_leads').select('id').limit(1);

    if (error) {
      // If table does not exist yet, but connection was authenticated
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return {
          success: true,
          message: 'Connected & Authenticated with Supabase Cloud! Please run the SQL schema in your Supabase SQL Editor to finish setting up the tables.'
        };
      }
      return { success: false, message: `Supabase Error: ${error.message}` };
    }

    return { success: true, message: 'Connected to Supabase Cloud! Realtime database is active.' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error reaching Supabase.' };
  }
}
