"use client";

import { useEffect } from "react";
import { markConversationRead } from "@/app/(platform)/assure/srm-actions";

/** Marks a conversation read for the signed-in person once it has been shown. */
export function MarkRead({ id }: { id: string }) {
  useEffect(() => { void markConversationRead(id); }, [id]);
  return null;
}
