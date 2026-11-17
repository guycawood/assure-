import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { importBids, importItems, inviteVendors, selectBid, setDeadline, setProgrammeStatus, updateProgramme } from "../actions";
import { answerVendor, approveProgramme, awardLowest, reopenProgramme, sendBack, setAwards, setValidity } from "../award-actions";

export const metadata: Metadata = { title: "Rate card programme" };

type Programme = {
  id: string; code: string; name: string; year: number; market: string | null; currency: string; status: string; fee_percent: number; cap_percent: number;
  winner_band_percent: number; min_coverage_percent: number; saving_high_percent: number; price_decimals: number; notes: string | null; bid_deadline: string | null;
  valid_from: string | null; valid_to: string | null; submitted_by: string | null; approved_by: string | null; approved_at: string | null; approval_note: string | null;
};
type Acceptance = { supplier_id: string; supplier_name: string; status: "pending" | "accepted" | "queried"; accepted_by: string | null; accepted_at: string | null; question: string | null; response: string | null; items: number };
type Award = { item_id: string; bid_id: string | null; supplier: string; share: number; buy: number; sell: number; contract_status: string };
type Invite = { supplier_id: string; supplier_name: string; status: "invited" | "viewed" | "submitted" | "declined"; invited_at: string; viewed_at: string | null; responded_at: string | null; decline_reason: string | null; priced: number };
type Bid = { id: string; supplier: string; price: number; in_srm: boolean };
type Row = {
  id: string; subcode: string; product_type: string; channel: string; category: string | null; uom: string | null; qty_min: number | null; qty_max: number | null;
  baseline_price: number | null; baseline_match: string | null; bids: number; lowest: number | null; market_avg_capped: number | null; selected_supplier: string | null; selection_reason: string | null;
  buy: number | null; sell: number | null; saving_type: "ref" | "market" | null; saving_pct: number | null; saving_amount: number | null; winners: string[]; flags: string[]; bid_list: Bid[]; selected_bid: string | null;
};
type Summary = {
  items: number; with_bids: number; with_price: number; coverage_percent: number; coverage_basis: string; meets_coverage: boolean; min_coverage: number; saving_amount: number;
  no_bids: number; single_bid: number; price_up: number; saving_high: number; tier_check: number; not_lowest: number;
  bids_open: boolean; sealed_bids: number; deadline: string | null;
};

const FLAGS: Record<string, { label: string; tone: "bad" | "warn" | "info" | "neutral"; help: string }> = {
  no_bids: { label: "No bids", tone: "bad", help: "Nobody has priced this row." },
  single_bid: { label: "One bid", tone: "warn", help: "Only one supplier priced it." },
  price_up: { label: "Dearer than last year", tone: "bad", help: "The sell price is above last year's." },
  saving_high: { label: "Saving looks too high", tone: "warn", help: "Check the baseline and the bid." },
  tier_check: { label: "Does not fall with quantity", tone: "bad", help: "The price is above the tier before it." },
  not_lowest: { label: "Not the lowest bid", tone: "info", help: "The buyer chose a dearer bid." },
  no_baseline: { label: "No last year price", tone: "neutral", help: "Measured against the market average." },
};
const FLAG_FILTERS = ["no_bids", "single_bid", "price_up", "saving_high", "tier_check", "not_lowest"];
const SHOW = 300;

