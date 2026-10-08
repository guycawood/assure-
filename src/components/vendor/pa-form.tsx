"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { CERT_GROUPS, PA_CATEGORIES, PA_STEPS, TEST_EQUIPMENT, type ActionResult, type CertRow, type PaData } from "@/lib/vendor";

// The five-section pre-assessment questionnaire (from the Base44 prototype), used by signed-in vendors (/vendor/pre-assessment)
// and by new vendors applying publicly (/apply). Answers are kept flat, with the prototype's field names.

type Data = PaData & Record<string, unknown>;
type Setter = (k: string, v: unknown) => void;

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <h3 className="rounded-t-xl border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-bold text-brand-navy">{title}</h3>
      <div className={clsx("grid gap-3 p-4", cols === 2 && "sm:grid-cols-2")}>{children}</div>
    </section>
  );
}

function Text({ d, set, k, label, type = "text", required, placeholder, disabled }: { d: Data; set: Setter; k: string; label: string; type?: string; required?: boolean; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={k}>{label}{required && <span className="text-bad"> *</span>}</label>
      <input id={k} type={type} className="input" maxLength={500} placeholder={placeholder} disabled={disabled} value={(d[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
}

function Choice({ d, set, k, label, options, required, disabled }: { d: Data; set: Setter; k: string; label: string; options: readonly string[]; required?: boolean; disabled?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={k}>{label}{required && <span className="text-bad"> *</span>}</label>
      <select id={k} className="input" disabled={disabled} value={(d[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)}>
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function List({ d, set, k, label, n, disabled }: { d: Data; set: Setter; k: string; label: string; n: number; disabled?: boolean }) {
  const arr = Array.isArray(d[k]) ? (d[k] as string[]) : [];
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <label className="label" htmlFor={`${k}-${i}`}>{label} {i + 1}</label>
          <input id={`${k}-${i}`} className="input" maxLength={200} disabled={disabled} value={arr[i] ?? ""} onChange={(e) => { const a = [...arr]; a[i] = e.target.value; set(k, a); }} />
        </div>
      ))}
    </>
  );
}

const YN = ["Yes", "No"] as const;

export function PaForm({ initial, mode, readOnly, save, photos, intro }: {
  initial: Data;
  mode: "vendor" | "public";
  readOnly?: boolean;
  save: (data: Data, submit: boolean, honeypot: string) => Promise<ActionResult>;
  photos?: React.ReactNode;
  intro?: React.ReactNode;
}) {
  const [d, setD] = useState<Data>(initial);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [hp, setHp] = useState("");
  const [declared, setDeclared] = useState(false);
  const [pending, start] = useTransition();
  const set: Setter = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const dis = readOnly;
  const last = PA_STEPS.length - 1;
  const stepLabels = mode === "public" ? [...PA_STEPS.slice(0, 4), "Review & submit"] : PA_STEPS;

  const certRows = (key: string) => (Array.isArray(d[key]) ? (d[key] as CertRow[]) : []);
  const setCert = (key: string, type: string, field: "cert_number" | "audit_date", v: string) => {
    const rows = certRows(key);
    const row = rows.find((r) => r.type === type) ?? { type, cert_number: "", audit_date: "" };
    set(key, [...rows.filter((r) => r.type !== type), { ...row, [field]: v }]);
  };
  const equipment = Array.isArray(d.major_test_equipment) ? (d.major_test_equipment as { name: string; available: string; comment: string }[]) : [];
  const setEq = (name: string, field: "available" | "comment", v: string) => {
    const row = equipment.find((e) => e.name === name) ?? { name, available: "", comment: "" };
    set("major_test_equipment", [...equipment.filter((e) => e.name !== name), { ...row, [field]: v }]);
  };

  const requiredOk = !!(d.supplier_company_name && d.major_category && d.head_office_country && d.primary_contact_name && d.primary_contact_email);
  const go = (submit: boolean) => start(async () => {
    const r = await save(d, submit, hp);
    setMsg(r);
  });

  return (
    <div className="flex flex-col gap-5">
      {intro}
      <ol className="flex flex-wrap gap-2" aria-label="Sections">
        {stepLabels.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className={clsx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition",
              i === step ? "border-brand-navy bg-brand-navy text-white" : "border-line bg-surface text-muted hover:text-fg")}>
              <span className={clsx("grid h-5 w-5 place-items-center rounded-full text-[0.65rem]", i === step ? "bg-white/20" : "bg-surface-2")}>{i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <Section title="Supplier details">
            <Text d={d} set={set} k="supplier_company_name" label="Supplier company name" required disabled={dis} />
            <Text d={d} set={set} k="type_of_ownership" label="Type of ownership" placeholder="e.g. Private, Joint venture" disabled={dis} />
            <Choice d={d} set={set} k="major_category" label="Major category" options={PA_CATEGORIES} required disabled={dis} />
            <Text d={d} set={set} k="company_size_m2" label="Company size (m²)" type="number" disabled={dis} />
            <Text d={d} set={set} k="head_office_address" label="Head office address" disabled={dis} />
            <Text d={d} set={set} k="total_employees" label="Total employees" type="number" disabled={dis} />
            <Text d={d} set={set} k="head_office_city" label="Head office city" disabled={dis} />
            <Text d={d} set={set} k="annual_turnover" label="Annual turnover (local currency)" placeholder="e.g. CNY 50,000,000" disabled={dis} />
            <Text d={d} set={set} k="head_office_country" label="Head office country" required disabled={dis} />
            <Text d={d} set={set} k="calculated_in_year" label="Turnover calculated in year" placeholder="e.g. 2025" disabled={dis} />
            <Text d={d} set={set} k="primary_contact_name" label="Primary contact name" required disabled={dis} />
            <Text d={d} set={set} k="document_date" label="Date completed" type="date" disabled={dis} />
            <Text d={d} set={set} k="primary_contact_email" label="Primary contact email" type="email" required disabled={dis} />
            <Choice d={d} set={set} k="english_speaking" label="English speaking" options={["yes", "partial", "no"]} disabled={dis} />
          </Section>
          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="Current & past clients" cols={1}><List d={d} set={set} k="clients" label="Customer" n={5} disabled={dis} /></Section>
            <Section title="Major products" cols={1}><List d={d} set={set} k="major_products" label="Product" n={5} disabled={dis} /></Section>
          </div>
        </>
      )}

      {step === 1 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {CERT_GROUPS.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-surface">
              <h3 className="border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-bold text-brand-navy">{g.title}</h3>
              <table className="w-full text-xs">
                <thead><tr><th className="th">Type</th><th className="th">Certificate number</th><th className="th">Audit date</th></tr></thead>
                <tbody>
                  {g.types.map((t) => {
                    const r = certRows(g.key).find((x) => x.type === t);
                    return (
                      <tr key={t}>
                        <td className="td font-semibold">{t}</td>
                        <td className="td"><input className="input h-8 text-xs" maxLength={100} placeholder="N/A if none" disabled={dis} value={r?.cert_number ?? ""} onChange={(e) => setCert(g.key, t, "cert_number", e.target.value)} aria-label={`${t} certificate number`} /></td>
                        <td className="td"><input type="date" className="input h-8 text-xs" disabled={dis} value={r?.audit_date ?? ""} onChange={(e) => setCert(g.key, t, "audit_date", e.target.value)} aria-label={`${t} audit date`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Design capability" cols={1}><List d={d} set={set} k="design_capabilities" label="Capability" n={7} disabled={dis} /></Section>
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <h3 className="border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-bold text-brand-navy">Major test equipment</h3>
            <table className="w-full text-xs">
              <thead><tr><th className="th">Equipment</th><th className="th">Available</th><th className="th">Comment</th></tr></thead>
              <tbody>
                {TEST_EQUIPMENT.map((name) => {
                  const r = equipment.find((e) => e.name === name);
                  return (
                    <tr key={name}>
                      <td className="td font-semibold">{name}</td>
                      <td className="td"><select className="input h-8 w-20 text-xs" disabled={dis} value={r?.available ?? ""} onChange={(e) => setEq(name, "available", e.target.value)} aria-label={`${name} available`}><option value="">—</option>{YN.map((o) => <option key={o}>{o}</option>)}</select></td>
                      <td className="td"><input className="input h-8 text-xs" maxLength={200} disabled={dis} value={r?.comment ?? ""} onChange={(e) => setEq(name, "comment", e.target.value)} aria-label={`${name} comment`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <Section title="R&D capability" cols={1}>
            <Text d={d} set={set} k="rd_designer_employees" label="Design department employees" type="number" disabled={dis} />
            <List d={d} set={set} k="rd_software" label="Major software" n={3} disabled={dis} />
            <Text d={d} set={set} k="rd_sample_making_machine" label="Sample making machine" disabled={dis} />
            <Text d={d} set={set} k="rd_digital_printer" label="Digital printer" disabled={dis} />
            <Text d={d} set={set} k="rd_other" label="Other" disabled={dis} />
          </Section>
          <div className="flex flex-col gap-5">
            <Section title="Quality capability" cols={1}>
              <Text d={d} set={set} k="quality_employees" label="Quality department employees" type="number" disabled={dis} />
              <Text d={d} set={set} k="lab_capability" label="Lab capability" disabled={dis} />
              <Text d={d} set={set} k="cnas_certificate" label="CNAS certificate number" disabled={dis} />
              <Text d={d} set={set} k="quality_other" label="Other" disabled={dis} />
            </Section>
            <Section title="Manufacture & machine capability" cols={1}><List d={d} set={set} k="manufacture_capabilities" label="Capability" n={7} disabled={dis} /></Section>
          </div>
        </div>
      )}

      {step === 3 && (
        <>
          <Section title="Factory details">
            <Text d={d} set={set} k="num_factories" label="Number of factories" type="number" disabled={dis} />
            <Text d={d} set={set} k="factory_ownership_type" label="Type of ownership" disabled={dis} />
            <Text d={d} set={set} k="primary_factory_product" label="Primary factory product" disabled={dis} />
            <Text d={d} set={set} k="total_factory_area" label="Total factory area (m²)" disabled={dis} />
            <Text d={d} set={set} k="factory_address" label="Primary factory address" disabled={dis} />
            <Choice d={d} set={set} k="including_dormitory" label="Including dormitory" options={YN} disabled={dis} />
            <Text d={d} set={set} k="factory_city" label="Primary factory city" disabled={dis} />
            <Choice d={d} set={set} k="including_canteen" label="Including canteen" options={YN} disabled={dis} />
            <Text d={d} set={set} k="factory_country" label="Primary factory country" disabled={dis} />
            <Text d={d} set={set} k="factory_contact_name" label="Factory contact name" disabled={dis} />
            <Text d={d} set={set} k="factory_contact_email" label="Factory contact email" type="email" disabled={dis} />
            <Choice d={d} set={set} k="factory_english_speaking" label="English speaking" options={YN} disabled={dis} />
          </Section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Factory employee profile" cols={1}>
              <Text d={d} set={set} k="total_employees_factory" label="Total employees" type="number" disabled={dis} />
              <Text d={d} set={set} k="employees_management" label="Management" type="number" disabled={dis} />
              <Text d={d} set={set} k="employees_engineering" label="Engineering" type="number" disabled={dis} />
              <Text d={d} set={set} k="employees_production" label="Production" type="number" disabled={dis} />
            </Section>
            <Section title="Working time records" cols={1}>
              {[["Paper card", "working_time_paper_card"], ["IC card", "working_time_ic_card"], ["Fingerprint", "working_time_fingerprint"], ["Manual", "working_time_manual"], ["No record", "working_time_no_record"]].map(([l, k]) => (
                <Choice key={k} d={d} set={set} k={k} label={l} options={YN} disabled={dis} />
              ))}
            </Section>
          </div>
          <Section title="Salary and wages">
            {[["Paid in cash", "wages_cash"], ["Calculated by hours", "wages_by_hours"], ["Paid by bank transfer", "wages_bank_transfer"], ["Calculated by piece", "wages_by_piece"], ["Paid another way", "wages_other_method"], ["Calculated another way", "wages_calc_other"]].map(([l, k]) => (
              <Choice key={k} d={d} set={set} k={k} label={l} options={YN} disabled={dis} />
            ))}
          </Section>
        </>
      )}

      {step === 4 && (mode === "vendor" ? photos : (
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5 text-sm">
          <h3 className="font-display text-base font-bold">Review and submit</h3>
          <ul className="space-y-1">
            <li><b>Company:</b> {d.supplier_company_name || <span className="text-bad">missing</span>}</li>
            <li><b>Category:</b> {d.major_category || <span className="text-bad">missing</span>}</li>
            <li><b>Head office country:</b> {d.head_office_country || <span className="text-bad">missing</span>}</li>
            <li><b>Contact:</b> {d.primary_contact_name || <span className="text-bad">missing</span>} · {d.primary_contact_email || <span className="text-bad">missing</span>}</li>
          </ul>
          <p className="text-muted">Site photos and certificate copies are collected after our procurement team has reviewed your application and invited you to the vendor portal.</p>
          {/* Honeypot: hidden from people, tempting to bots. Anything typed here means the submission is ignored. */}
          <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="website_url">Website URL</label>
            <input id="website_url" name="website_url" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>
          <label className="flex items-start gap-2"><input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1" /> I confirm the information is accurate and I am authorised to submit it for this company. adm Indicia will use it to assess the application.</label>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {step > 0 && <button type="button" className={btn.secondary} onClick={() => setStep(step - 1)}><MSymbol name="chevron_left" size={18} /> Back</button>}
        {step < last && <button type="button" className={btn.secondary} onClick={() => setStep(step + 1)}>Continue <MSymbol name="chevron_right" size={18} /></button>}
        <span className="flex-1" />
        {!readOnly && mode === "vendor" && <button type="button" className={btn.secondary} disabled={pending} onClick={() => go(false)}>{pending ? "Saving…" : "Save draft"}</button>}
        {!readOnly && step === last && (
          <button type="button" className={btn.primary} disabled={pending || !requiredOk || (mode === "public" && !declared)} onClick={() => go(true)}>
            {pending ? "Submitting…" : mode === "vendor" ? "Submit to adm Indicia" : "Submit application"}
          </button>
        )}
      </div>
      {!requiredOk && !readOnly && step === last && <p className="text-xs text-muted">Complete the required supplier details (marked *) to submit.</p>}
      {msg?.message && <p role="status" className={clsx("text-sm", msg.ok ? "text-ok" : "text-bad")}>{msg.message}</p>}
    </div>
  );
}
