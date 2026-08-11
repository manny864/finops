import AdminHubGate from "@/components/admin/AdminHubGate";
import ExecutiveReportPanel from "@/components/admin/panels/ExecutiveReportPanel";
import ExecutiveReportsHistoryPanel from "@/components/admin/panels/ExecutiveReportsHistoryPanel";
import InvoicingReportPanel from "@/components/admin/panels/InvoicingReportPanel";
import WorkbooksPanel from "@/components/admin/panels/WorkbooksPanel";
import PowerBiTemplatesPanel from "@/components/admin/panels/PowerBiTemplatesPanel";
import FocusExportPanel from "@/components/admin/panels/FocusExportPanel";

export default async function ReportsHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const tabs = [
        { key: "executive", label: "Reporte Ejecutivo", originalHref: "/admin/report", panel: <ExecutiveReportPanel /> },
        { key: "executive-history", label: "Historial Reportes", originalHref: "/admin/report", panel: <ExecutiveReportsHistoryPanel /> },
        { key: "invoicing", label: "Reporte de Facturación", originalHref: "/admin/report/invoicing", panel: <InvoicingReportPanel /> },
        { key: "workbooks", label: "Workbooks", originalHref: "/admin/workbooks", panel: <WorkbooksPanel /> },
        { key: "powerbi", label: "Power BI Templates", originalHref: "/admin/powerbi-templates", panel: <PowerBiTemplatesPanel /> },
        { key: "focus", label: "FOCUS 1.1 Export", originalHref: "/admin/focus-export", panel: <FocusExportPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/reports`} tabs={tabs} activeTab={tab ?? "executive"} />;
}
