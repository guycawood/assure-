import type { Metadata } from "next";
import Link from "next/link";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { ProofRound } from "@/components/proofs/proof-bits";
import type { ClientProof } from "@/lib/proofs";
import { decideProof } from "../actions";

export const metadata: Metadata = { title: "Proofs" };

// The client sees a proof only once we have checked it and sent it. An approver signs it off or asks for changes;
// the supplier cannot start production until a proof is approved.
export default async function ClientProofs({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const proofs = (await rpc<ClientProof[]>(ctx.supabase, "client_portal_proofs", scope(ctx))) ?? [];
  const waiting = proofs.filter((p) => p.status === "with_client");
  const done = proofs.filter((p) => p.status !== "with_client");

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Proofs" sub="Proofs and samples for your approval. Production only starts once you approve one." />

      <section className="space-y-3">
        <h2 className="font-bold">Waiting for your approval {waiting.length > 0 && <Pill tone="warn">{waiting.length}</Pill>}</h2>
        {waiting.length === 0 ? <Card className="p-5"><Empty title="Nothing waiting for you" /></Card> : (
          <ul className="space-y-3">
            {waiting.map((p) => (
              <Card key={p.id} className="space-y-3 p-5">
                <p className="text-sm"><b>{p.title}</b> <span className="text-muted">· {p.job_number} · order {p.po_number}</span></p>
                <ul><ProofRound r={p}>
                  {ctx.preview ? <p className="text-sm text-muted">Decisions are turned off in preview.</p>
                    : p.role !== "approver" ? <p className="text-sm text-muted">Waiting for an approver on your team to decide.</p> : (
                      <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-2">
                        <ClientActionForm action={decideProof} hidden={{ proof_id: p.id, decision: "approve" }} submit="Approve proof">
                          <label className="label" htmlFor={`ok-${p.id}`}>Comment <span className="font-normal text-muted">(optional)</span></label>
                          <input id={`ok-${p.id}`} name="comment" maxLength={4000} className="input" />
                        </ClientActionForm>
                        <ClientActionForm action={decideProof} hidden={{ proof_id: p.id, decision: "changes" }} submit="Request changes" variant="secondary">
                          <label className="label" htmlFor={`ch-${p.id}`}>What needs to change?</label>
                          <textarea id={`ch-${p.id}`} name="comment" rows={2} maxLength={4000} required className="input" />
                        </ClientActionForm>
                      </div>
                    )}
                </ProofRound></ul>
              </Card>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold">Earlier proofs</h2>
          <ul className="space-y-2">
            {done.map((p) => (
              <div key={p.id} className="space-y-1">
                <p className="text-xs text-muted">{p.title} · {p.job_number} · <Link className="hover:underline" href={ctx.link("/client-portal/orders")}>order {p.po_number}</Link></p>
                <ProofRound r={p} />
              </div>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
