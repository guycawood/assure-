import Link from "next/link";
import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, money, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Contracts" };

type Contract = { id: string; contract_ref: string; title: string; document_type: string; status: string; version: number; value: number | null; currency: string;
  start_date: string | null; end_date: string | null; due_date: string | null; sent_at: string | null };

export default async function ContractsPage() {
  await requireVendorCompany();
  const supabase = await createClient();
  const list = await rows<Contract>(supabase.from("vendor_contracts").select("id, contract_ref, title, document_type, status, version, value, currency, start_date, end_date, due_date, sent_at").order("sent_at", { ascending: false }));
  const waiting = list.filter((c) => ["sent", "viewed", "in_review", "signed"].includes(c.status));
  return (
    <>
      <PageHead title="Contracts" sub={`Contracts adm Indicia has sent you. Open one to read it, comment, and sign in the order shown.${waiting.length ? ` ${waiting.length} waiting for signatures.` : ""}`} />
      <Card className="overflow-x-auto">
        {list.length === 0 ? <Empty title="No contracts yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Contract</th><th className="th">Type</th><th className="th text-right">Value</th><th className="th">Term</th><th className="th">Sign by</th><th className="th">Status</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="td"><Link href={`/vendor/contracts/${c.id}`} className="font-semibold hover:underline">{c.title}</Link><span className="block text-xs text-muted">{c.contract_ref}{c.version > 1 ? ` · v${c.version}` : ""}</span></td>
                  <td className="td">{human(c.document_type)}</td>
                  <td className="td text-right tabular-nums">{c.value != null ? money(c.value, c.currency, 0) : "—"}</td>
                  <td className="td">{c.start_date ? `${formatDate(c.start_date)} to ${formatDate(c.end_date)}` : "—"}</td>
                  <td className="td">{formatDate(c.due_date) || "—"}</td>
                  <td className="td"><Pill tone={statusTone(c.status)}>{c.status === "counter_signed" ? "Fully signed" : human(c.status)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
