// Forms shared by the Assure+ pages and the Supplier 360 tabs. Server components that render a client ActionForm.
import {
  addCertificate, addDocument, createContract, createTask, logActivity, logInspection, raiseNcr, recordPerformance, reviewCertificate,
  reviewDocument, saveProfile, saveReview, setRiskLevel, setTaskStatus,
} from "@/app/(platform)/assure/srm-actions";
import {
  currentPeriod, DOC_TYPES, DOCUMENT_TYPES, ENTITY_TYPES, INSPECTION_RESULT, INSPECTION_TYPES, NCR_SEVERITY, PAYMENT_TERMS, PRIORITY, REVIEW_TYPES,
  RISK, SENTIMENT, BR_STATUS, TASK_CATEGORY, type BusinessReview, type SupplierProfile, type Task,
} from "@/lib/assure";
import { ActionForm, Field, Select } from "./action-form";

type Opt = { id: string; name: string };
const today = () => new Date().toISOString().slice(0, 10);

function SupplierPick({ suppliers, supplierId }: { suppliers?: Opt[]; supplierId?: string }) {
  if (supplierId) return null;
  return (
    <Field label="Supplier">
      <select name="supplier_id" required className="input" defaultValue="">
        <option value="">Choose…</option>
        {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </Field>
  );
}

export function CertificateForm({ supplierId, suppliers, types }: { supplierId?: string; suppliers?: Opt[]; types: { id: string; name: string }[] }) {
  return (
    <ActionForm action={addCertificate} submit="Add certificate" hidden={{ supplier_id: supplierId }} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-3">
        <SupplierPick suppliers={suppliers} supplierId={supplierId} />
        <Field label="Certificate type" hint="From the Watchtower certification types library">
          <select name="cert_type_id" required className="input" defaultValue=""><option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
        <Field label="Certificate number"><input name="cert_number" className="input" /></Field>
        <Field label="Issued by"><input name="issuer" className="input" placeholder="e.g. SGS" /></Field>
        <Field label="Issue date"><input name="issue_date" type="date" className="input" /></Field>
        <Field label="Expiry date"><input name="expiry_date" type="date" className="input" /></Field>
        <Field label="Audit score (0-100)"><input name="audit_score" type="number" min={0} max={100} step="0.1" className="input" /></Field>
        <Field label="Document location" hint="Where the evidence is stored"><input name="document_path" className="input" placeholder="SharePoint path or file reference" /></Field>
        <Field label="Internal note"><input name="internal_notes" className="input" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="not_applicable" /> Not applicable to this supplier</label>
      <p className="text-xs text-muted">New certificates start as &ldquo;to check&rdquo;. Someone other than you verifies them.</p>
    </ActionForm>
  );
}

export function CertReview({ id, supplierId }: { id: string; supplierId: string }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ActionForm action={reviewCertificate} submit="Verify" hidden={{ id, supplier_id: supplierId, decision: "verify" }} inline variant="secondary" />
      <ActionForm action={reviewCertificate} submit="Reject" hidden={{ id, supplier_id: supplierId, decision: "reject" }} inline variant="danger">
        <input name="reason" required className="input w-56 py-1.5" placeholder="Reason the vendor can act on" aria-label="Rejection reason" />
      </ActionForm>
    </div>
  );
}

export function DocReview({ id, supplierId }: { id: string; supplierId: string }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ActionForm action={reviewDocument} submit="Verify" hidden={{ id, supplier_id: supplierId, decision: "verify" }} inline variant="secondary" />
      <ActionForm action={reviewDocument} submit="Reject" hidden={{ id, supplier_id: supplierId, decision: "reject" }} inline variant="danger">
        <input name="note" required className="input w-56 py-1.5" placeholder="Reason the vendor can act on" aria-label="Rejection reason" />
      </ActionForm>
    </div>
  );
}

export function DocumentForm({ supplierId }: { supplierId: string }) {
  return (
    <ActionForm action={addDocument} submit="Add document" hidden={{ supplier_id: supplierId }} resetOnOk inline>
      <Field label="Type" className="min-w-[160px]"><Select name="doc_type" options={DOC_TYPES} /></Field>
      <Field label="Title" className="min-w-[200px] flex-1"><input name="title" required className="input" /></Field>
      <Field label="File location" className="min-w-[200px] flex-1"><input name="file_path" required className="input" /></Field>
      <Field label="PO reference" className="w-40"><input name="po_reference" className="input" /></Field>
    </ActionForm>
  );
}

