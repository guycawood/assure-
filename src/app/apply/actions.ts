"use server";

import { createClient } from "@/lib/supabase/server";
import { cleanPaData, friendlyError, isEmail, PA_CATEGORIES, type ActionResult } from "@/lib/vendor";

// Public vendor application (no sign-in). The server validates and trims everything; the database function
// vendor_apply validates again, checks the honeypot and duplicates, rate-limits, stores and notifies procurement.
// Nothing here writes a table directly.
export async function submitApplication(raw: unknown, honeypot: string): Promise<ActionResult> {
  const data = cleanPaData(raw);
  const company = (data.supplier_company_name ?? "").trim();
  const contact = (data.primary_contact_name ?? "").trim();
  const email = (data.primary_contact_email ?? "").trim().toLowerCase();
  const category = data.major_category && (PA_CATEGORIES as readonly string[]).includes(data.major_category) ? data.major_category : null;
  if (company.length < 2) return { ok: false, message: "Enter your company name." };
  if (contact.length < 2) return { ok: false, message: "Enter the contact name." };
  if (!isEmail(email)) return { ok: false, message: "Enter a valid contact email address." };
  if (!category) return { ok: false, message: "Choose your major category." };
  if (!data.head_office_country) return { ok: false, message: "Enter your head office country." };

  const supabase = await createClient();
  const { data: ref, error } = await supabase.rpc("vendor_apply", {
    p_company: company, p_contact_name: contact, p_email: email, p_country: data.head_office_country ?? null, p_category: category,
    p_data: data, p_honeypot: typeof honeypot === "string" ? honeypot.slice(0, 200) : "",
  });
  if (error) return { ok: false, message: friendlyError(error.message, "We couldn't send your application. Try again in a few minutes.") };
  return { ok: true, message: "Application received.", id: String(ref ?? "") };
}
