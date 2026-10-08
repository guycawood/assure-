import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { DOC_TYPES, expiryTone, human, statusTone } from "@/lib/vendor";
import { Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionDialog } from "@/components/vendor/action-form";
import { addCertificate, addDocument } from "../actions";

export const metadata = { title: "Certificates & documents" };

type Cert = { id: string; cert_type_name: string; cert_number: string | null; issuer: string | null; issue_date: string | null; expiry_date: string | null;
  document_path: string | null; verification_status: string; rejection_reason: string | null; uploaded_by_role: string; created_at: string; expiry_status: string };
type Doc = { id: string; doc_type: string; title: string; file_path: string; po_reference: string | null; status: string; review_note: string | null; uploaded_by_role: string; created_at: string };

const fileHref = (p: string | null) => (p && p.startsWith("files/") ? `/api/files/${p.slice(6)}` : null);
const EXPIRY_LABEL: Record<string, string> = { expired: "Expired", expiring_soon: "Expiring soon", valid: "Valid", no_expiry: "No expiry" };

function CertFields({ types, preset }: { types: { id: string; name: string }[]; preset?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cert_type">Certificate type</label>
        <select id="cert_type" name="cert_type" required className="input" defaultValue={preset ?? ""}>
          <option value="" disabled>Choose…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="cert_number">Certificate number</label><input id="cert_number" name="cert_number" maxLength={100} className="input" /></div>
      <div><label className="label" htmlFor="issuer">Issued by</label><input id="issuer" name="issuer" maxLength={200} className="input" placeholder="e.g. SGS, Bureau Veritas" /></div>
      <div><label className="label" htmlFor="issue_date">Issue date</label><input id="issue_date" name="issue_date" type="date" className="input" /></div>
      <div><label className="label" htmlFor="expiry_date">Expiry date</label><input id="expiry_date" name="expiry_date" type="date" className="input" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="file">Certificate document</label><input id="file" name="file" type="file" required accept=".pdf,image/*" className="input" />
        <p className="mt-1 text-xs text-muted">PDF or image, up to 15 MB. adm Indicia checks every upload before it counts.</p></div>
    </div>
  );
}