export function InspectionForm({ supplierId, suppliers }: { supplierId?: string; suppliers?: Opt[] }) {
  return (
    <ActionForm action={logInspection} submit="Log inspection" hidden={{ supplier_id: supplierId }} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-3">
        <SupplierPick suppliers={suppliers} supplierId={supplierId} />
        <Field label="PO reference"><input name="po_reference" className="input" /></Field>
        <Field label="Product"><input name="product_name" className="input" /></Field>
        <Field label="Inspection type"><Select name="inspection_type" options={INSPECTION_TYPES} defaultValue="final" /></Field>
        <Field label="Date"><input name="inspection_date" type="date" defaultValue={today()} className="input" /></Field>
        <Field label="AQL level"><input name="aql_level" className="input" placeholder="e.g. II / 2.5" /></Field>
        <Field label="Sample size"><input name="sample_size" type="number" min={0} className="input" /></Field>
        <Field label="Defects found (count)"><input name="defect_count" type="number" min={0} defaultValue={0} className="input" /></Field>
        <Field label="Result"><Select name="result" options={INSPECTION_RESULT} defaultValue="pending" /></Field>
      </div>
      <Field label="Defects (one per line)"><textarea name="defects_found" rows={2} className="input" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Corrective action notes"><input name="corrective_action_notes" className="input" /></Field>
        <Field label="Internal notes (not shown to the vendor)"><input name="internal_notes" className="input" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="corrective_action_required" /> Corrective action required</label>
      <p className="text-xs text-muted">You are recorded as the inspector.</p>
    </ActionForm>
  );
}

