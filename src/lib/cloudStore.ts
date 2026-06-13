import { supabase } from './supabase';

/**
 * Cloud persistence layer for the app's key/value state.
 *
 * The app keeps using LocalStorage synchronously as a fast local cache; this
 * module mirrors that cache to a single Supabase table (`app_state`) so data
 * survives across devices and browser clears. Cloud is treated as the source
 * of truth on load; LocalStorage is the working copy during a session.
 *
 * Table shape (run src/schema.sql -> app_state section in the Supabase SQL editor):
 *   key text primary key, value jsonb not null, updated_at timestamptz
 */

// Pull every persisted key/value pair from the cloud.
export async function loadAllCloudState(): Promise<Record<string, any>> {
  const { data, error } = await supabase.from('app_state').select('key, value');
  if (error) throw error;
  const out: Record<string, any> = {};
  for (const row of data || []) {
    out[(row as any).key] = (row as any).value;
  }
  return out;
}

// Upsert a single key/value pair. Safe to call fire-and-forget.
export async function saveCloudState(key: string, value: any): Promise<void> {
  const { error } = await supabase
    .from('app_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
