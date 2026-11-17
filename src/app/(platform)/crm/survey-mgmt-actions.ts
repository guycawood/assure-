"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id as uuidField, str, type FormResult } from "@/lib/sourcing-actions";
import { countQuestions, parseTemplateText, validateTemplate, type SurveyTemplate } from "@/lib/survey-template";

// Survey management: reminders, scheduled sends, and the survey templates (governed library records: new versions, approval and audit are the library's own).

export async function remindWave(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const wave = uuidField(fd);
  if (!wave) return { error: "Survey not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_survey_wave_remind", { p_wave: wave });
  if (error) return { error: friendly(error) };
  const r = data as { sent: number; too_soon: number; already_reminded_twice: number; skipped: number };
  revalidatePath(`/crm/surveys/${wave}`);
  const extra = [r.skipped ? `${r.skipped} could not be emailed` : "", r.too_soon ? `${r.too_soon} are too soon to remind` : "", r.already_reminded_twice ? `${r.already_reminded_twice} were already reminded twice` : ""].filter(Boolean);
  return { ok: true, message: `Sent ${r.sent} reminder${r.sent === 1 ? "" : "s"}.${extra.length ? ` ${extra.join("; ")}.` : ""}` };
}

export async function scheduleWave(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const wave = uuidField(fd), date = str(fd, "date");
  if (!wave) return { error: "Survey not found." };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose a date." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_survey_wave_schedule", { p_wave: wave, p_date: date });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/surveys/${wave}`);
  return { ok: true, message: date ? `It will be sent on ${date}.` : "Schedule removed." };
}

type Rec = { id: string; code: string; name: string; data: SurveyTemplate; version: number; status: string; effective_from: string };
const today = () => new Date().toISOString().slice(0, 10);
const dayAfter = (d: string) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);

function readTemplate(fd: FormData, previous: SurveyTemplate | null): { template: SurveyTemplate } | { error: string } {
  const parsed = parseTemplateText(str(fd, "sections") ?? "", previous ?? undefined);
  if (parsed.error) return { error: parsed.error };
  const threshold = Number(str(fd, "comment_at_or_below") ?? "3");
  const template: SurveyTemplate = {
    scale: str(fd, "scale") ?? "1 = poor, 5 = excellent", comment_at_or_below: threshold, sections: parsed.sections,
    tools: (str(fd, "tools") ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
  };
  const problem = validateTemplate(template);
  return problem ? { error: problem } : { template };
}

async function load(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("library_records").select("id, code, name, data, version, status, effective_from").eq("id", id).eq("library_key", "crm_survey_templates").maybeSingle();
  return { supabase, rec: (data as Rec | null) };
}

/** Save the edit as a new version of the template. Waves already created keep the version they were made with. */
export async function saveTemplateVersion(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = uuidField(fd), note = str(fd, "note");
  if (!id) return { error: "Template not found." };
  if (!note) return { error: "Say what changed and why." };
  const { supabase, rec } = await load(id);
  if (!rec) return { error: "Template not found." };
  const read = readTemplate(fd, rec.data);
  if ("error" in read) return { error: read.error };
  const from = today() > rec.effective_from ? today() : dayAfter(rec.effective_from);
  const { error } = await supabase.rpc("library_supersede", { p_id: id, p_name: str(fd, "name") ?? rec.name, p_data: read.template, p_effective_from: from, p_note: note });
  if (error) return { error: friendly(error) };
  revalidatePath("/crm/surveys/templates");
  return { ok: true, message: `Saved as a new version with ${countQuestions(read.template)} statements, from ${from}. If templates need approval, another CRM owner approves it in Watchtower first.` };
}

export async function duplicateTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = uuidField(fd), name = str(fd, "new_name"), code = (str(fd, "new_code") ?? "").toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) return { error: "Template not found." };
  if (!name || !code) return { error: "Give the copy a name and a short code." };
  const { supabase, rec } = await load(id);
  if (!rec) return { error: "Template not found." };
  const { error } = await supabase.rpc("library_create", { p_key: "crm_survey_templates", p_code: code, p_name: name, p_data: rec.data, p_effective_from: today(), p_notes: `Copied from ${rec.name}` });
  if (error) return { error: friendly(error) };
  revalidatePath("/crm/surveys/templates");
  return { ok: true, message: `Created ${name}. Edit its wording below.` };
}

export async function retireTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const id = uuidField(fd), note = str(fd, "note");
  if (!id) return { error: "Template not found." };
  if (!note) return { error: "Say why it is being retired." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("library_retire", { p_id: id, p_note: note });
  if (error) return { error: friendly(error) };
  revalidatePath("/crm/surveys/templates");
  return { ok: true, message: "Retired. Surveys already sent are not affected." };
}
