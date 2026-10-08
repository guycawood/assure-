import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/config";

type Client = ReturnType<typeof createServerClient>;

export async function createClient(): Promise<Client> {
  const cookieStore = await cookies();

  if (isDemoMode()) {
    // Loaded lazily so production builds never pull PGlite into a request path.
    const { createDemoClient } = await import("@/lib/demo/client");
    return createDemoClient(cookieStore.get(DEMO_COOKIE)?.value ?? null) as unknown as Client;
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
