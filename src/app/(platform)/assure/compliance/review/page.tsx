import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers } from "@/lib/data";
import { rows } from "@/lib/assure-data";
import { DOC_TYPES, optLabel, type Certificate, type SupplierDocument } from "@/lib/assure";
import { formatDate, personName, timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead, Panel, Stat } from "@/components/ui";
import { Chips, SupplierLink } from "@/components/assure/bits";
import { CertReview, DocReview } from "@/components/assure/forms";

export const metadata: Metadata = { title: "Document review" };

// The review queue: documents and certificates waiting to be checked. Vendors upload; staff verify or reject.
// Nobody can check their own upload (enforced in the database too).
export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [docs, certs, suppliers, people] = await Promise.all([
    rows<SupplierDocument>(supabase, "supplier_documents", { eq: ["status", "pending"], order: "created_at", asc: true }),
    rows<Certificate>(supabase, "supplier_certificates_v", { eq: ["verification_status", "pending"], order: "created_at", asc: true }),
    getSuppliers(supabase),
    getInternalPeople(supabase),
  ]);
  const sMap = new Map(suppliers.map((s) => [s.id, s]));
  const pMap = byId(people);
  const q = sp.q?.toLowerCase();
  const match = (supplierId: string, ...text: (string | null)[]) => !q || [sMap.get(supplierId)?.name ?? "", ...text].some((t) => t?.toLowerCase().includes(q));
  const docList = docs.filter((d) => (!sp.type || d.doc_type === sp.type) && match(d.supplier_id, d.title, d.po_reference));
  const certList = sp.type ? [] : certs.filter((c) => match(c.supplier_id, c.cert_type_name, c.cert_number));
  const uploader = (role: string, id: string | null) => (role === "vendor" ? "Vendor" : id ? personName(pMap.get(id)) : "System");

  return (
    <>
      <PageHead title="Document review queue" sub="Check what vendors and colleagues have uploaded. Verify it, or reject it with a reason the vendor can act on."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Compliance", href: "/assure/compliance" }, { label: "Review queue" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Documents to check" value={docs.length} />
        <Stat label="Certificates to check" value={certs.length} />
        <Stat label="Suppliers affected" value={new Set([...docs.map((d) => d.supplier_id), ...certs.map((c) => c.supplier_id)]).size} />
        <Stat label="Waiting over 5 days" value={[...docs, ...certs].filter((x) => Date.now() - Date.parse(x.created_at) > 5 * 86400000).length} tone="warn" />
      </section>
      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Supplier, document or PO reference" className="input" /></label>
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <button className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg" type="submit">Search</button>
        </form>
        <div className="mt-3"><Chips label="Document type:" param="type" options={DOC_TYPES.map((d) => ({ value: d.value, label: d.label, count: docs.filter((x) => x.doc_type === d.value).length })).filter((o) => o.count)} active={sp.type} keep={{ q: sp.q, type: sp.type }} /></div>
      </Card>
      <Panel title={`Documents (${docList.length})`}>
        {docList.length === 0 ? <Empty title="Nothing waiting">Every document has been checked.</Empty> : (
          <ul className="divide-y divide-line">
            {docList.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{d.title}</p>
                  <p className="text-xs text-muted">{optLabel(DOC_TYPES, d.doc_type)}{d.po_reference ? ` · ${d.po_reference}` : ""} · <SupplierLink id={d.supplier_id} name={sMap.get(d.supplier_id)?.name} tab="documents" /></p>
                  <p className="text-xs text-muted">Uploaded by {uploader(d.uploaded_by_role, d.uploaded_by)} · {timeAgo(d.created_at)} · {d.file_path}</p>
                </div>
                {d.uploaded_by === me.id ? <span className="text-xs text-muted">You uploaded this; someone else checks it</span> : <DocReview id={d.id} supplierId={d.supplier_id} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {!sp.type && (
        <Panel title={`Certificates (${certList.length})`}>
          {certList.length === 0 ? <Empty title="Nothing waiting" /> : (
            <ul className="divide-y divide-line">
              {certList.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.cert_type_name}{c.cert_number ? ` · ${c.cert_number}` : ""}</p>
                    <p className="text-xs text-muted"><SupplierLink id={c.supplier_id} name={sMap.get(c.supplier_id)?.name} tab="compliance" />{c.expiry_date ? ` · expires ${formatDate(c.expiry_date)}` : " · no expiry date"}{c.issuer ? ` · ${c.issuer}` : ""}</p>
                    <p className="text-xs text-muted">Uploaded by {uploader(c.uploaded_by_role, c.uploaded_by)} · {timeAgo(c.created_at)}{c.document_path ? ` · ${c.document_path}` : ""}</p>
                  </div>
                  {c.uploaded_by === me.id ? <span className="text-xs text-muted">You uploaded this; someone else checks it</span> : <CertReview id={c.id} supplierId={c.supplier_id} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
