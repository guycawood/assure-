"use client";

import { useMemo, useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn, Pill } from "@/components/ui";
import { Modal } from "@/components/modal";
import { MSymbol } from "@/components/symbol";
import { ClientActionForm } from "@/components/client/forms";
import { TaxonomySelect } from "@/components/taxonomy/taxonomy-select";
import { FORM_TYPES, SOURCE_SYSTEMS, type TaxLevel, type TaxonomyData, type TaxonomyValue } from "@/lib/taxonomy-shared";
import type { TaxUsage } from "@/lib/taxonomy-shared";
import {
  classifySpec, deleteAlias, deleteNode, nodeUsage, reorderNodes, rerunClassification, reviewMapping, saveAlias, saveNode,
  toggleNode, proposeMappings, importMappings, type TaxResult,
} from "./actions";

type Node = { id: string; code: string; name: string; description: string | null; active: boolean; default_hs_code?: string | null; parent: string };

/** A button that runs a server action and shows its message. */
export function RunButton({ run, label, pending = "Working…", variant = "secondary", confirm }: {
  run: () => Promise<TaxResult>; label: string; pending?: string; variant?: keyof typeof btn; confirm?: string;
}) {
  const [busy, start] = useTransition();
  const [res, setRes] = useState<TaxResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={btn[variant]} disabled={busy}
        onClick={() => { if (confirm && !window.confirm(confirm)) return; start(async () => setRes(await run())); }}>
        {busy ? pending : label}
      </button>
      {res?.error && <span className="text-sm text-bad" role="alert">{res.error}</span>}
      {res?.ok && res.message && <span className="text-sm text-ok" role="status">{res.message}</span>}
    </span>
  );
}

const LEVEL_LABEL: Record<TaxLevel, string> = { category: "category", subcategory: "subcategory", product_type: "product type" };

