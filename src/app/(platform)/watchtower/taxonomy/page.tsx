import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTaxonomy, MAPPING_STATUSES, SOURCE_SYSTEMS, type TaxonomyData } from "@/lib/taxonomy";
import { ButtonLink, Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import {
  AliasEditor, ClassifyButton, MappingReview, MappingTools, ProductTree, RerunButton, StatusPill, type AliasRow, type MappingRow,
} from "./taxonomy-admin";

export const metadata: Metadata = { title: "Product taxonomy" };

type Search = { tab?: string; q?: string; source?: string; status?: string };
const TABS = [
  { key: "product", label: "Product tree" },
  { key: "aac", label: "AAC rules" },
  { key: "aliases", label: "Aliases" },
  { key: "mappings", label: "Mappings queue", admin: true },
  { key: "unclassified", label: "Unclassified specs" },
  { key: "audit", label: "Audit trail" },
] as const;
const BASE = "/watchtower/taxonomy";
const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const label = (data: TaxonomyData, c: string | null, s: string | null, p: string | null) => {
  const pt = p ? data.productTypes.find((x) => x.id === p) : undefined;
  const sub = data.subcategories.find((x) => x.id === (s ?? pt?.subcategory_id));
  const cat = data.categories.find((x) => x.id === (c ?? sub?.category_id));
  return [cat?.form_type, cat?.name, sub?.name, pt?.name].filter(Boolean).join(" › ");
};

// Master Watchtower → Taxonomy. Product taxonomy (tree, aliases, mappings, unclassified specs, audit) and the AAC rules
// that triage reads. Everyone internal reads; admins change (every change audited in the database).
export default async function TaxonomyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "product";
  const q = (sp.q ?? "").trim();
  const supabase = await createClient();
  const data = await loadTaxonomy(supabase, { includeInactive: true });
  const active = { c: data.categories.filter((c) => c.active).length, s: data.subcategories.filter((s) => s.active).length, p: data.productTypes.filter((p) => p.active).length };
  const { data: summary } = await supabase.rpc("tax_classification_summary", {});
  const sum = (summary ?? {}) as { total?: number; classified?: number; unclassified?: number; automatic?: number; by_person?: number; by_admin?: number };
  const href = (extra: Record<string, string>) => `${BASE}?${new URLSearchParams({ tab, ...extra }).toString()}`;

  return (
    <>
      <PageHead
        title="Product taxonomy"
        crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Taxonomy" }]}
        sub="One governed naming tree for everything adm Indicia buys and produces: form type, category, subcategory and product type. Specs, orders, spend reporting and the AAC triage rules all use it. Materials stay on each spec's bill of materials."
      />

      <nav aria-label="Taxonomy domains" className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-fg">Product</span>
        <Link href="/crm/clients" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Client: managed in CRM</Link>
        <Link href="/finance" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">Finance: managed in Finance</Link>
        <Link href="/watchtower/libraries/doa_levels" className="rounded-full border border-line px-3 py-1 text-muted hover:text-fg">DOA: delegation of authority library</Link>
        <span className="rounded-full border border-dashed border-line px-3 py-1 text-muted" title="Geography master data is coming later">Geography: coming later</span>
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Categories" value={active.c} hint={`${data.categories.length - active.c} inactive · 10 form types`} />
        <Stat label="Subcategories" value={active.s} hint={`${data.subcategories.length - active.s} inactive`} />
        <Stat label="Product types" value={active.p} hint={`${data.productTypes.filter((p) => p.default_hs_code).length} with a default HS code`} />
        <Stat label="Specs classified" value={`${sum.classified ?? 0} / ${sum.total ?? 0}`} tone={(sum.unclassified ?? 0) > 0 ? "warn" : "ok"}
          hint={`${sum.unclassified ?? 0} unclassified · ${sum.automatic ?? 0} automatic, ${(sum.by_person ?? 0) + (sum.by_admin ?? 0)} by people`} />
      </section>

      <nav aria-label="Taxonomy sections" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.filter((t) => !("admin" in t) || me.is_admin).map((t) => (
          <Link key={t.key} href={`${BASE}?tab=${t.key}`}
            className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", t.key === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {!me.is_admin && <p className="text-xs text-muted">You can read the taxonomy. Admins make changes; use “Suggest a change” in the Watchtower to ask for one.</p>}

      {tab === "product" && (
        <Panel title="Product tree" sub="Choose a category, then a subcategory. Deactivating hides a node from the picker; records that use it keep it."
          actions={<SearchBox q={q} tab={tab} placeholder="Find a name or code" />}>
          <div className="pt-4"><ProductTree data={data} isAdmin={me.is_admin} q={q} /></div>
        </Panel>
      )}
      {tab === "aac" && <AacTab />}
      {tab === "aliases" && <AliasesTab data={data} q={q} isAdmin={me.is_admin} />}
      {tab === "mappings" && me.is_admin && <MappingsTab data={data} source={sp.source ?? ""} status={sp.status ?? ""} href={href} />}
      {tab === "unclassified" && <UnclassifiedTab data={data} q={q} isAdmin={me.is_admin} />}
      {tab === "audit" && <AuditTab q={q} />}
    </>
  );

  // -------------------------------------------------------------------------
  async function AliasesTab({ data, q, isAdmin }: { data: TaxonomyData; q: string; isAdmin: boolean }) {
    const { data: rows } = await supabase.from("tax_aliases").select("id, alias, category_id, subcategory_id, product_type_id, source_system, source_reference, active").order("alias");
    const list: AliasRow[] = ((rows ?? []) as Omit<AliasRow, "label">[]).map((a) => ({ ...a, label: label(data, a.category_id, a.subcategory_id, a.product_type_id) }))
      .filter((a) => !q || `${a.alias} ${a.label} ${a.source_system ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <Panel title="Aliases" sub="Historic, local-language, misspelled or alternative terms. Imports and free text resolve through them when they are saved, never when they are read."
        actions={<><SearchBox q={q} tab="aliases" placeholder="Find a term" />{isAdmin && <AliasEditor data={data} />}</>}>
        {list.length === 0 ? <Empty title="No aliases match" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Term", "Points to", "Source", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className="td font-semibold">{a.alias}</td>
                    <td className="td">{a.label}</td>
                    <td className="td text-xs text-muted">{a.source_system ?? "Entered here"}{a.source_reference ? ` · ${a.source_reference}` : ""}</td>
                    <td className="td">{a.active ? <Pill tone="ok">Active</Pill> : <Pill>Inactive</Pill>}</td>
                    <td className="td">{isAdmin && <AliasEditor data={data} alias={a} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  async function MappingsTab({ data, source, status, href }: { data: TaxonomyData; source: string; status: string; href: (x: Record<string, string>) => string }) {
    let query = supabase.from("tax_mappings").select("id, source_system, source_form_type, source_category, source_subcategory, source_product_type, category_id, subcategory_id, product_type_id, status, confidence, match_basis, notes, occurrences, reviewed_at");
    if ((SOURCE_SYSTEMS as readonly string[]).includes(source)) query = query.eq("source_system", source);
    if ((MAPPING_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
    const { data: rows } = await query.order("created_at", { ascending: false }).limit(500);
    const list = (rows ?? []) as (MappingRow & { occurrences: number; reviewed_at: string | null })[];
    const chip = (k: "source" | "status", v: string, text: string) => {
      const on = (k === "source" ? source : status) === v;
      return <Link key={k + v} href={href({ source: k === "source" ? v : source, status: k === "status" ? v : status })}
        className={clsx("rounded-full border px-2.5 py-0.5 text-xs font-semibold", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>{text}</Link>;
    };
    return (
      <Panel title="Cross-system mappings" sub="Values from other systems arrive here as Unmapped or Suggested. An admin approves them before they count as mapped; approving adds an alias. Admins only."
        actions={<MappingTools />}>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-3">
          <span className="text-xs text-muted">Source:</span>{chip("source", "", "All")}{SOURCE_SYSTEMS.map((s) => chip("source", s, s))}
          <span className="ml-3 text-xs text-muted">Status:</span>{chip("status", "", "All")}{MAPPING_STATUSES.map((s) => chip("status", s, s))}
        </div>
        {list.length === 0 ? <Empty title="Nothing in the queue">Use “Find unmapped values” to look through existing specs and jobs, or import a list.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Source", "External value", "Maps to", "Confidence", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td className="td text-xs">{m.source_system}</td>
                    <td className="td"><div className="font-semibold">{[m.source_category, m.source_subcategory, m.source_product_type].filter(Boolean).join(" / ")}</div>
                      <div className="text-xs text-muted">{m.source_form_type ?? ""}{m.occurrences ? ` · seen ${m.occurrences}×` : ""}</div></td>
                    <td className="td">{m.category_id ? label(data, m.category_id, m.subcategory_id, m.product_type_id) : <span className="text-muted">Not mapped</span>}
                      {m.match_basis && <div className="text-xs text-muted">{m.match_basis}</div>}</td>
                    <td className="td tabular-nums">{m.confidence != null ? `${Math.round(Number(m.confidence) * 100)}%` : "–"}</td>
                    <td className="td"><StatusPill status={m.status} />{m.reviewed_at && <div className="text-xs text-muted">{fmt(m.reviewed_at)}</div>}</td>
                    <td className="td"><MappingReview data={data} m={m} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  async function UnclassifiedTab({ data, q, isAdmin }: { data: TaxonomyData; q: string; isAdmin: boolean }) {
    const { data: rows } = await supabase.rpc("tax_unclassified_specs", { p_q: q || null, p_limit: 300 });
    const list = (rows ?? []) as { id: string; spec_no: number; title: string; spec_type: string; form_type: string | null; product_category: string | null; product_sub_type: string | null; job_id: string; job_number: string; client_name: string | null }[];
    return (
      <Panel title="Unclassified specs" sub="Specs whose free text did not resolve to the taxonomy. Add an alias (or approve a mapping) and re-run, or classify them one by one."
        actions={<><SearchBox q={q} tab="unclassified" placeholder="Find a spec" />{isAdmin && <RerunButton />}</>}>
        {list.length === 0 ? <Empty title="Every spec is classified" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Spec", "Job", "Type", "Category / sub-type (free text)", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="td font-semibold">{s.title}</td>
                    <td className="td"><Link href={`/sourcing/jobs/${s.job_id}`} className="text-accent hover:underline">{s.job_number}-{s.spec_no}</Link>
                      {s.client_name && <div className="text-xs text-muted">{s.client_name}</div>}</td>
                    <td className="td text-xs">{s.spec_type}{s.form_type ? ` · ${s.form_type}` : ""}</td>
                    <td className="td text-xs text-muted">{[s.product_category, s.product_sub_type].filter(Boolean).join(" / ") || "–"}</td>
                    <td className="td">{isAdmin && <ClassifyButton data={data} spec={s} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  async function AuditTab({ q }: { q: string }) {
    const { data: rows } = await supabase.from("tax_audit").select("id, domain, record_type, record_name, record_code, action, description, changed_by_name, at").order("at", { ascending: false }).limit(300);
    const list = ((rows ?? []) as { id: number; domain: string; record_type: string; record_name: string | null; record_code: string | null; action: string; description: string; changed_by_name: string | null; at: string }[])
      .filter((a) => !q || `${a.description} ${a.record_name ?? ""} ${a.changed_by_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <Panel title="Audit trail" sub="Every create, update, delete, deactivation, reorder, mapping decision and classification. Append-only." actions={<SearchBox q={q} tab="audit" placeholder="Find a change" />}>
        {list.length === 0 ? <Empty title="No changes yet" /> : (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Pill tone="neutral">{a.domain}</Pill><Pill tone="info">{a.action}</Pill><span>{a.description}</span></div>
                <div className="mt-0.5 text-xs text-muted">{fmt(a.at)} · {a.changed_by_name ?? "System"} · {a.record_type}{a.record_code ? ` ${a.record_code}` : ""}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }

  async function AacTab() {
    const [{ data: rules }, { data: cfgRow }, { data: usage }] = await Promise.all([
      supabase.from("library_records").select("id, code, name, data, status, version, effective_from, effective_to").eq("library_key", "aac_classification_rules").order("code"),
      supabase.from("sourcing_settings").select("triage_tolerance_percent, push_confidence_threshold, instant_price_limit, push_respond_days").maybeSingle(),
      supabase.rpc("aac_rule_usage", {}),
    ]);
    type Rule = { id: string; code: string; name: string; status: string; version: number; effective_from: string; effective_to: string | null; data: Record<string, unknown> };
    const all = ((rules ?? []) as Rule[]).filter((r) => r.status !== "superseded" && r.status !== "rejected");
    const cfg = (cfgRow ?? {}) as { triage_tolerance_percent?: number; push_confidence_threshold?: number; instant_price_limit?: number; push_respond_days?: number };
    const used = (usage ?? []) as { route: string; rule_code: string; lines: number }[];
    const val = (v: unknown, fallback: string) => (v === undefined || v === null || v === "" ? <span className="text-muted">{fallback} <i>(Sourcing settings)</i></span> : String(v));
    const scope = (d: Record<string, unknown>) => {
      const parts = [d.scope_form_type, d.scope_category_code, d.scope_subcategory_code, d.scope_product_type_code].filter((x) => x && String(x).trim()).map(String);
      const extra = [d.scope_client_code && `client ${d.scope_client_code}`, d.scope_market && `market ${d.scope_market}`].filter(Boolean);
      return [parts.length ? parts.join(" › ") : "Default (every spec)", ...extra].join(" · ");
    };
    const level = (d: Record<string, unknown>) => d.scope_product_type_code ? 4 : d.scope_subcategory_code ? 3 : d.scope_category_code ? 2 : d.scope_form_type ? 1 : 0;
    const ROUTES: { key: string; title: string; plain: string; applied: string }[] = [
      { key: "adopt", title: "Adopt", plain: "Use a rate-card item as it is. The spec matches a live card (type, material, client, currency) within the exact-match margin, the quantity is in the card's range and the supplier is cleared in SRM. The card price applies and no RFQ runs.",
        applied: "Recorded when a line adopts, and when an exact match fails this rule's supplier quality floor." },
      { key: "adapt", title: "Adapt", plain: "Price from the nearest live card, scaled to size, without an RFQ: the spec is inside the tolerance band and the line value is under the value limit.",
        applied: "Recorded when a line adapts, and when the value limit or this rule's quality floor sends an in-band line to an RFQ." },
      { key: "push", title: "Push", plain: "An in-band line whose price confidence reaches the push threshold: we state the price and the card's supplier accepts or declines within the respond-by days.",
        applied: "Recorded when a line is pushed." },
      { key: "create", title: "Create", plain: "Run an RFQ: no card matches, the nearest card is outside the band, the supplier is not eligible, or a Create rule forces it (e.g. ideation specs).",
        applied: "A forcing rule is recorded when it fires; otherwise the most specific Create rule in scope." },
    ];
    return (
      <>
        <Panel title="AAC classification rules" sub="How triage routes each spec line before an RFQ. Rules are governed in the Watchtower library (maker-checker, effective-dated). For each route the most specific active rule wins: product type, then subcategory, category, form type, then the default; client and market break ties, then priority."
          actions={<ButtonLink href="/watchtower/libraries/aac_classification_rules">Open the rules library</ButtonLink>}>
          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            {ROUTES.map((r) => {
              const rs = all.filter((x) => x.data.route === r.key).sort((a, b) => level(b.data) - level(a.data));
              const lines = used.filter((u) => u.route === r.key);
              return (
                <Card key={r.key} className="p-4">
                  <h3 className="font-display text-base font-bold">{r.title}</h3>
                  <p className="mt-1 text-sm">{r.plain}</p>
                  <p className="mt-2 text-xs text-muted">Which rule applied: {r.applied}</p>
                  {lines.length > 0 && <p className="mt-1 text-xs text-muted">Current lines: {lines.map((l) => `${l.rule_code} ${l.lines}`).join(" · ")}</p>}
                  <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                    {rs.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No rules.</li> : rs.map((x) => (
                      <li key={x.id} className="px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <b>{x.code}</b><span>{x.name}</span>
                          {x.status === "active" ? <Pill tone="ok">Active</Pill> : x.status === "pending_approval" ? <Pill tone="warn">Waiting for approval</Pill> : <Pill>Switched off</Pill>}
                        </div>
                        <div className="text-xs text-muted">Scope: {scope(x.data)} · priority {String(x.data.priority ?? 100)} · v{x.version} from {x.effective_from}</div>
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                          {r.key === "adopt" && <><dt className="text-muted">Exact-match margin</dt><dd>{x.data.exact_match_percent == null || x.data.exact_match_percent === "" ? "0.5%" : `${String(x.data.exact_match_percent)}%`}</dd>
                            <dt className="text-muted">Quantity outside card range</dt><dd>{x.data.allow_quantity_outside_range ? "Allowed" : "Not allowed"}</dd></>}
                          {r.key === "adapt" && <><dt className="text-muted">Tolerance band</dt><dd>{x.data.tolerance_percent == null || x.data.tolerance_percent === "" ? val(null, `${cfg.triage_tolerance_percent ?? 10}%`) : `${String(x.data.tolerance_percent)}%`}</dd>
                            <dt className="text-muted">Value limit</dt><dd>{val(x.data.max_value, String(cfg.instant_price_limit ?? 25000))}</dd></>}
                          {r.key === "push" && <><dt className="text-muted">Minimum confidence</dt><dd>{val(x.data.min_confidence, String(cfg.push_confidence_threshold ?? 0.9))}</dd>
                            <dt className="text-muted">Respond within</dt><dd>{cfg.push_respond_days ?? 3} days <span className="text-muted">(Sourcing settings)</span></dd></>}
                          {r.key === "create" && <><dt className="text-muted">Forces an RFQ for</dt><dd>{[...((x.data.force_spec_forms as string[]) ?? []).map((f) => `${f} specs`), ...((x.data.force_complexity as string[]) ?? []).map((c) => `${c} complexity`)].join(", ") || "Nothing (fallback)"}</dd></>}
                          {x.data.min_supplier_score != null && x.data.min_supplier_score !== "" && <><dt className="text-muted">Supplier quality floor</dt><dd>{String(x.data.min_supplier_score)}</dd></>}
                        </dl>
                        {typeof x.data.definition === "string" && <p className="mt-1 text-xs">{x.data.definition}</p>}
                        {typeof x.data.note === "string" && <p className="mt-0.5 text-xs text-muted">{x.data.note}</p>}
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </Panel>
        <Card className="p-4 text-sm text-muted">
          <b className="text-fg">Always in code, never a rule:</b> rate-card matching (spec type, material, client, currency, size), price scaling to size, the confidence calculation and the SRM purchasing block (a blocked or inactive supplier always sends the line to an RFQ). Every triage result records the rule that applied.
        </Card>
      </>
    );
  }
}

function SearchBox({ q, tab, placeholder }: { q: string; tab: string; placeholder: string }) {
  return (
    <form action={BASE} className="flex items-center gap-2">
      <input type="hidden" name="tab" value={tab} />
      <input name="q" defaultValue={q} placeholder={placeholder} className="input h-9 w-48" aria-label={placeholder} />
    </form>
  );
}
