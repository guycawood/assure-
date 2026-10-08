// Supplier 360 tabs. Each tab loads only its own data (server components; RLS applies to every read).
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { byId, getGateDefs, getInternalPeople } from "@/lib/data";
import { getLibrary, getLibraryNames, rows } from "@/lib/assure-data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { fmtScore, scoreSupplier } from "@/lib/scorecard";
import {
  ACK_STATUS, ACTIVITY_ICON, BR_STATUS, CERT_STATUS, CONTRACT_STATUS, DOC_TYPES, INSPECTION_RESULT, INSPECTION_TYPES, isContractExpiring, isTaskOverdue,
  NCR_SEVERITY, ntiValue, OUTCOME_STATUS, paymentTermLabel, PRIORITY, REVIEW_STATUS, REVIEW_TYPES, SCORE_KEYS, SEVERITY, SUPPLIER_STATUS, TASK_CATEGORY,
  TASK_STATUS, taskProgress, ENTITY_TYPES, optLabel, VENDOR_RESPONSE,
  type Activity, type BusinessReview, type Certificate, type Contract, type Inspection, type Ncr, type PerformanceIssue, type PerformanceRecord,
  type SupplierDocument, type SupplierProfile, type Task,
} from "@/lib/assure";
import { formatDate, formatEur, personName, TIER_LABEL, timeAgo, type GateAudit, type Profile, type Supplier, type SupplierGate, type Ticket } from "@/lib/srt";
import { updateSupplier } from "@/app/(platform)/assure/actions";
import { generateIssues, resolveIssue, updateCertificate } from "@/app/(platform)/assure/srm-actions";
import { Card, Empty, GateStrip, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Bar, Date_, Facts, OptPill, Score } from "@/components/assure/bits";
import { ActionForm, Field } from "@/components/assure/action-form";
import {
  ActivityForm, CertReview, CertificateForm, ContractForm, DocReview, DocumentForm, InspectionForm, NcrForm, PerformanceForm, ProfileForm, ReviewForm, RiskForm,
  TaskForm, TaskMoves,
} from "@/components/assure/forms";
import { TicketTable } from "@/app/(platform)/assure/srt/ticket-table";
import { SupplierForm } from "../supplier-form";
import { FastTrackForm, GapTicketsButton, GateTable } from "./gate-table";

type Props = { supplier: Supplier; profile: SupplierProfile | undefined; me: Profile };

