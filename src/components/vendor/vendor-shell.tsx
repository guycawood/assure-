"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { NotificationsBell, type Notice } from "@/components/notifications-bell";
import { VENDOR_NAV, type NavLink } from "@/lib/vendor";

// The vendor portal has its own shell (never the internal one): white left sidebar with the Assure+ vendor wordmark
// and the company name, and a top bar with notifications, the person and sign out. Assure+ green is the accent.

const ACCENT = "#2E9E8F";
const STORE_KEY = "adm.vendor.sidebar.collapsed";
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const isActive = (path: string, i: NavLink) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));

export function VendorShell({ user, company, demo, notices, children }: {
  user: { name: string; role: string };
  company: string | null;
  demo: boolean;
  notices: Notice[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      setCollapsed(saved === null ? window.innerWidth < 900 : saved === "1");
    } catch { /* storage unavailable */ }
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(STORE_KEY, c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  const items = company ? VENDOR_NAV.flatMap((g) => g.items) : [];
  const page = [...items].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(path, i));

  return (
    <div className="min-h-screen bg-bg">
      <aside className={clsx("fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-line bg-surface transition-[width] duration-200", collapsed ? "w-16" : "w-60")}>
        <Link href="/vendor" className={clsx("flex h-[76px] shrink-0 flex-col justify-center border-b border-line", collapsed ? "items-center px-2" : "px-5")}>
          {collapsed ? (
            <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: ACCENT + "26", color: ACCENT }}><MSymbol name="handshake" size={20} /></span>
          ) : (
            <>
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-muted/80">adm Indicia · Assure<span style={{ color: ACCENT }}>+</span></span>
              <span className="text-[1.05rem] font-extrabold uppercase leading-none tracking-[0.1em] text-brand-navy">Vendor Portal</span>
              {company && <span className="mt-1 truncate text-[0.7rem] font-semibold text-muted" title={company}>{company}</span>}
            </>
          )}
        </Link>

        <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label="Vendor portal navigation">
          {company ? VENDOR_NAV.map((g, gi) => (
            <div key={g.label} className={gi > 0 ? "mt-4" : ""}>
              {collapsed ? <div className="mx-2 my-3 border-t border-line" /> : <p className="mb-1 px-3 text-[0.64rem] font-bold uppercase tracking-wider text-muted/80">{g.label}</p>}
              <div className="space-y-0.5">
                {g.items.map((i) => {
                  const active = page?.href === i.href;
                  return (
                    <Link key={i.href} href={i.href} title={collapsed ? i.label : undefined} aria-current={active ? "page" : undefined}
                      className={clsx("flex items-center gap-3 rounded-lg py-2 text-[0.84rem] font-semibold transition-colors", collapsed ? "justify-center px-2" : "px-3",
                        active ? "text-brand-navy" : "text-muted hover:bg-surface-2 hover:text-fg")}
                      style={active ? { background: ACCENT + "22" } : undefined}>
                      <MSymbol name={i.icon} size={19} fill={active} style={active ? { color: ACCENT } : undefined} />
                      {!collapsed && <span className="truncate">{i.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          )) : !collapsed && <p className="px-3 text-xs text-muted">Your account isn&apos;t linked to a vendor yet.</p>}
        </nav>

        <div className="border-t border-line p-3">
          <button onClick={toggle} className="flex w-full items-center justify-center rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <MSymbol name={collapsed ? "chevron_right" : "chevron_left"} size={18} />
          </button>
        </div>
      </aside>

      <div className={clsx("flex min-h-screen min-w-0 flex-col transition-[margin] duration-200", collapsed ? "ml-16" : "ml-60")}>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
              <span className="font-semibold text-muted">Vendor portal</span>
              <span className="text-line">/</span>
              <span className="truncate font-bold text-fg">{page?.label ?? "Overview"}</span>
            </div>
            {demo && <span className="hidden rounded-full bg-warn-soft px-2.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-wider text-warn md:block">Demo data</span>}
            <NotificationsBell items={notices} />
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span className="grid h-8 w-8 place-items-center rounded-full text-[0.68rem] font-bold text-white" style={{ background: "#010062" }} aria-hidden>{initials(user.name)}</span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-xs font-bold">{user.name}</span>
                <span className="block text-[0.68rem] text-muted">{user.role}</span>
              </span>
              <form action="/auth/signout" method="post">
                <button title={demo ? "Switch user" : "Sign out"} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                  <MSymbol name="logout" size={18} />
                  <span className="sr-only">{demo ? "Switch user" : "Sign out"}</span>
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 pb-8 pt-5">{children}</main>
      </div>
    </div>
  );
}
