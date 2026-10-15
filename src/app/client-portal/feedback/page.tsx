import type { Metadata } from "next";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { fmtDate } from "@/lib/client-portal";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { sendFeedback } from "../actions";

export const metadata: Metadata = { title: "Feedback" };

type Team = { client_name: string; market: string; market_name: string | null; lead_name: string; lead_email: string };
type Given = { id: string; client_name: string; market: string | null; score: number; comment: string | null; created_at: string; author_name: string; followed_up: boolean };

const tone = (s: number) => (s >= 9 ? "ok" : s >= 7 ? "warn" : "bad") as "ok" | "warn" | "bad";

// Clients rate adm Indicia (0-10) and see who looks after them. Both through client-safe functions scoped to their accounts.
export default async function ClientFeedback({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const [team, given, surveys] = await Promise.all([
    rpc<Team[]>(ctx.supabase, "client_portal_account_team", scope(ctx)),
    rpc<Given[]>(ctx.supabase, "client_portal_feedback", scope(ctx)),
    rpc<{ token: string; title: string; client_name: string; kind: string }[]>(ctx.supabase, "client_portal_surveys", scope(ctx)),
  ]);
  const markets = [...new Map((team ?? []).map((t) => [t.market, t.market_name ?? t.market])).entries()];

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Feedback" sub="Tell us how we are doing. Your account team reads every response." />

      {(surveys ?? []).length > 0 && (
        <Card className="space-y-2 border-accent/40 px-5 py-4">
          <h2 className="font-display text-[0.95rem] font-bold">A survey is waiting for you</h2>
          <ul className="space-y-1 text-sm">{(surveys ?? []).map((s) => (
            <li key={s.token}><a className="font-semibold text-accent hover:underline" href={`/s/${s.token}`}>{s.title}</a> <span className="text-muted">· {s.client_name}</span></li>))}</ul>
        </Card>
      )}

      <Panel title="Your account team" sub="The adm Indicia people who look after your business">
        {(team ?? []).length === 0 ? <Empty title="Your account team will appear here" /> : (
          <ul className="divide-y divide-line">{(team ?? []).map((t) => (
            <li key={`${t.client_name}-${t.market}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1"><span className="font-semibold">{t.lead_name}</span><span className="block text-xs text-muted">Account lead · {t.market_name ?? t.market}{ctx.accounts.length > 1 ? ` · ${t.client_name}` : ""}</span></span>
              <a className="font-semibold text-accent hover:underline" href={`mailto:${t.lead_email}`}>{t.lead_email}</a>
            </li>))}</ul>
        )}
      </Panel>

      <Card className="px-5 py-4">
        <h2 className="mb-3 font-display text-[0.95rem] font-bold">How likely are you to recommend adm Indicia to a colleague?</h2>
        {ctx.preview ? <p className="text-sm text-muted">Preview: only the client&apos;s own users can send feedback.</p> : (
          <ClientActionForm action={sendFeedback} submit="Send feedback" hidden={ctx.accounts.length === 1 ? { client_id: ctx.accounts[0].id } : undefined}>
            {ctx.accounts.length > 1 && (
              <label className="block"><span className="label">Account</span>
                <select name="client_id" className="input" required>{ctx.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            )}
            <fieldset>
              <legend className="label">Score (0 = not at all, 10 = extremely likely)</legend>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 11 }, (_, i) => (
                  <label key={i} className="cursor-pointer">
                    <input type="radio" name="score" value={i} required className="peer sr-only" />
                    <span className="grid h-9 w-9 place-items-center rounded-lg border border-line text-sm font-semibold peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg">{i}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {markets.length > 1 && (
              <label className="block"><span className="label">Which market is this about? (optional)</span>
                <select name="market" className="input"><option value="">All of them</option>{markets.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
            )}
            <label className="block"><span className="label">What should we keep doing, or do better? (optional)</span>
              <textarea name="comment" rows={4} maxLength={4000} className="input" /></label>
          </ClientActionForm>
        )}
      </Card>

      <Panel title="Feedback you have given">
        {(given ?? []).length === 0 ? <Empty title="Nothing yet" /> : (
          <ul className="divide-y divide-line">{(given ?? []).map((g) => (
            <li key={g.id} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={tone(g.score)}>{g.score}/10</Pill>
                <span className="text-xs text-muted">{fmtDate(g.created_at)} · {g.author_name}{g.market ? ` · ${g.market}` : ""}</span>
                {g.followed_up && <Pill tone="ok">Followed up</Pill>}</div>
              {g.comment && <p>{g.comment}</p>}
            </li>))}</ul>
        )}
      </Panel>
    </>
  );
}
