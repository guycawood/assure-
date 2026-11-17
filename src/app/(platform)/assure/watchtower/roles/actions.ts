"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormResult } from "@/components/assure/action-form";

// SRM role levels. The database decides who may assign which level, never above their own.
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ""));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath("/assure", "layout");
  return { ok: true, message };
}

export async function assignRole(_: FormResult, fd: FormData): Promise<FormResult> {
  if (!uuid(s(fd, "user"))) return { error: "Choose a person." };
  if (!s(fd, "role")) return { error: "Choose a level." };
  return run("division_role_assign", { p_user: s(fd, "user"), p_module: "assure", p_role: s(fd, "role"), p_note: s(fd, "note") || null }, "Level saved. The person has been told.");
}

export async function removeRole(_: FormResult, fd: FormData): Promise<FormResult> {
  if (!uuid(s(fd, "user"))) return { error: "Choose a person." };
  return run("division_role_remove", { p_user: s(fd, "user"), p_module: "assure", p_note: s(fd, "note") || null }, "Level removed. They fall back to their older role.");
}