export default async function CompliancePage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [certs, types, docs] = await Promise.all([
    rows<Cert>(supabase.from("vendor_certificates").select("*").order("created_at", { ascending: false })),
    rows<{ id: string; name: string }>(supabase.from("vendor_certificate_types").select("id, name").order("name")),
    rows<Doc>(supabase.from("supplier_documents").select("id, doc_type, title, file_path, po_reference, status, review_note, uploaded_by_role, created_at").order("created_at", { ascending: false })),
  ]);
  // Latest certificate per type is the one that counts; older ones are history.
  const latest = new Map<string, Cert>();
  for (const c of certs) if (!latest.has(c.cert_type_name)) latest.set(c.cert_type_name, c);
  const current = [...latest.values()];
  const history = certs.filter((c) => !current.includes(c));
  const act = canAct(ctx.permission);
  const count = (s: string) => current.filter((c) => c.verification_status !== "rejected" && c.expiry_status === s).length;

  return (
    <>
      <PageHead title="Certificates & documents" sub="Keep your certificates current: anything expired or expiring within 90 days is flagged. Upload a renewal to replace a certificate; adm Indicia checks it before it counts.">
        {act && (
          <ActionDialog label="Upload certificate" variant="primary" title="Upload a certificate" action={addCertificate} submit="Upload" wide>
            <CertFields types={types} />
          </ActionDialog>
        )}
      </PageHead>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Valid" value={count("valid") + count("no_expiry")} tone="ok" />
        <Stat label="Expiring within 90 days" value={count("expiring_soon")} tone={count("expiring_soon") ? "warn" : undefined} />
        <Stat label="Expired" value={count("expired")} tone={count("expired") ? "bad" : undefined} />
        <Stat label="Waiting for checks" value={current.filter((c) => c.verification_status === "pending").length} />
      </div>

      <Panel title="Certificates" sub={`${current.length} current`}>
        {current.length === 0 ? <Empty title="No certificates yet">Upload your quality, environmental and social certificates.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Certificate</th><th className="th">Number / issuer</th><th className="th">Expiry</th><th className="th">Check by adm Indicia</th><th className="th" /></tr></thead>
              <tbody>
                {current.map((c) => {
                  const href = fileHref(c.document_path);
                  const typeId = types.find((t) => t.name === c.cert_type_name)?.id;
                  return (
                    <tr key={c.id}>
                      <td className="td font-semibold">{href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{c.cert_type_name}</a> : c.cert_type_name}</td>
                      <td className="td">{c.cert_number ?? "—"}<span className="block text-xs text-muted">{c.issuer}</span></td>
                      <td className="td">{formatDate(c.expiry_date) || "—"}<span className="mt-0.5 block"><Pill tone={expiryTone(c.expiry_status)}>{EXPIRY_LABEL[c.expiry_status] ?? c.expiry_status}</Pill></span></td>
                      <td className="td"><Pill tone={statusTone(c.verification_status)}>{human(c.verification_status)}</Pill>
                        {c.rejection_reason && c.verification_status === "rejected" && <span className="mt-1 block max-w-[40ch] text-xs text-bad">{c.rejection_reason}</span>}</td>
                      <td className="td text-right">
                        {act && typeId && (c.expiry_status !== "valid" || c.verification_status === "rejected") && (
                          <ActionDialog label="Upload renewal" title={`Replace ${c.cert_type_name}`} action={addCertificate} submit="Upload" wide>
                            <CertFields types={types} preset={typeId} />
                          </ActionDialog>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {history.length > 0 && (
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer font-semibold text-muted">Earlier versions ({history.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {history.map((c) => <li key={c.id}>{c.cert_type_name} · {c.cert_number ?? "no number"} · expired/expires {formatDate(c.expiry_date) || "—"} · {human(c.verification_status)}</li>)}
            </ul>
          </details>
        )}
      </Panel>

      <Panel title="Documents" sub="Insurance, policies and other documents adm Indicia has asked for"
        actions={act && (
          <ActionDialog label="Upload document" title="Upload a document" action={addDocument} submit="Upload">
            <div className="grid gap-3">
              <div><label className="label" htmlFor="doc_type">Type</label>
                <select id="doc_type" name="doc_type" required className="input" defaultValue=""><option value="" disabled>Choose…</option>{DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
              <div><label className="label" htmlFor="title">Title</label><input id="title" name="title" required maxLength={200} className="input" placeholder="e.g. Product liability insurance 2026" /></div>
              <div><label className="label" htmlFor="po_reference">PO reference (optional)</label><input id="po_reference" name="po_reference" maxLength={60} className="input" /></div>
              <div><label className="label" htmlFor="dfile">File</label><input id="dfile" name="file" type="file" required className="input" /></div>
            </div>
          </ActionDialog>
        )}>
        {docs.length === 0 ? <Empty title="No documents yet" /> : (
          <ul className="divide-y divide-line">
            {docs.map((d) => {
              const href = fileHref(d.file_path);
              return (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <MSymbol name="description" size={20} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    {href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{d.title}</a> : <span className="font-semibold">{d.title}</span>}
                    <span className="block text-xs text-muted">{human(d.doc_type)}{d.po_reference ? ` · ${d.po_reference}` : ""} · {formatDate(d.created_at)} · {d.uploaded_by_role === "vendor" ? "uploaded by you" : "from adm Indicia"}</span>
                    {d.status === "rejected" && d.review_note && <span className="block text-xs text-bad">{d.review_note}</span>}
                  </span>
                  <Pill tone={statusTone(d.status)}>{human(d.status)}</Pill>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
