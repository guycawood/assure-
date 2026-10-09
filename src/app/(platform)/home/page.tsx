import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { personName, ticketRef, formatDate, type Ticket } from "@/lib/srt";
import { MODULES } from "@/modules/registry";
import { Card, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Home" };

type Brief = { id: string; brief_code: string; title: string; status: string; approval_status: string | null; created_by: string | null };
type Client = Awaited<ReturnType<typeof createClient>>;

async function count(supabase: Client, table: string, filter?: (q: ReturnType<Client["from"]>) => unknown): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q as never) as typeof q;
  const { count: n, error } = await q;
  return error ? 0 : n ?? 0;
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Singapore" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

// System Guy home (Shopper IQ pattern): greeting, Ask bar with shortcuts, the pipeline across every module, then your work.
export default async function Home() {
  const me = await requireInternal();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [ticketsRes, briefsRes, crRes, governRes, markets, briefsInFlight, openRfqs, estAwait, poDoa, inTransit, awaitInstall, pods] = await Promise.all([
    supabase.from("srt_tickets").select("*").eq("assignee", me.id).neq("status", "resolved").order("due_date", { nullsFirst: false }).limit(6),
    supabase.from("briefs").select("id, brief_code, title, status, approval_status, created_by").eq("status", "submitted").limit(50),
    supabase.from("change_requests").select("id, module, status").in("status", ["logged", "under_review", "needs_clarification", "implemented_pending_verification"]),
    supabase.from("module_owners").select("module").eq("user_id", me.id),
    count(supabase, "markets"),
    count(supabase, "briefs", (q) => (q as never as { in: (c: string, v: string[]) => unknown }).in("status", ["submitted", "in_ideation"])),
    count(supabase, "rfqs", (q) => (q as never as { eq: (c: string, v: string) => unknown }).eq("status", "sent")),
    count(supabase, "estimates", (q) => (q as never as { eq: (c: string, v: string) => unknown }).eq("status", "sent")),
    count(supabase, "purchase_orders", (q) => (q as never as { eq: (c: string, v: string) => unknown }).eq("status", "pending_approval")),
    count(supabase, "deliveries", (q) => (q as never as { in: (c: string, v: string[]) => unknown }).in("status", ["booked", "dispatched", "in_transit"])),
    count(supabase, "deployments", (q) => (q as never as { eq: (c: string, v: string) => unknown }).eq("stage", "delivered")),
    count(supabase, "shipments", (q) => (q as never as { eq: (c: string, v: string) => unknown }).eq("pod_status", "received")),
  ]);
  const tickets = (ticketsRes.data ?? []) as Ticket[];
  const toApprove = ((briefsRes.data ?? []) as Brief[]).filter((b) => b.created_by !== me.id && b.approval_status !== "approved");
  const governs = new Set(((governRes.data ?? []) as { module: string }[]).map((g) => g.module));
  const crs = ((crRes.data ?? []) as { module: string }[]).filter((c) => me.is_admin || governs.has(c.module));
  const first = personName(me).split(" ")[0];

  const pipeline: { n: number; label: string; sub: string; href: string }[] = [
    { n: briefsInFlight, label: "Briefs in flight", sub: "Submitted or in ideation", href: "/briefing" },
    { n: openRfqs, label: "Open RFQs", sub: "Out with vendors", href: "/rfq" },
    { n: estAwait, label: "Estimates with clients", sub: "Awaiting a decision", href: "/orders/estimates" },
    { n: poDoa, label: "POs awaiting approval", sub: "Delegated authority", href: "/orders/purchase-orders" },
    { n: inTransit, label: "Deliveries on the way", sub: "Booked to in transit", href: "/logistics/deliveries" },
    { n: pods, label: "PODs to verify", sub: "8-point check", href: "/logistics/pods" },
    { n: awaitInstall, label: "Awaiting install", sub: "Delivered to store", href: "/execution/deployments" },
  ];
  const chips: [string, string][] = [
    ["Find a supplier", "/assure/suppliers"], ["Open RFQs", "/rfq"], ["POs to approve", "/orders/purchase-orders"],
    ["Proof of delivery", "/logistics/pods"], ["What worked", "/shopper-iq/insights"], ["Search everything", "/search"],
  ];

  return (
    <>
      <section className="flex flex-col items-center px-2 pt-6 text-center">
        <h1 className="text-[2rem] font-extrabold uppercase tracking-[0.01em] text-brand-navy md:text-[2.4rem]">{greeting()}, {first}</h1>
        <p className="mt-1 text-muted">Here&apos;s what needs your attention across {markets} markets in System Guy.</p>
        <form action="/search" className="mt-6 flex w-full max-w-2xl items-center gap-3 rounded-full border border-line bg-surface py-2 pl-5 pr-2 shadow-raised">
          <MSymbol name="search" size={22} className="text-muted" />
          <input name="q" placeholder='Try "Vistula", "BR-2026", "wobbler" or "FSC"' className="min-w-0 flex-1 bg-transparent text-[0.95rem] focus:outline-none" />
          <button className="flex items-center gap-1.5 rounded-full bg-brand-tech px-5 py-2 text-sm font-bold text-brand-navy shadow-[0_4px_14px_rgba(255,176,91,0.35)]">
            <MSymbol name="auto_awesome" size={17} fill /> Ask
          </button>
        </form>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {chips.map(([l, h]) => (
            <Link key={h} href={h} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-fg/80 shadow-card transition hover:border-accent/40 hover:text-fg">{l}</Link>
          ))}
        </div>
        <Link href="/briefing/new" className="mt-4 flex items-center gap-1.5 text-sm font-bold text-accent hover:underline"><MSymbol name="edit_note" size={18} /> New brief</Link>
      </section>

      <section>
        <h2 className="text-xl font-bold">Your pipeline</h2>
        <p className="mb-3 text-sm text-muted">Live across every module, from brief to store.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {pipeline.map((p) => (
            <Link key={p.label} href={p.href} className="group">
              <Card className="h-full p-4 transition group-hover:shadow-raised">
                <p className="text-[1.9rem] font-extrabold leading-none text-brand-indiblue tabular-nums">{p.n}</p>
                <p className="mt-2 text-sm font-bold">{p.label}</p>
                <p className="text-xs text-muted">{p.sub}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="My tickets" actions={<Link href="/assure/srt/tickets" className="text-sm font-semibold text-accent hover:underline">All</Link>}>
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
        <Panel title="Briefs waiting for review" actions={<Link href="/briefing" className="text-sm font-semibold text-accent hover:underline">All</Link>}>
          {toApprove.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No briefs waiting for you.</p> : (
            <ul className="divide-y divide-line">
              {toApprove.slice(0, 6).map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="font-mono text-xs text-muted">{b.brief_code}</span>
                  <Link href={`/briefing/${b.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{b.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Change requests" actions={<Link href="/watchtower/change-requests" className="text-sm font-semibold text-accent hover:underline">All</Link>}>
          <p className="px-5 py-4 text-sm">{crs.length ? <><b>{crs.length}</b> waiting for you to review or verify.</> : <span className="text-muted">{me.is_admin || governs.size ? "Nothing waiting for you." : "You don't govern a module."}</span>}</p>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MODULES.map((m) => (
            <Link key={m.key} href={m.basePath} className="group">
              <Card className="relative h-full overflow-hidden p-4 transition group-hover:shadow-raised">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: m.colour }} />
                <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: m.colour + "2e", color: m.colour === "#9DC5ED" ? "#4896F7" : m.colour }}><MSymbol name={m.icon} size={22} /></span>
                <p className="mt-3 font-bold">{m.name}</p>
                <p className="text-xs text-muted">{m.tagline}</p>
                {m.status === "planned" && <span className="mt-2 inline-block rounded-full bg-surface-2 px-2 text-[0.62rem] font-bold uppercase text-muted">{m.phase}</span>}
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
