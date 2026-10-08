import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/config";

export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
  if (isDemoMode()) {
    res.cookies.delete(DEMO_COOKIE);
    return res;
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return res;
}