export default async function ProgrammePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; type?: string; channel?: string; flag?: string }> }) {
  await requireInternal();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "import" ? "import" : sp.tab === "settings" ? "settings" : sp.tab === "vendors" ? "vendors" : sp.tab === "approval" ? "approval" : "analysis";
  const supabase = await createClient();
  const { data: pr } = await supabase.from("rate_card_programmes").select("*").eq("id", id).maybeSingle();
  if (!pr) notFound();
  const p = pr as Programme;
  const res = await supabase.rpc("rate_card_programme_analysis", { p_prog: id });
  const analysis = (res.data as { rows: Row[]; summary: Summary } | null) ?? { rows: [], summary: { items: 0 } as Summary };
  const locked = p.status === "approved" || p.status === "published";
  const [invitesRes, vendorsRes] = tab === "vendors" ? await Promise.all([
    supabase.rpc("rate_card_invites_list", { p_prog: id }),
    supabase.from("suppliers").select("id, name, market").eq("active", true).eq("purchasing_blocked", false).order("name").limit(1000),
  ]) : [null, null];
  const awardsRes = tab === "analysis" || tab === "approval" ? await supabase.rpc("rate_card_programme_awards", { p_prog: id }) : null;
  const acceptRes = tab === "approval" && (p.status === "approved" || p.status === "published") ? await supabase.rpc("rate_card_programme_acceptances", { p_prog: id }) : null;
  const acceptances = (acceptRes?.data ?? []) as Acceptance[];
  const awards = (awardsRes?.data ?? []) as Award[];
  const awardsBy = new Map<string, Award[]>();
  for (const a of awards) awardsBy.set(a.item_id, [...(awardsBy.get(a.item_id) ?? []), a]);
  const invites = ((invitesRes?.data ?? []) as Invite[]);
  const invited = new Set(invites.map((i) => i.supplier_id));
  const eligible = ((vendorsRes?.data ?? []) as { id: string; name: string; market: string | null }[]).filter((v) => !invited.has(v.id));
  const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "No deadline set");
  const money = (n: number | null | undefined, d = p.price_decimals) => n == null ? "—" : `${Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const types = [...new Set(analysis.rows.map((r) => r.product_type))].sort();
  const rows = analysis.rows.filter((r) => (!sp.type || r.product_type === sp.type) && (!sp.channel || r.channel === sp.channel) && (!sp.flag || r.flags.includes(sp.flag)));
  const s = analysis.summary;
  const base = `/sourcing/rate-cards/programmes/${id}`;
  const tabLink = (key: string, label: string) => (
    <Link href={key === "analysis" ? base : `${base}?tab=${key}`} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label}</Link>
  );
  const q = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), ...(sp.channel ? { channel: sp.channel } : {}), ...(sp.flag ? { flag: sp.flag } : {}), ...extra }).toString()}`;

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards", href: "/sourcing/rate-cards" }, { label: "Programmes", href: "/sourcing/rate-cards/programmes" }, { label: p.code }]}
        title={p.name} sub={`${p.year}${p.market ? ` · ${p.market}` : ""} · ${p.currency} · fee ${Number(p.fee_percent)}% · outliers capped at ${Number(p.cap_percent)}% · prices to ${p.price_decimals} decimals`}>
        <Pill tone={p.status === "draft" ? "neutral" : p.status === "review" ? "warn" : "info"}>{p.status}</Pill>
      </PageHead>
      <nav className="flex gap-1 border-b border-line">{tabLink("analysis", `Analysis (${s.items ?? 0} items)`)}{tabLink("vendors", "Vendors")}{tabLink("approval", "Award and approval")}{tabLink("import", "Import items and bids")}{tabLink("settings", "Settings")}</nav>

      {tab === "analysis" && (
        <>
          {s.sealed_bids > 0 && <Card className="border-warn/40 bg-warn-soft px-5 py-3 text-sm">{s.sealed_bids} vendor price{s.sealed_bids === 1 ? " is" : "s are"} sealed. They open at the deadline ({when(s.deadline)}) or when every invited vendor has responded.</Card>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="px-4 py-3"><p className="text-xs font-semibold text-muted">Items</p><p className="font-display text-2xl font-bold tabular-nums">{s.items ?? 0}</p><p className="text-xs text-muted">{s.with_bids ?? 0} with bids, {s.with_price ?? 0} priced</p></Card>
            <Card className="px-4 py-3"><p className="text-xs font-semibold text-muted">Coverage ({s.coverage_basis === "spend" ? "of last year's spend" : "of items"})</p>
              <p className={`font-display text-2xl font-bold tabular-nums ${s.meets_coverage ? "text-ok" : "text-bad"}`}>{s.coverage_percent ?? 0}%</p><p className="text-xs text-muted">Minimum {s.min_coverage ?? p.min_coverage_percent}%{s.meets_coverage ? "" : ", not met yet"}</p></Card>
            <Card className="px-4 py-3"><p className="text-xs font-semibold text-muted">Estimated saving</p><p className="font-display text-2xl font-bold tabular-nums">{p.currency} {money(s.saving_amount ?? 0, 0)}</p><p className="text-xs text-muted">On last year&apos;s volume</p></Card>
            <Card className="px-4 py-3"><p className="text-xs font-semibold text-muted">Need attention</p><p className="font-display text-2xl font-bold tabular-nums">{(s.no_bids ?? 0) + (s.price_up ?? 0) + (s.tier_check ?? 0)}</p><p className="text-xs text-muted">No bids, dearer, or not falling with quantity</p></Card>
            <Card className="px-4 py-3"><p className="text-xs font-semibold text-muted">Worth a look</p><p className="font-display text-2xl font-bold tabular-nums">{(s.single_bid ?? 0) + (s.saving_high ?? 0) + (s.not_lowest ?? 0)}</p><p className="text-xs text-muted">One bid, saving too high, not the lowest</p></Card>
          </div>

          <Card className="space-y-3 p-4">
            <form action={base} className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="type">Product type</label><select id="type" name="type" defaultValue={sp.type ?? ""} className="input"><option value="">All</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="label" htmlFor="channel">Channel</label><select id="channel" name="channel" defaultValue={sp.channel ?? ""} className="input"><option value="">All</option><option>DT</option><option>MT</option><option>Both</option></select></div>
              <div><label className="label" htmlFor="flag">Check</label><select id="flag" name="flag" defaultValue={sp.flag ?? ""} className="input"><option value="">All rows</option>{FLAG_FILTERS.map((f) => <option key={f} value={f}>{FLAGS[f].label}</option>)}</select></div>
              <button className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold" type="submit">Filter</button>
              <Link href={base} className="text-sm text-accent hover:underline">Clear</Link>
            </form>
            <div className="flex flex-wrap gap-2 text-xs">
              {FLAG_FILTERS.map((f) => {
                const count = (s as unknown as Record<string, number>)[f] ?? 0;
                return count > 0 ? <Link key={f} href={q({ flag: f })} className="rounded-full border border-line px-2.5 py-1 hover:border-accent/50">{FLAGS[f].label}: <b>{count}</b></Link> : null;
              })}
            </div>
          </Card>

          <Panel title="Items" sub={`${rows.length} row(s)${rows.length > SHOW ? `, showing the first ${SHOW}. Narrow the filters.` : ""}. Buy is the chosen bid rounded down; sell adds the ${Number(p.fee_percent)}% fee, rounded up.`}>
            {rows.length === 0 ? <p className="px-5 py-4 text-sm text-muted">{s.items ? "No rows match." : "No items yet. Import them on the next tab."}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>{["Item", "Tier", `Last year (${p.currency})`, "Bids", "Chosen bid", "Award", "Buy", "Sell", "Saving", "Checks"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, SHOW).map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="td"><b>{r.product_type}</b> <span className="text-xs text-muted">{r.channel}{r.category ? ` · ${r.category}` : ""}</span><div className="font-mono text-xs text-muted">{r.subcode}</div></td>
                        <td className="td tabular-nums">{money(r.qty_min, 0)} to {r.qty_max == null ? "no limit" : money(r.qty_max, 0)}<div className="text-xs text-muted">{r.uom ?? ""}</div></td>
                        <td className="td tabular-nums">{r.baseline_price == null ? "—" : money(r.baseline_price)}{r.baseline_match && <div className="text-xs text-muted">{r.baseline_match}</div>}</td>
                        <td className="td tabular-nums">{r.bids}{r.lowest != null && <div className="text-xs text-muted">low {money(r.lowest)}</div>}</td>
                        <td className="td">
                          {r.bids === 0 ? <span className="text-muted">No bids</span> : (
                            <details>
                              <summary className="cursor-pointer text-sm">{r.selected_supplier ?? r.bid_list[0]?.supplier}{r.selected_supplier ? "" : <span className="text-xs text-muted"> (lowest)</span>}</summary>
                              <ul className="mt-1 space-y-0.5 text-xs">{r.bid_list.map((b) => <li key={b.id} className="tabular-nums">{b.supplier} · {money(b.price)}{!b.in_srm && <span className="text-warn"> · not in SRM</span>}</li>)}</ul>
                              {!locked && (
                                <ActionForm action={selectBid} hidden={{ item: r.id }} submit="Use this bid" variant="secondary" className="mt-2 w-56">
                                  <select name="bid" aria-label="Bid" className="input py-1.5"><option value="">Lowest bid</option>{r.bid_list.map((b) => <option key={b.id} value={b.id} selected={b.id === r.selected_bid}>{b.supplier} · {money(b.price)}</option>)}</select>
                                  <input name="reason" aria-label="Why not the lowest" placeholder="Why, if not the lowest" defaultValue={r.selection_reason ?? ""} className="input py-1.5" />
                                </ActionForm>
                              )}
                              {r.selection_reason && <p className="mt-1 text-xs text-muted">Reason: {r.selection_reason}</p>}
                            </details>
                          )}
                          {r.winners.length > 1 && <div className="mt-1 text-xs text-muted">Within the band: {r.winners.join(", ")}</div>}
                        </td>
                        <td className="td">
                          {(awardsBy.get(r.id) ?? []).length === 0 ? <span className="text-xs text-muted">{r.bids ? "Not awarded" : "—"}</span> : (
                            <ul className="space-y-0.5 text-xs">{(awardsBy.get(r.id) ?? []).map((a) => <li key={a.supplier} className="tabular-nums"><b>{a.supplier}</b> {Number(a.share)}% · buy {money(a.buy)} · sell {money(a.sell)}</li>)}</ul>
                          )}
                          {!locked && r.bids > 0 && s.bids_open && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-accent">Edit award</summary>
                              <ActionForm action={setAwards} hidden={{ item: r.id }} submit="Save award" variant="secondary" className="mt-2 w-60">
                                {r.bid_list.map((b) => {
                                  const cur = (awardsBy.get(r.id) ?? []).find((a) => a.bid_id === b.id);
                                  return <label key={b.id} className="flex items-center justify-between gap-2 text-xs"><span>{b.supplier} · {money(b.price)}</span>
                                    <input name={`share:${b.id}`} inputMode="decimal" defaultValue={cur ? Number(cur.share) : ""} placeholder="%" aria-label={`Share for ${b.supplier}`} className="input w-16 py-1" /></label>;
                                })}
                                <p className="text-xs text-muted">Shares add up to 100. Leave a vendor blank to leave it out.</p>
                              </ActionForm>
                            </details>
                          )}
                        </td>
                        <td className="td tabular-nums">{money(r.buy)}</td>
                        <td className="td tabular-nums font-semibold">{money(r.sell)}</td>
                        <td className="td tabular-nums">{r.saving_pct == null ? "—" : <span className={r.saving_pct < 0 ? "text-bad" : ""}>{r.saving_pct}%</span>}<div className="text-xs text-muted">{r.saving_type === "ref" ? "vs last year" : r.saving_type === "market" ? "vs market" : ""}</div></td>
                        <td className="td"><div className="flex flex-wrap gap-1">{r.flags.map((f) => <span key={f} title={FLAGS[f]?.help}><Pill tone={FLAGS[f]?.tone ?? "neutral"}>{FLAGS[f]?.label ?? f}</Pill></span>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {tab === "approval" && (() => {
        const pricedItems = analysis.rows.filter((r) => r.bids > 0);
        const unawarded = pricedItems.filter((r) => !(awardsBy.get(r.id) ?? []).length).length;
        const openChecks = (s.price_up ?? 0) + (s.tier_check ?? 0) + (s.saving_high ?? 0);
        const checks: { ok: boolean; label: string; detail: string }[] = [
          { ok: !!p.valid_from && !!p.valid_to, label: "Validity dates set", detail: p.valid_from && p.valid_to ? `${p.valid_from} to ${p.valid_to}` : "Set when the cards start and end." },
          { ok: s.bids_open, label: "Vendor prices open", detail: s.bids_open ? "The deadline has passed or every vendor has responded." : `${s.sealed_bids} sealed until ${when(s.deadline)}.` },
          { ok: s.meets_coverage, label: "Coverage meets the minimum", detail: `${s.coverage_percent ?? 0}% against a minimum of ${s.min_coverage ?? p.min_coverage_percent}%.` },
          { ok: unawarded === 0 && pricedItems.length > 0, label: "Every priced item is awarded", detail: unawarded ? `${unawarded} item(s) have bids but no award.` : `${pricedItems.length} item(s) awarded.` },
          { ok: openChecks === 0, label: "No checks open", detail: openChecks ? `${openChecks} row(s) are dearer than last year, don't fall with quantity or save too much. A note is needed to approve.` : "Nothing flagged." },
        ];
        return (
          <div className="space-y-4">
            {p.status === "approved" || p.status === "published" ? (
              <>
              <Card className="space-y-1 border-ok/40 bg-ok-soft p-5 text-sm">
                <p className="font-semibold">Approved and locked</p>
                <p>Valid {p.valid_from} to {p.valid_to}. {awards.length} award(s) to {new Set(awards.map((a) => a.supplier)).size} vendor(s). Prices can&apos;t be changed. Each awarded vendor has been told.</p>
                {p.approval_note && <p className="text-muted">Note: {p.approval_note}</p>}
              </Card>
              <Panel title="Vendor acceptance" sub={`${acceptances.filter((a) => a.status === "accepted").length} of ${acceptances.length} awarded vendor(s) have accepted. An item's price is agreed once its vendor accepts.`}>
                {acceptances.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No vendor was awarded an item.</p> : (
                  <ul className="divide-y divide-line text-sm">
                    {acceptances.map((a) => (
                      <li key={a.supplier_id} className="space-y-2 px-5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span><b>{a.supplier_name}</b> <span className="text-xs text-muted">{a.items} item(s)</span></span>
                          <Pill tone={a.status === "accepted" ? "ok" : a.status === "queried" ? "info" : "warn"}>{a.status === "accepted" ? "Accepted" : a.status === "queried" ? "Has a question" : "Waiting for the vendor"}</Pill>
                        </div>
                        {a.status === "accepted" && <p className="text-xs text-muted">Accepted by {a.accepted_by ?? "the vendor"}{a.accepted_at ? ` on ${when(a.accepted_at)}` : ""}.</p>}
                        {a.question && <p>Question: {a.question}</p>}
                        {a.response && a.status !== "queried" && <p className="text-muted">Our answer: {a.response}</p>}
                        {a.status === "queried" && (
                          <ActionForm action={answerVendor} hidden={{ id, supplier: a.supplier_id }} submit="Send the answer" variant="secondary" inline>
                            <input name="response" required aria-label={`Answer to ${a.supplier_name}`} placeholder="Your answer" className="input min-w-[320px]" />
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Card className="space-y-3 p-5">
                <h2 className="font-display text-lg font-semibold">Change prices or scope</h2>
                <p className="text-sm text-muted">Any change to price or scope after approval reopens the programme. It goes back to review, a different sourcing lead approves it again, and every vendor accepts again.</p>
                <ActionForm action={reopenProgramme} hidden={{ id }} submit="Reopen for changes" variant="secondary">
                  <Field label="What is changing, and why" htmlFor="ro-note"><textarea id="ro-note" name="note" rows={2} required className="input" /></Field>
                </ActionForm>
              </Card>
              </>
            ) : (
              <>
                <Card className="space-y-3 p-5">
                  <h2 className="font-display text-lg font-semibold">1. Validity</h2>
                  <p className="text-sm text-muted">The dates the approved prices run. Set for each programme.</p>
                  <ActionForm action={setValidity} hidden={{ id }} submit="Save validity" variant="secondary" inline>
                    <div><label className="label" htmlFor="valid_from">From</label><input id="valid_from" name="valid_from" type="date" required defaultValue={p.valid_from ?? ""} className="input" /></div>
                    <div><label className="label" htmlFor="valid_to">To</label><input id="valid_to" name="valid_to" type="date" required defaultValue={p.valid_to ?? ""} className="input" /></div>
                  </ActionForm>
                </Card>
                <Card className="space-y-3 p-5">
                  <h2 className="font-display text-lg font-semibold">2. Award</h2>
                  <p className="text-sm text-muted">Give every priced item to its chosen or lowest bid in one go, then split or change items on the Analysis tab. An item can be held by one vendor or shared by percentage. Each vendor is held to its own buy price.</p>
                  <ActionForm action={awardLowest} hidden={{ id }} submit="Award the lowest bid to every unawarded item" variant="secondary" />
                </Card>
                <Panel title="3. Checklist" sub="Everything here must be in place before a second sourcing lead can approve.">
                  <ul className="divide-y divide-line text-sm">
                    {checks.map((c) => (
                      <li key={c.label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                        <span><b>{c.label}</b><span className="block text-xs text-muted">{c.detail}</span></span>
                        <Pill tone={c.ok ? "ok" : "warn"}>{c.ok ? "Done" : "To do"}</Pill>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Card className="space-y-3 p-5">
                  <h2 className="font-display text-lg font-semibold">4. Review and approve</h2>
                  {p.status !== "review" ? (
                    <>
                      <p className="text-sm text-muted">Send it for review when the checklist is in order. A different sourcing lead approves it.</p>
                      <ActionForm action={setProgrammeStatus} hidden={{ id, status: "review" }} submit="Send for review" />
                    </>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <ActionForm action={approveProgramme} hidden={{ id }} submit="Approve and lock" variant="primary">
                        <Field label="Note" htmlFor="ap-note" hint="Required if any checks are open. Say why it can be approved."><textarea id="ap-note" name="note" rows={2} className="input" /></Field>
                        <p className="text-xs text-muted">Only a different sourcing lead from the one who sent it for review can approve. Approving locks the prices and tells each awarded vendor.</p>
                      </ActionForm>
                      <ActionForm action={sendBack} hidden={{ id }} submit="Send back" variant="secondary">
                        <Field label="What needs to change" htmlFor="sb-note"><textarea id="sb-note" name="note" rows={2} required className="input" /></Field>
                      </ActionForm>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        );
      })()}

      {tab === "vendors" && (
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">Deadline</h2>
            <p className="text-sm text-muted">Vendors price by this date and time. Their prices are sealed until then, or until every invited vendor has responded. Currently: <b>{when(p.bid_deadline)}</b>.</p>
            {locked ? <p className="text-sm text-muted">This programme is {p.status}.</p> : (
              <ActionForm action={setDeadline} hidden={{ id }} submit="Set the deadline" variant="secondary" inline>
                <div><label className="label" htmlFor="deadline">Date and time</label><input id="deadline" name="deadline" type="datetime-local" required className="input" /></div>
              </ActionForm>
            )}
          </Card>
          <Panel title="Invited vendors" sub={`${invites.length} invited. Each is told in the vendor portal and by email, and prices in their own pricing grid.`}>
            {invites.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No vendors invited yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr>{["Vendor", "Status", "Items priced", "Last activity"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>
                    {invites.map((i) => (
                      <tr key={i.supplier_id}>
                        <td className="td"><Link className="font-semibold hover:text-accent" href={`/assure/suppliers/${i.supplier_id}`}>{i.supplier_name}</Link></td>
                        <td className="td"><Pill tone={i.status === "submitted" ? "ok" : i.status === "declined" ? "bad" : i.status === "viewed" ? "info" : "warn"}>{i.status === "invited" ? "Not opened" : i.status === "viewed" ? "Opened" : i.status === "submitted" ? "Prices sent" : "Declined"}</Pill>{i.decline_reason && <div className="text-xs text-muted">{i.decline_reason}</div>}</td>
                        <td className="td tabular-nums">{i.priced} of {s.items ?? 0}</td>
                        <td className="td text-xs text-muted">{when(i.responded_at ?? i.viewed_at ?? i.invited_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {!locked && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">Invite vendors</h2>
              <p className="text-sm text-muted">Only vendors that are active in SRM and not blocked for purchasing can be invited. Set the deadline first.</p>
              {eligible.length === 0 ? <p className="text-sm text-muted">Every eligible vendor is already invited.</p> : (
                <ActionForm action={inviteVendors} hidden={{ id }} submit="Invite the chosen vendors">
                  <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {eligible.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="supplier" value={v.id} /> {v.name}{v.market ? <span className="text-xs text-muted"> · {v.market}</span> : null}</label>
                    ))}
                  </div>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "import" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">1. Items and quantity tiers</h2>
            <p className="text-sm text-muted">One row per item and tier: product type, client code, sub-code, channel (DT, MT or Both), spec, unit, quantity range, and last year&apos;s price and volume. An existing sub-code is updated. Save your sheet as CSV UTF-8.</p>
            <Link prefetch={false} className="text-sm font-semibold text-accent hover:underline" href="/sourcing/rate-cards/programmes/template?kind=items">Download the items template</Link>
            {locked ? <p className="text-sm text-muted">This programme is {p.status} and can&apos;t be changed.</p> : (
              <ActionForm action={importItems} hidden={{ programme: id }} submit="Import items">
                <input name="file" type="file" accept=".csv,text/csv" aria-label="Items file" className="input" />
                <textarea name="pasted" rows={4} placeholder="Or paste the CSV here" aria-label="Pasted items" className="input font-mono text-xs" />
              </ActionForm>
            )}
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">2. Supplier bids</h2>
            <p className="text-sm text-muted">One row per supplier and item: the sub-code, the supplier (SRM code or name) and the price. A supplier not yet in SRM is kept by name and flagged. A new price for the same supplier and item replaces the old one.</p>
            <Link prefetch={false} className="text-sm font-semibold text-accent hover:underline" href="/sourcing/rate-cards/programmes/template?kind=bids">Download the bids template</Link>
            {locked ? <p className="text-sm text-muted">This programme is {p.status} and can&apos;t be changed.</p> : (
              <ActionForm action={importBids} hidden={{ programme: id }} submit="Import bids">
                <input name="file" type="file" accept=".csv,text/csv" aria-label="Bids file" className="input" />
                <textarea name="pasted" rows={4} placeholder="Or paste the CSV here" aria-label="Pasted bids" className="input font-mono text-xs" />
              </ActionForm>
            )}
          </Card>
          <Card className="space-y-2 p-5 lg:col-span-2">
            <h2 className="font-display text-lg font-semibold">Stage</h2>
            <p className="text-sm text-muted">Draft while you set up, bidding while suppliers price, review once the bids are in. Approving and publishing the cards come next.</p>
            <div className="flex flex-wrap gap-2">
              {(["draft", "bidding", "review"] as const).map((st) => (
                <ActionForm key={st} action={setProgrammeStatus} hidden={{ id, status: st }} submit={`Move to ${st}`} variant={p.status === st ? "primary" : "secondary"} inline />
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <Card className="p-5">
          {locked ? <p className="text-sm text-muted">This programme is {p.status} and can&apos;t be changed.</p> : (
            <ActionForm action={updateProgramme} hidden={{ id }} submit="Save settings">
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Name" htmlFor="s-name"><input id="s-name" name="name" defaultValue={p.name} className="input" /></Field>
                <Field label="Year" htmlFor="s-year"><input id="s-year" name="year" type="number" defaultValue={p.year} className="input" /></Field>
                <Field label="Market" htmlFor="s-market"><input id="s-market" name="market" maxLength={2} defaultValue={p.market ?? ""} className="input uppercase" /></Field>
                <Field label="Currency" htmlFor="s-currency"><input id="s-currency" name="currency" maxLength={3} defaultValue={p.currency} className="input uppercase" /></Field>
                <Field label="Fee (%)" htmlFor="s-fee" hint="Sell = buy plus this fee, rounded up."><input id="s-fee" name="fee_percent" type="number" step="any" defaultValue={Number(p.fee_percent)} className="input" /></Field>
                <Field label="Rounded to (decimals)" htmlFor="s-dec"><input id="s-dec" name="price_decimals" type="number" min={0} max={4} defaultValue={p.price_decimals} className="input" /></Field>
                <Field label="Cap outlier bids (%)" htmlFor="s-cap" hint="Bids further than this from the average are left out of the market average."><input id="s-cap" name="cap_percent" type="number" step="any" defaultValue={Number(p.cap_percent)} className="input" /></Field>
                <Field label="Winner band (%)" htmlFor="s-band" hint="Bids within this of the chosen price are listed as winners."><input id="s-band" name="winner_band_percent" type="number" step="any" defaultValue={Number(p.winner_band_percent)} className="input" /></Field>
                <Field label="Minimum coverage (%)" htmlFor="s-cov"><input id="s-cov" name="min_coverage_percent" type="number" step="any" defaultValue={Number(p.min_coverage_percent)} className="input" /></Field>
                <Field label="Flag savings above (%)" htmlFor="s-hi" hint="A saving above this looks too good."><input id="s-hi" name="saving_high_percent" type="number" step="any" defaultValue={Number(p.saving_high_percent)} className="input" /></Field>
              </div>
              <Field label="Notes" htmlFor="s-notes"><textarea id="s-notes" name="notes" rows={2} defaultValue={p.notes ?? ""} className="input" /></Field>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
