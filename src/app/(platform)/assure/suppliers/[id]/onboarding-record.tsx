// The single supplier record for onboarding: the nine-stage tracker, the evidence trail, IDs, contract set, certificates,
// approvals and exception history, with the action for each stage. Every rule is enforced in the database.
import Link from "next/link";
import { clsx } from "clsx";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { formatDate, timeAgo, type Profile } from "@/lib/srt";
import { CADENCES, EVENTS, GATE_STATUS_PLAIN, onboardingLine, registrationLabel, STAGES, SYSTEMS, TAXONOMY, type SupplierRecord } from "@/lib/onboarding";
import { typeLabel } from "@/components/approvals/labels";
import { Card, Empty, Panel, Pill } from "@/components/ui";
import { Facts } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import {
  activateSupplier, allocatePanels, decideFinance, decideGap, decideRisk, linkContract, raiseGap, raiseRevalidation, reconcileIds, recordSystemId,
  requestFastTrack, submitRiskReview, updateRemediation,
} from "@/app/(platform)/assure/onboarding-actions";

const statusTone = (st: string | null | undefined, clear?: boolean) =>
  clear || st === "verified" || st === "not_required" ? "ok" : st === "rejected" ? "bad" : st === "received" || st === "requested" ? "warn" : "neutral";

