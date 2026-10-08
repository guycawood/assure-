import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Vendor portal" };

// Placeholder until the vendor portal phase. Vendors never see internal SRT data.
export default async function VendorHome() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.is_admin || profile.user_type === "internal") redirect("/internal/srt");

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md space-y-3 rounded-md border border-line bg-surface p-7">
        <h1 className="font-display text-xl font-bold">Assure+ Vendor Portal</h1>
        {profile.supplier_id ? (
          <p className="text-sm text-muted">Your account is linked to your company. The vendor portal opens in the next release.</p>
        ) : (
          <p className="text-sm text-muted">
            We couldn&apos;t match <span className="font-medium text-fg">{profile.email}</span> to a registered vendor. Ask your adm
            Indicia contact to invite this email address to your vendor team.
          </p>
        )}
        <form action="/auth/signout" method="post">
          <button className="text-sm font-semibold text-accent underline underline-offset-2">Sign out</button>
        </form>
      </div>
    </main>
  );
}
