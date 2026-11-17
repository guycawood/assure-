import { MSymbol } from "@/components/symbol";
import { Pill } from "@/components/ui";
import { PROOF_KIND, PROOF_STATUS, type Proof } from "@/lib/proofs";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export function ProofFiles({ files }: { files: Proof["files"] }) {
  if (!files.length) return <p className="text-xs text-muted">No files yet.</p>;
  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-sm">
          <MSymbol name={f.type.startsWith("image/") ? "image" : "description"} size={18} className="text-muted" />
          <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="truncate font-semibold text-accent hover:underline">{f.name}</a>
        </li>
      ))}
    </ul>
  );
}

/** One round: kind, status, files and what each party said. */
export function ProofRound({ r, children }: { r: Proof; children?: React.ReactNode }) {
  const st = PROOF_STATUS[r.status];
  return (
    <li className="space-y-2 rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>Round {r.round}</b> <span className="text-muted">{PROOF_KIND[r.kind]}</span> <Pill tone={st.tone}>{st.label}</Pill>
        {r.tracking_number && <span className="text-xs text-muted">Tracking {r.tracking_number}</span>}
      </div>
      <ProofFiles files={r.files} />
      {r.supplier_note && <p className="text-xs"><span className="text-muted">Supplier:</span> {r.supplier_note}</p>}
      {r.cs_note && <p className="text-xs"><span className="text-muted">Client services{r.cs_checked_at ? ` · ${when(r.cs_checked_at)}` : ""}:</span> {r.cs_note}</p>}
      {r.sent_to_client_at && <p className="text-xs text-muted">Sent to the client {when(r.sent_to_client_at)}</p>}
      {r.client_comment && <p className="text-xs"><span className="text-muted">Client{r.client_decided_at ? ` · ${when(r.client_decided_at)}` : ""}:</span> {r.client_comment}</p>}
      {children}
    </li>
  );
}
