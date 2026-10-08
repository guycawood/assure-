import type { Metadata } from "next";
import { requireVendor } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { personName } from "@/lib/srt";
import { PERMISSION_LABEL } from "@/lib/vendor";
import { VendorShell } from "@/components/vendor/vendor-shell";
import type { Notice } from "@/components/notifications-bell";

export const metadata: Metadata = { title: { default: "Vendor portal", template: "%s · Vendor portal" } };
export const dynamic = "force-dynamic";

// External vendor portal. Only signed-in vendor users get here; staff are sent to /home by requireVendor.
export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireVendor();
  const supabase = await createClient();
  const { data: notices } = await supabase.from("notifications").select("id, module, title, body, href, read_at, created_at").order("created_at", { ascending: false }).limit(15);
  return (
    <VendorShell
      user={{ name: personName(ctx.profile), role: ctx.permission ? PERMISSION_LABEL[ctx.permission] : "Vendor" }}
      company={ctx.company?.name ?? null}
      demo={isDemoMode()}
      notices={(notices ?? []) as Notice[]}
    >
      {children}
    </VendorShell>
  );
}
