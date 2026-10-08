"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { isUuid, withPreview } from "@/lib/client-portal";

const ITEMS = [
  { href: "/client-portal", label: "Overview", icon: "dashboard", exact: true },
  { href: "/client-portal/campaigns", label: "Campaigns", icon: "campaign" },
  { href: "/client-portal/briefs", label: "Briefs", icon: "description" },
  { href: "/client-portal/estimates", label: "Estimates", icon: "request_quote" },
  { href: "/client-portal/orders", label: "Orders", icon: "local_shipping" },
  { href: "/client-portal/reports", label: "Reports", icon: "monitoring" },
];

/** Client Portal sidebar links; keeps ?preview=<client> on every link while adm Indicia staff preview a client. */
export function ClientNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const preview = isUuid(sp.get("preview")) ? sp.get("preview") : null;
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4" aria-label="Client Portal navigation">
      {ITEMS.map((i) => {
        const active = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={withPreview(i.href, preview)} aria-current={active ? "page" : undefined}
            className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-[0.84rem] font-semibold transition-colors",
              active ? "bg-[#4896F7]/15 text-brand-navy" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            <MSymbol name={i.icon} size={19} fill={active} style={active ? { color: "#4896F7" } : undefined} />
            <span className="truncate">{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
