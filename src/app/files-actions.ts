"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";

export type UploadResult = { ok: boolean; message: string; id?: string };

const MAX = 15 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpe?g|webp|gif|heic)|application\/pdf|text\/csv|application\/vnd\.(openxmlformats-officedocument\.(spreadsheetml|wordprocessingml|presentationml)\.[a-z.]+|ms-excel)|application\/msword)$/;

/**
 * Upload a file and attach it to a record. Production: Supabase Storage bucket "files" + a files row.
 * Demo: bytes are kept in the database. Access is enforced by file_register (vendors can only attach to their own company).
 */
export async function uploadFile(fd: FormData): Promise<UploadResult> {
  const me = await getProfile();
  if (!me) return { ok: false, message: "Sign in to upload." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file." };
  if (file.size > MAX) return { ok: false, message: "Files can be up to 15 MB." };
  if (!ALLOWED.test(file.type)) return { ok: false, message: "Upload a PDF, image, Office document or CSV." };

  const mod = String(fd.get("module") ?? "");
  const entityType = String(fd.get("entity_type") ?? "");
  const entityId = String(fd.get("entity_id") ?? "");
  const supplier = String(fd.get("supplier_id") ?? "") || null;
  if (!mod || !entityType || !entityId) return { ok: false, message: "Missing upload context." };

  const supabase = await createClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  let storagePath: string | null = null;
  let base64: string | null = null;

  if (isDemoMode()) {
    base64 = bytes.toString("base64");
  } else {
    storagePath = `${mod}/${entityType}/${entityId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const real = supabase as unknown as { storage: { from: (b: string) => { upload: (p: string, b: Buffer, o: object) => Promise<{ error: { message: string } | null }> } } };
    const { error } = await real.storage.from("files").upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (error) return { ok: false, message: `Upload failed: ${error.message}` };
  }

  const { data, error } = await supabase.rpc("file_register", {
    p_module: mod, p_entity_type: entityType, p_entity_id: entityId, p_supplier: supplier,
    p_name: file.name, p_type: file.type, p_size: file.size, p_base64: base64, p_storage_path: storagePath, p_label: String(fd.get("label") ?? ""),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Uploaded.", id: data as string };
}

export async function deleteFile(id: string): Promise<UploadResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("file_delete", { p_id: id });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Removed." };
}

export async function markNotificationsRead(id: string | null) {
  const supabase = await createClient();
  await supabase.rpc("notifications_mark_read", { p_id: id });
  revalidatePath("/", "layout");
}
