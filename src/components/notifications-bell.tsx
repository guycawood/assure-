"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationsRead } from "@/app/files-actions";
import { MSymbol } from "@/components/symbol";

export type Notice = { id: string; module: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export function NotificationsBell({ items }: { items: Notice[] }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
        <MSymbol name="notifications" size={20} fill={unread > 0} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[0.6rem] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-xl border border-line bg-surface shadow-raised">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && <button onClick={() => start(() => markNotificationsRead(null))} className="text-xs font-semibold text-accent hover:underline">Mark all read</button>}
          </div>
          {items.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p> : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {items.map((n) => {
                const body = (
                  <div className="flex gap-2.5 px-4 py-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-accent"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{n.title}</p>
                      {n.body && <p className="text-xs text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[0.68rem] text-muted">{ago(n.created_at)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="hover:bg-surface-2">
                    {n.href ? <Link href={n.href} onClick={() => { setOpen(false); if (!n.read_at) start(() => markNotificationsRead(n.id)); }}>{body}</Link> : body}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
