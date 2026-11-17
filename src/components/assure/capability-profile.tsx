import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { removeCapabilityItem, saveCapabilityItem, verifyCapabilityItem } from "./capability-actions";
import { ExtraFields, SavedExtra, type ExtraQuestion, type SavedAnswers } from "./extra-fields";

// Vendor capability profile: what the vendor can make, the machines they run and the tooling they hold.
// mode "internal" (SRM, can verify) or "vendor" (the vendor portal, keeps its own entries).

type Lib = { id: string; code: string; name: string; data: Record<string, unknown> };
type Status = "declared" | "verified" | "rejected";
type Common = { custom?: SavedAnswers; id: string; site_id: string | null; evidence_status: Status; verification_note: string | null; updated_by: string | null; notes: string | null };
type Cap = Common & { process_id: string; in_house: boolean; subcontractor: string | null; materials: string[]; max_width_mm: number | null; max_height_mm: number | null;
  max_depth_mm: number | null; min_run: number | null; max_run: number | null; monthly_capacity: number | null; lead_time_days: number | null; colours: number | null };
type Machine = Common & { machine_type_id: string; make: string | null; model: string | null; year_built: number | null; quantity: number; max_width_mm: number | null;
  max_height_mm: number | null; colours_stations: number | null; speed: number | null; speed_unit: string | null; condition: string | null };
type Tool = Common & { tool_code: string; tooling_type_id: string; description: string; owner: "supplier" | "adm_indicia" | "client"; owner_client_id: string | null;
  spec_id: string | null; material: string | null; cavities: number | null; dimensions: string | null; made_year: number | null; last_used: string | null;
  lifetime: number | null; used: number | null; storage_cost_month: number | null; currency: string; insured: boolean; status: string };

const STATUS_TONE: Record<Status, "warn" | "ok" | "bad"> = { declared: "warn", verified: "ok", rejected: "bad" };
const OWNER: Record<Tool["owner"], string> = { supplier: "Supplier", adm_indicia: "Our team", client: "Client" };
const n = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? null : `${Number(v).toLocaleString("en-GB")}${unit}`);
const size = (w: number | null, h: number | null, d?: number | null) => (w || h ? `${[w, h, d].filter((x) => x).map((x) => Number(x).toLocaleString("en-GB")).join(" × ")} mm` : null);

function StatusPill({ s, note }: { s: Status; note: string | null }) {
  return <span title={note ?? undefined}><Pill tone={STATUS_TONE[s]}>{s === "declared" ? "Declared" : s === "verified" ? "Verified" : "Rejected"}</Pill></span>;
}

function Verify({ kind, id, supplierId }: { kind: string; id: string; supplierId: string }) {
  return (
    <details className="text-xs"><summary className="cursor-pointer font-semibold text-accent">Verify</summary>
      <ActionForm action={verifyCapabilityItem} hidden={{ kind, id, supplier_id: supplierId }} submit="Record" variant="secondary" className="mt-2 flex flex-wrap items-end gap-2">
        <select name="decision" className="input w-32" aria-label="Decision"><option value="verify">Verified</option><option value="reject">Rejected</option></select>
        <input name="note" className="input w-56" placeholder="How it was checked (site visit, photo, invoice)" aria-label="Note" />
      </ActionForm>
    </details>
  );
}

