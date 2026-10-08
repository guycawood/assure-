import { requireInternal } from "@/lib/auth";
import { personName, SRT_ROLES } from "@/lib/srt";
import { isDemoMode } from "@/lib/demo/config";
import { ModuleTabs } from "@/components/module-tabs";

export const dynamic = "force-dynamic";

// Internal platform shell: brand bar + one tab per module. Vendors never reach this (requireInternal sends them to /vendor).
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireInternal();
  const role = profile.is_admin ? "Admin" : SRT_ROLES.find((r) => r.value === profile.srt_role)?.label ?? "Internal";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-[#010062] text-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 pt-3 md:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">adm Indicia</span>
            <span className="text-sm text-white/60">Assure+ platform</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight sm:block">
              <span className="block font-semibold">{personName(profile)}</span>
              <span className="block text-xs text-white/60">{role}</span>
            </span>
            <form action="/auth/signout" method="post">
              <button className="rounded border border-white/30 px-2.5 py-1 text-xs font-semibold hover:bg-white/10">
                {isDemoMode() ? "Switch user" : "Sign out"}
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-[1600px] px-2 md:px-4">
          <ModuleTabs />
        </div>
      </header>
      {isDemoMode() && (
        <div className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs">
          <b>Demo mode.</b> <span className="text-muted">Dummy data in a temporary database. Changes last until the server restarts.</span>
        </div>
      )}
      {children}
    </div>
  );
}
