import { redirect } from "next/navigation";

// Approval policies are a governed Watchtower library; the generic library screens manage them.
export default function ApprovalPoliciesPage() {
  redirect("/watchtower/libraries/approval_policies");
}
