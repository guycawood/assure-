import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/config";

// Demo-only: the invited vendor "registers" and lands in the vendor portal.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const token = request.nextUrl.searchParams.get("invite") ?? "";
  if (!isDemoMode() || !token) return NextResponse.redirect(new URL("/login", origin));
  const { registerDemoInvitee } = await import("@/lib/demo/invite");
  const userId = await registerDemoInvitee(token);
  if (!userId) return NextResponse.redirect(new URL(`/vendor/register?invite=${encodeURIComponent(token)}`, origin));
  const res = NextResponse.redirect(new URL(`/vendor?invite=${encodeURIComponent(token)}`, origin));
  res.cookies.set(DEMO_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  return res;
}
