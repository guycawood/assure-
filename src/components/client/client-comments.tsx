import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { fmtDate, type ClientComment } from "@/lib/client-portal";

/**
 * Client comments on a brief, for the internal Briefing+ brief page: <ClientComments briefId={brief.id} />.
 * Comments are written by client users in the Client Portal (append-only); internal staff only read them here.
 */
export async function ClientComments({ briefId }: { briefId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_comments_for_brief", { p_brief: briefId });
  if (error) return null;
  const comments = (data ?? []) as ClientComment[];
  return (
    <Panel title="Client comments" sub="From the client's users in the Client Portal">
      {comments.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No comments from the client yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 px-5 py-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-info-soft text-info"><MSymbol name="storefront" size={16} /></span>
              <div className="min-w-0">
                <p className="text-xs text-muted"><b className="text-fg">{c.author_name}</b> · {c.client_name} · {fmtDate(c.created_at)}</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
