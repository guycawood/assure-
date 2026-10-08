"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CERTIFICATIONS, type RfiData } from "@/lib/srt";

export type VendorActionResult = { ok?: boolean; error?: string };

const text = (fd: FormData, k: string, max = 500) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
};

export async function submitRfi(rfiId: string, _: VendorActionResult, fd: FormData): Promise<VendorActionResult> {
  const me = await getProfile();
  if (!me || me.user_type !== "vendor") return { error: "Sign in with your vendor account to submit." };

  const data: RfiData = {
    legal_name: text(fd, "legal_name", 200),
    trading_name: text(fd, "trading_name", 200),
    registration_number: text(fd, "registration_number", 100),
    vat_number: text(fd, "vat_number", 100),
    year_established: text(fd, "year_established", 4),
    website: text(fd, "website", 200),
    address: text(fd, "address", 500),
    country: text(fd, "country", 100),
    contact_name: text(fd, "contact_name", 200),
    contact_email: text(fd, "contact_email", 200),
    contact_phone: text(fd, "contact_phone", 50),
    accounts_email: text(fd, "accounts_email", 200),
    categories: text(fd, "categories", 500),
    employees: text(fd, "employees", 50),
    sites: text(fd, "sites", 1000),
    capabilities: text(fd, "capabilities", 2000),
    certifications: fd.getAll("certifications").map(String).filter((c) => (CERTIFICATIONS as readonly string[]).includes(c)),
    declaration: fd.get("declaration") === "on",
  };
  const bank = {
    bank_name: text(fd, "bank_name", 200),
    account_name: text(fd, "account_name", 200),
    account_number: text(fd, "account_number", 50),
    sort_code_or_swift: text(fd, "sort_code_or_swift", 50),
    iban: text(fd, "iban", 50),
    bank_country: text(fd, "bank_country", 100),
  };
  if (!data.legal_name || !data.registration_number) return { error: "Enter your registered company name and registration number." };
  if (!data.declaration) return { error: "Confirm the declaration before submitting." };
  if (!bank.account_number && !bank.iban) return { error: "Enter your bank account number or IBAN." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_vendor_rfi", { p_rfi: rfiId, p_data: data, p_bank: bank });
  if (error) {
    const safe = /^(This information request|Enter |Confirm )/.test(error.message);
    return { error: safe ? error.message : "Your information couldn't be submitted. Try again, or contact adm Indicia." };
  }
  revalidatePath("/vendor");
  return { ok: true };
}
