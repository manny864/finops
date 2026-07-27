import { redirect } from "next/navigation";

export default async function RedirectPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(`/${locale}/admin/reports?tab=executive`);
}
