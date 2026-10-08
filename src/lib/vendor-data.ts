import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/srt";
import type { VendorPermission } from "@/lib/vendor";

// Vendor portal data access. The vendor's company is never taken from the request: every read goes through
// views and functions that filter on my_supplier_id() in Postgres.

export type VendorCompany = {
  id: string; supplier_code: string | null; name: string; market: string | null; region: string | null; category: string | null;
  status: string; onboarding_status: string; primary_contact_email: string | null;
  legal_entity: string | null; trading_name: string | null; website: string | null; address: string | null;
  primary_contact_name: string | null; contact_phone: string | null;
  subscription_tier: string | null; subscription_status: string; subscription_renewal: string | null;
  my_permission: VendorPermission | null;
};

export type VendorCtx = { profile: Profile; company: VendorCompany | null; permission: VendorPermission | null };

export const getVendorContext = cache(async (): Promise<VendorCtx | null> => {
  const profile = await getProfile();
  if (!profile) return null;
  if (profile.is_admin || profile.user_type !== "vendor" || !profile.supplier_id) return { profile, company: null, permission: null };
  const supabase = await createClient();
  const { data } = await supabase.from("vendor_my_company").select("*").maybeSingle();
  const company = (data as VendorCompany | null) ?? null;
  return { profile, company, permission: company?.my_permission ?? null };
});

/** Signed-in vendor user (company may not be linked yet). Staff go to their own home. */
export async function requireVendor(): Promise<VendorCtx> {
  const ctx = await getVendorContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.is_admin || ctx.profile.user_type === "internal") redirect("/home");
  if (ctx.profile.user_type === "client") redirect("/client-portal");
  return ctx;
}

/** A vendor user linked to a company. */
export async function requireVendorCompany(): Promise<VendorCtx & { company: VendorCompany; permission: VendorPermission }> {
  const ctx = await requireVendor();
  if (!ctx.company || !ctx.permission) redirect("/vendor");
  return ctx as VendorCtx & { company: VendorCompany; permission: VendorPermission };
}

export const canAct = (p: VendorPermission | null | undefined) => p === "admin" || p === "standard";

/** Await a query and return its rows typed (empty on error). */
export async function rows<T>(query: PromiseLike<{ data: unknown }>): Promise<T[]> {
  const { data } = await query;
  return (Array.isArray(data) ? data : []) as T[];
}

/** Small helper: call a JSON-returning vendor function and get [] on error. */
export async function rpcList<T>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !Array.isArray(data)) return [];
  return data as T[];
}

export type VendorRfqRow = {
  rfq_id: string; rfq_number: string; title: string; due_at: string; currency: string; open: boolean; rfq_status: string;
  invitation_status: string; quote_status: string | null; line_count: number;
};
export type PushRow = {
  id: string; spec_title: string; spec_type: string; description: string | null; job_number: string; quantity: number;
  unit_price: number; currency: string; respond_by: string | null; status: string;
};
export type VendorPoRow = {
  id: string; po_number: string; job_number: string; title: string; currency: string; total_value: number;
  po_date: string; delivery_date: string | null; status: string; responded_at: string | null;
};
