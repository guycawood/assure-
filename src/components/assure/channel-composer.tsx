"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm, Field } from "@/components/assure/action-form";
import { ChannelIcon } from "@/components/channel-icon";
import { sendMessage } from "@/app/(platform)/assure/srm-actions";
import { sendOnChannel, simulateReply } from "@/app/(platform)/assure/messages/channel-actions";

export type ChannelOption = { contact_id: string; channel: "whatsapp" | "wechat"; name: string | null; tail: string; free_text_ok: boolean; window_hours: number | null; window_closes_at: string | null; address?: string };
export type TemplateOption = { key: string; label: string; body: string; channel: string; status: string };

const CH = { whatsapp: "WhatsApp", wechat: "WeChat" } as const;
const fields = (body: string) => Math.max(0, ...Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])));
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** Send in the portal thread, or out to the vendor's WhatsApp or WeChat. Free text only while the reply window is open; otherwise an approved template. */
export function ChannelComposer({ conversationId, channels, templates, mock }: { conversationId: string; channels: ChannelOption[]; templates: TemplateOption[]; mock: boolean }) {
  // "portal" or a contact id. Each channel is always offered; one the vendor has no opted-in contact on is shown but cannot be chosen, with the way to fix it.
  const [pick, setPick] = useState("portal");
  const [tpl, setTpl] = useState("");
  const ch = channels.find((c) => c.contact_id === pick);
  const usable = templates.filter((t) => t.status === "approved" && ch && t.channel === ch.channel);
  const chosen = usable.find((t) => t.key === tpl);
  const choose = (v: string) => { setPick(v); setTpl(""); };
  const btn = (on: boolean, off = false) => `inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-accent bg-accent-soft" : off ? "border-line opacity-60" : "border-line hover:bg-surface-2"}`;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Send this message by</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Send this message by">
          <button type="button" className={btn(pick === "portal")} aria-pressed={pick === "portal"} onClick={() => choose("portal")}>
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-[0.65rem] font-bold text-accent-fg" aria-hidden>SG</span>Portal
          </button>
          {(["whatsapp", "wechat"] as const).map((k) => {
            const list = channels.filter((c) => c.channel === k);
            const on = !!ch && ch.channel === k;
            return list.length > 0 ? (
              <button key={k} type="button" className={btn(on)} aria-pressed={on} onClick={() => choose(list[0].contact_id)}><ChannelIcon channel={k} size={22} />{CH[k]}</button>
            ) : (
              <Link key={k} href="/assure/messages/channels" className={btn(false, true)} title={`This vendor has no opted-in ${CH[k]} contact. Add one on the channels page.`}>
                <ChannelIcon channel={k} size={22} />{CH[k]}<span className="text-xs font-normal text-muted">no contact · add</span>
              </Link>
            );
          })}
        </div>
        {ch && channels.filter((c) => c.channel === ch.channel).length > 1 && (
          <select className="input w-auto py-1.5 text-sm" value={pick} onChange={(e) => choose(e.target.value)} aria-label="Which contact">
            {channels.filter((c) => c.channel === ch.channel).map((c) => <option key={c.contact_id} value={c.contact_id}>{c.name ?? "Contact"} (…{c.tail})</option>)}
          </select>
        )}
        <p className="text-xs text-muted">{ch ? `Goes to ${ch.name ?? "the vendor"} on ${CH[ch.channel]} and is kept in this conversation.` : "Stays in the portal. The vendor sees it when they sign in."}</p>
      </div>
      {!ch ? (
        <ActionForm action={sendMessage} submit="Send" hidden={{ conversation_id: conversationId }} resetOnOk>
          <textarea name="body" rows={2} required className="input" placeholder="Write a message" aria-label="Message" />
        </ActionForm>
      ) : (
        <ActionForm action={sendOnChannel} submit={`Send on ${CH[ch.channel]}`} hidden={{ conversation_id: conversationId, contact_id: ch.contact_id, template: tpl }} resetOnOk>
          <p className={`rounded-lg px-3 py-2 text-xs ${ch.free_text_ok ? "bg-ok-soft" : "bg-warn-soft"}`}>
            {ch.window_hours == null ? `${CH[ch.channel]} has no reply window. You can send free text.`
              : ch.free_text_ok ? `Free text allowed until ${when(ch.window_closes_at)} (${ch.window_hours} hours after their last message).`
              : `The reply window is closed. Send an approved template to start the conversation again.`}
          </p>
          {ch.channel === "whatsapp" && (
            <Field label="Template" hint={ch.free_text_ok ? "Optional while the window is open." : "Required."}>
              <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Template">
                <option value="">{ch.free_text_ok ? "No template: free text" : "Choose a template"}</option>
                {usable.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
          )}
          {chosen ? (
            <div className="space-y-2">
              <p className="rounded-lg bg-surface-2 p-3 text-sm">{chosen.body}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {Array.from({ length: fields(chosen.body) }, (_, i) => <input key={i} name={`var${i + 1}`} required className="input" placeholder={`Fills {{${i + 1}}}`} aria-label={`Field ${i + 1}`} />)}
              </div>
            </div>
          ) : <textarea name="body" rows={2} required={ch.free_text_ok} className="input" placeholder="Write a message" aria-label="Message" disabled={!ch.free_text_ok} />}
        </ActionForm>
      )}
      {mock && ch && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Demo: reply as the vendor</summary>
          <ActionForm action={simulateReply} submit="Receive reply" variant="secondary" hidden={{ channel: ch.channel, address: ch.address ?? "" }} resetOnOk inline>
            <input name="body" required className="input min-w-[260px] py-1.5" placeholder="What the vendor writes back" aria-label="Simulated reply" />
          </ActionForm>
        </details>
      )}
    </div>
  );
}
