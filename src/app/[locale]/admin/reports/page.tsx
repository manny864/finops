import AdminHubGate from "@/components/admin/AdminHubGate";
import ExecutiveReportPanel from "@/components/admin/panels/ExecutiveReportPanel";
import ExecutiveReportsHistoryPanel from "@/components/admin/panels/ExecutiveReportsHistoryPanel";
import InvoicingReportPanel from "@/components/admin/panels/InvoicingReportPanel";
import WorkbooksPanel from "@/components/admin/panels/WorkbooksPanel";
import PowerBiTemplatesPanel from "@/components/admin/panels/PowerBiTemplatesPanel";
import FocusExportPanel from "@/components/admin/panels/FocusExportPanel";

import { getTranslations } from "next-intl/server";

export default async function ReportsHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const t = await getTranslations("AdminHub");

    const tabs = [
        { key: "executive", label: t("tab_executive"), originalHref: "/admin/report", panel: <ExecutiveReportPanel /> },
        { key: "executive-history", label: t("tab_executive_history"), originalHref: "/admin/report", panel: <ExecutiveReportsHistoryPanel /> },
        { key: "invoicing", label: t("tab_invoicing"), originalHref: "/admin/report/invoicing", panel: <InvoicingReportPanel /> },
        { key: "workbooks", label: t("tab_workbooks"), originalHref: "/admin/workbooks", panel: <WorkbooksPanel /> },
        { key: "powerbi", label: t("tab_powerbi"), originalHref: "/admin/powerbi-templates", panel: <PowerBiTemplatesPanel /> },
        { key: "focus", label: t("tab_focus"), originalHref: "/admin/focus-export", panel: <FocusExportPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/reports`} tabs={tabs} activeTab={tab ?? "executive"} />;
}
