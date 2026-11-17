import Link from "next/link";
import { clsx } from "clsx";

export const CO_BASE = "/sustainability/conscious-ordering";
const ITEMS = [
  { key: "dashboard", label: "Dashboard", href: CO_BASE },
  { key: "breakdown", label: "Brands and markets", href: `${CO_BASE}/breakdown` },
  { key: "orders", label: "Order lines", href: `${CO_BASE}/orders` },
] as const;

/** The three conscious ordering views, as link tabs under the page title. */
export function ConsciousNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav aria-label="Conscious ordering views" className="flex flex-wrap gap-1 border-b border-line">
      {ITEMS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined}
          className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", current === t.key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
