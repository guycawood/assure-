import { createClient } from "@/lib/supabase/server";
import { MSymbol } from "@/components/symbol";
import { timeAgo } from "@/lib/srt";

export type FileRow = { id: string; file_name: string; content_type: string; size_bytes: number; label: string | null; uploaded_by_vendor: boolean; created_at: string };

export async function getFiles(entityType: string, entityId: string): Promise<FileRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("files").select("id, file_name, content_type, size_bytes, label, uploaded_by_vendor, created_at")
    .eq("entity_type", entityType).eq("entity_id", entityId).order("created_at", { ascending: false });
  return (data ?? []) as FileRow[];
}

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const icon = (t: string) => (t.startsWith("image/") ? "image" : t === "application/pdf" ? "picture_as_pdf" : t.includes("sheet") || t === "text/csv" ? "table" : "description");

/** Files attached to a record (server component). Downloads go through /api/files/[id], which checks access. */
export async function FileList({ entityType, entityId, empty = "No files yet." }: { entityType: string; entityId: string; empty?: string }) {
  const files = await getFiles(entityType, entityId);
  if (!files.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
          <MSymbol name={icon(f.content_type)} size={20} className="text-muted" />
          <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold hover:underline">{f.label ? `${f.label} · ` : ""}{f.file_name}</a>
          <span className="whitespace-nowrap text-xs text-muted">{kb(f.size_bytes)} · {f.uploaded_by_vendor ? "vendor" : "internal"} · {timeAgo(f.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
