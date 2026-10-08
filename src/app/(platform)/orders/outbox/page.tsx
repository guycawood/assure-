import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/sourcing-data";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Stocktool hand-off" };

type Row = { id: string; module: string; event: string; aggregate_type: string | null; aggregate_id: string | null; payload: Record<string, unknown>; status: string; created_at: string };

export default async function OutboxPage() {
  await requireInternal();
  const supabase = await createClient();
  const list = await rows<Row>(supabase, "integration_outbox", { eq: { module: "sourcing" }, order: [["created_at", false]], limit: 500 });
  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "Stocktool hand-off" }]} title="Stocktool hand-off"
        sub="Sourcing ends at client approval of the estimate: an estimate.approved event with the article, PO and SO details is queued here for Stocktool. The connector delivers it once the API is agreed." />
      <Card className="min-w-0 overflow-x-auto">
        {list.length === 0 ? <Empty title="Nothing queued"><p>Events appear when a client approves an estimate.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Queued</Th><Th>Event</Th><Th>Estimate</Th><Th>Job</Th><Th>Status</Th><Th>Payload</Th></tr></thead>
            <tbody>{list.map((o) => (
              <tr key={o.id}>
                <Td>{fmtDateTime(o.created_at)}</Td><Td><code>{o.event}</code></Td>
                <Td>{o.aggregate_id ? <Link className="hover:underline" href={`/orders/estimates/${o.aggregate_id}`}>{String(o.payload.estimate_number ?? "Estimate")}</Link> : "—"}</Td>
                <Td>{String(o.payload.job_number ?? "—")}</Td>
                <Td><Pill tone={o.status === "sent" ? "ok" : o.status === "failed" ? "bad" : "info"}>{o.status}</Pill></Td>
                <Td><details><summary className="cursor-pointer text-xs">Show</summary><pre className="mt-2 max-h-64 max-w-xl overflow-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify(o.payload, null, 2)}</pre></details></Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