export async function OnboardingRecord({ supplierId, me }: { supplierId: string; me: Profile }) {
  const supabase = await createClient();
  const [{ data, error }, people, { data: jobs }] = await Promise.all([
    supabase.rpc("srm_supplier_record", { p_supplier: supplierId }),
    getInternalPeople(supabase),
    supabase.from("jobs").select("id, job_number, title, status").order("created_at", { ascending: false }).limit(200),
  ]);
  const r = data as SupplierRecord | null;
  if (error || !r) return <Card><Empty title="The onboarding record could not load">{error?.message}</Empty></Card>;
  const s = r.supplier;
  const peopleOpts = people.map((p) => ({ value: p.id, label: p.full_name || p.email }));
  const stage = (no: number) => r.stages.find((x) => x.stage_no === no)!;
  const openJobs = ((jobs ?? []) as { id: string; job_number: string; title: string; status: string }[]).filter((j) => !["closed", "cancelled"].includes(j.status));
  const gapGates = stage(4).items.filter((i) => i.allows_gap && !i.clear);
  const ft = r.fast_track;
  const ftOpen = ft && ["requested", "approved"].includes(ft.status);
  const t = TAXONOMY[s.state];

  return (
    <>
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Pill tone={t.tone}>{t.label}</Pill>
          <span className="font-semibold">{onboardingLine({ onboarding_state: s.state, onboarding_stage: s.stage, onboarding_released: s.released, onboarding_baseline: s.baseline })}</span>
          {s.blocked ? <Pill tone="bad">Purchasing blocked</Pill> : <Pill tone="ok">{s.state === "exception" ? "Restricted purchasing (fast-track scope)" : "Purchasing allowed"}</Pill>}
          {!s.released && <span className="text-muted">In this stage since {formatDate(s.stage_since)}</span>}
          {s.next_review_due && <span className="text-muted">Next review {formatDate(s.next_review_due)}</span>}
        </div>
        {s.block_reason && <p className="text-sm text-bad">{s.block_reason}</p>}
        {s.baseline === "legacy" && <p className="text-xs text-muted">Approved before the nine-stage standard: its new controls were recorded as carried over and it is revalidated on the review cadence.</p>}
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-9" aria-label="Onboarding stages">
          {r.stages.map((st) => {
            const current = !s.released && st.stage_no === s.stage;
            return (
              <li key={st.stage_no} className={clsx("rounded-lg border px-2 py-2 text-xs", st.complete ? "border-ok bg-ok-soft" : current ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
                <span className="font-mono font-bold">{st.stage_no}</span> <span className="font-semibold">{st.label}</span>
                <span className="mt-0.5 block text-[0.68rem] text-muted">{st.complete ? "Complete" : current ? "Current" : `${st.items.filter((i) => i.clear).length}/${st.items.length} done`}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Panel title="Stages, controls and evidence" sub="Each stage advances only when its exit criterion is met.">
          <div className="divide-y divide-line">
            {r.stages.map((st) => (
              <details key={st.stage_no} open={!s.released && st.stage_no === s.stage} className="px-5 py-3">
                <summary className="cursor-pointer text-sm">
                  <b className="font-mono">{st.stage_no}</b> <b>{st.label}</b> <span className="text-muted">· {st.owner}</span>
                  {st.complete ? <Pill tone="ok">Complete</Pill> : <span className="ml-2 text-xs text-muted">{st.items.filter((i) => !i.clear).length} open</span>}
                </summary>
                <p className="mt-1 text-xs text-muted">{st.controls} <b>Exit:</b> {st.exit_criterion}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {st.items.map((i) => (
                    <li key={i.gate_key} className="flex flex-wrap items-baseline gap-2">
                      <Pill tone={statusTone(i.status, i.clear)}>{i.gap_id ? "Documented gap" : i.expired ? "Expired" : GATE_STATUS_PLAIN[i.status] ?? i.status}</Pill>
                      <span>{i.label}{i.critical && <b className="ml-1 text-[0.65rem] text-bad">CRITICAL</b>}{i.system && <span className="ml-1 text-[0.65rem] text-muted">recorded by the workflow</span>}</span>
                      {i.expiry_date && <span className="text-xs text-muted">expires {formatDate(i.expiry_date)}</span>}
                      {i.gap_due && <span className="text-xs text-muted">gap due {formatDate(i.gap_due)}</span>}
                      {i.rejection_reason && <span className="text-xs text-bad">{i.rejection_reason}</span>}
                      {i.note && !i.rejection_reason && <span className="text-xs text-muted">{i.note}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">Evidence is checked on the <Link href={`/assure/suppliers/${s.id}?tab=onboarding`} className="text-accent underline">Onboarding gates</Link> tab; workflow steps are recorded here.</p>
        </Panel>

        <div className="space-y-4">
          <Panel title="Identity and accountability">
            <div className="p-5">
              <Facts items={[
                ["Legal entity", r.identity.legal_entity], [registrationLabel(s.market), r.identity.registration_number], ["VAT / tax number", r.identity.vat_number],
                ["Supplier ID", s.supplier_code], ["Category · country · client", [s.category, s.market, s.client].filter(Boolean).join(" · ")], ["Risk level", r.identity.risk_level],
                ["Requested by", r.case?.requested_by_name], ["Triage approved by", r.case?.triaged_by_name], ["Released by", r.case?.activated_by_name ?? r.activation?.activated_by_name],
                ["Procurement owner", s.procurement_owner],
              ]} />
              {r.case && <p className="mt-3 text-sm">Onboarding request <Link href={`/assure/srt/requests/${r.case.id}`} className="font-semibold text-accent underline">#{r.case.case_no}</Link>{r.case.route ? ` · ${r.case.route} route` : ""}{r.case.relationship ? ` · ${r.case.relationship}` : ""}</p>}
              <p className="mt-2 text-xs text-muted">Nobody can request, approve at triage and release the same supplier; the database refuses it.</p>
            </div>
          </Panel>
          <Panel title="System IDs" sub="SRM is the system of record for status and evidence; these systems hold the IDs.">
            <table className="w-full text-sm">
              <thead><tr>{["System", "ID", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{r.system_ids.map((x) => (
                <tr key={x.system}><td className="td">{x.label}</td><td className="td font-mono text-xs">{x.external_id ?? "—"}{x.name_in_system && <div className="font-sans text-muted">{x.name_in_system}</div>}</td>
                  <td className="td">{!x.required ? <Pill>Not required</Pill> : x.reconciled ? <Pill tone="ok">Reconciled</Pill> : x.external_id ? <Pill tone="warn">To reconcile</Pill> : <Pill>Waiting</Pill>}</td></tr>
              ))}</tbody>
            </table>
            <p className="px-5 py-3 text-xs text-muted">{s.ids_synced_at ? `Status synchronised ${timeAgo(s.ids_synced_at)}.` : "Not synchronised yet."} Groups and panels: {r.panels.length ? r.panels.join(", ") : "none"}</p>
          </Panel>
          <Panel title="Certificates and expiry">
            <ul className="space-y-1 p-5 text-sm">{r.certificates.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2"><Pill tone={statusTone(c.status)}>{GATE_STATUS_PLAIN[c.status] ?? c.status}</Pill>{c.label}
                {c.expiry_date && <span className={clsx("text-xs", (c.days_left ?? 0) < 0 ? "text-bad" : (c.days_left ?? 99) <= 60 ? "text-warn" : "text-muted")}>expires {formatDate(c.expiry_date)}</span>}</li>
            ))}</ul>
          </Panel>
        </div>
      </div>

      {/* Stage 4 */}
      <Panel title="Due diligence: documented gaps" sub="A gap (reason, owner, due date) is a valid exit only when a second person approves it, and only until its due date.">
        <div className="space-y-4 p-5 text-sm">
          {r.gaps.length === 0 ? <p className="text-muted">No documented gaps.</p> : (
            <table className="w-full">
              <thead><tr>{["Evidence", "Reason", "Owner", "Due", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{r.gaps.map((g) => (
                <tr key={g.id} className="align-top">
                  <td className="td">{g.gate}</td><td className="td">{g.reason}<div className="text-xs text-muted">Raised by {g.raised_by_name}</div></td>
                  <td className="td">{g.owner_type === "vendor" ? "Vendor" : g.owner_name}</td><td className="td">{formatDate(g.due_date)}</td>
                  <td className="td"><Pill tone={g.status === "approved" ? "ok" : g.status === "proposed" ? "warn" : g.status === "rejected" ? "bad" : "neutral"}>{g.status}</Pill>
                    {g.decided_by_name && <div className="text-xs text-muted">by {g.decided_by_name}{g.decision_note ? `: ${g.decision_note}` : ""}</div>}</td>
                  <td className="td">{g.status === "proposed" && r.can.gap_decide && g.raised_by !== me.id && (
                    <ActionForm action={decideGap.bind(null, s.id, g.id)} submit="Decide" inline>
                      <Select name="decision" options={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }]} />
                      <input name="note" placeholder="Note" className="input py-1" />
                    </ActionForm>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {gapGates.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-accent">Propose a documented gap</summary>
              <ActionForm action={raiseGap.bind(null, s.id)} submit="Propose gap" className="mt-2 grid gap-3 md:grid-cols-3">
                <Field label="Evidence"><Select name="gate" options={gapGates.map((g) => ({ value: g.gate_key, label: g.label }))} /></Field>
                <Field label="Who closes it"><Select name="owner_type" options={[{ value: "vendor", label: "The vendor" }, { value: "internal", label: "Someone at adm Indicia" }]} /></Field>
                <Field label="Owner at adm Indicia"><Select name="owner" blank="(for an internal owner)" options={peopleOpts} /></Field>
                <Field label="Reason" className="md:col-span-2"><input name="reason" required className="input" /></Field>
                <Field label="Due date"><input name="due" type="date" required className="input" /></Field>
              </ActionForm>
            </details>
          )}
        </div>
      </Panel>

      {/* Stage 5 */}
      <Panel title="Risk gates" sub={r.risk_rules ? `Rules: Category Manager ${r.risk_rules.needs_cm ? "required" : "not required"}; Quality ${r.risk_rules.needs_quality ? "required" : "not required"}${r.risk_rules.audit_required ? "; audit required" : ""}${r.risk_rules.codes.length ? ` (${r.risk_rules.codes.join(", ")})` : ""}.` : undefined}>
        <div className="space-y-3 p-5 text-sm">
          {r.risk_review && (
            <>
              <Facts items={[
                ["Category fit", r.risk_review.category_fit], ["Competitiveness / NTI", [r.risk_review.competitiveness, r.risk_review.nti_percent != null ? `NTI ${r.risk_review.nti_percent}%` : null].filter(Boolean).join(" · ")],
                ["Quality", r.risk_review.quality], ["Sustainability", r.risk_review.sustainability], ["Audit", r.risk_review.audit_needed ? `Needed${r.risk_review.audit_notes ? `: ${r.risk_review.audit_notes}` : ""}` : "Not needed"],
                ["Client-specific requirements", r.risk_review.client_requirements], ["Submitted by", r.risk_review.submitted_by_name],
                ["Category Manager", r.risk_review.needs_cm ? (r.risk_review.cm_decision ? `${r.risk_review.cm_decision} by ${r.risk_review.cm_by_name}` : "Waiting") : "Not required"],
                ["Quality approval", r.risk_review.needs_quality ? (r.risk_review.quality_decision ? `${r.risk_review.quality_decision} by ${r.risk_review.quality_by_name}` : "Waiting") : "Not required"],
              ]} />
              {r.risk_review.status === "submitted" && r.risk_review.submitted_by !== me.id && (
                <div className="flex flex-wrap gap-6">
                  {r.risk_review.needs_cm && !r.risk_review.cm_decision && r.can.risk_cm && (
                    <ActionForm action={decideRisk.bind(null, s.id, "cm")} submit="Category Manager decision" inline>
                      <Select name="decision" options={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }]} /><input name="note" placeholder="Note" className="input py-1" />
                    </ActionForm>
                  )}
                  {r.risk_review.needs_quality && !r.risk_review.quality_decision && r.can.risk_quality && (
                    <ActionForm action={decideRisk.bind(null, s.id, "quality")} submit="Quality decision" inline>
                      <Select name="decision" options={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }]} /><input name="note" placeholder="Note" className="input py-1" />
                    </ActionForm>
                  )}
                </div>
              )}
            </>
          )}
          {(!r.risk_review || r.risk_review.status === "rejected") && (
            stage(4).complete ? (
              <ActionForm action={submitRiskReview.bind(null, s.id)} submit={r.risk_review ? "Resubmit risk review" : "Submit risk review"} className="grid gap-3 md:grid-cols-2">
                <Field label="Category fit" className="md:col-span-2"><input name="category_fit" required className="input" /></Field>
                <Field label="Competitiveness"><input name="competitiveness" className="input" placeholder="Benchmarks, quotes" /></Field>
                <Field label="NTI %"><input name="nti_percent" type="number" min={0} max={100} step="0.5" className="input" /></Field>
                <Field label="Quality"><input name="quality" className="input" /></Field>
                <Field label="Sustainability"><input name="sustainability" className="input" /></Field>
                <Field label="Client-specific requirements"><input name="client_requirements" className="input" /></Field>
                <Field label="Audit notes"><input name="audit_notes" className="input" /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" name="audit_needed" /> An audit is needed</label>
              </ActionForm>
            ) : <p className="text-muted">The risk review opens when due diligence is complete (evidence or approved documented gaps).</p>
          )}
        </div>
      </Panel>

      {/* Stage 6 */}
      <Panel title="Contract set" sub="Required agreements for this supplier type and client. A fully signed contract with its stored copy completes the item.">
        <div className="space-y-3 p-5 text-sm">
          <table className="w-full">
            <thead><tr>{["Agreement", "Status", "Contracts"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{r.contracts.map((c) => (
              <tr key={c.doc} className="align-top"><td className="td font-semibold">{c.label}</td>
                <td className="td"><Pill tone={statusTone(c.gate_status)}>{GATE_STATUS_PLAIN[c.gate_status ?? "missing"] ?? c.gate_status}</Pill></td>
                <td className="td">{c.contracts.length === 0 ? <span className="text-muted">—</span> : c.contracts.map((k) => (
                  <div key={k.id}><Link href={`/assure/contracts/${k.id}`} className="underline">{k.ref ?? k.title}</Link> <span className="text-xs text-muted">{k.status.replace(/_/g, " ")}{k.stored ? " · stored" : ""}</span></div>
                ))}</td></tr>
            ))}</tbody>
          </table>
          {r.untagged_contracts.length > 0 && (
            <ActionForm action={linkContract.bind(null, s.id)} submit="Tag contract" inline variant="secondary">
              <Field label="Contract"><Select name="contract" options={r.untagged_contracts.map((k) => ({ value: k.id, label: `${k.title} (${k.status})` }))} /></Field>
              <Field label="Is the"><Select name="doc" options={[{ value: "nda", label: "NDA" }, { value: "coc", label: "Code of Conduct" }, { value: "msa", label: "MSA / terms" }, { value: "psa", label: "PSA / SSA" }, { value: "schedule", label: "Schedule or addendum" }]} /></Field>
            </ActionForm>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Stage 7 */}
        <Panel title="Finance approval" sub="Local Finance for the supplier's market validates bank, tax and set-up after contracts are signed.">
          <div className="p-5 text-sm">
            {stage(7).items.find((i) => i.gate_key === "finance_approval")?.clear ? <p><Pill tone="ok">Approved</Pill> {stage(7).items.find((i) => i.gate_key === "finance_approval")?.note}</p>
              : !r.can.finance ? <p className="text-muted">Waiting for Local Finance ({s.market ?? "market not set"}).</p>
              : !stage(6).complete || !stage(5).complete || !stage(4).complete ? <p className="text-muted">Opens when stages 1 to 6 are complete.</p> : (
                <ActionForm action={decideFinance.bind(null, s.id)} submit="Record Finance decision" inline>
                  <Select name="decision" options={[{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }]} />
                  <input name="note" placeholder="What was checked" className="input min-w-[240px] py-1" />
                </ActionForm>
              )}
          </div>
        </Panel>
        {/* Stage 8 */}
        <Panel title="System enablement" sub="Record the IDs each system returned, then reconcile (name and VAT must match). No live integration: capture and reconciliation.">
          <div className="space-y-3 p-5 text-sm">
            {!stage(7).complete ? <p className="text-muted">Opens after Finance approval.</p> : r.can.ids ? (
              <>
                <ActionForm action={recordSystemId.bind(null, s.id)} submit="Record ID" className="grid gap-2 md:grid-cols-2" variant="secondary">
                  <Field label="System"><Select name="system" options={SYSTEMS.filter((x) => r.system_ids.find((i) => i.system === x.value)?.required)} /></Field>
                  <Field label="ID returned"><input name="external_id" required className="input" /></Field>
                  <Field label="Name in that system"><input name="name_in_system" className="input" defaultValue={s.name} /></Field>
                  <Field label="VAT in that system"><input name="vat_in_system" className="input" defaultValue={r.identity.vat_number ?? ""} /></Field>
                </ActionForm>
                <ActionForm action={reconcileIds.bind(null, s.id)} submit="Reconcile IDs and synchronise status" variant="secondary" />
              </>
            ) : <p className="text-muted">SRT or Finance records the IDs.</p>}
            {stage(7).complete && (r.can.activate || r.can.risk_cm) && (
              <ActionForm action={allocatePanels.bind(null, s.id)} submit="Save groups and panels" inline variant="secondary">
                <Field label="Groups and panels (comma separated)"><input name="panels" defaultValue={r.panels.join(", ")} className="input min-w-[260px]" /></Field>
              </ActionForm>
            )}
          </div>
        </Panel>
      </div>

      {/* Stage 9 */}
      <Panel title="Activate and govern" sub="Welcome pack, training, named owner, evidence location, expiry dates and review cadence; then the supplier is released for use and appears in reporting.">
        <div className="p-5 text-sm">
          {r.activation ? (
            <Facts items={[["Released", `${formatDate(r.activation.activated_at)} by ${r.activation.activated_by_name}`], ["Owner", r.activation.owner_name], ["Training", r.activation.training.replace("_", " ")],
              ["Evidence location", r.activation.evidence_location], ["Review cadence", CADENCES.find((c) => c.value === r.activation!.review_cadence)?.label], ["Next review", formatDate(r.activation.next_review_due)]]} />
          ) : !stage(8).complete || !r.stages.slice(0, 8).every((x) => x.complete) ? <p className="text-muted">Opens when stages 1 to 8 are complete.</p>
            : !r.can.activate ? <p className="text-muted">Procurement releases the supplier.</p> : (
              <ActionForm action={activateSupplier.bind(null, s.id)} submit="Release supplier for use" className="grid gap-3 md:grid-cols-3" confirm="Release this supplier for use?">
                <Field label="Named procurement owner"><Select name="owner" required blank="Choose" options={peopleOpts} /></Field>
                <Field label="Training"><Select name="training" options={[{ value: "assigned", label: "Assigned" }, { value: "completed", label: "Completed" }, { value: "not_required", label: "Not required" }]} /></Field>
                <Field label="Review cadence"><Select name="review_cadence" defaultValue="annual" options={CADENCES} /></Field>
                <Field label="Evidence location" className="md:col-span-2"><input name="evidence_location" required className="input" placeholder="Where the evidence file is kept" /></Field>
                <Field label="Note"><input name="note" className="input" /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" name="welcome_pack_sent" /> Welcome pack sent</label>
                <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="expiry_confirmed" /> Certificate and document expiry dates confirmed</label>
              </ActionForm>
            )}
        </div>
      </Panel>

      {/* Fast-track */}
      <Panel title="Fast-track exception" sub="An exception route, not a bypass: declared urgency, a minimum pack, two named approvals (Procurement Director and Local Finance), restricted scope and a remediation clock. Any overdue item stops further orders.">
        <div className="space-y-4 p-5 text-sm">
          {ft && (
            <div className="space-y-2">
              <p><Pill tone={TAXONOMY[ft.status === "approved" ? "exception" : ft.status === "requested" ? "submitted" : ft.status === "closed" ? "approved" : "declined"].tone}>{ft.status}</Pill> <b>{ft.urgency_reason}</b></p>
              <Facts items={[["Client need", ft.client_need], ["Required by", formatDate(ft.required_date)], ["Remediation closes by", formatDate(ft.close_by)],
                ["Scope", [ft.jobs.map((j) => j.job_number).join(", "), ft.scope_value_cap ? `cap ${ft.scope_value_cap.toLocaleString("en-GB")} ${ft.scope_currency}` : null, ft.scope_systems.length ? `systems: ${ft.scope_systems.join(", ")}` : null].filter(Boolean).join(" · ")],
                ["Requested by", ft.requested_by_name], ["Procurement Director", ft.director_name ?? "Waiting"], ["Local Finance", ft.finance_name ?? "Waiting"]]} />
              {ft.status === "requested" && <p className="text-xs text-muted">Both approvals are decided in the <Link href="/watchtower/approvals" className="text-accent underline">approvals inbox</Link>.</p>}
            </div>
          )}
          {r.remediation.length > 0 && (
            <table className="w-full">
              <thead><tr>{["Remediation item", "Owner", "Due", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{r.remediation.map((i) => (
                <tr key={i.id}><td className="td">{i.item}</td><td className="td">{i.owner_type === "vendor" ? "Vendor" : i.owner_name ?? "adm Indicia"}</td>
                  <td className="td">{formatDate(i.due_date)}{i.overdue && <div><Pill tone="bad">Overdue</Pill></div>}</td>
                  <td className="td">{i.status}{i.note && <div className="text-xs text-muted">{i.note}</div>}</td>
                  <td className="td">{i.status === "open" && r.can.director && (
                    <ActionForm action={updateRemediation.bind(null, s.id, i.id)} submit="Waive" variant="secondary" inline hidden={{ status: "waived" }}>
                      <input name="note" required placeholder="Why" className="input py-1" />
                    </ActionForm>
                  )}</td></tr>
              ))}</tbody>
            </table>
          )}
          {!ftOpen && !s.released && (
            <details>
              <summary className="cursor-pointer font-semibold text-accent">Request a fast-track</summary>
              <div className="mt-2 space-y-3">
                <div>
                  <p className="font-semibold">Minimum pack</p>
                  <ul className="mt-1 space-y-0.5">{r.min_pack.items.map((i) => <li key={i.key}>{i.ok ? <Pill tone="ok">Yes</Pill> : <Pill tone="bad">Missing</Pill>} {i.label}</li>)}</ul>
                </div>
                <ActionForm action={requestFastTrack.bind(null, s.id)} submit="Request fast-track" className="grid gap-3 md:grid-cols-2">
                  <Field label="Why is it urgent?" className="md:col-span-2"><input name="urgency_reason" required className="input" /></Field>
                  <Field label="Client need"><input name="client_need" required className="input" /></Field>
                  <Field label="Required by"><input name="required_date" type="date" required className="input" /></Field>
                  <Field label="Value cap" hint="Only the value the urgent transaction needs"><div className="flex gap-2"><input name="value_cap" type="number" min={1} className="input" /><select name="currency" className="input w-24" defaultValue="EUR">{["EUR", "GBP", "USD", "SGD"].map((c) => <option key={c}>{c}</option>)}</select></div></Field>
                  <Field label="Remediation closes by (optional)"><input name="close_by" type="date" className="input" /></Field>
                  <fieldset className="md:col-span-2"><legend className="label">Jobs in scope</legend>
                    <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">{openJobs.map((j) => <label key={j.id} className="flex items-center gap-2"><input type="checkbox" name="jobs" value={j.id} /> {j.job_number} · {j.title}</label>)}</div>
                  </fieldset>
                  <fieldset><legend className="label">Systems in scope</legend>
                    {SYSTEMS.map((x) => <label key={x.value} className="mr-3 inline-flex items-center gap-1.5"><input type="checkbox" name="systems" value={x.value} /> {x.label}</label>)}
                  </fieldset>
                  <Field label="Scope note"><input name="scope_note" className="input" /></Field>
                </ActionForm>
              </div>
            </details>
          )}
          {!ft && s.released && <p className="text-muted">Not needed: the supplier is fully onboarded.</p>}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Approvals and exception history">
          <ul className="space-y-2 p-5 text-sm">
            {r.approvals.map((a, i) => (
              <li key={`a${i}`}><b>{typeLabel(a.type)}</b> · {a.status}<span className="block text-xs text-muted">{a.role} · asked by {a.requested_by} {timeAgo(a.requested_at)}{a.decided_by ? ` · decided by ${a.decided_by}` : ""}{a.note ? `: ${a.note}` : ""}</span></li>
            ))}
            {r.decisions.map((d, i) => (
              <li key={`d${i}`}><b>{typeLabel(d.type)}</b> · {d.decision}<span className="block text-xs text-muted">{d.by} · {timeAgo(d.at)}{d.note ? `: ${d.note}` : ""}</span></li>
            ))}
            {r.approvals.length + r.decisions.length === 0 && <li className="text-muted">No approvals yet.</li>}
          </ul>
        </Panel>
        <Panel title="Revalidation" sub="Event-based review: a material change, a client request or an adverse finding opens a revalidation case.">
          <div className="space-y-3 p-5 text-sm">
            {r.review_tasks.length > 0 && <ul className="space-y-1">{r.review_tasks.map((t) => <li key={t.id}><Pill tone={t.status === "open" ? "warn" : "ok"}>{t.status}</Pill> {t.title} <span className="text-xs text-muted">due {formatDate(t.due_date)}{t.outcome ? ` · ${t.outcome}` : ""}</span></li>)}</ul>}
            <ActionForm action={raiseRevalidation.bind(null, s.id)} submit="Open revalidation" variant="secondary" className="grid gap-2 md:grid-cols-2">
              <Field label="Event"><Select name="event" options={EVENTS} /></Field>
              <Field label="What happened"><input name="note" required className="input" /></Field>
            </ActionForm>
          </div>
        </Panel>
      </div>

      <Panel title="Evidence trail" sub="Every gate change and onboarding step, newest first.">
        <ol className="max-h-[480px] space-y-2 overflow-y-auto p-5 text-sm">
          {r.events.map((e, i) => (
            <li key={i}><span className={e.source === "gate" ? "" : "font-semibold"}>{e.title}</span><span className="block text-xs text-muted">{e.by ?? "System"} · {timeAgo(e.at)}</span></li>
          ))}
        </ol>
      </Panel>
      <p className="text-xs text-muted">Stages: {STAGES.map((x) => `${x.no} ${x.label} (${x.owner})`).join(" · ")}</p>
    </>
  );
}
