import { redirect } from 'next/navigation';

export default async function ReportsExecutiveRedirectPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    redirect(`/${locale}/admin/reports?tab=executive`);
}
