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
const THEME_KEY = "adm.theme";

// Two looks (Shopper IQ pattern): "navy" = the dark look, teal #5DA4A8 with Tech-orange accents (key kept for saved
// preferences); "light" = white with Indi-blue accents.
const THEMES = {
  navy: {
    aside: "bg-gradient-to-b from-[#5DA4A8] to-[#4A8F93] text-white",
    card: "border-white/25 bg-white/10 hover:bg-white/15",
    cardSub: "text-white/85",
    group: "text-white/80",
    divider: "border-white/20",
    item: "text-white/90 hover:bg-white/15 hover:text-white",
    itemActive: "bg-brand-tech text-brand-navy shadow-[0_4px_14px_rgba(255,176,91,0.35)]",
    badge: "bg-brand-tech text-brand-navy",
    foot: "[&_button]:text-white/90 [&_button:hover]:bg-white/15 [&_button:hover]:text-white",
    header: "bg-[#5DA4A8] text-white shadow-[0_2px_10px_rgba(39,92,95,0.3)]",
    headSub: "text-white/85",
    headMuted: "text-white/90",
    search: "border-white/30 bg-white/15 focus-within:bg-white/20 [&_input]:text-white [&_input]:placeholder:text-white/80",
    searchIcon: "text-white",
    ask: "bg-brand-tech text-brand-navy shadow-[0_4px_14px_rgba(255,176,91,0.35)]",
    plus: "text-brand-tech",
    chip: "text-white/90 hover:bg-white/15 hover:text-white",
    chipActive: "bg-brand-tech text-brand-navy",
    icon: "text-white/90 hover:bg-white/15 hover:text-white",
    avatar: "bg-brand-tech text-brand-navy",
    page: "bg-bg",
  },
  light: {
    aside: "bg-surface text-fg border-r border-line",
    card: "border-line bg-surface-2/70 hover:bg-surface-2",
    cardSub: "text-muted",
    group: "text-muted/80",
    divider: "border-line",
    item: "text-fg/75 hover:bg-surface-2 hover:text-fg",
    itemActive: "bg-brand-indiblue text-white shadow-[0_4px_14px_rgba(72,150,247,0.35)]",
    badge: "bg-brand-indiblue text-white",
    foot: "[&_button]:text-muted [&_button:hover]:bg-surface-2 [&_button:hover]:text-fg",
    header: "bg-surface/95 text-fg border-b border-line backdrop-blur",
    headSub: "text-muted",
    headMuted: "text-muted",
    search: "border-line bg-surface-2/80 focus-within:bg-surface",
    searchIcon: "text-brand-indiblue",
    ask: "bg-brand-indiblue text-white shadow-[0_4px_14px_rgba(72,150,247,0.35)]",
    plus: "text-brand-indiblue",
    chip: "text-fg/70 hover:bg-surface-2 hover:text-fg",
    chipActive: "bg-brand-indiblue text-white",
    icon: "text-muted hover:bg-surface-2 hover:text-fg",
    avatar: "bg-brand-indiblue text-white",
    page: "bg-gradient-to-b from-[#eef5ff] to-bg",
  },
} as const;
type ThemeName = keyof typeof THEMES;
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

