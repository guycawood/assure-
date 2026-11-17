import { NextResponse } from "next/server";
import { requireInternal } from "@/lib/auth";
import { BID_TEMPLATE, ITEM_TEMPLATE } from "@/lib/csv";

// CSV templates for the rate card programme imports.
export async function GET(req: Request) {
  await requireInternal();
  const kind = new URL(req.url).searchParams.get("kind") === "bids" ? "bids" : "items";
  return new NextResponse(kind === "bids" ? BID_TEMPLATE : ITEM_TEMPLATE, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rate-card-${kind}-template.csv"` },
  });
}
