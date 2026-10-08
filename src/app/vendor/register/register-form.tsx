"use client";

import { useActionState } from "react";
import { sendVendorSignInLink, type RegisterState } from "./actions";

export function RegisterForm({ invite, email, demo }: { invite: string; email: string; demo: boolean }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(sendVendorSignInLink, { status: "idle" });

  if (demo) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">Demo mode: no email is sent. Continue as the invited vendor ({email}).</p>
        <a href={`/auth/demo-invite?invite=${encodeURIComponent(invite)}`} className="inline-block rounded bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:brightness-110">
          Register and continue
        </a>
      </div>
    );
  }

  if (state.status === "sent") {
    return <p className="text-sm">We sent a sign-in link to <b>{email}</b>. Open it on this device to continue your registration.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invite" value={invite} />
      <p className="text-sm text-muted">We&apos;ll email a secure sign-in link to <b className="text-fg">{email}</b>. No password needed.</p>
      {state.status === "error" && <p className="text-sm text-bad" role="alert">{state.message}</p>}
      <button disabled={pending} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60">
        {pending ? "Sending…" : "Register and continue"}
      </button>
    </form>
  );
}
