import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Download a file. Access is checked in the database (file_content applies the same rule as the files table).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return new NextResponse("Sign in", { status: 401 });

  const { data } = await supabase.rpc("file_content", { p_id: id });
  const row = (Array.isArray(data) ? data[0] : data) as { file_name: string; content_type: string; content_b64: string | null; storage_path: string | null } | null;
  if (!row) return new NextResponse("Not found", { status: 404 });

  if (row.storage_path) {
    const real = supabase as unknown as { storage: { from: (b: string) => { createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null }> } } };
    const { data: signed } = await real.storage.from("files").createSignedUrl(row.storage_path, 60);
    if (!signed) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(signed.signedUrl);
  }
  const bytes = Buffer.from(row.content_b64 ?? "", "base64");
  const inline = /^(image\/|application\/pdf)/.test(row.content_type);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(row.file_name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
