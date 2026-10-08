"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { MODULES, type ModuleDef } from "@/modules/registry";
import { NAV, type NavItem } from "@/modules/nav";
import { MSymbol } from "@/components/symbol";

// Platform shell, Base44 pattern in adm Indicia dress:
// left sidebar per module (wordmark block, grouped nav, collapse), white top bar with breadcrumb,
// and a floating module dock on the right for moving between modules.

type Props = {
  user: { name: string; role: string };
  isAdmin: boolean;
  demo: boolean;
  badges: { myTickets: number };
  children: React.ReactNode;
};

const STORE_KEY = "adm.sidebar.collapsed";
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function currentModule(path: string): ModuleDef {
  return MODULES.find((m) => path === m.basePath || path.startsWith(m.basePath + "/")) ?? MODULES[0];
}

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

export function Shell({ user, isAdmin, demo, badges, children }: Props) {
  const path = usePathname();
  const m = currentModule(path);
  const nav = NAV[m.key];
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

        <div className="border-t border-line p-3">
          <button onClick={toggle} className="flex w-full items-center justify-center rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <MSymbol name={collapsed ? "chevron_right" : "chevron_left"} size={18} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className={clsx("flex min-h-screen flex-col transition-[margin] duration-200", collapsed ? "ml-16" : "ml-60", "pr-[76px] xl:pr-[214px]")}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-line bg-surface/95 px-6 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="whitespace-nowrap text-xs font-semibold text-muted">{m.name} {nav.portal.toLowerCase().includes("portal") ? "" : "· " + nav.portal}</span>
            <span className="text-line">/</span>
            <span className="truncate font-bold text-fg">{page?.label ?? "Overview"}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {demo && <span className="hidden rounded-full bg-warn-soft px-2.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-wider text-warn md:block">Demo data</span>}
            {m.key === "assure" && (
              <Link href="/vendor" className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-fg/80 transition hover:bg-surface-2 sm:flex">
                <MSymbol name="open_in_new" size={15} /> Vendor portal
              </Link>
            )}
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
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">{children}</main>
      </div>

      {/* Module dock (right) */}
      <nav aria-label="Modules" className="fixed right-3 top-1/2 z-30 max-h-[calc(100vh-1.5rem)] -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface/95 p-1.5 shadow-raised backdrop-blur-md">
        <div className="flex flex-col gap-1">
          <span className="hidden px-2 pb-1 pt-1 text-[0.58rem] font-bold uppercase tracking-[0.16em] text-muted/80 xl:block">System Guy</span>
          {MODULES.map((x) => {
            const active = x.key === m.key;
            const c = x.colour === "#9DC5ED" ? "#4896F7" : x.colour;
            return (
              <Link
                key={x.key}
                href={x.basePath}
                title={`${x.name} · ${NAV[x.key].portal}`}
                aria-current={active ? "page" : undefined}
                className={clsx("group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors", active ? "bg-surface-2 ring-1 ring-line" : "hover:bg-surface-2/70")}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: x.colour + "26", color: c }}>
                  <MSymbol name={x.icon} size={18} fill={active} />
                </span>
                <span className="hidden min-w-0 flex-col pr-1 leading-none xl:flex">
                  <Wordmark m={x} size="sm" />
                  <span className="mt-1 whitespace-nowrap text-[0.56rem] font-semibold uppercase tracking-wider text-muted">{NAV[x.key].portal}</span>
                </span>
                {x.status === "planned" && <span className="hidden text-[0.55rem] font-bold uppercase text-muted/70 xl:block">{x.phase.replace("Phase ", "P")}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