export function Shell({ user, isAdmin, demo, badges, notices, children }: Props) {
  const path = usePathname();
  const isHome = path === "/home";
  const m = isHome ? HOME : currentModule(path);
  const nav = isHome ? HOME_NAV : NAV[m.key];
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemeName>("navy");
  const T = THEMES[theme];
  const switchTheme = () => setTheme((x) => { const n = x === "navy" ? "light" : "navy"; try { localStorage.setItem(THEME_KEY, n); } catch { /* ignore */ } return n; });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      setCollapsed(saved === null ? window.innerWidth < 900 : saved === "1");
      const th = localStorage.getItem(THEME_KEY);
      if (th === "light" || th === "navy") setTheme(th);
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
    <div className={clsx("min-h-screen", T.page)}>
      {/* Left sidebar (deep navy, orange active item) */}
      <aside className={clsx("fixed left-0 top-0 z-40 flex h-screen flex-col transition-[width] duration-200", T.aside, collapsed ? "w-16" : "w-64")}>
        <Link href="/home" className={clsx("flex h-16 shrink-0 items-center gap-2.5", collapsed ? "justify-center px-2" : "px-5")} aria-label="System Guy home">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
            <circle cx="13" cy="13" r="9.5" fill="none" stroke="#97DBD9" strokeWidth="3.5" strokeDasharray="48 12" strokeLinecap="round" transform="rotate(-50 13 13)" />
          </svg>
          {!collapsed && <span className="text-[1.1rem] font-extrabold tracking-[-0.01em]">System Guy</span>}
        </Link>

        {/* Current module card (like the account switcher) */}
        <div className={clsx("pb-3", collapsed ? "px-2" : "px-3")}>
          <Link href={m.basePath} className={clsx("flex items-center gap-3 rounded-2xl border transition", T.card, collapsed ? "justify-center p-2" : "px-3 py-2.5")}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: m.colour + "40", color: "#fff" }}><MSymbol name={m.icon} size={18} fill /></span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-bold">{m.name}</span>
                <span className={clsx("block truncate text-[0.7rem]", T.cardSub)}>{nav.portal}</span>
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]" aria-label={`${m.name} navigation`}>
          {nav.groups.map((g, gi) => {
            const visible = g.items.filter((i) => !i.adminOnly || isAdmin);
            if (!visible.length) return null;
            return (
              <div key={g.label} className={gi > 0 ? "mt-3" : ""}>
                {collapsed ? <div className={clsx("mx-2 my-3 border-t", T.divider)} /> : <p className={clsx("mb-1 px-3 text-[0.62rem] font-bold uppercase tracking-[0.12em]", T.group)}>{g.label}</p>}
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
                          "relative flex items-center gap-3 rounded-xl py-2 text-[0.86rem] font-semibold transition-colors",
                          collapsed ? "justify-center px-2" : "px-3",
                          active ? T.itemActive : T.item,
                        )}
                      >
                        <MSymbol name={i.icon} size={19} fill={active} />
                        {!collapsed && <span className="truncate">{i.label}</span>}
                        {!collapsed && badge > 0 && <span className={clsx("ml-auto rounded-full px-1.5 py-px text-[0.68rem] font-bold tabular-nums", active ? "bg-white/90 text-brand-navy" : T.badge)}>{badge}</span>}
                        {collapsed && badge > 0 && <span className={clsx("absolute right-1.5 top-1 h-2 w-2 rounded-full", T.badge)} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={clsx("space-y-1 border-t p-3", T.divider, T.foot)}>
          <SuggestChange module={m.key} collapsed={collapsed} />
          <button onClick={toggle} className="flex w-full items-center justify-center rounded-lg p-2 transition-colors" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <MSymbol name={collapsed ? "chevron_right" : "chevron_left"} size={18} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className={clsx("flex min-h-screen min-w-0 flex-col transition-[margin] duration-200", collapsed ? "ml-16" : "ml-64")}>
        <header className={clsx("sticky top-0 z-30", T.header)}>
          {/* Row 1: where you are, search, Ask, notifications, you */}
          <div className="flex h-14 items-center gap-4 px-5">
            <div className="hidden min-w-0 leading-tight md:block">
              <p className="truncate text-[0.95rem] font-extrabold uppercase tracking-[0.02em]">{isHome ? "System Guy" : <>{m.name.replace(/\+$/, "")}{m.name.endsWith("+") && <span className={T.plus}>+</span>} <span className={clsx("font-semibold normal-case tracking-normal", T.headMuted)}>· {nav.portal}</span></>}</p>
              <p className={clsx("text-[0.62rem] font-bold uppercase tracking-[0.16em]", T.headSub)}>Powered by adm Indicia</p>
            </div>
            <form action="/search" className={clsx("mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border px-4 py-1.5", T.search)}>
              <MSymbol name="search" size={18} className={T.searchIcon} />
              <input name="q" placeholder="Search System Guy: suppliers, briefs, jobs, RFQs, POs…" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
            </form>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/search?ask=1" className={clsx("hidden items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition hover:brightness-105 sm:flex", T.ask)}>
                <MSymbol name="auto_awesome" size={17} fill /> Ask
              </Link>
              {demo && <span className="hidden rounded-full border border-brand-tech/60 px-2.5 py-0.5 text-[0.64rem] font-bold uppercase tracking-wider text-brand-tech lg:block">Demo data</span>}
              {m.key === "assure" && (
                <Link href="/vendor" className="hidden items-center gap-1 rounded-full border border-white/25 px-2.5 py-1 text-xs font-semibold text-white/85 hover:bg-white/10 xl:flex">
                  <MSymbol name="open_in_new" size={14} /> Vendor portal
                </Link>
              )}
              <button onClick={switchTheme} title={theme === "navy" ? "Switch to the light look" : "Switch to the dark look"} aria-label="Switch theme" className={clsx("grid h-9 w-9 place-items-center rounded-lg transition", T.icon)}><MSymbol name={theme === "navy" ? "light_mode" : "dark_mode"} size={19} /></button>
              <div className={theme === "navy" ? "[&>div>button]:text-white/90 [&>div>button:hover]:bg-white/15 [&>div>button:hover]:text-white" : ""}><NotificationsBell items={notices} /></div>
              <div className={clsx("flex items-center gap-2 border-l pl-3", T.divider)}>
                <span className={clsx("grid h-8 w-8 place-items-center rounded-full text-[0.68rem] font-extrabold", T.avatar)} aria-hidden>{initials(user.name)}</span>
                <span className="hidden text-left leading-tight lg:block">
                  <span className="block text-xs font-bold">{user.name}</span>
                  <span className={clsx("block text-[0.66rem]", T.headMuted)}>{user.role}</span>
                </span>
                <form action="/auth/signout" method="post">
                  <button title={demo ? "Switch user" : "Sign out"} className={clsx("grid h-8 w-8 place-items-center rounded-lg transition", T.icon)}>
                    <MSymbol name="logout" size={18} />
                    <span className="sr-only">{demo ? "Switch user" : "Sign out"}</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
          {/* Row 2: module tabs. They wrap rather than scroll, so every module is always visible. */}
          <nav aria-label="Modules" className={clsx("flex flex-wrap items-center gap-1 border-t px-3 py-1.5", T.divider)}>
            <Link href="/home" aria-current={isHome ? "page" : undefined}
              className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8rem] font-bold transition", isHome ? T.chipActive : T.chip)}>
              <MSymbol name="home" size={16} fill={isHome} /> Home
            </Link>
            {MODULES.map((x) => {
              const active = !isHome && x.key === m.key;
              return (
                <Link
                  key={x.key}
                  href={x.basePath}
                  title={`${x.name} · ${NAV[x.key].portal}${x.status === "planned" ? ` (${x.phase})` : ""}`}
                  aria-current={active ? "page" : undefined}
                  className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8rem] font-bold transition", active ? T.chipActive : T.chip)}
                >
                  <MSymbol name={x.icon} size={16} fill={active} style={active ? undefined : { color: x.colour === "#9DC5ED" ? "#9DC5ED" : x.colour }} />
                  <span className="whitespace-nowrap">{x.name}</span>
                  {x.status === "planned" && <span className={clsx("rounded-full px-1.5 text-[0.55rem] font-bold uppercase", active ? "bg-black/10" : "bg-black/5 opacity-70")}>{x.phase.replace("Phase ", "P")}</span>}
                </Link>
              );
            })}
          </nav>
        </header>
        {!isHome && (
          <div className="flex items-center gap-2 px-6 pt-4 text-xs">
            <span className="font-semibold text-muted">{m.name}</span>
            <span className="text-line">/</span>
            <span className="font-bold text-fg">{page?.label ?? "Overview"}</span>
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 pb-8 pt-3">{children}</main>
      </div>
    </div>
  );
}