"use client";

import { useActionState } from "react";
import { sendSignInLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendSignInLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Check your email</p>
        <p className="text-muted">
          We sent a sign-in link to <span className="font-medium text-fg">{state.email}</span>. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email" className="label">Work email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="name@adm-indicia.com" />
      </div>
      {state.status === "error" && <p className="text-sm text-bad">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="text-xs text-muted">No password needed. Vendors use the email address they registered with.</p>
    </form>
  );
}
