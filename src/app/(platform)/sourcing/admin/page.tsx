import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBillingEntities, getClients, getEvents, getLibrary, getPeople, rows } from "@/lib/sourcing-data";
import { money, REGIONS, type SourcingClient, type BillingEntity } from "@/lib/sourcing";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Td, Th } from "@/components/sourcing/bits";
import { saveBillingEntity, saveClient, setAccess, updateSettings } from "../actions";

export const metadata: Metadata = { title: "Sourcing+ admin" };

export default async function SourcingAdmin() {
  const me = await requireInternal();
  const supabase = await createClient();
  const [clients, entities, people, access, settings, matrix, cards, thresholds, doa, events] = await Promise.all([
    getClients(supabase), getBillingEntities(supabase), getPeople(supabase),
    rows<{ user_id: string; is_lead: boolean; is_finance: boolean; doa_level: number | null }>(supabase, "sourcing_user_access"),
    rows<{ triage_tolerance_percent: number; push_confidence_threshold: number; instant_price_limit: number; push_respond_days: number }>(supabase, "sourcing_settings"),
    getLibrary(supabase, "sourcing_control_matrix"), getLibrary(supabase, "rate_cards"), getLibrary(supabase, "high_value_thresholds"), getLibrary(supabase, "doa_levels"),
    getEvents(supabase, { entity: "settings" }, 20),
  ]);
  const acc = new Map(access.map((a) => [a.user_id, a]));
  const cfg = settings[0];

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Admin" }]} title="Sourcing+ admin"
        sub="Client commercial rules, billing entities, who can approve what, and the triage rules. Governed libraries (control matrix, rate cards, thresholds, DOA) are changed in the Watchtower." />

      <Panel title="Clients and commercial rules" sub="Minimum quotes, markup, quote tolerance, savings target and e-tender threshold per client">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>Client</Th><Th>Min quotes</Th><Th>Markup</Th><Th>Tolerance</Th><Th>Savings target</Th><Th>E-tender above</Th><Th>Status</Th></tr></thead>
            <tbody>{clients.map((c) => (
              <tr key={c.id}>
                <Td><details><summary className="cursor-pointer font-semibold">{c.name} <span className="text-xs text-muted">{c.code}</span></summary><div className="mt-3 max-w-3xl"><ClientForm c={c} /></div></details></Td>
                <Td>{c.min_quotes_required}</Td><Td>{c.default_markup_percent}%</Td><Td>{c.quote_tolerance_percent != null ? `±${c.quote_tolerance_percent}%` : "—"}</Td>
                <Td>{c.savings_target_percent}%</Td><Td>{money(c.e_tender_threshold, c.default_currency)}</Td><Td>{c.active ? <Pill tone="ok">Active</Pill> : <Pill>Inactive</Pill>}</Td>
              </tr>))}</tbody>
          </table>
        </div>
        <details className="border-t border-line px-5 py-3"><summary className="cursor-pointer text-sm font-semibold">Add a client</summary><div className="mt-3 max-w-3xl"><ClientForm /></div></details>
      </Panel>

      <Panel title="Billing entities" sub="The adm Indicia legal entity a job is invoiced from">
        <table className="w-full text-sm">
          <thead><tr><Th>Entity</Th><Th>Region</Th><Th>Market</Th><Th>Currency</Th><Th>VAT</Th></tr></thead>
          <tbody>{entities.map((b) => (
            <tr key={b.id}>
              <Td><details><summary className="cursor-pointer font-semibold">{b.name} <span className="text-xs text-muted">{b.code}</span></summary><div className="mt-3 max-w-3xl"><EntityForm b={b} /></div></details></Td>
              <Td>{b.region}</Td><Td>{b.market}</Td><Td>{b.currency}</Td><Td>{b.vat_number ?? "—"}</Td>
            </tr>))}</tbody>
        </table>
        <details className="border-t border-line px-5 py-3"><summary className="cursor-pointer text-sm font-semibold">Add a billing entity</summary><div className="mt-3 max-w-3xl"><EntityForm /></div></details>
      </Panel>

      <Panel title="People and approval authority" sub="Sourcing leads approve high-value RFQs and route lines away from RFQ; Finance approves quotes; DOA level decides which POs someone can approve. Admins and Sourcing+ owners can change this.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>Person</Th><Th>Access</Th></tr></thead>
            <tbody>{[...people.entries()].map(([uid, name]) => {
              const a = acc.get(uid);
              return (
                <tr key={uid}>
                  <Td className="font-semibold">{name}{uid === me.id && <span className="ml-1 text-xs text-muted">(you)</span>}</Td>
                  <Td>
                    <ActionForm action={setAccess} hidden={{ user_id: uid }} submit="Save" variant="secondary" inline>
                      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="is_lead" defaultChecked={a?.is_lead} /> Sourcing lead</label>
                      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="is_finance" defaultChecked={a?.is_finance} /> Finance approver</label>
                      <select name="doa_level" defaultValue={a?.doa_level ?? ""} className="input w-auto" aria-label="DOA level">
                        <option value="">No DOA authority</option>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => <option key={l} value={l}>DOA level {l}</option>)}
                      </select>
                    </ActionForm>
                  </Td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>

      {cfg && (
        <Panel title="Triage rules" sub="Rule-based routing before RFQ. Every change needs a reason and is logged.">
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <ActionForm action={updateSettings} submit="Save rules">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Size tolerance band (±%)" htmlFor="triage_tolerance_percent"><input id="triage_tolerance_percent" name="triage_tolerance_percent" defaultValue={Number(cfg.triage_tolerance_percent)} className="input" /></Field>
                <Field label="Push confidence threshold (%)" htmlFor="push_confidence_percent"><input id="push_confidence_percent" name="push_confidence_percent" defaultValue={Math.round(Number(cfg.push_confidence_threshold) * 100)} className="input" /></Field>
                <Field label="Instant-price limit (line value)" htmlFor="instant_price_limit"><input id="instant_price_limit" name="instant_price_limit" defaultValue={Number(cfg.instant_price_limit)} className="input" /></Field>
                <Field label="Days for a supplier to answer a Push" htmlFor="push_respond_days"><input id="push_respond_days" name="push_respond_days" defaultValue={cfg.push_respond_days} className="input" /></Field>
                <Field label="Reason for the change" htmlFor="reason" className="sm:col-span-2"><input id="reason" name="reason" required className="input" /></Field>
              </div>
            </ActionForm>
            <div><p className="eyebrow mb-2">Recent changes</p><ActivityList events={events} people={people} /></div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Sourcing control matrix" sub="Watchtower library: suppliers to invite by value band">
          <table className="w-full text-sm"><thead><tr><Th>Band</Th><Th>In-country</Th><Th>Cross-border</Th><Th>Owner</Th><Th>Price validation</Th></tr></thead>
            <tbody>{matrix.map((r) => (
              <tr key={r.id}><Td className="font-semibold">{r.name}</Td><Td>{String(r.data.suppliers_in_country ?? "—")}</Td><Td>{String(r.data.suppliers_cross_border ?? "—")}</Td><Td className="text-xs">{String(r.data.strategy_owner ?? "—")}</Td><Td>{String(r.data.external_price_validation ?? "—")}</Td></tr>
            ))}</tbody></table>
        </Panel>
        <Panel title="High-value thresholds" sub="Watchtower library: RFQs at or above need a sourcing lead's approval">
          <table className="w-full text-sm"><thead><tr><Th>Market</Th><Th>Threshold</Th></tr></thead>
            <tbody>{thresholds.map((r) => (<tr key={r.id}><Td>{String(r.data.market ?? "All other markets")}</Td><Td>{money(Number(r.data.threshold), String(r.data.currency ?? "EUR"))}</Td></tr>))}</tbody></table>
        </Panel>
        <Panel title="Rate cards" sub="Watchtower library: drive Adopt, Adapt and Push">
          <table className="w-full text-sm"><thead><tr><Th>Card</Th><Th>Type</Th><Th>Size (mm)</Th><Th>Qty band</Th><Th>Price</Th><Th>Supplier</Th></tr></thead>
            <tbody>{cards.map((r) => (
              <tr key={r.id}><Td className="font-semibold">{r.name}</Td><Td>{String(r.data.spec_type)}</Td><Td>{r.data.finished_length_mm ? `${r.data.finished_length_mm} × ${r.data.finished_width_mm}` : "Any"}</Td>
                <Td>{String(r.data.min_qty ?? 0)}–{String(r.data.max_qty ?? "∞")}</Td><Td>{money(Number(r.data.unit_price), String(r.data.currency ?? "EUR"), 2)}</Td><Td>{String(r.data.supplier_code ?? "—")}</Td></tr>
            ))}</tbody></table>
        </Panel>
        <Panel title="Delegation of authority" sub="Watchtower library: the level needed is read from the version in force on the PO date">
          <table className="w-full text-sm"><thead><tr><Th>Level</Th><Th>Up to</Th></tr></thead>
            <tbody>{doa.map((r) => (<tr key={r.id}><Td>Level {String(r.data.approval_level)}</Td><Td>{r.data.max_approval_amount == null ? "Uncapped" : money(Number(r.data.max_approval_amount), String(r.data.currency ?? "GBP"))}</Td></tr>))}</tbody></table>
        </Panel>
      </div>
    </>
  );
}

function ClientForm({ c }: { c?: SourcingClient }) {
  return (
    <ActionForm action={saveClient} hidden={{ id: c?.id }} submit={c ? "Save client" : "Add client"} variant="secondary">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code" htmlFor={`code-${c?.id}`}><input id={`code-${c?.id}`} name="code" defaultValue={c?.code} required className="input uppercase" /></Field>
        <Field label="Name" htmlFor={`name-${c?.id}`} className="sm:col-span-2"><input id={`name-${c?.id}`} name="name" defaultValue={c?.name} required className="input" /></Field>
        <Field label="Currency" htmlFor={`cur-${c?.id}`}><input id={`cur-${c?.id}`} name="default_currency" defaultValue={c?.default_currency ?? "EUR"} className="input uppercase" /></Field>
        <Field label="Minimum quotes" htmlFor={`mq-${c?.id}`}><input id={`mq-${c?.id}`} name="min_quotes_required" defaultValue={c?.min_quotes_required ?? 3} className="input" /></Field>
        <Field label="Markup %" htmlFor={`mk-${c?.id}`}><input id={`mk-${c?.id}`} name="default_markup_percent" defaultValue={c?.default_markup_percent ?? 15} className="input" /></Field>
        <Field label="Quote tolerance ±%" htmlFor={`tol-${c?.id}`}><input id={`tol-${c?.id}`} name="quote_tolerance_percent" defaultValue={c?.quote_tolerance_percent ?? ""} className="input" /></Field>
        <Field label="Savings target %" htmlFor={`st-${c?.id}`}><input id={`st-${c?.id}`} name="savings_target_percent" defaultValue={c?.savings_target_percent ?? 5} className="input" /></Field>
        <Field label="E-tender threshold" htmlFor={`et-${c?.id}`}><input id={`et-${c?.id}`} name="e_tender_threshold" defaultValue={c?.e_tender_threshold ?? ""} className="input" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> Active</label>
      </div>
    </ActionForm>
  );
}

function EntityForm({ b }: { b?: BillingEntity }) {
  return (
    <ActionForm action={saveBillingEntity} hidden={{ id: b?.id }} submit={b ? "Save entity" : "Add entity"} variant="secondary">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code" htmlFor={`bc-${b?.id}`}><input id={`bc-${b?.id}`} name="code" defaultValue={b?.code} required className="input uppercase" /></Field>
        <Field label="Name" htmlFor={`bn-${b?.id}`} className="sm:col-span-3"><input id={`bn-${b?.id}`} name="name" defaultValue={b?.name} required className="input" /></Field>
        <Field label="Region" htmlFor={`br-${b?.id}`}><select id={`br-${b?.id}`} name="region" defaultValue={b?.region ?? ""} className="input"><option value="">Choose…</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Market" htmlFor={`bm-${b?.id}`}><input id={`bm-${b?.id}`} name="market" defaultValue={b?.market} required className="input" /></Field>
        <Field label="Currency" htmlFor={`bcu-${b?.id}`}><input id={`bcu-${b?.id}`} name="currency" defaultValue={b?.currency ?? "EUR"} className="input uppercase" /></Field>
        <Field label="VAT number" htmlFor={`bv-${b?.id}`}><input id={`bv-${b?.id}`} name="vat_number" defaultValue={b?.vat_number ?? ""} className="input" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={b?.active ?? true} /> Active</label>
      </div>
    </ActionForm>
  );
}
