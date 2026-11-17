import "server-only";
import { systemRpc } from "@/lib/messaging/system";
import { isDemoMode } from "@/lib/demo/config";
import { readFileText } from "./engines";

type Claimed = { id: string; file_id: string | null; file_name: string | null; content_type: string | null; storage_path: string | null; attempts: number };

async function fetchBytes(c: Claimed): Promise<Buffer | null> {
  if (c.storage_path && !isDemoMode()) {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data } = await sb.storage.from("files").download(c.storage_path);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }
  const b64 = await systemRpc<string | null>("docchecks_file", { id: c.id });
  return b64 ? Buffer.from(b64, "base64") : null;
}

/** Read and check everything that is waiting. Safe to call often: each item is claimed once, and failures retry up to three times. */
export async function runDocumentChecks(limit = 5): Promise<{ checked: number }> {
  const items = (await systemRpc<Claimed[]>("docchecks_claim", { limit })) ?? [];
  let checked = 0;
  for (const c of items) {
    try {
      const bytes = await fetchBytes(c);
      if (!bytes) { await systemRpc("docchecks_result", { id: c.id, ok: false, engine: null, text: null, error: "The file could not be found.", permanent: true }); continue; }
      const r = await readFileText({ bytes, contentType: c.content_type ?? "", fileName: c.file_name ?? "" });
      if (r.ok) await systemRpc("docchecks_result", { id: c.id, ok: true, engine: r.engine, text: r.text, error: null, permanent: false });
      else await systemRpc("docchecks_result", { id: c.id, ok: false, engine: r.engine, text: null, error: r.error, permanent: r.permanent });
      checked++;
    } catch (e) {
      await systemRpc("docchecks_result", { id: c.id, ok: false, engine: null, text: null, error: e instanceof Error ? e.message : "Check failed", permanent: false }).catch(() => {});
    }
  }
  return { checked };
}
