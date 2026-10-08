import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(profile.is_admin || profile.user_type === "internal" ? "/internal/srt" : "/vendor");
}
