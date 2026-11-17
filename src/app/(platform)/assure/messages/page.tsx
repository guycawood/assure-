import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { personName, timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/assure/action-form";
import { MarkRead } from "@/components/assure/mark-read";
import { startConversation } from "../srm-actions";
import { ChannelComposer, type ChannelOption, type TemplateOption } from "@/components/assure/channel-composer";
import { providerFor } from "@/lib/messaging/dispatch";
import { ChannelIcon } from "@/components/channel-icon";
import { attachUnmatched, dismissUnmatched } from "./channel-actions";

export const metadata: Metadata = { title: "Messages" };

type Conv = { id: string; supplier_id: string; subject: string; status: string; last_message_at: string | null; created_at: string };
type Msg = { id: string; conversation_id: string; body: string; sender: string | null; sender_side: string; created_at: string; channel: string };
const CH_LABEL: Record<string, string> = { whatsapp: "WhatsApp", wechat: "WeChat" };
const DELIVERY: Record<string, string> = { queued: "Queued", sending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Not delivered" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [convs, msgs, reads, suppliers, people] = await Promise.all([
    rows<Conv>(supabase, "conversations", { order: "last_message_at" }),
    rows<Msg>(supabase, "messages", { order: "created_at", asc: true, limit: 20000 }),
    rows<{ conversation_id: string; last_read_at: string }>(supabase, "message_reads"),
    getSuppliers(supabase),
    getInternalPeople(supabase),
  ]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  const pMap = byId(people);
  const readAt = new Map(reads.map((r) => [r.conversation_id, r.last_read_at]));
  const q = sp.q?.toLowerCase();
  const list = convs.filter((c) => !q || c.subject.toLowerCase().includes(q) || name.get(c.supplier_id)?.toLowerCase().includes(q));
  const unread = (c: Conv) => msgs.filter((m) => m.conversation_id === c.id && m.sender !== me.id && m.created_at > (readAt.get(c.id) ?? "")).length;
  const active = convs.find((c) => c.id === sp.c);
  const thread = active ? msgs.filter((m) => m.conversation_id === active.id) : [];
  const [chRes, outRes, tplRes, unRes] = await Promise.all([
    active ? supabase.rpc("messaging_conversation_channels", { p_conversation: active.id }) : Promise.resolve({ data: [] }),
    active ? supabase.rpc("messaging_outbound_for", { p_conversation: active.id }) : Promise.resolve({ data: [] }),
    supabase.rpc("messaging_templates"),
    supabase.rpc("messaging_unmatched"),
  ]);
  const channels = ((chRes.data as ChannelOption[] | null) ?? []);
  const outbound = new Map((((outRes.data as { message_id: string; status: string; error: string | null }[] | null) ?? [])).map((o) => [o.message_id, o]));
  const templates = ((tplRes.data as TemplateOption[] | null) ?? []);
  const unmatched = ((unRes.data as { id: string; channel: string; address: string; display_name: string | null; body: string; received_at: string }[] | null) ?? []);
  const mock = providerFor("whatsapp") === "mock" || providerFor("wechat") === "mock";

  return (
    <>
      <PageHead title="Messages" sub="Conversations with suppliers. Vendors see only their own company's threads. Messages can also go out on a vendor's WhatsApp or WeChat once they have opted in." crumbs={[{ label: "SRM", href: "/assure" }, { label: "Messages" }]}>
        <Link href="/assure/messages/channels" className="btn-secondary inline-flex items-center gap-2"><ChannelIcon channel="whatsapp" size={16} label={false} /><ChannelIcon channel="wechat" size={16} label={false} />WhatsApp and WeChat</Link>
      </PageHead>
      {unmatched.length > 0 && (
        <Panel title={`Messages from numbers we don't know (${unmatched.length})`} sub="Link each to a vendor, with how they agreed to be messaged, or dismiss it.">
          <ul className="divide-y divide-line text-sm">
            {unmatched.map((u) => (
              <li key={u.id} className="space-y-2 px-5 py-3">
                <p className="flex flex-wrap items-center gap-1.5"><ChannelIcon channel={u.channel} /><b>{CH_LABEL[u.channel]}</b> ·{u.display_name ?? "No name"} · {u.address} · {timeAgo(u.received_at)}</p>
                <p className="rounded-lg bg-surface-2 p-2">{u.body}</p>
                <div className="flex flex-wrap gap-3">
                  <ActionForm action={attachUnmatched} hidden={{ id: u.id }} submit="Link to vendor" variant="secondary" inline>
                    <select name="supplier" required className="input py-1.5" aria-label="Vendor" defaultValue=""><option value="">Choose a vendor</option>{supplierOptions(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <input name="method" required className="input py-1.5" placeholder="How they agreed (for example: they wrote to us first)" aria-label="Opt-in evidence" />
                  </ActionForm>
                  <ActionForm action={dismissUnmatched} hidden={{ id: u.id }} submit="Dismiss" variant="secondary" inline />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="min-w-0">
          <form method="get" className="border-b border-line p-3">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search supplier or subject" className="input" aria-label="Search conversations" />
          </form>
          {list.length === 0 ? <Empty title="No conversations" /> : (
            <ul className="max-h-[600px] divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const u = unread(c);
                const last = msgs.filter((m) => m.conversation_id === c.id).at(-1);
                return (
                  <li key={c.id}>
                    <Link href={`/assure/messages?c=${c.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} className={clsx("block px-4 py-3 text-sm hover:bg-surface-2", c.id === sp.c && "bg-accent-soft")}>
                      <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold">{name.get(c.supplier_id)}</span>{(["whatsapp", "wechat"] as const).filter((k) => msgs.some((m) => m.conversation_id === c.id && m.channel === k)).map((k) => <ChannelIcon key={k} channel={k} size={14} />)}</span>{u > 0 && <Pill tone="accent">{u}</Pill>}</div>
                      <p className="truncate">{c.subject}</p>
                      <p className="truncate text-xs text-muted">{last ? `${last.body.slice(0, 80)} · ${timeAgo(last.created_at)}` : "No messages yet"}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {active ? (
          <Panel title={active.subject} sub={name.get(active.supplier_id)} actions={<Link href={`/assure/suppliers/${active.supplier_id}`} className="text-sm text-accent underline">Supplier</Link>}>
            <MarkRead id={active.id} />
            <div className="max-h-[520px] space-y-3 overflow-y-auto p-5">
              {thread.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
              {thread.map((m) => {
                const mine = m.sender === me.id;
                return (
                  <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={clsx("max-w-[75%] rounded-xl px-3.5 py-2 text-sm", mine ? "bg-accent text-accent-fg" : m.sender_side === "supplier" ? "bg-warn-soft" : "bg-surface-2")}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className={clsx("mt-1 text-[0.7rem]", mine ? "text-accent-fg/80" : "text-muted")}>
                        {m.sender_side === "supplier" ? `${name.get(active.supplier_id)} (vendor)` : m.sender ? personName(pMap.get(m.sender)) : "Team"} · {timeAgo(m.created_at)}
                        {m.channel !== "portal" && <> · <ChannelIcon channel={m.channel} size={13} className="mx-0.5 inline-block align-[-2px]" /> {CH_LABEL[m.channel] ?? m.channel}</>}
                        {outbound.get(m.id) && ` · ${DELIVERY[outbound.get(m.id)!.status] ?? outbound.get(m.id)!.status}`}
                      </p>
                      {outbound.get(m.id)?.status === "failed" && <p className="mt-0.5 text-[0.7rem] font-semibold text-bad">{outbound.get(m.id)!.error}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line p-4">
              <ChannelComposer conversationId={active.id} channels={channels} templates={templates} mock={mock} />
            </div>
          </Panel>
        ) : (
          <Panel title="Start a conversation">
            <div className="p-5">
              <ActionForm action={startConversation} submit="Start conversation">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Supplier"><select name="supplier_id" required className="input" defaultValue=""><option value="">Choose…</option>{supplierOptions(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                  <Field label="Subject"><input name="subject" required className="input" /></Field>
                </div>
                <Field label="First message"><textarea name="body" rows={3} className="input" /></Field>
              </ActionForm>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
