import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SurveyForm, type SurveyPage } from "./survey-form";

export const metadata: Metadata = { title: "Survey" };

// A client's survey link (/s/<token>): the customer satisfaction survey or a post-job survey. Works without signing in.
export default async function PublicSurvey({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("public_survey_get", { p_token: token }) : { data: null, error: null };
  const page = data as SurveyPage | null;
  if (error || !page) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
        <h1 className="font-display text-xl font-bold">This survey link doesn&apos;t work</h1>
        <p className="mt-1 text-sm text-muted">{error ? error.message : "Check you used the whole link from the email, or ask your adm Indicia contact for a new one."}</p>
      </section>
    );
  }
  if (page.state !== "open") {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
        <h1 className="font-display text-xl font-bold">{page.state === "answered" ? "Thank you, we have your answers" : "This survey is closed"}</h1>
        <p className="mt-1 text-sm text-muted">{page.state === "answered" ? "Your account team will be in touch about what you told us." : "Thank you for your interest. Your account team can tell you about the next one."}</p>
      </section>
    );
  }
  return <SurveyForm token={token} page={page} />;
}
