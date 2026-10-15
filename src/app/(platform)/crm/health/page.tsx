import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth } from "@/lib/crm-data";
import { ago, money } from "@/lib/crm";
import { Card, Empty, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ClientLink, RagPill } from "@/components/crm/bits";

export const metadata: Metadata = { title: "Client health · CRM" };

export default async function CrmHealth() {
  await requireInternal();
  const supabase = await createClient();
  const rows = (await getHealth(supabase)).filter((h) => h.active);
  const count = (r: string) => rows.filter((h) => h.rag === r).length;

  return (
    <>
      <PageHead title="Client health" sub="Worked out from spend, overdue bills, satisfaction, open detractor comments, renewals due and how recently we were in touch. Red flags count 2, amber flags 1: four or more points is red, two or three amber."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Client health" }]}>
        <Link href="/crm/watchtower" className="text-sm font-semibold text-accent underline">CRM Watchtower</Link>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Red" value={count("red")} tone={count("red") ? "bad" : "ok"} icon={<MSymbol name="error" />} />
        <Stat label="Amber" value={count("amber")} tone={count("amber") ? "warn" : "ok"} icon={<MSymbol name="warning" />} />
        <Stat label="Green" value={count("green")} tone="ok" icon={<MSymbol name="check_circle" />} />
      </div>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No active clients" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Client</Th><Th>Health</Th><Th>Why</Th><Th className="text-right">Spend this year</Th><Th>Overdue bills</Th><Th>Satisfaction</Th><Th>Next renewal</Th><Th>Last activity</Th></tr></thead>
            <tbody>{rows.map((h) => (
              <tr key={h.client_id} className="align-top">
                <Td><ClientLink id={h.client_id} name={h.name} /><div className="text-xs text-muted">{h.code}</div></Td>
                <Td><RagPill rag={h.rag} /><div className="text-xs text-muted">{h.points} points</div></Td>
                <Td className="text-xs">{h.reasons.join(" · ") || "Nothing to flag"}</Td>
                <Td className="text-right tabular-nums">{money(h.spend_ytd, h.currency)}</Td>
                <Td className={h.overdue_bills ? "text-bad" : ""}>{h.overdue_bills}</Td>
                <Td>{h.satisfaction != null ? `${h.satisfaction}/10` : "—"}{h.nps != null && <div className="text-xs text-muted">NPS {h.nps}</div>}</Td>
                <Td>{h.next_renewal ? <>{fmtDate(h.next_renewal)}<div className="text-xs text-muted">in {h.days_to_renewal} days</div></> : "—"}</Td>
                <Td>{ago(h.last_activity_at)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
