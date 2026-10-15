"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { DEPARTMENTS, FREQUENCIES, LEGAL_BASES, LEVELS, QUADRANT, RAGS, labelOf, type StakeholderRow } from "@/lib/crm";
import { setContactField } from "@/app/(platform)/crm/actions";

type Opt = { value: string; label: string };

/**
 * Spreadsheet-style stakeholder grid: every editable cell saves on change through crm_contact_set_field (checked and audited
 * in the database). Ticked rows are posted by the bulk forms below the grid (form="bulk-…" on each checkbox).
 */
export function StakeholderGrid({ rows, people, roles, services }: { rows: StakeholderRow[]; people: Opt[]; roles: Opt[]; services: Opt[] }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  const save = (row: StakeholderRow, field: string, value: unknown) =>
    start(async () => {
      const key = `${row.id}:${field}`;
      const res = await setContactField(row.id, field, value);
      setErrors((e) => { const n = { ...e }; if (res.error) n[key] = res.error; else delete n[key]; return n; });
      if (!res.error) { setSaved((s) => ({ ...s, [key]: true })); setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 1500); }
    });

  const sel = (row: StakeholderRow, field: keyof StakeholderRow, opts: Opt[], required = false) => {
    const key = `${row.id}:${field}`;
    return (
      <td className={clsx("border-b border-line px-1 py-1", errors[key] && "bg-bad-soft", saved[key] && "bg-ok-soft")} title={errors[key]}>
        <select aria-label={`${String(field)} for ${row.full_name}`} defaultValue={(row[field] as string | null) ?? ""} disabled={!!row.left_at}
          onChange={(e) => save(row, String(field), e.target.value || null)}
          className={clsx("w-full min-w-[7rem] rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-line focus:border-accent", required && !row[field] && "border-warn")}>
          {(!required || !row[field]) && <option value="">—</option>}
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
    );
  };
  const tick = (row: StakeholderRow, field: keyof StakeholderRow) => {
    const key = `${row.id}:${field}`;
    return (
      <td className={clsx("border-b border-line px-2 py-1 text-center", errors[key] && "bg-bad-soft", saved[key] && "bg-ok-soft")} title={errors[key]}>
        <input type="checkbox" aria-label={`${String(field)} for ${row.full_name}`} defaultChecked={!!row[field]} disabled={!!row.left_at}
          onChange={(e) => save(row, String(field), e.target.checked)} />
      </td>
    );
  };
  const multi = (row: StakeholderRow, field: "services_offered" | "services_declined") => {
    const key = `${row.id}:${field}`;
    const current = row[field] ?? [];
    const names = field === "services_offered" ? row.services_offered_names : row.services_declined_names;
    return (
      <td className={clsx("border-b border-line px-1 py-1", errors[key] && "bg-bad-soft", saved[key] && "bg-ok-soft")} title={errors[key]}>
        <details className="relative">
          <summary className="cursor-pointer list-none truncate rounded px-1 py-1 text-xs hover:bg-surface-2" style={{ maxWidth: "11rem" }}>{names.length ? names.join(", ") : "—"}</summary>
          <div className="absolute z-20 mt-1 w-64 space-y-1 rounded-lg border border-line bg-surface p-2 shadow-card">
            {services.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-xs">
                <input type="checkbox" defaultChecked={current.includes(s.value)} disabled={!!row.left_at}
                  onChange={(e) => {
                    const next = e.target.checked ? [...new Set([...current, s.value])] : current.filter((x) => x !== s.value);
                    row[field] = next;
                    save(row, field, next);
                  }} />
                {s.label}
              </label>
            ))}
          </div>
        </details>
      </td>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted">
            {["", "Contact", "Owner *", "Owner role *", "Department *", "RAG *", "Last contacted", "Frequency", "Influence *", "Decision maker *", "Matrix",
              "Services offered", "Services declined", "Induction", "Survey", "Legal basis *", "Opted out", "Status"].map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-line px-2 py-2 font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.quadrant ? QUADRANT[r.quadrant] : null;
            return (
              <tr key={r.id} className={clsx(r.left_at && "opacity-50")}>
                <td className="border-b border-line px-2 py-1">
                  <input type="checkbox" name="ids" value={r.id} form="bulk-reassign" aria-label={`Select ${r.full_name}`}
                    onChange={(e) => { const o = document.getElementById(`rv-${r.id}`) as HTMLInputElement | null; if (o) o.checked = e.target.checked; }} />
                  <input type="checkbox" name="ids" value={r.id} form="bulk-review" id={`rv-${r.id}`} className="hidden" readOnly />
                </td>
                <td className="whitespace-nowrap border-b border-line px-2 py-1">
                  <Link href={`/crm/clients/${r.client_id}?tab=contacts`} className="font-semibold hover:underline">{r.full_name}</Link>
                  <div className="text-xs text-muted">{r.client_name}{r.account_market ? ` · ${r.account_market}` : ""}{r.job_title ? ` · ${r.job_title}` : ""}</div>
                </td>
                {sel(r, "owner", people, true)}
                {sel(r, "owner_role_id", roles, true)}
                {sel(r, "department", DEPARTMENTS, true)}
                {sel(r, "relationship_rag", RAGS, true)}
                <td className={clsx("border-b border-line px-1 py-1", errors[`${r.id}:last_contacted_on`] && "bg-bad-soft", saved[`${r.id}:last_contacted_on`] && "bg-ok-soft")}
                  title={errors[`${r.id}:last_contacted_on`]}>
                  <input type="date" aria-label={`Last contacted for ${r.full_name}`} defaultValue={r.last_contacted_on ?? ""} disabled={!!r.left_at}
                    onChange={(e) => save(r, "last_contacted_on", e.target.value || null)}
                    className="rounded border border-transparent bg-transparent px-1 py-1 text-xs hover:border-line focus:border-accent" />
                </td>
                {sel(r, "contact_frequency", FREQUENCIES)}
                {sel(r, "influence_level", LEVELS, true)}
                {sel(r, "decision_level", LEVELS, true)}
                <td className="whitespace-nowrap border-b border-line px-2 py-1 text-xs">
                  {q ? <span className={clsx("rounded-full px-2 py-0.5 font-bold", q.tone === "ok" ? "bg-ok-soft text-ok" : q.tone === "warn" ? "bg-warn-soft text-warn" : q.tone === "info" ? "bg-info-soft text-info" : "bg-surface-2 text-muted")}
                    title={r.quadrant_confirmed ? "From the confirmed grid" : "Default grid, still to be confirmed in the CRM Watchtower"}>{q.label}{!r.quadrant_confirmed && " *"}</span> : <span className="text-muted">—</span>}
                </td>
                {multi(r, "services_offered")}
                {multi(r, "services_declined")}
                {tick(r, "induction_required")}
                {tick(r, "receive_survey")}
                {sel(r, "legal_basis", LEGAL_BASES, true)}
                {tick(r, "email_opt_out")}
                <td className="whitespace-nowrap border-b border-line px-2 py-1 text-xs">
                  {r.left_at ? <span className="text-muted">Left</span> : r.missing_fields.length ? <span className="text-warn" title={`Missing: ${r.missing_fields.join(", ")}`}>{r.missing_fields.length} missing</span>
                    : r.needs_review ? <span className="text-info">Review due</span> : <span className="text-ok">OK</span>}
                  {r.latest_nps != null && <div><Link className="text-accent hover:underline" href={r.latest_survey_wave_id ? `/crm/surveys/${r.latest_survey_wave_id}` : "/crm/surveys"}>NPS {r.latest_nps}</Link></div>}
                  {r.send_block && !r.left_at && <div className="text-bad" title="Excluded from email sends">{r.send_block}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-muted">
        {pending ? "Saving…" : "Changes save as you go; every change is in the audit trail. * marks a mandatory field. Matrix values with * come from the default grid and are still to be confirmed."}
        {" "}Legal basis: {labelOf(LEGAL_BASES, "legitimate_interest_existing")} is the default.
      </p>
    </div>
  );
}
