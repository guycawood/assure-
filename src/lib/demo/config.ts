// Demo mode runs the app on an in-process Postgres (PGlite) loaded with the real
// migrations and dummy data, so it can be explored without a Supabase project.
// Turn it on with DEMO_MODE=1 (also on automatically when no Supabase URL is set).

export const DEMO_COOKIE = "assure_demo_user";

export function isDemoMode() {
  return process.env.DEMO_MODE === "1" || !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  role: string;
  description: string;
}

// Fictional people. Emails on adm-indicia.com join as internal staff, as they will in production.
export const DEMO_USERS: DemoUser[] = [
  { id: "d0000000-0000-4000-8000-000000000001", email: "ada.admin@adm-indicia.com", name: "Ada Admin", role: "Admin", description: "Everything, including user access" },
  { id: "d0000000-0000-4000-8000-000000000002", email: "lena.lead@adm-indicia.com", name: "Lena Lead", role: "SRT lead", description: "Approves fast-track, marks gates not required, changes due dates" },
  { id: "d0000000-0000-4000-8000-000000000003", email: "arjun.agent@adm-indicia.com", name: "Arjun Agent", role: "SRT agent", description: "Works tickets, verifies gates except bank details" },
  { id: "d0000000-0000-4000-8000-000000000004", email: "fiona.finance@adm-indicia.com", name: "Fiona Finance", role: "Finance", description: "Verifies bank details" },
  { id: "d0000000-0000-4000-8000-000000000005", email: "pedro.procurement@adm-indicia.com", name: "Pedro Procurement", role: "In-market procurement", description: "Raises tickets, sends vendor information requests" },
  { id: "d0000000-0000-4000-8000-000000000007", email: "hana.head@adm-indicia.com", name: "Hana Head", role: "Procurement head", description: "Reviews vendor information and gives final onboarding approval" },
  { id: "d0000000-0000-4000-8000-000000000006", email: "vendor1@example.com", name: "Wei Chen (Northwind Print Co)", role: "Vendor", description: "A vendor user: sees only the vendor portal" },
];
