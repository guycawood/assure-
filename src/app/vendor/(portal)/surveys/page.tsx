import Link from "next/link";
import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Surveys" };

type Survey = { id: string; template_name: string; questions: unknown[]; due_date: string | null; status: string; submitted_at: string | null; feedback_to_vendor: string | null; created_at: string };

export default async function SurveysPage() {
  await requireVendorCompany();
  const supabase = await createClient();
  const list = await rows<Survey>(supabase.from("vendor_survey_responses").select("id, template_name, questions, due_date, status, submitted_at, feedback_to_vendor, created_at").order("created_at", { ascending: false }));
  return (
    <>
      <PageHead title="Surveys" sub="Questionnaires from adm Indicia (onboarding, compliance, ESG and more). Save your answers as you go and submit when complete." />
      <Card className="overflow-x-auto">
        {list.length === 0 ? <Empty title="No surveys for you right now" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Survey</th><th className="th">Questions</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2">
                  <td className="td"><Link href={`/vendor/surveys/${s.id}`} className="font-semibold hover:underline">{s.template_name}</Link>
                    {s.status === "rejected" && s.feedback_to_vendor && <span className="block text-xs text-bad">adm Indicia asked for changes: {s.feedback_to_vendor}</span>}</td>
                  <td className="td tabular-nums">{Array.isArray(s.questions) ? s.questions.length : 0}</td>
                  <td className="td">{formatDate(s.due_date) || "—"}</td>
                  <td className="td"><Pill tone={s.status === "draft" ? "warn" : statusTone(s.status)}>{s.status === "draft" ? "To answer" : s.status === "rejected" ? "Changes requested" : human(s.status)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
