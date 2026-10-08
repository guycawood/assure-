import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.is_admin || profile.user_type === "internal") redirect("/home");
  redirect(profile.user_type === "client" ? "/client-portal" : "/vendor");
}
