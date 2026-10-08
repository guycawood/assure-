import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { distinct, filterDirectory, FILTER_KEYS, loadDirectory, type DirectoryFilters } from "@/lib/assure-directory";
import { RISK, SUPPLIER_STATUS, SUPPLIER_TIER } from "@/lib/assure";
import { CLIENTS, formatEur, REGIONS } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { OptPill, Score } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { setSupplierStatus } from "../srm-actions";

export const metadata: Metadata = { title: "Supplier directory" };

export default async function SupplierDirectory({ searchParams }: { searchParams: Promise<DirectoryFilters> }) {
  const me = await requireInternal();
  const f = await searchParams;
  const supabase = await createClient();
  const all = await loadDirectory(supabase);
  const list = filterDirectory(all, f).sort((a, b) => a.s.name.localeCompare(b.s.name));
  const qs = new URLSearchParams(FILTER_KEYS.filter((k) => f[k]).map((k) => [k, f[k] as string]));
  const canBulk = me.is_admin || me.srt_role === "lead" || me.srt_role === "head";
  const sel = (name: keyof DirectoryFilters, label: string, opts: { value: string; label: string }[]) => (
    <label className="min-w-[130px] flex-1">
      <span className="label">{label}</span>
      <select name={name} defaultValue={f[name] ?? ""} className="input"><option value="">All</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
  const plain = (v: string[]) => v.map((x) => ({ value: x, label: x }));

  return (
    <>
      <PageHead title="Supplier directory" sub={`Every supplier adm Indicia buys from. ${all.length} records.`} crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Suppliers" }]}>
        <ButtonLink href={`/assure/suppliers/export?${qs}`}><MSymbol name="download" size={18} /> Export CSV</ButtonLink>
        <ButtonLink href="/assure/suppliers/new" variant="primary"><MSymbol name="add" size={18} /> Add supplier</ButtonLink>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Showing" value={list.length} hint={`of ${all.length} suppliers`} />
        <Stat label="Active" value={list.filter((r) => r.s.status === "active").length} />
        <Stat label="With compliance issues" value={list.filter((r) => r.issues > 0).length} tone={list.some((r) => r.issues > 0) ? "warn" : "ok"} hint="Certificates or critical gates" />
        <Stat label="High or critical risk" value={list.filter((r) => r.p && ["high", "critical"].includes(r.p.risk_level)).length} tone="bad" />
      </section>

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="min-w-[220px] flex-[2]">
            <span className="label">Search</span>
            <input name="q" defaultValue={f.q ?? ""} placeholder="Name, supplier ID, vendor code or UEN" className="input" />
          </label>
          {sel("region", "Region", plain([...REGIONS]))}
          {sel("market", "Market", plain(distinct(all.map((r) => r.s.market))))}
          {sel("category", "Category", plain(distinct(all.map((r) => r.s.category))))}
          {sel("client", "Client", plain([...CLIENTS]))}
          {sel("status", "Status", SUPPLIER_STATUS)}
          {sel("tier", "Tier", SUPPLIER_TIER)}
          {sel("risk", "Risk", RISK)}
          {sel("compliance", "Compliance", [{ value: "ok", label: "No issues" }, { value: "issues", label: "Has issues" }])}
          <button className="inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg" type="submit">Filter</button>
          {qs.toString() && <Link href="/assure/suppliers" className="pb-2 text-sm text-muted underline">Clear</Link>}
        </form>
      </Card>

      {canBulk && (
        <Card className="p-4">
          <ActionForm id="bulk" action={setSupplierStatus} submit="Change status of ticked suppliers" inline confirm="Change the status of the ticked suppliers?">
            <Field label="New status" className="min-w-[180px]"><Select name="status" options={SUPPLIER_STATUS} blank="Choose…" required /></Field>
            <Field label="Reason (recorded on each supplier)" className="min-w-[280px] flex-1"><input name="reason" required className="input" placeholder="e.g. Quality escalation agreed with Procurement head" /></Field>
          </ActionForm>
        </Card>
      )}

      <Card className="overflow-x-auto">
        {list.length === 0 ? <Empty title="No suppliers match">Try clearing a filter.</Empty> : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {canBulk && <th className="th w-8"><span className="sr-only">Select</span></th>}
                {["Supplier", "Vendor code", "Region · market", "Category", "Client", "Status", "Tier", "Risk", "Compliance", "Score", "YTD spend"].map((h) => <th key={h} className="th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map(({ s, p, issues, score, period }) => (
                <tr key={s.id} className="hover:bg-surface-2/60">
                  {canBulk && <td className="td"><input type="checkbox" name="ids" value={s.id} form="bulk" aria-label={`Select ${s.name}`} /></td>}
                  <td className="td"><Link href={`/assure/suppliers/${s.id}`} className="font-semibold hover:text-accent">{s.name}</Link><div className="text-xs text-muted">{s.supplier_code}</div></td>
                  <td className="td text-xs">{p?.vendor_code ?? "—"}{p?.uen_number && <div className="text-muted">UEN {p.uen_number}</div>}</td>
                  <td className="td whitespace-nowrap">{[s.region, s.market].filter(Boolean).join(" · ")}</td>
                  <td className="td">{s.category}</td>
                  <td className="td">{s.client}</td>
                  <td className="td"><OptPill list={SUPPLIER_STATUS} value={s.status} /></td>
                  <td className="td"><OptPill list={SUPPLIER_TIER} value={s.tier} /></td>
                  <td className="td"><OptPill list={RISK} value={p?.risk_level} /></td>
                  <td className="td">{issues ? <Pill tone="warn">{issues} issue{issues === 1 ? "" : "s"}</Pill> : <Pill tone="ok">OK</Pill>}</td>
                  <td className="td" title={period ? `Latest period ${period}` : "No performance scores yet"}><Score value={score} /></td>
                  <td className="td text-right tabular-nums">{formatEur(s.ytd_spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
