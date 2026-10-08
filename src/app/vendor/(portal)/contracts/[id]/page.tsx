import { notFound } from "next/navigation";
import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, timeAgo } from "@/lib/srt";
import { human, money, statusTone } from "@/lib/vendor";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionDialog, ActionForm } from "@/components/vendor/action-form";
import { commentContract, signContract } from "../../actions";

export const metadata = { title: "Contract" };

type Contract = { id: string; contract_ref: string; title: string; document_type: string; status: string; version: number; content_summary: string | null; document_path: string | null;
  value: number | null; currency: string; start_date: string | null; end_date: string | null; due_date: string | null; sent_at: string | null; finalized_at: string | null };
type Party = { id: string; name: string; email: string; role: string; signing_order: number; status: string; signed_at: string | null; is_internal: boolean };
type Act = { id: number; event_type: string; description: string | null; created_at: string; mine: boolean; from_vendor: boolean };

export default async function ContractDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.from("vendor_contracts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  // Opening a sent contract records that the vendor has seen it (server-side, own company only).
  await supabase.rpc("vendor_contract_open", { p_id: id });
  const c = { ...(data as Contract), status: (data as Contract).status === "sent" ? "viewed" : (data as Contract).status };
  const [parties, activity] = await Promise.all([
    rows<Party>(supabase.from("vendor_contract_parties").select("*").eq("contract_id", id).order("signing_order")),
    rows<Act>(supabase.from("vendor_contract_activity").select("*").eq("contract_id", id).order("created_at", { ascending: false })),
  ]);
  const open = ["sent", "viewed", "in_review", "signed"].includes(c.status);
  const signers = parties.filter((p) => p.role === "signer");
  const next = signers.find((p) => p.status !== "signed" && p.status !== "declined");
  const mineToSign = open && next && !next.is_internal && canAct(ctx.permission)
    && (next.email.toLowerCase() === ctx.profile.email.toLowerCase() || ctx.permission === "admin") ? next : null;
  const href = c.document_path?.startsWith("files/") ? `/api/files/${c.document_path.slice(6)}` : null;

  return (
    <>
      <PageHead title={c.title} crumbs={[{ label: "Contracts", href: "/vendor/contracts" }, { label: c.contract_ref }]} sub={`${human(c.document_type)}${c.version > 1 ? ` · version ${c.version}` : ""}`}>
        <Pill tone={statusTone(c.status)}>{c.status === "counter_signed" ? "Fully signed" : human(c.status)}</Pill>
      </PageHead>

      {mineToSign && (
        <Card className="flex flex-wrap items-center gap-3 border-accent/40 bg-accent-soft px-5 py-4">
          <MSymbol name="draw" size={22} className="text-accent" />
          <p className="min-w-0 flex-1 text-sm"><b>It&apos;s your turn to sign</b> as {mineToSign.name} ({mineToSign.email}){c.due_date ? `, by ${formatDate(c.due_date)}` : ""}.</p>
          <ActionDialog label="Sign" variant="primary" title={`Sign ${c.title}`} sub={`Signing as ${mineToSign.name}`} action={signContract} hidden={{ party: mineToSign.id, decision: "sign" }} submit="Sign contract">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" required /> I have read this contract and I am authorised to sign it for {ctx.company.name}.</label>
            <p className="text-xs text-muted">Your signature is recorded with your account, email address and the time.</p>
          </ActionDialog>
          <ActionDialog label="Decline" variant="danger" title={`Decline ${c.title}`} action={signContract} hidden={{ party: mineToSign.id, decision: "decline" }} submit="Decline contract">
            <label className="label" htmlFor="note">Why are you declining?</label>
            <textarea id="note" name="note" required rows={3} maxLength={2000} className="input" />
          </ActionDialog>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Panel title="Summary">
            <div className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              <div><p className="eyebrow">Value</p><p className="font-semibold">{c.value != null ? money(c.value, c.currency, 0) : "—"}</p></div>
              <div><p className="eyebrow">Term</p><p className="font-semibold">{c.start_date ? `${formatDate(c.start_date)} to ${formatDate(c.end_date)}` : "—"}</p></div>
              <div><p className="eyebrow">Sent</p><p className="font-semibold">{formatDate(c.sent_at)}</p></div>
              {c.content_summary && <p className="sm:col-span-3">{c.content_summary}</p>}
              {href && <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline sm:col-span-3"><MSymbol name="picture_as_pdf" size={18} /> Open the contract document</a>}
            </div>
          </Panel>
          <Panel title="Comments & history">
            {canAct(ctx.permission) && c.status !== "cancelled" && (
              <div className="border-b border-line p-5">
                <ActionForm action={commentContract} hidden={{ id: c.id }} submit="Send comment" resetOnOk>
                  <label className="label" htmlFor="body">Comment or question for adm Indicia</label>
                  <textarea id="body" name="body" required rows={3} maxLength={2000} className="input" />
                </ActionForm>
              </div>
            )}
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="flex gap-3 px-5 py-3 text-sm">
                  <MSymbol name={a.event_type === "commented" ? "chat" : a.event_type === "signed" ? "draw" : "history"} size={18} className="mt-0.5 text-muted" />
                  <div className="min-w-0 flex-1"><p>{a.event_type === "commented" ? <><b>{a.mine ? "You" : "Your team"}:</b> {a.description}</> : a.description ?? human(a.event_type)}</p>
                    <p className="text-xs text-muted">{timeAgo(a.created_at)}</p></div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title="Signing order" sub="Each signer signs after everyone above them">
          <ol className="divide-y divide-line">
            {parties.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-xs font-bold">{p.signing_order}</span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{p.name}</span><span className="block truncate text-xs text-muted">{p.is_internal ? "adm Indicia" : p.email} · {human(p.role)}</span></span>
                <Pill tone={statusTone(p.status)}>{p.status === "signed" && p.signed_at ? `Signed ${formatDate(p.signed_at)}` : human(p.status)}</Pill>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