// ---------------------------------------------------------------------------
// Product tree: categories grouped by form type → subcategories → product types
// ---------------------------------------------------------------------------
export function ProductTree({ data, isAdmin, q }: { data: TaxonomyData; isAdmin: boolean; q: string }) {
  const [catId, setCatId] = useState<string>(data.categories[0]?.id ?? "");
  const [subId, setSubId] = useState<string>("");
  const [edit, setEdit] = useState<{ level: TaxLevel; node?: Node; parent?: string } | null>(null);
  const [warn, setWarn] = useState<{ level: TaxLevel; node: Node; usage: TaxUsage | null } | null>(null);
  const [msg, setMsg] = useState<TaxResult | null>(null);
  const [busy, start] = useTransition();

  const needle = q.trim().toLowerCase();
  const hit = (n: { name: string; code: string }) => !needle || n.name.toLowerCase().includes(needle) || n.code.toLowerCase().includes(needle);
  const subs = data.subcategories.filter((s) => s.category_id === catId);
  const pts = data.productTypes.filter((p) => p.subcategory_id === subId);
  const matchingCats = useMemo(() => new Set(data.categories.filter((c) => hit(c)
    || data.subcategories.some((s) => s.category_id === c.id && (hit(s) || data.productTypes.some((p) => p.subcategory_id === s.id && hit(p))))).map((c) => c.id)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, needle]);

  const act = (fn: () => Promise<TaxResult>) => start(async () => setMsg(await fn()));
  const move = (level: TaxLevel, list: { id: string }[], i: number, d: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => reorderNodes(level, ids));
  };
  const deactivate = async (level: TaxLevel, node: Node) => setWarn({ level, node, usage: await nodeUsage(level, node.id) });

  const row = (level: TaxLevel, n: Node, list: Node[], i: number, selected: boolean, onSelect?: () => void) => (
    <li key={n.id} className={clsx("group flex items-start gap-2 border-b border-line px-3 py-2 last:border-0", selected && "bg-accent-soft", !n.active && "opacity-60")}>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect} disabled={!onSelect}>
        <span className="block truncate text-sm font-semibold">{n.name}</span>
        <span className="block text-xs text-muted">{n.code}{n.default_hs_code ? ` · HS ${n.default_hs_code}` : ""}{!n.active ? " · inactive" : ""}</span>
      </button>
      {isAdmin && (
        <span className="flex shrink-0 items-center gap-0.5 text-muted">
          <IconBtn label="Move up" icon="arrow_upward" onClick={() => move(level, list, i, -1)} disabled={busy || i === 0} />
          <IconBtn label="Move down" icon="arrow_downward" onClick={() => move(level, list, i, 1)} disabled={busy || i === list.length - 1} />
          <IconBtn label="Edit" icon="edit" onClick={() => setEdit({ level, node: n })} />
          {n.active
            ? <IconBtn label="Deactivate" icon="toggle_on" onClick={() => deactivate(level, n)} />
            : <IconBtn label="Reactivate" icon="toggle_off" onClick={() => act(() => toggleNode(level, n.id, true))} />}
        </span>
      )}
    </li>
  );

  const catNodes = (ft: string) => data.categories.filter((c) => c.form_type === ft && matchingCats.has(c.id)).map((c) => ({ ...c, parent: c.form_type }));
  const subNodes: Node[] = subs.filter((s) => !needle || hit(s) || data.productTypes.some((p) => p.subcategory_id === s.id && hit(p))).map((s) => ({ ...s, parent: s.category_id }));
  const ptNodes: Node[] = pts.filter((p) => !needle || hit(p) || hit(data.subcategories.find((s) => s.id === p.subcategory_id) ?? { name: "", code: "" })).map((p) => ({ ...p, parent: p.subcategory_id }));
  const cat = data.categories.find((c) => c.id === catId);
  const sub = data.subcategories.find((s) => s.id === subId);

  return (
    <div className="space-y-3">
      {msg && (msg.error ? <p className="px-5 text-sm text-bad" role="alert">{msg.error}</p> : <p className="px-5 text-sm text-ok" role="status">{msg.message}</p>)}
      <div className="grid gap-4 px-5 pb-5 lg:grid-cols-3">
        <Column title="Categories" sub="Grouped by form type" onAdd={isAdmin ? () => setEdit({ level: "category" }) : undefined}>
          {FORM_TYPES.map((ft) => {
            const list = catNodes(ft);
            if (!list.length) return null;
            return (
              <div key={ft}>
                <p className="eyebrow bg-surface-2 px-3 py-1.5">{ft}</p>
                <ul>{list.map((c, i) => row("category", c, list, i, c.id === catId, () => { setCatId(c.id); setSubId(""); }))}</ul>
              </div>
            );
          })}
        </Column>
        <Column title={cat ? `Subcategories of ${cat.name}` : "Subcategories"} sub={cat ? cat.form_type : "Choose a category"}
          onAdd={isAdmin && cat ? () => setEdit({ level: "subcategory", parent: cat.id }) : undefined}>
          {subNodes.length === 0 ? <p className="px-3 py-4 text-sm text-muted">No subcategories.</p>
            : <ul>{subNodes.map((s, i) => row("subcategory", s, subNodes, i, s.id === subId, () => setSubId(s.id)))}</ul>}
        </Column>
        <Column title={sub ? `Product types of ${sub.name}` : "Product types"} sub={sub ? "The leaf specs reference; default HS code is a starting value" : "Choose a subcategory"}
          onAdd={isAdmin && sub ? () => setEdit({ level: "product_type", parent: sub.id }) : undefined}>
          {!sub ? <p className="px-3 py-4 text-sm text-muted">Choose a subcategory.</p> : ptNodes.length === 0 ? <p className="px-3 py-4 text-sm text-muted">No product types.</p>
            : <ul>{ptNodes.map((p, i) => row("product_type", p, ptNodes, i, false))}</ul>}
        </Column>
      </div>

      {edit && <NodeDialog data={data} edit={edit} onClose={() => setEdit(null)} />}
      {warn && (
        <Modal open onClose={() => setWarn(null)} title={`Deactivate ${LEVEL_LABEL[warn.level]} "${warn.node.name}"?`}
          sub="It leaves the picker. Records that already use it keep it, and you can reactivate it at any time.">
          <div className="space-y-3 text-sm">
            {warn.usage ? (
              <ul className="list-disc space-y-1 pl-5">
                {warn.level !== "product_type" && <li><b>{warn.usage.active_children}</b> active {warn.level === "category" ? "subcategories" : "product types"} under it will no longer be reachable in the picker.</li>}
                <li><b>{warn.usage.specs}</b> specs are classified with it.</li>
                <li><b>{warn.usage.aliases}</b> aliases point to it (they stop resolving while it is inactive).</li>
                {warn.usage.mappings > 0 && <li><b>{warn.usage.mappings}</b> cross-system mappings point to it.</li>}
              </ul>
            ) : <p className="text-muted">Usage could not be loaded.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn.danger} disabled={busy} onClick={() => { const w = warn; setWarn(null); act(() => toggleNode(w.level, w.node.id, false)); }}>Deactivate</button>
              {warn.usage && warn.usage.children === 0 && warn.usage.specs === 0 && warn.usage.mappings === 0 && (
                <button type="button" className={btn.secondary} disabled={busy}
                  onClick={() => { const w = warn; if (!window.confirm(`Delete "${w.node.name}" for good?`)) return; setWarn(null); act(() => deleteNode(w.level, w.node.id)); }}>
                  Delete instead (unused)
                </button>
              )}
              <button type="button" className={btn.secondary} onClick={() => setWarn(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function IconBtn({ label, icon, onClick, disabled }: { label: string; icon: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded hover:bg-surface-2 hover:text-fg disabled:opacity-30">
      <MSymbol name={icon} size={16} />
    </button>
  );
}

function Column({ title, sub, onAdd, children }: { title: string; sub?: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0"><p className="truncate text-sm font-bold">{title}</p>{sub && <p className="truncate text-xs text-muted">{sub}</p>}</div>
        {onAdd && <button type="button" className={btn.secondary} onClick={onAdd}><MSymbol name="add" size={16} />Add</button>}
      </div>
      <div className="max-h-[32rem] overflow-y-auto">{children}</div>
    </div>
  );
}

function NodeDialog({ data, edit, onClose }: { data: TaxonomyData; edit: { level: TaxLevel; node?: Node; parent?: string }; onClose: () => void }) {
  const { level, node } = edit;
  const parent = node?.parent ?? edit.parent ?? "";
  const title = `${node ? "Edit" : "Add"} ${LEVEL_LABEL[level]}`;
  return (
    <Modal open onClose={onClose} title={title} sub="Codes are unique within the parent. Every change is recorded in the audit trail.">
      <ClientActionForm action={async (p, fd) => { const r = await saveNode(p, fd); if (r.ok) onClose(); return r; }} submit={node ? "Save" : "Add"}
        hidden={{ level, id: node?.id ?? "" }}>
        {level === "category" && (
          <div>
            <label className="label" htmlFor="tx-ft">Form type</label>
            <select id="tx-ft" name="form_type" className="input" defaultValue={parent || FORM_TYPES[0]} required>
              {FORM_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
        {level === "subcategory" && (
          <div>
            <label className="label" htmlFor="tx-parent">Category</label>
            <select id="tx-parent" name="parent_id" className="input" defaultValue={parent} required>
              {FORM_TYPES.map((f) => (
                <optgroup key={f} label={f}>
                  {data.categories.filter((c) => c.form_type === f).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {level === "product_type" && (
          <div>
            <label className="label" htmlFor="tx-parent">Subcategory</label>
            <select id="tx-parent" name="parent_id" className="input" defaultValue={parent} required>
              {data.categories.map((c) => (
                <optgroup key={c.id} label={`${c.form_type} › ${c.name}`}>
                  {data.subcategories.filter((s) => s.category_id === c.id).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="tx-code">Code</label>
            <input id="tx-code" name="code" className="input uppercase" defaultValue={node?.code} required maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="tx-name">Name</label>
            <input id="tx-name" name="name" className="input" defaultValue={node?.name} required />
          </div>
        </div>
        {level === "product_type" && (
          <div>
            <label className="label" htmlFor="tx-hs">Default HS code</label>
            <input id="tx-hs" name="default_hs_code" className="input" defaultValue={node?.default_hs_code ?? ""} placeholder="e.g. 4911.10" />
            <p className="mt-1 text-xs text-muted">A starting value: a spec takes it when someone picks this product type and the spec has no HS code. The spec&apos;s own HS code always wins.</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="tx-desc">Description</label>
          <textarea id="tx-desc" name="description" className="input" rows={2} defaultValue={node?.description ?? ""} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={node?.active ?? true} /> Active (offered in the picker)</label>
      </ClientActionForm>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------
export type AliasRow = { id: string; alias: string; category_id: string | null; subcategory_id: string | null; product_type_id: string | null;
  source_system: string | null; source_reference: string | null; active: boolean; label: string };

export function AliasEditor({ data, alias }: { data: TaxonomyData; alias?: AliasRow }) {
  const [open, setOpen] = useState(false);
  const value: Partial<TaxonomyValue> = alias ? { category_id: alias.category_id ?? "", subcategory_id: alias.subcategory_id ?? "", product_type_id: alias.product_type_id ?? "" } : {};
  return (
    <>
      {alias ? <IconBtn label="Edit alias" icon="edit" onClick={() => setOpen(true)} />
        : <button type="button" className={btn.primary} onClick={() => setOpen(true)}><MSymbol name="add" size={16} />Add alias</button>}
      {open && (
        <Modal open onClose={() => setOpen(false)} wide title={alias ? `Edit alias "${alias.alias}"` : "Add an alias"}
          sub="A historic, local-language, misspelled or alternative term. It points to exactly one node: the deepest level you choose.">
          <ClientActionForm action={async (p, fd) => { const r = await saveAlias(p, fd); if (r.ok) setOpen(false); return r; }} submit="Save alias" hidden={{ id: alias?.id ?? "" }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="label" htmlFor="al-term">Term</label>
                <input id="al-term" name="alias" className="input" defaultValue={alias?.alias} required />
              </div>
              <div>
                <label className="label" htmlFor="al-src">Source system</label>
                <select id="al-src" name="source_system" className="input" defaultValue={alias?.source_system ?? ""}>
                  <option value="">Entered here</option>
                  {SOURCE_SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="al-ref">Source reference</label>
                <input id="al-ref" name="source_reference" className="input" defaultValue={alias?.source_reference ?? ""} />
              </div>
            </div>
            <TaxonomySelect name="target" data={data} defaultValue={value} required requireSubcategory={false} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={alias?.active ?? true} /> Active</label>
          </ClientActionForm>
          {alias && <div className="mt-3 border-t border-line pt-3"><RunButton run={() => deleteAlias(alias.id)} label="Delete alias" variant="danger" confirm={`Delete the alias "${alias.alias}"?`} /></div>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------
export type MappingRow = { id: string; source_system: string; source_form_type: string | null; source_category: string | null; source_subcategory: string | null;
  source_product_type: string | null; category_id: string | null; subcategory_id: string | null; product_type_id: string | null; status: string;
  confidence: number | null; match_basis: string | null; notes: string | null };

export function MappingReview({ data, m }: { data: TaxonomyData; m: MappingRow }) {
  const [open, setOpen] = useState(false);
  const ext = [m.source_form_type, m.source_category, m.source_subcategory, m.source_product_type].filter(Boolean).join(" / ");
  const done = m.status === "Approved" || m.status === "Archived";
  return (
    <>
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)} disabled={done}>{done ? m.status : "Review"}</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} wide title={`Review "${ext}"`} sub={`From ${m.source_system}. Approving adds an alias so the value resolves from now on.`}>
          <ClientActionForm action={async (p, fd) => { const r = await reviewMapping(p, fd); if (r.ok) setOpen(false); return r; }} submit="Save decision" hidden={{ id: m.id }}>
            <TaxonomySelect name="target" data={data} requireSubcategory={false}
              defaultValue={{ category_id: m.category_id ?? "", subcategory_id: m.subcategory_id ?? "", product_type_id: m.product_type_id ?? "" }} />
            {m.match_basis && <p className="text-xs text-muted">Suggested by {m.match_basis} (confidence {Math.round(Number(m.confidence ?? 0) * 100)}%).</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="mp-dec">Decision</label>
                <select id="mp-dec" name="decision" className="input" defaultValue="approve">
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                  <option value="pending">Mark for review</option>
                  <option value="archive">Archive</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="mp-notes">Notes (needed to reject)</label>
                <input id="mp-notes" name="notes" className="input" defaultValue={m.notes ?? ""} />
              </div>
            </div>
          </ClientActionForm>
        </Modal>
      )}
    </>
  );
}

export function MappingTools() {
  const [open, setOpen] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <RunButton run={proposeMappings} label="Find unmapped values" pending="Looking…" />
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>Import values</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Import values from another system" sub="One value per line: product type, or category | subcategory | product type, or form type | category | subcategory | product type.">
          <ClientActionForm action={async (p, fd) => { const r = await importMappings(p, fd); if (r.ok) setOpen(false); return r; }} submit="Queue for review">
            <div>
              <label className="label" htmlFor="im-src">Source system</label>
              <select id="im-src" name="source_system" className="input" defaultValue="Stocktool">{SOURCE_SYSTEMS.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="im-rows">Values</label>
              <textarea id="im-rows" name="rows" className="input font-mono text-xs" rows={8} required placeholder={"POS | Floor | Corr. FSDU 4 shelf\nMug 11oz ceramic"} />
            </div>
          </ClientActionForm>
        </Modal>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Unclassified specs
// ---------------------------------------------------------------------------
export function ClassifyButton({ data, spec }: { data: TaxonomyData; spec: { id: string; title: string; form_type: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>Classify</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} wide title={`Classify "${spec.title}"`} sub="Picking a product type also fills the spec's HS code when it has none.">
          <ClientActionForm action={async (p, fd) => { const r = await classifySpec(p, fd); if (r.ok) setOpen(false); return r; }} submit="Save classification" hidden={{ spec_id: spec.id }}>
            <TaxonomySelect name="spec" data={data} required requireSubcategory={false} defaultValue={{ form_type: spec.form_type ?? "" }} />
          </ClientActionForm>
        </Modal>
      )}
    </>
  );
}

export function RerunButton() {
  return <RunButton run={rerunClassification} label="Re-run automatic classification" pending="Classifying…" />;
}

export function StatusPill({ status }: { status: string }) {
  const tone = status === "Approved" ? "ok" : status === "Rejected" ? "bad" : status === "Suggested" ? "info" : status === "Pending review" ? "warn" : "neutral";
  return <Pill tone={tone}>{status}</Pill>;
}
