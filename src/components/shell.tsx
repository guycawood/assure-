"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { MODULES, type ModuleDef } from "@/modules/registry";
import { NAV, type NavItem } from "@/modules/nav";
import { MSymbol } from "@/components/symbol";
import { SuggestChange } from "@/components/watchtower/suggest-change";
import { NotificationsBell, type Notice } from "@/components/notifications-bell";

// Platform shell, Base44 pattern in adm Indicia dress:
// left sidebar per module (wordmark block, grouped nav, collapse), white top bar with breadcrumb,
// and a floating module dock on the right for moving between modules.

type Props = {
  user: { name: string; role: string };
  isAdmin: boolean;
  demo: boolean;
  badges: { myTickets: number };
  notices: Notice[];
  children: React.ReactNode;
};

const STORE_KEY = "adm.sidebar.collapsed";
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function currentModule(path: string): ModuleDef {
  return MODULES.find((m) => path === m.basePath || path.startsWith(m.basePath + "/")) ?? MODULES[0];
}

// The System Guy home page sits above the modules: its own small sidebar, no module tab highlighted.
const HOME: ModuleDef = { key: "watchtower", name: "System Guy", tagline: "Home", icon: "home", colour: "#010062", basePath: "/home", status: "live", phase: "Live", scope: [], flow: "" };
const HOME_NAV = {
  portal: "My work",
  groups: [
    { label: "My work", items: [{ label: "Home", href: "/home", icon: "home", exact: true } as NavItem] },
    { label: "Across the platform", items: [
      { label: "How it fits together", href: "/watchtower/flow", icon: "account_tree" } as NavItem,
      { label: "Internal reporting", href: "/watchtower/reporting", icon: "monitoring" } as NavItem,
    ] },
  ],
};

function isActive(path: string, item: NavItem) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(item.href + "/");
}

/** Module wordmark, e.g. ASSURE+ with the plus in the module colour. */
function Wordmark({ m, size = "lg" }: { m: ModuleDef; size?: "lg" | "sm" }) {
  const base = m.name.replace(/\+$/, "");
  const plus = m.name.endsWith("+");
  return (
    <span className={clsx("font-extrabold uppercase leading-none text-brand-navy", size === "lg" ? "text-[1.05rem] tracking-[0.12em]" : "text-[0.72rem] tracking-[0.04em]")}>
      {base}
      {plus && <span style={{ color: m.colour === "#9DC5ED" ? "#4896F7" : m.colour }}>+</span>}
    </span>
  );
}

