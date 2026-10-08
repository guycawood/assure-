import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Outbox" };

type Mail = { id: string; to_email: string; subject: string; body: string; link: string | null; ticket_id: string | null; status: string; created_at: string };

export default async function OutboxPage() {
  await requireInternal();
  const supabase = await createClient();
  const { data } = await supabase.from("email_outbox").select("*").order("created_at", { ascending: false }).limit(200);
  const mails = (data ?? []) as Mail[];
  return (
    <>
      <PageHead title="Outbox" sub="Emails the desk sends to vendors. Each is queued here, then delivered by the mail service." />
      {isDemoMode() && (
        <p className="rounded border border-line bg-info-soft px-3 py-2 text-sm">
          Demo mode doesn&apos;t send real email. Open a vendor link below to see what the vendor sees.
        </p>
      )}
      <Card className="min-w-0">
        {mails.length === 0 ? (
          <Empty title="No emails yet"><p>Send an information request from a new-onboarding ticket and the email appears here.</p></Empty>
        ) : (
          <ul className="divide-y divide-line">
            {mails.map((m) => (
              <li key={m.id} className="space-y-1 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{m.subject}</b>
                  <Pill tone={m.status === "sent" ? "ok" : m.status === "failed" ? "bad" : "neutral"}>{m.status}</Pill>
                  <span className="ml-auto text-xs text-muted">{timeAgo(m.created_at)}</span>
                </div>
                <p className="text-muted">To {m.to_email}{m.ticket_id && <> · <Link href={`/internal/srt/tickets/${m.ticket_id}`} className="text-accent underline">ticket</Link></>}</p>
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-accent">Show email</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-surface-2 p-3 font-sans text-sm">{m.body}</pre>
                </details>
                {m.link && <p className="break-all font-mono text-xs"><a href={m.link} className="text-accent underline">{m.link}</a></p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
