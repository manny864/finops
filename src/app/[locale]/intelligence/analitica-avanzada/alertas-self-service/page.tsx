import { redirect } from "next/navigation";

export default async function AlertasSelfServiceRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/governance/alerts`);
}
