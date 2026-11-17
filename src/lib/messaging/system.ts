import "server-only";
import { isDemoMode } from "@/lib/demo/config";

// Calls the messaging functions that only the platform itself may run (claim the queue, record a result, a delivery receipt, an inbound message).
// In the demo they run on the local database as its owner; in production they run with the Supabase service role key, which never reaches a browser.
export async function systemRpc<T = unknown>(fn: string, args: Record<string, string | number | boolean | null>): Promise<T> {
  if (!/^[a-z_]+$/.test(fn)) throw new Error("Bad function name");
  if (isDemoMode()) {
    const { demoDb } = await import("@/lib/demo/db");
    const db = await demoDb();
    const keys = Object.keys(args);
    const named = keys.map((k, i) => `p_${k} => $${i + 1}`).join(", ");
    const r = await db.query<{ r: T }>(`select public.${fn}(${named}) as r`, keys.map((k) => args[k]));
    return r.rows[0]?.r as T;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc(fn, Object.fromEntries(Object.entries(args).map(([k, v]) => [`p_${k}`, v])));
  if (error) throw new Error(error.message);
  return data as T;
}
