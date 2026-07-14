import { redirect } from "next/navigation";

// Fusionada con /governance/reporting: el KPI de "Estado de Gobernanza" ahora
// vive dentro de GovernanceReportingDashboard. Se conserva este redirect para
// no romper links/bookmarks existentes.
export default async function GovernanceScorePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(`/${locale}/governance/reporting`);
}
