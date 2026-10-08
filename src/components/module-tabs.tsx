"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { MODULES } from "@/modules/registry";

/** Top bar: one tab per module. Planned modules stay visible so people can see where the platform is going. */
export function ModuleTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Modules" className="-mb-px flex gap-1 overflow-x-auto">
      {MODULES.map((m) => {
        const active = path === m.basePath || path.startsWith(m.basePath + "/");
        const Icon = m.icon;
        return (
          <Link
            key={m.key}
            href={m.basePath}
            aria-current={active ? "page" : undefined}
            style={active ? { borderColor: m.colour } : undefined}
            className={clsx(
              "flex shrink-0 items-center gap-2 border-b-[3px] px-3 pb-2.5 pt-2 text-sm font-semibold transition-colors",
              active ? "text-white" : "border-transparent text-white/65 hover:text-white",
            )}
          >
            <Icon size={16} aria-hidden style={{ color: m.colour }} />
            {m.name}
            {m.status === "planned" && <span className="rounded-full bg-white/10 px-1.5 text-[0.65rem] font-medium text-white/70">{m.phase}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
