import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { supplierOptions } from "@/lib/assure-data";
import { providerFor } from "@/lib/messaging/dispatch";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ChannelIcon, ChannelTag } from "@/components/channel-icon";
import { ActionForm, Field } from "@/components/assure/action-form";
import { addContact, optInContact, optOutContact, saveTemplate, setChannelWindow, setTemplateStatus } from "../channel-actions";

export const metadata: Metadata = { title: "WhatsApp and WeChat" };

type Contact = { id: string; supplier_id: string; supplier_name: string; channel: "whatsapp" | "wechat"; address: string; display_name: string | null; status: "pending" | "opted_in" | "opted_out"; opt_in_method: string | null; opted_in_at: string | null; last_inbound_at: string | null };
type Template = { key: string; label: string; body: string; provider_name: string; language: string; status: "draft" | "approved" | "retired" };
const CH = { whatsapp: "WhatsApp", wechat: "WeChat" } as const;
const STATUS = { pending: ["Needs opt-in", "warn"], opted_in: ["Opted in", "ok"], opted_out: ["Opted out", "bad"] } as const;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// Who we may message on WhatsApp and WeChat, the approved templates, and the reply windows.
export default async function ChannelsPage() {
  await requireInternal();
  const supabase = await createClient();
  const [contactsRes, tplRes, setRes, owner, suppliers] = await Promise.all([
    supabase.rpc("messaging_contacts", { p_supplier: null }),
    supabase.rpc("messaging_templates"),
    supabase.from("messaging_channel_settings").select("channel, window_hours").order("channel"),
    supabase.rpc("division_can", { p_module: "assure", p_capability: "manage_libraries" }),
    getSuppliers(supabase),
  ]);
  const contacts = (contactsRes.data as Contact[] | null) ?? [];
  const templates = (tplRes.data as Template[] | null) ?? [];
  const settings = (setRes.data as { channel: "whatsapp" | "wechat"; window_hours: number | null }[] | null) ?? [];
  const owners = owner.data === true;

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Messages", href: "/assure/messages" }, { label: "WhatsApp and WeChat" }]} title="WhatsApp and WeChat"
        sub="A vendor can only be messaged on a channel after they have opted in, and the opt-in is recorded. Everything sent or received lands in the vendor's conversation." />
      <Card className="flex flex-wrap gap-3 p-4 text-sm">
        <span className="inline-flex items-center gap-2"><ChannelIcon channel="whatsapp" size={20} /> WhatsApp: <Pill tone={providerFor("whatsapp") === "meta" ? "ok" : "neutral"}>{providerFor("whatsapp") === "meta" ? "Live" : "Demo mode (nothing leaves the system)"}</Pill></span>
        <span className="inline-flex items-center gap-2"><ChannelIcon channel="wechat" size={20} /> WeChat: <Pill tone={providerFor("wechat") === "official" ? "ok" : "neutral"}>{providerFor("wechat") === "official" ? "Live" : "Demo mode (nothing leaves the system)"}</Pill></span>
      </Card>

      <Panel title="Contacts" sub="Numbers and IDs by vendor">
        {contacts.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No contacts yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th">Vendor</th><th className="th">Channel</th><th className="th">Contact</th><th className="th">Status</th><th className="th">Opt-in</th><th className="th">Last reply</th><th className="th" /></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="td font-semibold">{c.supplier_name}</td><td className="td"><ChannelTag channel={c.channel} /></td>
                  <td className="td">{c.display_name ?? ""}<span className="block text-xs text-muted">{c.address}</span></td>
                  <td className="td"><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill></td>
                  <td className="td text-xs">{c.opt_in_method ? `${c.opt_in_method}${c.opted_in_at ? `, ${day(c.opted_in_at)}` : ""}` : ""}</td>
                  <td className="td text-xs">{day(c.last_inbound_at)}</td>
                  <td className="td">
                    {c.status === "opted_in" ? <ActionForm action={optOutContact} hidden={{ id: c.id }} submit="Opt out" variant="secondary" inline />
                      : <ActionForm action={optInContact} hidden={{ id: c.id }} submit="Record opt-in" variant="secondary" inline><input name="method" required className="input py-1.5" placeholder="How they agreed" aria-label="Opt-in evidence" /></ActionForm>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Add a contact</h2>
        <p className="text-sm text-muted">Fill in how the vendor agreed (for example, an email confirmation) to opt them in now. Leave it empty to add the contact and record the opt-in later. Vendors can also add their own on the vendor portal.</p>
        <ActionForm action={addContact} submit="Add contact" variant="secondary" resetOnOk>
          <div className="grid gap-3 md:grid-cols-5">
            <Field label="Vendor"><select name="supplier" required className="input" defaultValue=""><option value="">Choose a vendor</option>{supplierOptions(suppliers).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Channel"><select name="channel" className="input"><option value="whatsapp">WhatsApp</option><option value="wechat">WeChat</option></select></Field>
            <Field label="Number or ID" hint="WhatsApp: with country code."><input name="address" required className="input" placeholder="+44 7700 900123" /></Field>
            <Field label="Name"><input name="name" className="input" /></Field>
            <Field label="How they agreed"><input name="method" className="input" placeholder="Email confirmation 12 Nov" /></Field>
          </div>
        </ActionForm>
      </Card>

      <Panel title="WhatsApp templates" sub="WhatsApp only allows a first message, or one after the window closes, to use a template approved by WhatsApp. Changed wording must be approved again.">
        <ul className="divide-y divide-line text-sm">
          {templates.map((t) => (
            <li key={t.key} className="space-y-1 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2"><b>{t.label}</b><Pill tone={t.status === "approved" ? "ok" : t.status === "draft" ? "warn" : "neutral"}>{t.status}</Pill><span className="text-xs text-muted">{t.provider_name} · {t.language}</span></div>
              <p className="text-muted">{t.body}</p>
              {owners && (
                <div className="flex gap-2">
                  {t.status !== "approved" && <ActionForm action={setTemplateStatus} hidden={{ key: t.key, status: "approved" }} submit="Mark approved at WhatsApp" variant="secondary" inline />}
                  {t.status !== "retired" && <ActionForm action={setTemplateStatus} hidden={{ key: t.key, status: "retired" }} submit="Retire" variant="secondary" inline />}
                </div>
              )}
            </li>
          ))}
        </ul>
        {owners && (
          <div className="border-t border-line p-5">
            <ActionForm action={saveTemplate} submit="Save template" variant="secondary" resetOnOk>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Key" hint="Letters, digits and underscores."><input name="key" required className="input" placeholder="late_shipment" /></Field>
                <Field label="Name"><input name="label" required className="input" /></Field>
                <Field label="Name at WhatsApp"><input name="provider_name" required className="input" /></Field>
                <Field label="Language"><input name="language" defaultValue="en" className="input" /></Field>
              </div>
              <Field label="Text" hint="Use {{1}}, {{2}} for the fields filled in when sending."><textarea name="body" required rows={2} className="input" /></Field>
            </ActionForm>
          </div>
        )}
      </Panel>

      <Panel title="Reply windows" sub="How long after a vendor's last message you may reply with free text. Outside it, WhatsApp needs a template.">
        <ul className="divide-y divide-line text-sm">
          {settings.map((s) => (
            <li key={s.channel} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <b className="w-24">{CH[s.channel]}</b><span>{s.window_hours == null ? "No window" : `${s.window_hours} hours`}</span>
              {owners && (
                <ActionForm action={setChannelWindow} hidden={{ channel: s.channel }} submit="Change" variant="secondary" inline>
                  <input name="hours" type="number" min={1} max={720} defaultValue={s.window_hours ?? ""} className="input w-28 py-1.5" placeholder="Hours" aria-label="Hours" />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
