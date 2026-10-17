import { redirect } from "next/navigation";

// The recurring overview grew into the subscription hub.
export default function RecurringPage() {
  redirect("/subscriptions");
}
