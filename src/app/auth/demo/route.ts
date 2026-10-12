import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, DEMO_USERS, isDemoMode } from "@/lib/demo/config";

// Demo-only sign-in: /auth/demo?user=<demo user id>[&next=/path]
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const user = DEMO_USERS.find((u) => u.id === request.nextUrl.searchParams.get("user"));
  if (!isDemoMode() || !user) return NextResponse.redirect(new URL("/login", origin));
  // Only same-site paths (no "//host" or scheme), so the link can't redirect elsewhere.
  const next = request.nextUrl.searchParams.get("next");
  const safeNext = next && /^\/(?![/\\])[\w\-/?=&.%]*$/.test(next) ? next : null;
  const home = user.role.startsWith("Vendor") ? "/vendor" : user.role === "Client" ? "/client-portal" : "/home";
  const res = NextResponse.redirect(new URL(safeNext ?? home, origin));
  res.cookies.set(DEMO_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  return res;
}
