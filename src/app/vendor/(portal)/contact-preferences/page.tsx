import { requireVendorCompany } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHead, Panel, Pill, Card } from "@/components/ui";
import { ChannelIcon } from "@/components/channel-icon";
import { ActionButton, ActionForm } from "@/components/vendor/action-form";
import { addMessageContact, optOutMessageContact } from "../actions";

export const metadata = { title: "Message channels" };

type Contact = { id: string; channel: "whatsapp" | "wechat"; address: string; display_name: string | null; status: "pending" | "opted_in" | "opted_out"; opted_in_at: string | null };
const CH = { whatsapp: "WhatsApp", wechat: "WeChat" } as const;

// A vendor chooses whether our team may message them on WhatsApp or WeChat, and stops it any time.
export default async function ContactPreferencesPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.rpc("messaging_contacts", { p_supplier: null });
  const contacts = (data as Contact[] | null) ?? [];
  const canEdit = ctx.permission !== "viewer";

  return (
    <>
      <PageHead title="Message channels" crumbs={[{ label: "Messages", href: "/vendor/messages" }, { label: "Channels" }]}
        sub="Get our messages on WhatsApp or WeChat as well as here in the portal. Everything stays in your conversations with us, and you can stop it at any time." />
      <Panel title="Your numbers and IDs">
        {contacts.length === 0 ? <Empty title="Nothing added yet" /> : (
          <ul className="divide-y divide-line text-sm">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
<ChannelIcon channel={c.channel} size={22} /><b>{CH[c.channel]}</b><span>{c.display_name ? `${c.display_name} · ` : ""}{c.address}</span>
                <Pill tone={c.status === "opted_in" ? "ok" : c.status === "opted_out" ? "bad" : "warn"}>{c.status === "opted_in" ? "Receiving messages" : c.status === "opted_out" ? "Stopped" : "Waiting for confirmation"}</Pill>
                {canEdit && c.status === "opted_in" && <span className="ml-auto"><ActionButton action={optOutMessageContact} label="Stop messages" variant="danger" hidden={{ id: c.id }} /></span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {canEdit ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">Add a number or ID</h2>
          <ActionForm action={addMessageContact} submit="Add" resetOnOk>
            <div className="grid gap-3 md:grid-cols-3">
              <div><label className="label" htmlFor="channel">Channel</label><select id="channel" name="channel" className="input"><option value="whatsapp">WhatsApp</option><option value="wechat">WeChat</option></select></div>
              <div><label className="label" htmlFor="address">WhatsApp number (with country code) or WeChat ID</label><input id="address" name="address" required maxLength={120} className="input" placeholder="+44 7700 900123" /></div>
              <div><label className="label" htmlFor="name">Name of the person</label><input id="name" name="name" maxLength={120} className="input" /></div>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" className="mt-1" />
              <span>I agree that our customer&apos;s procurement team may send messages about quotes, orders, documents and payments to this number or ID. I can stop them at any time, here or by replying STOP.</span></label>
          </ActionForm>
        </Card>
      ) : <p className="text-sm text-muted">Your account is view-only.</p>}
    </>
  );
}