export function NcrForm({ supplierId, suppliers, categories, inspectionId }: { supplierId?: string; suppliers?: Opt[]; categories: { id: string; name: string }[]; inspectionId?: string }) {
  return (
    <ActionForm action={raiseNcr} submit="Raise NCR" hidden={{ supplier_id: supplierId, inspection_id: inspectionId }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <SupplierPick suppliers={suppliers} supplierId={supplierId} />
        <Field label="Category" hint="From the Watchtower non-conformance categories">
          <select name="category_id" required className="input" defaultValue=""><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Severity"><Select name="severity" options={NCR_SEVERITY} defaultValue="major" /></Field>
        <Field label="What went wrong" className="sm:col-span-2"><input name="title" required className="input" /></Field>
        <Field label="PO reference"><input name="po_reference" className="input" /></Field>
        <Field label="Response due" hint="Defaults by severity: 7 / 14 / 30 days"><input name="due_date" type="date" className="input" /></Field>
      </div>
      <Field label="Details for the vendor"><textarea name="description" rows={2} className="input" /></Field>
      <Field label="Internal notes (not shown to the vendor)"><input name="internal_notes" className="input" /></Field>
    </ActionForm>
  );
}

export function TaskForm({ supplierId, suppliers }: { supplierId?: string; suppliers?: Opt[] }) {
  return (
    <ActionForm action={createTask} submit="Add task" hidden={{ supplier_id: supplierId }} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-3">
        <SupplierPick suppliers={suppliers} supplierId={supplierId} />
        <Field label="Task" className="sm:col-span-2"><input name="title" required className="input" /></Field>
        <Field label="Category"><Select name="category" options={TASK_CATEGORY} defaultValue="quality" /></Field>
        <Field label="Priority"><Select name="priority" options={PRIORITY} defaultValue="medium" /></Field>
        <Field label="Due"><input name="due_date" type="date" className="input" /></Field>
      </div>
      <Field label="Description"><textarea name="description" rows={2} className="input" /></Field>
    </ActionForm>
  );
}

/** The next legal moves for a task (the database enforces who may make them). */
export function TaskMoves({ task }: { task: Pick<Task, "id" | "status" | "supplier_id"> }) {
  const moves: [string, string, "primary" | "secondary" | "danger"][] =
    task.status === "open" ? [["in_progress", "Start", "secondary"], ["completed", "Complete", "secondary"]]
      : task.status === "in_progress" ? [["completed", "Complete", "secondary"]]
        : task.status === "completed" ? [["verified", "Verify", "primary"], ["in_progress", "Reopen", "danger"]] : [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {moves.map(([status, label, variant]) => (
        <ActionForm key={status} action={setTaskStatus} submit={label} hidden={{ id: task.id, status, supplier_id: task.supplier_id }} variant={variant} inline />
      ))}
    </div>
  );
}

export function PerformanceForm({ supplierId }: { supplierId: string }) {
  return (
    <ActionForm action={recordPerformance} submit="Save scores" hidden={{ supplier_id: supplierId }}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Period"><input name="period" required defaultValue={currentPeriod()} pattern="\d{4}-Q[1-4]" className="input" /></Field>
        {[["cost", "Cost"], ["otif", "OTIF"], ["quality", "Quality"], ["compliance", "Compliance"], ["sustainability", "Sustainability"]].map(([k, l]) => (
          <Field key={k} label={`${l} (0-100)`}><input name={k} type="number" min={0} max={100} step="0.1" className="input" /></Field>
        ))}
        <Field label="NCRs in period"><input name="ncr_count" type="number" min={0} defaultValue={0} className="input" /></Field>
        <Field label="Defect rate %"><input name="defect_rate" type="number" min={0} max={100} step="0.1" className="input" /></Field>
      </div>
      <Field label="Internal notes"><input name="notes" className="input" /></Field>
      <p className="text-xs text-muted">Saving a period that already exists corrects it; the change is logged. The composite is the average of the scores entered.</p>
    </ActionForm>
  );
}

export function ReviewForm({ supplierId, suppliers, review }: { supplierId?: string; suppliers?: Opt[]; review?: BusinessReview }) {
  const r = review;
  return (
    <ActionForm action={saveReview} submit={r ? "Save review" : "Schedule review"} hidden={{ id: r?.id, supplier_id: r ? undefined : supplierId }}>
      <div className="grid gap-3 sm:grid-cols-3">
        {!r && <SupplierPick suppliers={suppliers} supplierId={supplierId} />}
        <Field label="Topic" className={r ? "sm:col-span-2" : ""}><input name="title" required defaultValue={r?.title} className="input" /></Field>
        <Field label="Type"><Select name="review_type" options={REVIEW_TYPES} defaultValue={r?.review_type ?? "qbr"} /></Field>
        <Field label="Meeting date"><input name="meeting_date" type="date" required defaultValue={r?.meeting_date} className="input" /></Field>
        {r && <Field label="Status"><Select name="status" options={BR_STATUS} defaultValue={r.status} /></Field>}
        <Field label="Next review"><input name="next_review_date" type="date" defaultValue={r?.next_review_date ?? ""} className="input" /></Field>
      </div>
      <Field label="Description"><textarea name="description" rows={2} defaultValue={r?.description ?? ""} className="input" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Agenda (one item per line)"><textarea name="agenda_items" rows={3} required defaultValue={r?.agenda_items.join("\n")} className="input" /></Field>
        <Field label="adm Indicia attendees (emails)"><textarea name="internal_attendees" rows={3} defaultValue={r?.internal_attendees.join("\n")} className="input" /></Field>
        <Field label="Vendor attendees"><textarea name="vendor_attendees" rows={3} defaultValue={r?.vendor_attendees.join("\n")} className="input" /></Field>
      </div>
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Internal only: never shown to the vendor</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Key outcomes" hint="Changing outcomes sends them to the Procurement head for approval" className="sm:col-span-2"><textarea name="key_outcomes" rows={2} defaultValue={r?.key_outcomes ?? ""} className="input" /></Field>
          <Field label="Sentiment"><Select name="overall_sentiment" options={SENTIMENT} defaultValue={r?.overall_sentiment} blank="—" /></Field>
        </div>
        <Field label="Discussion notes" className="mt-3"><textarea name="discussion_notes" rows={2} defaultValue={r?.discussion_notes ?? ""} className="input" /></Field>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shared_with_vendor" defaultChecked={r?.shared_with_vendor} /> Share with the vendor (they see the date, agenda and attendees only)</label>
    </ActionForm>
  );
}

export function ContractForm({ supplierId, suppliers, templates }: { supplierId?: string; suppliers?: Opt[]; templates: { id: string; name: string }[] }) {
  return (
    <ActionForm action={createContract} submit="Create draft" hidden={{ supplier_id: supplierId }}>
      <div className="grid gap-3 sm:grid-cols-3">
        {!supplierId && (
          <Field label="Supplier">
            <select name="supplier_id" className="input" defaultValue=""><option value="">No supplier yet</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
        )}
        <Field label="Title"><input name="title" required className="input" /></Field>
        <Field label="Type"><Select name="document_type" options={DOCUMENT_TYPES} defaultValue="contract" /></Field>
        <Field label="Start from template">
          <select name="template_id" className="input" defaultValue=""><option value="">Blank</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
        <Field label="Value"><input name="value" type="number" min={0} step="0.01" className="input" /></Field>
        <Field label="Currency"><input name="currency" defaultValue="EUR" maxLength={3} className="input uppercase" /></Field>
        <Field label="Start"><input name="start_date" type="date" className="input" /></Field>
        <Field label="End"><input name="end_date" type="date" className="input" /></Field>
        <Field label="Signature due"><input name="due_date" type="date" className="input" /></Field>
      </div>
      <Field label="Document location"><input name="document_path" className="input" /></Field>
    </ActionForm>
  );
}

export function ActivityForm({ supplierId }: { supplierId: string }) {
  return (
    <ActionForm action={logActivity} submit="Log" hidden={{ supplier_id: supplierId }} resetOnOk inline>
      <Field label="What" className="w-32"><Select name="kind" options={[{ value: "note", label: "Note" }, { value: "call", label: "Call" }, { value: "meeting", label: "Meeting" }, { value: "email", label: "Email" }]} /></Field>
      <Field label="Title" className="min-w-[200px] flex-1"><input name="title" required className="input" /></Field>
      <Field label="Details" className="min-w-[240px] flex-[2]"><input name="body" className="input" /></Field>
    </ActionForm>
  );
}

export function RiskForm({ supplierId, current }: { supplierId: string; current: string }) {
  return (
    <ActionForm action={setRiskLevel} submit="Set risk" hidden={{ supplier_id: supplierId }} inline variant="secondary">
      <Field label="Risk level" className="w-36"><Select name="risk_level" options={RISK} defaultValue={current} /></Field>
      <Field label="Why" className="min-w-[220px] flex-1"><input name="reason" required className="input" /></Field>
    </ActionForm>
  );
}

export function ProfileForm({ supplierId, p }: { supplierId: string; p?: SupplierProfile }) {
  return (
    <ActionForm action={saveProfile} submit="Save" hidden={{ supplier_id: supplierId }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Payment terms"><Select name="payment_terms" options={PAYMENT_TERMS} defaultValue={p?.payment_terms ?? "net_30"} /></Field>
        <Field label="Custom days" hint="Only for custom terms"><input name="payment_terms_days" type="number" min={0} max={365} defaultValue={p?.payment_terms_days ?? ""} className="input" /></Field>
        <Field label="NTI rate %"><input name="nti_rate" type="number" min={0} max={100} step="0.1" defaultValue={p?.nti_rate ?? ""} className="input" /></Field>
        <Field label="Annual spend forecast (€)"><input name="annual_spend_forecast" type="number" min={0} step="1000" defaultValue={p?.annual_spend_forecast ?? ""} className="input" /></Field>
        <Field label="Legal entity"><input name="legal_entity" defaultValue={p?.legal_entity ?? ""} className="input" /></Field>
        <Field label="Trading name"><input name="trading_name" defaultValue={p?.trading_name ?? ""} className="input" /></Field>
        <Field label="Entity type"><Select name="entity_type" options={ENTITY_TYPES} defaultValue={p?.entity_type} blank="—" /></Field>
        <Field label="Sub-category"><input name="sub_category" defaultValue={p?.sub_category ?? ""} className="input" /></Field>
        <Field label="Vendor code (ERP)"><input name="vendor_code" defaultValue={p?.vendor_code ?? ""} className="input" /></Field>
        <Field label="UEN / registration"><input name="uen_number" defaultValue={p?.uen_number ?? ""} className="input" /></Field>
        <Field label="Factories"><input name="factory_count" type="number" min={0} defaultValue={p?.factory_count ?? ""} className="input" /></Field>
        <Field label="Website"><input name="website" defaultValue={p?.website ?? ""} className="input" placeholder="https://" /></Field>
        <Field label="Primary contact"><input name="primary_contact_name" defaultValue={p?.primary_contact_name ?? ""} className="input" /></Field>
        <Field label="Contact phone"><input name="contact_phone" defaultValue={p?.contact_phone ?? ""} className="input" /></Field>
        <Field label="Address"><input name="address" defaultValue={p?.address ?? ""} className="input" /></Field>
      </div>
      <p className="text-xs text-muted">Payment term and NTI changes are recorded in the activity trail.</p>
    </ActionForm>
  );
}