/* ---------------- Overview ---------------- */
export async function OverviewTab({ supplier: s, profile: p }: Props) {
  const supabase = await createClient();
  const [certs, perf, ncrs, tasks, contracts, reviews, people] = await Promise.all([
    rows<Certificate>(supabase, "supplier_certificates_v", { eq: ["supplier_id", s.id] }),
    rows<PerformanceRecord>(supabase, "performance_records", { eq: ["supplier_id", s.id], order: "period" }),
    rows<Ncr>(supabase, "ncrs", { eq: ["supplier_id", s.id] }),
    rows<Task>(supabase, "action_plan_tasks", { eq: ["supplier_id", s.id] }),
    rows<Contract>(supabase, "contracts", { eq: ["supplier_id", s.id] }),
    rows<BusinessReview>(supabase, "business_reviews", { eq: ["supplier_id", s.id], order: "meeting_date" }),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  const latest = perf[0];
  const certIssues = certs.filter((c) => ["expired", "expiring_soon", "rejected"].includes(c.status));
  const live = contracts.find((c) => c.status === "counter_signed" || c.status === "signed");
  const today = new Date().toISOString().slice(0, 10);
  const nextReview = [...reviews].reverse().find((r) => r.status === "scheduled" && r.meeting_date >= today);
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Latest performance" value={latest?.composite_score != null ? Math.round(Number(latest.composite_score)) : "—"} hint={latest ? latest.period : "No scores yet"}
          tone={latest?.composite_score == null ? undefined : Number(latest.composite_score) >= 80 ? "ok" : Number(latest.composite_score) >= 60 ? "warn" : "bad"} />
        <Stat label="Certificates needing attention" value={certIssues.length} hint={`${certs.length} on file`} tone={certIssues.length ? "warn" : "ok"} />
        <Stat label="Open NCRs" value={ncrs.filter((n) => n.status === "open").length} tone={ncrs.some((n) => n.status === "open") ? "bad" : "ok"} />
        <Stat label="Action plan" value={`${taskProgress(tasks)}%`} hint={`${tasks.filter((t) => t.status === "open" || t.status === "in_progress").length} open tasks`} />
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Company">
          <div className="p-5">
            <Facts items={[
              ["Legal entity", p?.legal_entity], ["Trading name", p?.trading_name], ["Entity type", optLabel(ENTITY_TYPES, p?.entity_type)],
              ["Category", [s.category, p?.sub_category].filter(Boolean).join(" · ")], ["Region", s.region], ["Market", s.market], ["Client", s.client],
              ["Factories", p?.factory_count], ["Vendor code", p?.vendor_code], ["UEN", p?.uen_number],
              ["Website", p?.website ? <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-accent underline">{p.website}</a> : null],
              ["Status", <OptPill key="s" list={SUPPLIER_STATUS} value={s.status} />],
            ]} />
          </div>
        </Panel>
        <Panel title="Contacts and ownership">
          <div className="p-5">
            <Facts items={[
              ["Primary contact", p?.primary_contact_name], ["Contact email", s.primary_contact_email], ["Phone", p?.contact_phone],
              ["SRT owner", s.srt_owner ? personName(pMap.get(s.srt_owner)) : null], ["Procurement owner", s.procurement_owner ? personName(pMap.get(s.procurement_owner)) : null],
              ["Onboarding priority", s.priority_tier ? TIER_LABEL[s.priority_tier] : "Clear"],
              ["Live contract", live ? <Link key="c" href={`/assure/contracts/${live.id}`} className="text-accent underline">{live.title}{live.end_date ? ` (ends ${formatDate(live.end_date)})` : ""}</Link> : "None"],
              ["Next business review", nextReview ? <Link key="r" href={`/assure/reviews/${nextReview.id}`} className="text-accent underline">{formatDate(nextReview.meeting_date)}: {nextReview.title}</Link> : "None scheduled"],
            ]} />
          </div>
        </Panel>
      </div>
      {latest && (
        <Panel title={`Performance: ${latest.period}`} sub="0-100 per dimension. 80+ good, 60+ watch, below 60 needs action.">
          <div className="grid gap-4 p-5 sm:grid-cols-5">
            {SCORE_KEYS.map(([k, l]) => (
              <div key={k}>
                <p className="text-xs font-semibold text-muted">{l}</p>
                <p className="font-display text-xl"><Score value={latest[k] as number | null} /></p>
                <Bar value={Number(latest[k] ?? 0)} tone={Number(latest[k] ?? 0) >= 80 ? "ok" : Number(latest[k] ?? 0) >= 60 ? "warn" : "bad"} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

/* ---------------- Onboarding gates (SRT desk view) ---------------- */
export async function OnboardingTab({ supplier: s, me }: Props) {
  const supabase = await createClient();
  const [defs, people, gatesRes, ticketsRes, auditRes] = await Promise.all([
    getGateDefs(supabase),
    getInternalPeople(supabase),
    supabase.from("supplier_gates").select("*").eq("supplier_id", s.id),
    supabase.from("srt_tickets").select("*").eq("supplier_id", s.id).order("created_at", { ascending: false }),
    supabase.from("gate_audit_log").select("*").eq("supplier_id", s.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const gates = (gatesRes.data ?? []) as SupplierGate[];
  const tickets = (ticketsRes.data ?? []) as Ticket[];
  const pMap = byId(people);
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const labelOf = new Map(defs.map((d) => [d.key, d.label]));
  const role = me.is_admin ? "admin" : me.srt_role;
  const isLead = me.is_admin || me.srt_role === "lead";
  const openTickets = tickets.filter((t) => t.status !== "resolved");
  return (
    <>
      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <GateStrip defs={defs} gates={gates} />
        <span className="font-mono">{s.gates_clear}/{defs.length} gates clear</span>
        {s.onboarding_route === "fast_track" && <Pill tone="warn">Fast-track{s.fast_track_close_by ? ` until ${formatDate(s.fast_track_close_by)}` : ""}{s.fast_track_approved_by ? "" : " · not approved"}</Pill>}
      </Card>
      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Onboarding gates</h2>
            <p className="text-xs text-muted">Changes save immediately and are written to the audit trail. Vendor uploads never verify a gate.</p>
          </div>
          {s.critical_open > 0 && <GapTicketsButton supplierId={s.id} />}
        </div>
        <GateTable supplierId={s.id} defs={defs} gates={gates} people={Object.fromEntries(people.map((p) => [p.id, p.full_name || p.email]))} role={role} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <h2 className="px-4 pb-2 pt-4 font-display text-lg font-semibold">SRT tickets ({openTickets.length} open)</h2>
          {tickets.length ? <TicketTable tickets={tickets} suppliers={new Map([[s.id, s]])} people={pMap} compact /> : <p className="px-4 pb-5 text-sm text-muted">No tickets for this supplier.</p>}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Fast-track exception</h2>
          {s.fast_track_approved_by ? (
            <div className="space-y-1 text-sm">
              <p>Approved by <b>{personName(pMap.get(s.fast_track_approved_by))}</b> {s.fast_track_approved_at ? timeAgo(s.fast_track_approved_at) : ""}.</p>
              <p>All critical gates must close by <b>{formatDate(s.fast_track_close_by)}</b>. After that date purchasing is blocked automatically.</p>
              {s.fast_track_justification && <p className="text-muted">Reason: {s.fast_track_justification}</p>}
            </div>
          ) : isLead ? <FastTrackForm supplierId={s.id} /> : (
            <p className="text-sm text-muted">An SRT lead can approve a time-limited fast-track exception, which lets purchasing continue while critical gates are closed.</p>
          )}
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Supplier details</h2>
        <SupplierForm action={updateSupplier.bind(null, s.id)} supplier={s} people={peopleOpts} submitLabel="Save details" />
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">Gate audit trail</h2>
        {(auditRes.data ?? []).length === 0 ? <p className="text-sm text-muted">No gate changes recorded yet.</p> : (
          <ol className="space-y-2 text-sm">
            {((auditRes.data ?? []) as GateAudit[]).map((a) => (
              <li key={a.id}>
                <span className="font-semibold">{labelOf.get(a.gate_key) ?? a.gate_key}</span>
                {a.from_status !== a.to_status && <>: {a.from_status} → {a.to_status}</>}
                {a.expiry_from !== a.expiry_to && <>, expiry {a.expiry_to ? formatDate(a.expiry_to) : "cleared"}</>}
                {a.note && <span className="text-muted"> ({a.note})</span>}
                <span className="block text-xs text-muted">{a.actor ? personName(pMap.get(a.actor)) : "System"} · {timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

/* ---------------- Compliance ---------------- */
export async function ComplianceTab({ supplier: s, me }: Props) {
  const supabase = await createClient();
  const [certs, types, people] = await Promise.all([
    rows<Certificate>(supabase, "supplier_certificates_v", { eq: ["supplier_id", s.id], order: "expiry_date", asc: true }),
    getLibrary(supabase, "certification_types"),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  return (
    <>
      <Panel title="Certificates" sub="Expired once the date passes; expiring soon within 90 days. Vendors can upload, only staff verify, and never the person who uploaded.">
        {certs.length === 0 ? <Empty title="No certificates on file" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Certificate", "Number", "Issued", "Expires", "Status", "Uploaded", "Check"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="td font-semibold">{c.cert_type_name}{c.issuer && <div className="text-xs font-normal text-muted">{c.issuer}</div>}{c.document_path && <div className="text-xs font-normal text-muted">{c.document_path}</div>}</td>
                    <td className="td">{c.cert_number ?? "—"}</td>
                    <td className="td"><Date_ d={c.issue_date} /></td>
                    <td className="td"><Date_ d={c.expiry_date} />{c.days_left !== null && c.days_left >= 0 && c.days_left <= 90 && <div className="text-xs text-warn">{c.days_left} days left</div>}</td>
                    <td className="td"><OptPill list={CERT_STATUS} value={c.status} />{c.rejection_reason && <div className="mt-1 max-w-[220px] text-xs text-bad">{c.rejection_reason}</div>}</td>
                    <td className="td text-xs">{c.uploaded_by_role === "vendor" ? "Vendor" : c.uploaded_by ? personName(pMap.get(c.uploaded_by)) : "System"}{c.verified_by && <div className="text-muted">Checked by {personName(pMap.get(c.verified_by))}</div>}</td>
                    <td className="td">
                      {c.verification_status === "pending" ? (c.uploaded_by === me.id ? <span className="text-xs text-muted">Someone else checks this</span> : <CertReview id={c.id} supplierId={s.id} />) : (
                        <details>
                          <summary className="cursor-pointer text-xs text-accent">Edit</summary>
                          <ActionForm action={updateCertificate} submit="Save" hidden={{ id: c.id, supplier_id: s.id }} className="mt-2 w-64">
                            <Field label="Certificate number"><input name="cert_number" defaultValue={c.cert_number ?? ""} className="input" /></Field>
                            <Field label="Issue date"><input name="issue_date" type="date" defaultValue={c.issue_date ?? ""} className="input" /></Field>
                            <Field label="Expiry date" hint="Changing dates sends a verified certificate back for checking"><input name="expiry_date" type="date" defaultValue={c.expiry_date ?? ""} className="input" /></Field>
                            <Field label="Audit score"><input name="audit_score" type="number" min={0} max={100} defaultValue={c.audit_score ?? ""} className="input" /></Field>
                            <Field label="Internal note"><input name="internal_notes" defaultValue={c.internal_notes ?? ""} className="input" /></Field>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="not_applicable" defaultChecked={c.not_applicable} /> Not applicable</label>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Add a certificate"><div className="p-5"><CertificateForm supplierId={s.id} types={types} /></div></Panel>
    </>
  );
}

/* ---------------- Performance ---------------- */
export async function PerformanceTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const [perf, issues, m, inputs] = await Promise.all([
    rows<PerformanceRecord>(supabase, "performance_records", { eq: ["supplier_id", s.id], order: "period" }),
    rows<PerformanceIssue>(supabase, "performance_issues", { eq: ["supplier_id", s.id], order: "created_at" }),
    getMethodology(supabase, { status: "active" }),
    getInputsBySupplier(supabase),
  ]);
  const score = m ? scoreSupplier(m, inputs.get(s.id) ?? [], s.active) : null;
  return (
    <>
      {m && score && (
        <Panel title="Scorecard" sub={`Methodology v${m.version}, scored 0-5. Preferred when active, rules met and above ${m.preferred_threshold}.`}
          actions={<Link href="/assure/scorecard" className="text-sm text-accent underline">All suppliers</Link>}>
          <div className="grid gap-4 p-5 sm:grid-cols-4">
            <div><p className="eyebrow">Overall</p><p className="font-display text-3xl font-bold">{fmtScore(score.overall)}</p>
              {score.preferred ? <Pill tone="ok">Preferred</Pill> : score.blockedReason ? <Pill tone="bad">{score.blockedReason}</Pill> : <Pill>Below threshold</Pill>}</div>
            {m.pillars.map((pl, i) => (
              <div key={pl.key}><p className="eyebrow">{pl.label} · {pl.weight}%</p><p className="font-display text-2xl font-bold">{fmtScore(score.pillars[i].score)}</p>
                <p className="text-xs text-muted">{Math.round(score.pillars[i].completeness * 100)}% of data</p></div>
            ))}
          </div>
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">Criteria</summary>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {m.criteria.map((c, i) => <p key={c.key}><span className="text-muted">{c.label}:</span> {score.criteria[i].display} → <b>{fmtScore(score.criteria[i].score)}</b></p>)}
            </div>
          </details>
        </Panel>
      )}
      <Panel title="Period scores" sub="0-100 per dimension; composite is the average of the scores entered.">
        {perf.length === 0 ? <Empty title="No performance scores yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Period</th>{SCORE_KEYS.map(([, l]) => <th key={l} className="th text-right">{l}</th>)}<th className="th text-right">Composite</th><th className="th text-right">NCRs</th><th className="th text-right">Defect rate</th></tr></thead>
              <tbody>
                {perf.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-semibold">{r.period}</td>
                    {SCORE_KEYS.map(([k]) => <td key={k} className="td text-right"><Score value={r[k] as number | null} /></td>)}
                    <td className="td text-right font-bold"><Score value={r.composite_score} /></td>
                    <td className="td text-right tabular-nums">{r.ncr_count}</td>
                    <td className="td text-right tabular-nums">{r.defect_rate != null ? `${r.defect_rate}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Issues feed" sub="Raised on the server from the latest period and the certificates: NCRs, defect rate over 2%, OTIF under 70, expired or expiring certificates."
        actions={<ActionForm action={generateIssues} submit="Check for new issues" hidden={{ supplier_id: s.id }} variant="secondary" inline />}>
        <IssueList issues={issues} supplierId={s.id} />
      </Panel>
      <Panel title="Record scores"><div className="p-5"><PerformanceForm supplierId={s.id} /></div></Panel>
    </>
  );
}

export function IssueList({ issues, supplierId, names }: { issues: PerformanceIssue[]; supplierId?: string; names?: Map<string, string> }) {
  if (!issues.length) return <Empty title="No issues raised" />;
  return (
    <ul className="divide-y divide-line">
      {issues.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><OptPill list={SEVERITY} value={i.severity} /><span className="font-semibold">{i.title}</span></div>
            {names && <Link href={`/assure/suppliers/${i.supplier_id}?tab=performance`} className="text-xs text-accent">{names.get(i.supplier_id)}</Link>}
            {i.supplier_response && <p className="mt-1 text-muted">Vendor: {i.supplier_response}{i.corrective_action ? ` · Action: ${i.corrective_action}` : ""}{i.target_resolution_date ? ` · by ${formatDate(i.target_resolution_date)}` : ""}</p>}
            {i.internal_notes && <p className="mt-1 text-xs text-muted">Resolution: {i.internal_notes}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <OptPill list={ACK_STATUS} value={i.acknowledgement_status} />
            {i.acknowledgement_status !== "resolved" && (
              <ActionForm action={resolveIssue} submit="Resolve" hidden={{ id: i.id, supplier_id: supplierId ?? i.supplier_id }} inline variant="secondary">
                <input name="note" required className="input w-52 py-1.5" placeholder="How it was resolved" aria-label="Resolution" />
              </ActionForm>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Commercial ---------------- */
export async function CommercialTab({ supplier: s, profile: p }: Props) {
  const nti = ntiValue(s.ytd_spend, p?.nti_rate);
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="YTD spend" value={formatEur(s.ytd_spend)} hint={p?.annual_spend_forecast ? `Forecast ${formatEur(p.annual_spend_forecast)}` : undefined} />
        <Stat label="NTI rate" value={p?.nti_rate != null ? `${p.nti_rate}%` : "—"} />
        <Stat label="NTI value" value={formatEur(nti)} hint="Spend × NTI rate" />
        <Stat label="Payment terms" value={paymentTermLabel(p?.payment_terms, p?.payment_terms_days)} />
      </section>
      <Panel title="Risk" sub={p?.risk_reason ? `Current reason: ${p.risk_reason}` : "Set by vendor managers or procurement, always with a reason."}>
        <div className="p-5"><RiskForm supplierId={s.id} current={p?.risk_level ?? "low"} /></div>
      </Panel>
      <Panel title="Commercial terms and classification" sub="Internal only. Vendors never see NTI, payment-term notes or risk.">
        <div className="p-5"><ProfileForm supplierId={s.id} p={p} /></div>
      </Panel>
    </>
  );
}

/* ---------------- Contracts ---------------- */
export async function ContractsTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const [contracts, templates] = await Promise.all([
    rows<Contract>(supabase, "contracts", { eq: ["supplier_id", s.id], order: "created_at" }),
    rows<{ id: string; name: string; is_active: boolean }>(supabase, "contract_templates", { cols: "id, name, is_active" }),
  ]);
  return (
    <>
      <Panel title="Contracts">
        {contracts.length === 0 ? <Empty title="No contracts yet" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Contract", "Type", "Status", "Value", "Ends"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td className="td"><Link href={`/assure/contracts/${c.id}`} className="font-semibold hover:text-accent">{c.title}</Link><div className="text-xs text-muted">{c.contract_ref}{c.version > 1 ? ` · v${c.version}` : ""}</div></td>
                  <td className="td">{c.document_type}</td>
                  <td className="td"><OptPill list={CONTRACT_STATUS} value={c.status} /></td>
                  <td className="td tabular-nums">{c.value != null ? `${c.currency} ${Number(c.value).toLocaleString("en-GB")}` : "—"}</td>
                  <td className="td"><Date_ d={c.end_date} />{isContractExpiring(c) && <div><Pill tone="warn">Renewal due</Pill></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="New contract"><div className="p-5"><ContractForm supplierId={s.id} templates={templates.filter((t) => t.is_active)} /></div></Panel>
    </>
  );
}

/* ---------------- Quality ---------------- */
export async function QualityTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const [insp, ncrs, cats, catNames] = await Promise.all([
    rows<Inspection>(supabase, "quality_inspections", { eq: ["supplier_id", s.id], order: "inspection_date" }),
    rows<Ncr>(supabase, "ncrs", { eq: ["supplier_id", s.id], order: "created_at" }),
    getLibrary(supabase, "ncr_categories"),
    getLibraryNames(supabase, "ncr_categories"),
  ]);
  return (
    <>
      <Panel title="Non-conformance reports">
        {ncrs.length === 0 ? <Empty title="No NCRs" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["NCR", "Category", "Severity", "Vendor", "Status", "Due"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {ncrs.map((n) => (
                <tr key={n.id}>
                  <td className="td"><Link href={`/assure/quality/ncr/${n.id}`} className="font-semibold hover:text-accent">{n.title}</Link><div className="text-xs text-muted">{n.ncr_ref}</div></td>
                  <td className="td">{catNames.get(n.category_id)}</td>
                  <td className="td"><OptPill list={NCR_SEVERITY} value={n.severity} /></td>
                  <td className="td"><OptPill list={ACK_STATUS} value={n.acknowledgement_status} /></td>
                  <td className="td"><Pill tone={n.status === "open" ? "warn" : "neutral"}>{n.status}</Pill></td>
                  <td className="td"><Date_ d={n.due_date} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Inspections">
        {insp.length === 0 ? <Empty title="No inspections logged" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Inspection", "Type", "Date", "Sample", "Defects", "Result"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {insp.map((q) => (
                <tr key={q.id}>
                  <td className="td font-semibold">{q.product_name ?? q.po_reference ?? "Inspection"}<div className="text-xs font-normal text-muted">{q.inspection_ref}{q.po_reference ? ` · ${q.po_reference}` : ""}</div></td>
                  <td className="td">{optLabel(INSPECTION_TYPES, q.inspection_type)}</td>
                  <td className="td"><Date_ d={q.inspection_date} /></td>
                  <td className="td tabular-nums">{q.sample_size ?? "—"}</td>
                  <td className="td tabular-nums">{q.defect_count}</td>
                  <td className="td"><OptPill list={INSPECTION_RESULT} value={q.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Log an inspection"><div className="p-5"><InspectionForm supplierId={s.id} /></div></Panel>
        <Panel title="Raise an NCR"><div className="p-5"><NcrForm supplierId={s.id} categories={cats} /></div></Panel>
      </div>
    </>
  );
}

/* ---------------- Reviews ---------------- */
export async function ReviewsTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const reviews = await rows<BusinessReview>(supabase, "business_reviews", { eq: ["supplier_id", s.id], order: "meeting_date" });
  return (
    <>
      <Panel title="Business reviews" actions={<Link href="/assure/reviews" className="text-sm text-accent underline">Calendar</Link>}>
        {reviews.length === 0 ? <Empty title="No reviews yet" /> : (
          <ul className="divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <Link href={`/assure/reviews/${r.id}`} className="font-semibold hover:text-accent">{r.title}</Link>
                  <div className="text-xs text-muted">{optLabel(REVIEW_TYPES, r.review_type)} · {formatDate(r.meeting_date)} · {r.agenda_items.slice(0, 3).join(", ")}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.shared_with_vendor && <Pill tone="info">Shared</Pill>}
                  {r.vendor_response !== "none" && <OptPill list={VENDOR_RESPONSE} value={r.vendor_response} />}
                  <OptPill list={OUTCOME_STATUS} value={r.outcomes_approval_status} />
                  <OptPill list={BR_STATUS} value={r.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Schedule a review"><div className="p-5"><ReviewForm supplierId={s.id} /></div></Panel>
    </>
  );
}

/* ---------------- Tasks ---------------- */
export async function TasksTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const tasks = await rows<Task>(supabase, "action_plan_tasks", { eq: ["supplier_id", s.id], order: "created_at" });
  return (
    <>
      <Panel title="Action plan" sub={`${taskProgress(tasks)}% complete. The vendor sees these tasks and can move them to completed; only staff verify.`}>
        <div className="px-5 pt-3"><Bar value={taskProgress(tasks)} tone="ok" /></div>
        {tasks.length === 0 ? <Empty title="No tasks" /> : (
          <table className="mt-2 w-full text-sm">
            <thead><tr>{["Task", "Category", "Priority", "Due", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="td font-semibold">{t.title}{t.progress_notes && <div className="text-xs font-normal text-muted">{t.progress_notes}</div>}</td>
                  <td className="td">{optLabel(TASK_CATEGORY, t.category)}</td>
                  <td className="td"><OptPill list={PRIORITY} value={t.priority} /></td>
                  <td className="td"><Date_ d={t.due_date} />{isTaskOverdue(t) && <div><Pill tone="bad">Overdue</Pill></div>}</td>
                  <td className="td"><OptPill list={TASK_STATUS} value={t.status} /></td>
                  <td className="td"><TaskMoves task={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Add a task"><div className="p-5"><TaskForm supplierId={s.id} /></div></Panel>
    </>
  );
}

/* ---------------- Documents ---------------- */
export async function DocumentsTab({ supplier: s, me }: Props) {
  const supabase = await createClient();
  const [docs, people] = await Promise.all([
    rows<SupplierDocument>(supabase, "supplier_documents", { eq: ["supplier_id", s.id], order: "created_at" }),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  return (
    <>
      <Panel title="Documents" sub="Vendor and staff uploads. Nobody checks their own upload.">
        {docs.length === 0 ? <Empty title="No documents" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Document", "Type", "Uploaded", "Status", "Check"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="td font-semibold">{d.title}<div className="text-xs font-normal text-muted">{d.file_path}{d.po_reference ? ` · ${d.po_reference}` : ""}</div></td>
                  <td className="td">{optLabel(DOC_TYPES, d.doc_type)}</td>
                  <td className="td text-xs">{d.uploaded_by_role === "vendor" ? "Vendor" : personName(d.uploaded_by ? pMap.get(d.uploaded_by) : null)} · {timeAgo(d.created_at)}</td>
                  <td className="td"><OptPill list={REVIEW_STATUS} value={d.status} />{d.review_note && <div className="mt-1 max-w-[220px] text-xs text-muted">{d.review_note}</div>}</td>
                  <td className="td">{d.status === "pending" && d.uploaded_by !== me.id ? <DocReview id={d.id} supplierId={s.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Add a document"><div className="p-5"><DocumentForm supplierId={s.id} /></div></Panel>
    </>
  );
}

/* ---------------- Activity ---------------- */
export async function ActivityTab({ supplier: s }: Props) {
  const supabase = await createClient();
  const [acts, people] = await Promise.all([
    rows<Activity>(supabase, "assure_activity", { eq: ["supplier_id", s.id], order: "created_at", limit: 300 }),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  return (
    <>
      <Panel title="Log a call, meeting, email or note"><div className="p-5"><ActivityForm supplierId={s.id} /></div></Panel>
      <Panel title="Activity" sub="Every change across Assure+ for this supplier, newest first. Nothing here can be edited or deleted.">
        {acts.length === 0 ? <Empty title="Nothing recorded yet" /> : (
          <ol className="divide-y divide-line">
            {acts.map((a) => (
              <li key={a.id} className="flex gap-3 px-5 py-3 text-sm">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><MSymbol name={a.kind !== "event" ? ({ call: "call", meeting: "groups", email: "mail", note: "sticky_note_2" } as Record<string, string>)[a.kind] : ACTIVITY_ICON[a.entity] ?? "history"} size={16} /></span>
                <div className="min-w-0">
                  <p className="font-semibold">{a.title ?? a.action.replace(/_/g, " ")}{a.from_status !== a.to_status && (a.from_status || a.to_status) && <span className="font-normal text-muted"> · {a.from_status ?? "—"} → {a.to_status ?? "—"}</span>}</p>
                  {a.body && <p className="text-muted">{a.body}</p>}
                  <p className="text-xs text-muted">{a.actor ? personName(pMap.get(a.actor)) : "System"} · {timeAgo(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
