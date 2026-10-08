import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { getLibrary, rows, supplierOptions } from "@/lib/assure-data";
import { CERT_STATUS, type Certificate } from "@/lib/assure";
import { REGIONS } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Chips, Date_, OptPill, SupplierLink } from "@/components/assure/bits";
import { CertificateForm } from "@/components/assure/forms";

export const metadata: Metadata = { title: "Compliance" };

type SP = Promise<{ region?: string; status?: string; type?: string }>;

export default async function CompliancePage({ searchParams }: { searchParams: SP }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [certs, suppliers, types, docs] = await Promise.all([
    rows<Certificate>(supabase, "supplier_certificates_v", { order: "expiry_date", asc: true }),
    getSuppliers(supabase),
    getLibrary(supabase, "certification_types"),
    rows<{ id: string; status: string }>(supabase, "supplier_documents", { cols: "id, status" }),
  ]);
  const sMap = new Map(suppliers.map((s) => [s.id, s]));
  const scoped = certs.filter((c) => (!sp.region || c.region === sp.region) && (!sp.type || c.cert_type_id === sp.type));
  const list = scoped.filter((c) => !sp.status || c.status === sp.status);
  const count = (st: string) => scoped.filter((c) => c.status === st).length;
  const expired = scoped.filter((c) => c.status === "expired");
  const expiring = scoped.filter((c) => c.status === "expiring_soon");
  const scopedSuppliers = suppliers.filter((s) => !sp.region || s.region === sp.region);
  const withIssue = new Set(scoped.filter((c) => ["expired", "rejected"].includes(c.status)).map((c) => c.supplier_id));
  const coverage = scopedSuppliers.length ? Math.round(((scopedSuppliers.length - scopedSuppliers.filter((s) => withIssue.has(s.id)).length) / scopedSuppliers.length) * 100) : 0;
  const pendingDocs = docs.filter((d) => d.status === "pending").length;
  const keep = { region: sp.region, status: sp.status, type: sp.type };

  const shortList = (items: Certificate[], empty: string) => items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">{empty}</p> : (
    <ul className="divide-y divide-line">
      {items.slice(0, 12).map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
          <div className="min-w-0"><SupplierLink id={c.supplier_id} name={sMap.get(c.supplier_id)?.name} tab="compliance" /><div className="text-xs text-muted">{c.cert_type_name}</div></div>
          <div className="text-right text-xs"><Date_ d={c.expiry_date} /><div className={c.status === "expired" ? "text-bad" : "text-warn"}>{c.days_left !== null && (c.days_left < 0 ? `${-c.days_left} days ago` : `${c.days_left} days left`)}</div></div>
        </li>
      ))}
      {items.length > 12 && <li className="px-5 py-2 text-xs text-muted">and {items.length - 12} more below</li>}
    </ul>
  );

  return (
    <>
      <PageHead title="Compliance" sub="Certificates across all suppliers. One rule everywhere: expired once the date passes, expiring soon within 90 days." crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Compliance" }]}>
        <ButtonLink href="/assure/compliance/review" variant="primary"><MSymbol name="fact_check" size={18} /> Review queue{pendingDocs + count("pending") ? ` (${pendingDocs + count("pending")})` : ""}</ButtonLink>
      </PageHead>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Coverage" value={`${coverage}%`} hint="Suppliers with no expired or rejected certificate" />
        <Stat label="Valid" value={count("valid") + count("no_expiry")} tone="ok" />
        <Stat label="Expiring soon" value={count("expiring_soon")} tone={count("expiring_soon") ? "warn" : undefined} hint="Within 90 days" />
        <Stat label="Expired" value={count("expired")} tone={count("expired") ? "bad" : undefined} />
        <Stat label="To check" value={count("pending")} hint="Waiting for verification" />
      </section>
      <div className="flex flex-col gap-2">
        <Chips label="Region:" param="region" options={REGIONS.map((r) => ({ value: r, label: r }))} active={sp.region} keep={keep} />
        <Chips label="Type:" param="type" options={types.map((t) => ({ value: t.id, label: t.name }))} active={sp.type} keep={keep} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Expired (${expired.length})`} sub="Chase the renewed certificate; purchasing rules may apply.">{shortList(expired, "Nothing has expired.")}</Panel>
        <Panel title={`Expiring in the next 90 days (${expiring.length})`}>{shortList(expiring, "Nothing expires in the next 90 days.")}</Panel>
      </div>
      <div>
        <Chips label="Status:" param="status" options={CERT_STATUS.filter((o) => o.value !== "no_expiry").map((o) => ({ value: o.value, label: o.label, count: count(o.value) }))} active={sp.status} keep={keep} />
      </div>
      <Card className="overflow-x-auto">
        {list.length === 0 ? <Empty title="No certificates match" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Supplier", "Certificate", "Number", "Issued", "Expires", "Score", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="td"><SupplierLink id={c.supplier_id} name={sMap.get(c.supplier_id)?.name} tab="compliance" /><div className="text-xs text-muted">{[c.region, c.market].filter(Boolean).join(" · ")}</div></td>
                  <td className="td">{c.cert_type_name}</td>
                  <td className="td">{c.cert_number ?? "—"}</td>
                  <td className="td"><Date_ d={c.issue_date} /></td>
                  <td className="td"><Date_ d={c.expiry_date} /></td>
                  <td className="td tabular-nums">{c.audit_score ?? "—"}</td>
                  <td className="td"><OptPill list={CERT_STATUS} value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Panel title="Add a certificate" sub="Pick the supplier; someone else verifies it."><div className="p-5"><CertificateForm suppliers={supplierOptions(suppliers)} types={types} /></div></Panel>
      <p className="text-xs text-muted">Certificate types are governed in the <Link href="/watchtower" className="underline">Watchtower</Link> library &ldquo;Certification types&rdquo;.</p>
    </>
  );
}
