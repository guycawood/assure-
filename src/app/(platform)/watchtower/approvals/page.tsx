import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInbox, getPolicies, type ApprovalRow } from "@/components/approvals/data";
import { ageText, money, moduleLabel, ROLE_LABEL, typeLabel } from "@/components/approvals/labels";
import { btn, Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "All approvals" };

type Search = { scope?: string; module?: string; type?: string; region?: string; market?: string; overdue?: string };

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

// Master Watchtower: every pending approval across all modules (admins), or the ones you can decide (everyone else).
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const scope: "mine" | "all" = me.is_admin && sp.scope !== "mine" ? "all" : "mine";
  const supabase = await createClient();
  const [{ rows, error }, policies] = await Promise.all([getInbox(supabase, scope), getPolicies(supabase)]);

  const shown = rows.filter((r) =>
    (!sp.module || r.module === sp.module) && (!sp.type || r.approval_type === sp.type) &&
    (!sp.region || r.region === sp.region) && (!sp.market || r.market === sp.market) && (!sp.overdue || r.status === "overdue"));
  const overdue = rows.filter((r) => r.status === "overdue").length;
  const yours = rows.filter((r) => r.can_decide).length;
  const byModule = new Map<string, { n: number; overdue: number }>();
  for (const r of rows) {
    const m = byModule.get(r.module) ?? { n: 0, overdue: 0 };
    m.n += 1; if (r.status === "overdue") m.overdue += 1;
    byModule.set(r.module, m);
  }
  const link = (patch: Partial<Search>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return `/watchtower/approvals${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "All approvals" }]}
        title={scope === "all" ? "All approvals" : "My approvals"}
        sub={scope === "all"
          ? "Every approval waiting anywhere on the platform, from briefs to invoices. Open an item to decide it where it lives."
          : "Approvals you can decide now. Items you asked for yourself are left out where a second person has to approve."}>
        {me.is_admin && (
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 text-sm font-semibold">
            <Link href={link({ scope: undefined })} className={scope === "all" ? "rounded-md bg-accent px-3 py-1 text-accent-fg" : "px-3 py-1 text-muted hover:text-fg"}>Everything</Link>
            <Link href={link({ scope: "mine" })} className={scope === "mine" ? "rounded-md bg-accent px-3 py-1 text-accent-fg" : "px-3 py-1 text-muted hover:text-fg"}>Mine to decide</Link>
          </div>
        )}
      </PageHead>

      {error && <Card className="p-4 text-sm text-bad" >{error}</Card>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Waiting" value={rows.length} icon={<MSymbol name="approval" size={20} />} hint={scope === "all" ? "Across every module" : "That you can decide"} />
        <Stat label="Overdue" value={overdue} tone={overdue ? "bad" : "ok"} hint="Older than the policy SLA" icon={<MSymbol name="schedule" size={20} />} />
        <Stat label="Yours to decide" value={yours} tone={yours ? "warn" : undefined} hint="Your role allows it" icon={<MSymbol name="how_to_reg" size={20} />} />
        <Card className="px-5 py-4">
          <p className="eyebrow">By module</p>
          {byModule.size === 0 ? <p className="mt-1 text-sm text-muted">Nothing waiting.</p> : (
            <ul className="mt-1.5 space-y-0.5 text-sm">
              {[...byModule.entries()].sort((a, b) => b[1].n - a[1].n).map(([m, v]) => (
                <li key={m} className="flex items-baseline justify-between gap-2">
                  <Link href={link({ module: m })} className="truncate text-accent hover:underline">{moduleLabel(m)}</Link>
                  <span className="tabular-nums font-bold">{v.n}{v.overdue > 0 && <span className="ml-1 text-xs text-bad">({v.overdue} late)</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" action="/watchtower/approvals">
          {scope === "mine" && me.is_admin && <input type="hidden" name="scope" value="mine" />}
          <Filter name="module" label="Module" value={sp.module} options={uniq(rows.map((r) => r.module)).map((m) => [m, moduleLabel(m)])} />
          <Filter name="type" label="Type" value={sp.type} options={uniq(rows.map((r) => r.approval_type)).map((t) => [t, typeLabel(t)])} />
          <Filter name="region" label="Region" value={sp.region} options={uniq(rows.map((r) => r.region)).map((x) => [x, x])} />
          <Filter name="market" label="Market" value={sp.market} options={uniq(rows.map((r) => r.market)).map((x) => [x, x])} />
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={Boolean(sp.overdue)} /> Overdue only</label>
          <button className={btn.primary}><MSymbol name="filter_list" size={17} /> Filter</button>
          <Link href={link({ module: undefined, type: undefined, region: undefined, market: undefined, overdue: undefined })} className="pb-2 text-sm font-semibold text-accent hover:underline">Clear</Link>
        </form>
      </Card>

      <Card className="overflow-x-auto">
        {shown.length === 0 ? (
          <Empty title={rows.length ? "Nothing matches these filters" : "Nothing waiting"}>
            <p className="text-sm">{rows.length ? "Clear the filters to see everything." : scope === "all" ? "No approvals are pending anywhere on the platform." : "There is nothing for you to approve right now."}</p>
          </Empty>
        ) : (
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr>
                <th className="th">Status</th><th className="th">What</th><th className="th">Module</th><th className="th">Asked by</th>
                <th className="th text-right">Value</th><th className="th">Client · market</th><th className="th">Who approves</th><th className="th" />
              </tr>
            </thead>
            <tbody>{shown.map((r) => <Row key={`${r.module}:${r.approval_type}:${r.item_id}`} r={r} />)}</tbody>
          </table>
        )}
      </Card>

      <Panel title="Approval policies" sub="Who approves what, set in the Watchtower library. Changes to a policy need a second person to approve them."
        actions={<Link href="/watchtower/libraries/approval_policies" className="text-sm font-semibold text-accent hover:underline">Open the library</Link>}>
        <div className="space-y-2 px-5 py-4 text-sm text-muted">
          <p>Each module publishes its waiting items in a view called <code>approvals_&lt;module&gt;</code>; this page reads them all, so a new module shows up here as soon as it adds its view.
            The most specific policy applies: a client policy beats a market policy, which beats a value threshold. <b>Maker-checker</b> means the approver is never the person who asked.
            An item is <b>overdue</b> once it is older than the policy SLA.</p>
        </div>
        {policies.length > 0 && (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr><th className="th">Policy</th><th className="th">Module</th><th className="th">Who approves</th><th className="th">Scope</th><th className="th">Rules</th><th className="th text-right">SLA</th></tr></thead>
              <tbody>
                {policies.map((p) => {
                  const d = p.data as Record<string, string | number | boolean | null | undefined>;
                  const scopeText = [d.client_code ? `Client ${d.client_code}` : null, d.market ? `Market ${d.market}` : null,
                    d.min_value != null && d.min_value !== "" ? `From ${money(Number(d.min_value), (d.currency as string) || null)}` : null].filter(Boolean).join(" · ") || "Everything";
                  return (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="td"><p className="font-semibold">{p.name}</p><p className="font-mono text-xs text-muted">{p.code} · {typeLabel(String(d.approval_type ?? ""))}</p></td>
                      <td className="td">{moduleLabel(String(d.module ?? ""))}</td>
                      <td className="td">{ROLE_LABEL[String(d.approver_role ?? "")] ?? String(d.approver_role ?? "–")}</td>
                      <td className="td">{scopeText}</td>
                      <td className="td"><span className="flex flex-wrap gap-1">
                        {d.maker_checker !== false && <Pill tone="info">Maker-checker</Pill>}
                        {d.client_approval_required === true && <Pill tone="accent">Client approves</Pill>}
                      </span></td>
                      <td className="td text-right tabular-nums">{d.sla_days != null && d.sla_days !== "" ? `${d.sla_days} d` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Filter({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div className="min-w-[150px]">
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="input">
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Row({ r }: { r: ApprovalRow }) {
  return (
    <tr className="border-t border-line align-top">
      <td className="td">{r.status === "overdue" ? <Pill tone="bad">Overdue</Pill> : <Pill tone="warn">Waiting</Pill>}</td>
      <td className="td min-w-[260px]">
        <Link href={r.href} className="font-semibold hover:underline">{r.title ?? r.ref}</Link>
        <p className="text-xs text-muted"><span className="font-mono">{r.ref}</span> · {typeLabel(r.approval_type)}</p>
      </td>
      <td className="td whitespace-nowrap">{moduleLabel(r.module)}</td>
      <td className="td whitespace-nowrap">{r.requested_by_name ?? <span className="text-muted">Vendor or system</span>}<p className="text-xs text-muted">{ageText(r.age_days)}</p></td>
      <td className="td text-right tabular-nums">{r.amount != null ? money(r.amount, r.currency) : "–"}</td>
      <td className="td">{[r.client, [r.market, r.region].filter(Boolean).join(" · ")].filter(Boolean).join(" · ") || "–"}</td>
      <td className="td text-xs">{r.approver_rule}{r.maker_checker && <span className="text-muted"> · second person</span>}</td>
      <td className="td whitespace-nowrap text-right">
        <Link href={r.href} className={r.can_decide ? btn.primary : btn.secondary}>{r.can_decide ? "Decide" : "Open"}</Link>
      </td>
    </tr>
  );
}
