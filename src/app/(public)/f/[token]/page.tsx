import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { FormField } from "@/lib/crm";
import { PublicForm } from "./public-form";

export const metadata: Metadata = { title: "Form" };

// A public CRM form (/f/<token>): event registration, feedback, etc. Works without signing in.
export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("public_form_get", { p_token: token }) : { data: null };
  const form = data as { name: string; description: string | null; fields: FormField[]; consent_text: string | null; active: boolean } | null;
  if (!form || !form.active) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
        <h1 className="font-display text-xl font-bold">{form ? "This form is closed" : "This form link doesn't work"}</h1>
        <p className="mt-1 text-sm text-muted">{form ? "Thank you for your interest." : "Check you used the whole link."}</p>
      </section>
    );
  }
  return (
    <>
      <div>
        <h1 className="font-display text-[1.6rem] font-bold leading-tight">{form.name}</h1>
        {form.description && <p className="mt-1 text-sm text-muted">{form.description}</p>}
      </div>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card"><PublicForm token={token} fields={form.fields} consentText={form.consent_text} /></section>
    </>
  );
}
