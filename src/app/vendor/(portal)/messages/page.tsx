import Link from "next/link";
import { clsx } from "clsx";
import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead } from "@/components/ui";
import { ActionDialog, ActionForm } from "@/components/vendor/action-form";
import { sendMessage, startConversation } from "../actions";

export const metadata = { title: "Messages" };

type Conv = { id: string; subject: string; status: string; last_message_at: string | null; created_at: string };
type Msg = { id: string; body: string; sender: string | null; sender_side: string; created_at: string };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireVendorCompany();
  const { c } = await searchParams;
  const supabase = await createClient();
  const [convs, reads] = await Promise.all([
    rows<Conv>(supabase.from("conversations").select("id, subject, status, last_message_at, created_at").order("last_message_at", { ascending: false, nullsFirst: false })),
    rows<{ conversation_id: string; last_read_at: string }>(supabase.from("message_reads").select("conversation_id, last_read_at")),
  ]);
  const current = convs.find((x) => x.id === c) ?? convs[0];
  let msgs: Msg[] = [];
  if (current) {
    msgs = await rows<Msg>(supabase.from("messages").select("id, body, sender, sender_side, created_at").eq("conversation_id", current.id).order("created_at"));
    await supabase.rpc("assure_mark_conversation_read", { p_conversation: current.id });
  }
  const readAt = new Map(reads.map((r) => [r.conversation_id, r.last_read_at]));

  return (
    <>
      <PageHead title="Messages" sub="Conversations with adm Indicia's team about your account, orders and compliance.">
        <ActionDialog label="New message" variant="primary" title="New message to adm Indicia" action={startConversation} submit="Send">
          <label className="label" htmlFor="subject">Subject</label>
          <input id="subject" name="subject" required maxLength={200} className="input" />
          <label className="label" htmlFor="nbody">Message</label>
          <textarea id="nbody" name="body" required rows={5} maxLength={10000} className="input" />
        </ActionDialog>
      </PageHead>
      {convs.length === 0 ? <Card><Empty title="No conversations yet">Start one with the New message button.</Empty></Card> : (
        <div className="grid min-h-[480px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {convs.map((x) => {
                const unread = x.last_message_at && (!readAt.get(x.id) || readAt.get(x.id)! < x.last_message_at);
                return (
                  <li key={x.id}>
                    <Link href={`/vendor/messages?c=${x.id}`} className={clsx("block px-4 py-3 hover:bg-surface-2", x.id === current?.id && "bg-accent-soft")}>
                      <span className="flex items-center gap-2"><span className={clsx("truncate text-sm", unread ? "font-extrabold" : "font-semibold")}>{x.subject}</span>{unread && x.id !== current?.id && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}</span>
                      <span className="block text-xs text-muted">{x.last_message_at ? timeAgo(x.last_message_at) : "No messages yet"}{x.status === "archived" ? " · archived" : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          {current && (
            <Card className="flex flex-col">
              <p className="border-b border-line px-5 py-3 font-display font-bold">{current.subject}</p>
              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {msgs.map((m) => {
                  const mine = m.sender === ctx.profile.id;
                  return (
                    <div key={m.id} className={clsx("flex", mine || m.sender_side === "supplier" ? "justify-end" : "justify-start")}>
                      <div className={clsx("max-w-[75%] rounded-2xl px-4 py-2.5 text-sm", m.sender_side === "supplier" ? "bg-brand-navy text-white" : "bg-surface-2")}>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className={clsx("mt-1 text-[0.68rem]", m.sender_side === "supplier" ? "text-white/60" : "text-muted")}>{m.sender_side === "supplier" ? (mine ? "You" : "Your team") : "adm Indicia"} · {timeAgo(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {current.status === "active" ? (
                <div className="border-t border-line p-4">
                  <ActionForm action={sendMessage} hidden={{ conversation: current.id }} submit="Send" resetOnOk>
                    <textarea name="body" required rows={3} maxLength={10000} className="input" placeholder="Write a reply…" aria-label="Reply" />
                  </ActionForm>
                </div>
              ) : <p className="border-t border-line p-4 text-sm text-muted">This conversation is archived.</p>}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
