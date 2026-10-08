import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Vendor registration" };
export const dynamic = "force-dynamic";

type Invite = { valid: boolean; reason?: string; supplier_name?: string; email?: string };

export default async function VendorRegister({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite = "" } = await searchParams;
  const supabase = await createClient();
  const { data } = invite ? await supabase.rpc("lookup_vendor_invite", { p_token: invite }) : { data: null };
  const info = (data as Invite | null) ?? { valid: false, reason: "not_found" };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-4 rounded-md border border-line bg-surface p-7">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded bg-accent font-display text-lg font-bold text-accent-fg">A+</div>
          <div>
            <h1 className="font-display text-xl font-bold leading-none">Assure+ Vendor Portal</h1>
            <p className="mt-1 text-xs text-muted">adm Indicia</p>
          </div>
        </div>
        {info.valid ? (
          <>
            <p>
              adm Indicia has invited <b>{info.supplier_name}</b> to register as a vendor. You&apos;ll be asked for your company details,
              certifications and bank details. It takes about 10 minutes.
            </p>
            <RegisterForm invite={invite} email={info.email!} demo={isDemoMode()} />
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">
              {info.reason === "expired" ? "This link has expired." : info.reason === "used" ? "This link has already been used." : "This link isn't valid."}
            </p>
            <p className="text-muted">
              {info.reason === "used"
                ? "If you've already registered, sign in to the vendor portal with your email address."
                : "Ask your adm Indicia contact to send you a new information request."}
            </p>
            <Link href="/login" className="font-semibold text-accent underline underline-offset-2">Go to sign in</Link>
          </div>
        )}
      </div>
    </main>
  );
}
