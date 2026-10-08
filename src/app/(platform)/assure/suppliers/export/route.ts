import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { filterDirectory, FILTER_KEYS, loadDirectory, type DirectoryFilters } from "@/lib/assure-directory";
import { optLabel, RISK, SUPPLIER_STATUS, SUPPLIER_TIER, toCsv } from "@/lib/assure";

// CSV of the supplier directory with the same filters as the page. Staff only; cells are escaped against formula injection.
export async function GET(req: NextRequest) {
  const me = await getProfile();
  if (!me || !(me.is_admin || me.user_type === "internal")) return new NextResponse("Not allowed", { status: 403 });
  const f: DirectoryFilters = {};
  for (const k of FILTER_KEYS) { const v = req.nextUrl.searchParams.get(k); if (v) f[k] = v; }
  const supabase = await createClient();
  const list = filterDirectory(await loadDirectory(supabase), f).sort((a, b) => a.s.name.localeCompare(b.s.name));
  const csv = toCsv([
    ["Name", "Supplier ID", "Vendor code", "UEN", "Region", "Market", "Category", "Client", "Status", "Tier", "Risk", "Compliance issues", "Latest score", "Score period", "YTD spend (EUR)"],
    ...list.map(({ s, p, issues, score, period }) => [
      s.name, s.supplier_code, p?.vendor_code, p?.uen_number, s.region, s.market, s.category, s.client,
      optLabel(SUPPLIER_STATUS, s.status), optLabel(SUPPLIER_TIER, s.tier), optLabel(RISK, p?.risk_level), issues, score, period, s.ytd_spend,
    ]),
  ]);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="suppliers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
