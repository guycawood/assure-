import type { Metadata } from "next";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Unsubscribe" };

// Unsubscribe link from CRM emails (/u/<token>). A button (not the page load) opts out, so link scanners can't unsubscribe people.
export default async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-6 shadow-card">
      <h1 className="font-display text-xl font-bold">Stop emails from adm Indicia</h1>
      {/^[0-9a-f]{64}$/.test(token) ? (
        <><p className="text-sm text-muted">Confirm below and we will stop sending you marketing emails and surveys. Your account team can still contact you about work in progress.</p>
          <UnsubscribeButton token={token} /></>
      ) : <p className="text-sm text-muted">This link doesn&apos;t work. Check you used the whole link from the email.</p>}
    </section>
  );
}