export function Shell({ user, isAdmin, demo, badges, notices, children }: Props) {
  const path = usePathname();
  const isHome = path === "/home";
  const m = isHome ? HOME : currentModule(path);
  const nav = isHome ? HOME_NAV : NAV[m.key];
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      setCollapsed(saved === null ? window.innerWidth < 900 : saved === "1");
    } catch { /* storage unavailable: keep default */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(STORE_KEY, c ? "0" : "1"); } catch { /* ignore */ }
      return !c;
    });
  };

  const items = nav.groups.flatMap((g) => g.items);
  const page = [...items].sort((a, b) => b.href.length - a.href.length).find((i) => isActive(path, i));
  const accent = m.colour === "#9DC5ED" ? "#4896F7" : m.colour; // Riverblue is too light for text

  return (
    <div className="min-h-screen bg-bg">
      {/* Left sidebar */}
      <aside className={clsx("fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-line bg-surface transition-[width] duration-200", collapsed ? "w-16" : "w-60")}>
        <Link href={m.basePath} className={clsx("flex h-[76px] shrink-0 flex-col justify-center border-b border-line", collapsed ? "items-center px-2" : "px-5")}>
          {collapsed ? (
            <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: m.colour + "26", color: accent }}><MSymbol name={m.icon} size={20} /></span>
          ) : (
            <>
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-muted/80">System Guy</span>
              <Wordmark m={m} />
              <span className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted">{nav.portal}</span>
            </>
          )}
        </Link>

        <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label={`${m.name} navigation`}>
          {nav.groups.map((g, gi) => {
            const visible = g.items.filter((i) => !i.adminOnly || isAdmin);
            if (!visible.length) return null;
            return (
              <div key={g.label} className={gi > 0 ? "mt-4" : ""}>
                {collapsed ? <div className="mx-2 my-3 border-t border-line" /> : <p className="mb-1 px-3 text-[0.64rem] font-bold uppercase tracking-wider text-muted/80">{g.label}</p>}
                <div className="space-y-0.5">
                  {visible.map((i) => {
                    const active = page?.href === i.href;
                    const badge = i.badge ? badges[i.badge] : 0;
                    return (
                      <Link
                        key={i.href}
                        href={i.href}
                        title={collapsed ? i.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "relative flex items-center gap-3 rounded-lg py-2 text-[0.84rem] font-semibold transition-colors",
                          collapsed ? "justify-center px-2" : "px-3",
                          active ? "text-brand-navy" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                        style={active ? { background: m.colour + "22" } : undefined}
                      >
                        <MSymbol name={i.icon} size={19} fill={active} style={active ? { color: accent } : undefined} />
                        {!collapsed && <span className="truncate">{i.label}</span>}
                        {!collapsed && badge > 0 && <span className="ml-auto rounded-full px-1.5 py-px text-[0.68rem] font-bold tabular-nums text-white" style={{ background: accent }}>{badge}</span>}
                        {collapsed && badge > 0 && <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full" style={{ background: accent }} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-line p-3">
          <SuggestChange module={m.key} collapsed={collapsed} />
          <button onClick={toggle} className="flex w-full items-center justify-center rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <MSymbol name={collapsed ? "chevron_right" : "chevron_left"} size={18} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className={clsx("flex min-h-screen min-w-0 flex-col transition-[margin] duration-200", collapsed ? "ml-16" : "ml-60")}>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4">
          {/* Module tabs: every module stands alone; the tabs are how you move between them. */}
          <nav aria-label="Modules" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            <Link href="/home" className="mr-2 hidden items-center gap-1.5 whitespace-nowrap pl-1 text-[0.95rem] font-extrabold tracking-[-0.01em] text-brand-navy lg:flex"><MSymbol name="home" size={18} fill={isHome} /> System Guy</Link>
            {MODULES.map((x) => {
              const active = !isHome && x.key === m.key;
              const c = x.colour === "#9DC5ED" ? "#4896F7" : x.colour;
              return (
                <Link
                  key={x.key}
                  href={x.basePath}
                  title={`${x.name} · ${NAV[x.key].portal}${x.status === "planned" ? ` (${x.phase})` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={clsx("relative flex h-14 shrink-0 items-center gap-2 px-3 text-[0.82rem] font-bold transition-colors", active ? "text-brand-navy" : "text-muted hover:text-fg")}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: active ? x.colour + "33" : "transparent", color: c }}>
                    <MSymbol name={x.icon} size={18} fill={active} />
                  </span>
                  <span className="whitespace-nowrap">{x.name}</span>
                  {x.status === "planned" && <span className="rounded bg-surface-2 px-1 py-px text-[0.56rem] font-bold uppercase text-muted">{x.phase.replace("Phase ", "P")}</span>}
                  {active && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t" style={{ background: c }} />}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {demo && <span className="hidden rounded-full bg-warn-soft px-2.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-wider text-warn md:block">Demo data</span>}
            {m.key === "assure" && (
              <Link href="/vendor" className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-fg/80 transition hover:bg-surface-2 sm:flex">
                <MSymbol name="open_in_new" size={15} /> Vendor portal
              </Link>
            )}
            <NotificationsBell items={notices} />
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-navy text-[0.68rem] font-bold text-white" aria-hidden>{initials(user.name)}</span>
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
          </div>
        </header>
        <div className="flex items-center gap-2 px-6 pt-4 text-xs">
          <span className="font-semibold text-muted">{m.name}</span>
          <span className="text-line">/</span>
          <span className="font-bold text-fg">{page?.label ?? "Overview"}</span>
        </div>
        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 pb-8 pt-3">{children}</main>
      </div>

    </div>
  );
}