export async function CapabilityProfile({ supplierId, mode }: { supplierId: string; mode: "internal" | "vendor" }) {
  const supabase = await createClient();
  const [{ data: caps }, { data: machines }, { data: tools }, { data: libs }, { data: sites }, { data: clients }] = await Promise.all([
    supabase.from("supplier_capabilities").select("*").eq("supplier_id", supplierId).order("created_at"),
    supabase.from("supplier_machines").select("*").eq("supplier_id", supplierId).order("created_at"),
    supabase.from("supplier_tooling").select("*").eq("supplier_id", supplierId).order("tool_code"),
    supabase.from("library_records").select("id, code, name, data, library_key").in("library_key", ["srm_processes", "srm_machine_types", "srm_tooling_types"]).eq("status", "active").order("code"),
    supabase.from("supplier_sites").select("id, name").eq("supplier_id", supplierId).eq("active", true).order("name"),
    mode === "internal" ? supabase.from("sourcing_clients").select("id, name").eq("active", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const extra = Object.fromEntries(await Promise.all((["capability", "machine", "tooling"] as const).map(async (k) => {
    const { data } = await supabase.rpc("vendor_form_questions", { p_form: k });
    return [k, ((data as { questions?: ExtraQuestion[] } | null)?.questions ?? [])] as const;
  }))) as Record<"capability" | "machine" | "tooling", ExtraQuestion[]>;
  const lib = (libs ?? []) as (Lib & { library_key: string })[];
  const byId = new Map(lib.map((l) => [l.id, l]));
  const bySeq = (a: Lib, b: Lib) => Number(a.data.seq ?? 0) - Number(b.data.seq ?? 0) || a.name.localeCompare(b.name);
  const processes = lib.filter((l) => l.library_key === "srm_processes").sort(bySeq);
  const machineTypes = lib.filter((l) => l.library_key === "srm_machine_types").sort(bySeq);
  const toolTypes = lib.filter((l) => l.library_key === "srm_tooling_types").sort(bySeq);
  const siteList = (sites ?? []) as { id: string; name: string }[];
  const siteName = new Map(siteList.map((s) => [s.id, s.name]));
  const clientList = (clients ?? []) as { id: string; name: string }[];
  const capRows = (caps ?? []) as Cap[];
  const machineRows = (machines ?? []) as Machine[];
  const toolRows = (tools ?? []) as Tool[];
  const internal = mode === "internal";
  const counts = (rs: Common[]) => ({ verified: rs.filter((r) => r.evidence_status === "verified").length, total: rs.length });
  const siteSelect = siteList.length > 0 && (
    <label className="text-sm"><span className="label">Site</span><select name="site_id" className="input"><option value="">Whole company</option>{siteList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  );
  const hidden = { supplier_id: supplierId };
  const summary = [["Capabilities", counts(capRows)], ["Machines", counts(machineRows)], ["Tooling", counts(toolRows)]] as const;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
        {summary.map(([label, c]) => <span key={label}><b>{c.total}</b> {label.toLowerCase()} <span className="text-muted">({c.verified} verified)</span></span>)}
        <span className="ml-auto text-xs text-muted">{internal ? "Vendors keep these up to date in the vendor portal. Verify what you have seen; a change makes an entry declared again." : "Keep this up to date: the team uses it to invite you to the right RFQs. Entries show as declared until SRM verifies them."}</span>
      </Card>

      <Panel title="Capabilities" sub="Processes you run, the sizes, run lengths and capacity, and lead time.">
        {capRows.length === 0 ? <Empty title="No capabilities yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">Process</th><th className="th">Max size</th><th className="th">Runs</th><th className="th">Capacity / month</th><th className="th">Lead time</th><th className="th">Materials</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{capRows.map((c) => {
              const p = byId.get(c.process_id);
              return (
                <tr key={c.id} className="align-top">
                  <td className="td"><span className="font-semibold">{p?.name ?? "Process"}</span><div className="text-xs text-muted">{c.in_house ? "In-house" : `Subcontracted${c.subcontractor ? ` to ${c.subcontractor}` : ""}`}{c.site_id ? ` · ${siteName.get(c.site_id) ?? ""}` : ""}{c.colours ? ` · ${c.colours} colours` : ""}</div><SavedExtra custom={c.custom} /></td>
                  <td className="td tabular-nums">{size(c.max_width_mm, c.max_height_mm, c.max_depth_mm) ?? "—"}</td>
                  <td className="td tabular-nums">{c.min_run || c.max_run ? `${n(c.min_run) ?? "0"} – ${n(c.max_run) ?? "any"}` : "—"}</td>
                  <td className="td tabular-nums">{n(c.monthly_capacity) ? `${n(c.monthly_capacity)} ${String(p?.data.capacity_unit ?? "").replace(" per month", "")}` : "—"}</td>
                  <td className="td">{c.lead_time_days !== null ? `${c.lead_time_days} days` : "—"}</td>
                  <td className="td text-xs">{c.materials.join(", ") || "—"}</td>
                  <td className="td"><StatusPill s={c.evidence_status} note={c.verification_note} />{internal && <Verify kind="capability" id={c.id} supplierId={supplierId} />}</td>
                  <td className="td"><ActionForm action={removeCapabilityItem} hidden={{ kind: "capability", id: c.id, supplier_id: supplierId }} submit="Remove" variant="secondary" inline confirm="Remove this capability?" /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <details className="border-t border-line px-5 py-3"><summary className="cursor-pointer text-sm font-semibold text-accent">Add a capability</summary>
          <ActionForm action={saveCapabilityItem} hidden={{ ...hidden, kind: "capability" }} submit="Add" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm sm:col-span-2"><span className="label">Process</span><select name="process_id" className="input" required>{processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {siteSelect}
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="in_house" defaultChecked /> In-house</label>
            <label className="text-sm"><span className="label">Subcontractor (if not in-house)</span><input name="subcontractor" className="input" /></label>
            <label className="text-sm"><span className="label">Max width (mm)</span><input name="max_width_mm" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Max height (mm)</span><input name="max_height_mm" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Max depth (mm)</span><input name="max_depth_mm" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Minimum run</span><input name="min_run" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Maximum run</span><input name="max_run" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Capacity per month</span><input name="monthly_capacity" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Lead time (days)</span><input name="lead_time_days" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Colours (print)</span><input name="colours" type="number" className="input" /></label>
            <label className="text-sm sm:col-span-2"><span className="label">Materials (comma separated)</span><input name="materials" className="input" placeholder="PP, ABS, PETG" /></label>
            <ExtraFields questions={extra.capability} />
            <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">Notes</span><input name="notes" className="input" /></label>
          </ActionForm>
        </details>
      </Panel>

      <Panel title="Machines" sub="The equipment behind each capability.">
        {machineRows.length === 0 ? <Empty title="No machines yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">Machine</th><th className="th">Make / model</th><th className="th">Qty</th><th className="th">Year</th><th className="th">Max format</th><th className="th">Colours / stations</th><th className="th">Speed</th><th className="th">Condition</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{machineRows.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="td font-semibold">{byId.get(m.machine_type_id)?.name ?? "Machine"}{m.site_id && <div className="text-xs font-normal text-muted">{siteName.get(m.site_id)}</div>}<SavedExtra custom={m.custom} /></td>
                <td className="td">{[m.make, m.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="td tabular-nums">{m.quantity}</td>
                <td className="td tabular-nums">{m.year_built ?? "—"}</td>
                <td className="td tabular-nums">{size(m.max_width_mm, m.max_height_mm) ?? "—"}</td>
                <td className="td tabular-nums">{m.colours_stations ?? "—"}</td>
                <td className="td">{m.speed !== null ? `${n(m.speed)} ${m.speed_unit ?? ""}` : "—"}</td>
                <td className="td capitalize">{m.condition ?? "—"}</td>
                <td className="td"><StatusPill s={m.evidence_status} note={m.verification_note} />{internal && <Verify kind="machine" id={m.id} supplierId={supplierId} />}</td>
                <td className="td"><ActionForm action={removeCapabilityItem} hidden={{ kind: "machine", id: m.id, supplier_id: supplierId }} submit="Remove" variant="secondary" inline confirm="Remove this machine?" /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <details className="border-t border-line px-5 py-3"><summary className="cursor-pointer text-sm font-semibold text-accent">Add a machine</summary>
          <ActionForm action={saveCapabilityItem} hidden={{ ...hidden, kind: "machine" }} submit="Add" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm sm:col-span-2"><span className="label">Machine type</span><select name="machine_type_id" className="input" required>{machineTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {siteSelect}
            <label className="text-sm"><span className="label">Make</span><input name="make" className="input" /></label>
            <label className="text-sm"><span className="label">Model</span><input name="model" className="input" /></label>
            <label className="text-sm"><span className="label">Year built</span><input name="year_built" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Quantity</span><input name="quantity" type="number" min={1} defaultValue={1} className="input" /></label>
            <label className="text-sm"><span className="label">Max width (mm)</span><input name="max_width_mm" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Max height (mm)</span><input name="max_height_mm" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Colours / stations / heads</span><input name="colours_stations" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Speed</span><input name="speed" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Speed unit</span><input name="speed_unit" className="input" placeholder="sheets/h, m2/h, tonnes clamp" /></label>
            <label className="text-sm"><span className="label">Condition</span><select name="condition" className="input"><option value="">—</option>{["new", "good", "fair", "poor"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <ExtraFields questions={extra.machine} />
            <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">Notes</span><input name="notes" className="input" /></label>
          </ActionForm>
        </details>
      </Panel>

      <Panel title="Tooling and moulds" sub="Moulds, dies, cutting formes, screens and jigs held at the vendor: who owns them, what they were made for and how worn they are. Kept as a record: retire or return, never delete.">
        {toolRows.length === 0 ? <Empty title="No tooling registered" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">Tool</th><th className="th">Owner</th><th className="th">Cavities</th><th className="th">Wear</th><th className="th">Last used</th><th className="th">Storage</th><th className="th">State</th><th className="th">Status</th></tr></thead>
            <tbody>{toolRows.map((t) => {
              const wear = t.lifetime && t.used !== null ? Math.round((t.used / t.lifetime) * 100) : null;
              return (
                <tr key={t.id} className="align-top">
                  <td className="td"><span className="font-semibold">{t.description}</span><div className="text-xs text-muted">{t.tool_code} · {byId.get(t.tooling_type_id)?.name}{t.material ? ` · ${t.material}` : ""}{t.dimensions ? ` · ${t.dimensions}` : ""}{t.site_id ? ` · ${siteName.get(t.site_id) ?? ""}` : ""}</div><SavedExtra custom={t.custom} /></td>
                  <td className="td">{OWNER[t.owner]}{t.owner === "client" && t.owner_client_id && <div className="text-xs text-muted">{clientList.find((c) => c.id === t.owner_client_id)?.name ?? "Client"}</div>}</td>
                  <td className="td tabular-nums">{t.cavities ?? "—"}</td>
                  <td className="td">{wear !== null ? <Pill tone={wear >= 90 ? "bad" : wear >= 70 ? "warn" : "ok"}>{wear}% used</Pill> : "—"}<div className="text-xs text-muted">{t.used !== null && t.lifetime ? `${n(t.used)} of ${n(t.lifetime)} ${String(byId.get(t.tooling_type_id)?.data.wear_unit ?? "")}` : ""}</div></td>
                  <td className="td">{t.last_used ?? "—"}</td>
                  <td className="td">{t.storage_cost_month !== null ? `${t.currency} ${n(t.storage_cost_month)}/month` : "—"}{t.insured && <div className="text-xs text-ok">Insured</div>}</td>
                  <td className="td capitalize">{t.status.replace("_", " ")}</td>
                  <td className="td"><StatusPill s={t.evidence_status} note={t.verification_note} />{internal && <Verify kind="tooling" id={t.id} supplierId={supplierId} />}
                    {t.status === "active" && (
                      <ActionForm action={saveCapabilityItem} hidden={{ kind: "tooling", id: t.id, supplier_id: supplierId, tooling_type_id: t.tooling_type_id, owner: t.owner, owner_client_id: t.owner_client_id, description: t.description, status: "retired" }}
                        submit="Retire" variant="secondary" inline confirm="Mark this tooling as retired?" />
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <details className="border-t border-line px-5 py-3"><summary className="cursor-pointer text-sm font-semibold text-accent">Register tooling</summary>
          <ActionForm action={saveCapabilityItem} hidden={{ ...hidden, kind: "tooling" }} submit="Register" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm sm:col-span-2"><span className="label">Type</span><select name="tooling_type_id" className="input" required>{toolTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-sm sm:col-span-2"><span className="label">Description</span><input name="description" className="input" required placeholder="e.g. Shelf wobbler base, 4-cavity" /></label>
            <label className="text-sm"><span className="label">Owned by</span><select name="owner" className="input"><option value="supplier">Supplier</option><option value="adm_indicia">Our team</option>{internal && <option value="client">Client</option>}</select></label>
            {internal && <label className="text-sm"><span className="label">Client (if client-owned)</span><select name="owner_client_id" className="input"><option value="">—</option>{clientList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {siteSelect}
            <label className="text-sm"><span className="label">Material</span><input name="material" className="input" placeholder="P20 steel, aluminium" /></label>
            <label className="text-sm"><span className="label">Cavities</span><input name="cavities" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Dimensions</span><input name="dimensions" className="input" /></label>
            <label className="text-sm"><span className="label">Year made</span><input name="made_year" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Expected life</span><input name="lifetime" type="number" className="input" placeholder="shots / impressions" /></label>
            <label className="text-sm"><span className="label">Used so far</span><input name="used" type="number" className="input" /></label>
            <label className="text-sm"><span className="label">Last used</span><input name="last_used" type="date" className="input" /></label>
            <label className="text-sm"><span className="label">Storage cost per month</span><input name="storage_cost_month" type="number" step="any" className="input" /></label>
            <label className="text-sm"><span className="label">Currency</span><input name="currency" className="input" defaultValue="EUR" /></label>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="insured" /> Insured</label>
            <ExtraFields questions={extra.tooling} />
            <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="label">Notes</span><input name="notes" className="input" /></label>
          </ActionForm>
          {!internal && <p className="mt-2 text-xs text-muted">Client-owned tooling: register it as supplier-owned and tell your contact; SRM records the client owner.</p>}
        </details>
      </Panel>
    </div>
  );
}
