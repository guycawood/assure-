"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function NavLink({ href, exact, badge, children }: { href: string; exact?: boolean; badge?: number; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-2 rounded px-2.5 py-2 text-sm font-medium",
        active ? "bg-accent-soft font-semibold text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
      {!!badge && <span className="ml-auto rounded-full bg-accent px-1.5 font-mono text-[0.7rem] text-accent-fg">{badge}</span>}
    </Link>
  );
}
