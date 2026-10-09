"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo/config";
import { loadCsv, resetDemoDb, writeCsvSnapshot } from "@/lib/demo/db";

export type Result = { ok: boolean; message: string };

export async function exportCsvNow(): Promise<Result> {
  await requireAdmin();
  if (!isDemoMode()) return { ok: false, message: "Only available in demo mode." };
  const r = await writeCsvSnapshot();
  return { ok: true, message: `${r.tables} tables written to ${r.dir}` };
}

export async function loadTableCsv(table: string): Promise<Result> {
  await requireAdmin();
  if (!isDemoMode()) return { ok: false, message: "Only available in demo mode." };
  try {
    const r = await loadCsv(table);
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.rows} rows loaded into ${table}.` };
  } catch (e) {
    return { ok: false, message: `Nothing loaded: ${(e as Error).message}` };
  }
}

export async function resetDemoData(): Promise<Result> {
  await requireAdmin();
  if (!isDemoMode()) return { ok: false, message: "Only available in demo mode." };
  await resetDemoDb();
  revalidatePath("/", "layout");
  return { ok: true, message: "Demo data reset to the starting set. Sign in again if your session ends." };
}
