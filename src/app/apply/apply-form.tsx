"use client";

import { useState } from "react";
import Link from "next/link";
import { PaForm } from "@/components/vendor/pa-form";
import { MSymbol } from "@/components/symbol";
import type { ActionResult, PaData } from "@/lib/vendor";
import { submitApplication } from "./actions";

export function ApplyForm() {
  const [done, setDone] = useState<string | null>(null);
  const save = async (data: PaData, _submit: boolean, honeypot: string): Promise<ActionResult> => {
    const r = await submitApplication(data, honeypot);
    if (r.ok) setDone(r.id ?? "");
    return r;
  };
  if (done !== null) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-ok-soft text-ok"><MSymbol name="check" size={30} /></span>
        <h2 className="font-display text-2xl font-bold">Thank you, your application is in</h2>
        {done && !done.endsWith("RECEIVED") && <p className="text-sm">Your reference is <b>{done}</b>.</p>}
        <p className="max-w-md text-sm text-muted">Our procurement team will review it and contact you, usually within 5 to 7 working days. If we invite you to the vendor portal, you&apos;ll sign in with the email address you gave us.</p>
        <Link href="/vendor-portal" className="text-sm font-semibold text-accent hover:underline">Back to the vendor portal page</Link>
      </div>
    );
  }
  return <PaForm initial={{}} mode="public" save={save} />;
}
