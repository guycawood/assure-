import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { personName, ticketRef, formatDate, type Ticket } from "@/lib/srt";
import { MODULES } from "@/modules/registry";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Home" };

type Brief = { id: string; code: string; title: string; status: string; approval_status: string | null; created_by: string | null };

// System Guy home (Base44 "Workspace"): what needs you across every module, and a way into each one.
export default async function Home() {
  const me = await requireInternal();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [ticketsRes, briefsRes, crRes, noticesRes, governRes] = await Promise.all([
    supabase.from("srt_tickets").select("*").eq("assignee", me.id).neq("status", "resolved").order("due_date", { nullsFirst: false }).limit(8),
    supabase.from("briefs").select("id, code, title, status, approval_status, created_by").eq("status", "submitted").limit(50),
    supabase.from("change_requests").select("id, module, status").in("status", ["logged", "under_review", "needs_clarification", "implemented_pending_verification"]),
    supabase.from("notifications").select("id").is("read_at", null),
    supabase.from("module_owners").select("module").eq("user_id", me.id),
  ]);
  const tickets = (ticketsRes.data ?? []) as Ticket[];
  const toApprove = ((briefsRes.data ?? []) as Brief[]).filter((b) => b.created_by !== me.id && b.approval_status !== "approved");
  const governs = new Set(((governRes.data ?? []) as { module: string }[]).map((g) => g.module));
  const crs = ((crRes.data ?? []) as { id: string; module: string; status: string }[]).filter((c) => me.is_admin || governs.has(c.module));
  const overdue = tickets.filter((t) => t.due_date && t.due_date < today).length;
  const first = personName(me).split(" ")[0];

  return (
    <>
      <PageHead title={`Hello, ${first}`} sub="Here's what needs you across System Guy today." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="My open tickets" value={tickets.length} tone={overdue ? "bad" : undefined} hint={overdue ? `${overdue} overdue` : "SRT desk"} icon={<MSymbol name="inbox" size={20} />} />
        <Stat label="Briefs to review" value={toApprove.length} tone={toApprove.length ? "warn" : undefined} hint="Waiting for a second person" icon={<MSymbol name="lightbulb" size={20} />} />
        <Stat label="Change requests" value={crs.length} tone={crs.length ? "warn" : undefined} hint={me.is_admin || governs.size ? "For you to review or verify" : "You don't govern a module"} icon={<MSymbol name="rule" size={20} />} />
        <Stat label="Unread notifications" value={(noticesRes.data ?? []).length} icon={<MSymbol name="notifications" size={20} />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="My tickets" actions={<Link href="/assure/srt/tickets" className="text-sm font-semibold text-accent hover:underline">All tickets</Link>}>
          {tickets.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing assigned to you.</p> : (
            <ul className="divide-y divide-line">
              {tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="font-mono text-xs text-muted">{ticketRef(t.ticket_no)}</span>
                  <Link href={`/assure/srt/tickets/${t.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{t.title}</Link>
                  {t.due_date && <Pill tone={t.due_date < today ? "bad" : "neutral"}>{formatDate(t.due_date)}</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Briefs waiting for review" actions={<Link href="/briefing" className="text-sm font-semibold text-accent hover:underline">All briefs</Link>}>
          {toApprove.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No briefs waiting for you.</p> : (
            <ul className="divide-y divide-line">
              {toApprove.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="font-mono text-xs text-muted">{b.code}</span>
                  <Link href={`/briefing/${b.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{b.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MODULES.map((m) => (
            <Link key={m.key} href={m.basePath} className="group">
              <Card className="flex h-full items-start gap-3 p-4 transition group-hover:shadow-raised">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: m.colour + "2e", color: m.colour === "#9DC5ED" ? "#4896F7" : m.colour }}><MSymbol name={m.icon} size={20} /></span>
                <span className="min-w-0">
                  <span className="block font-bold">{m.name}</span>
                  <span className="block text-xs text-muted">{m.tagline}</span>
                  {m.status === "planned" && <span className="mt-1 inline-block rounded bg-surface-2 px-1.5 text-[0.62rem] font-bold uppercase text-muted">{m.phase}</span>}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
