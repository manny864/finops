import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RootStatusPage() {
  // Redirect to default locale (es)
  redirect("/es/status");
}
