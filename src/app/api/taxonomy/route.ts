import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadTaxonomy } from "@/lib/taxonomy";

// The product taxonomy tree for the shared picker. Any signed-in user (RLS decides); ?all=1 includes inactive nodes.
// Cached privately in the browser for 5 minutes (the tree changes rarely; admins see edits after a reload).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const all = new URL(req.url).searchParams.get("all") === "1";
  try {
    const data = await loadTaxonomy(supabase, { includeInactive: all });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
