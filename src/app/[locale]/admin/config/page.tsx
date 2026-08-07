import AdminHubGate from "@/components/admin/AdminHubGate";
import ConfigGeneralPanel from "@/components/admin/panels/ConfigGeneralPanel";
import AiConfigPanel from "@/components/admin/panels/AiConfigPanel";
import NotificationsPanel from "@/components/admin/panels/NotificationsPanel";
import CloudAccountsPanel from "@/components/admin/panels/CloudAccountsPanel";
import MarkupPanel from "@/components/admin/panels/MarkupPanel";

export default async function ConfigHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const tabs = [
        { key: "general", label: "General", originalHref: "/admin/config", panel: <ConfigGeneralPanel /> },
        { key: "ai", label: "IA", originalHref: "/admin/ai-config", panel: <AiConfigPanel /> },
        { key: "notifications", label: "Notificaciones", originalHref: "/admin/notifications", panel: <NotificationsPanel /> },
        { key: "cloud-accounts", label: "Estado de Cuenta", originalHref: "/admin/cloud-accounts", panel: <CloudAccountsPanel /> },
        { key: "markup", label: "Partner Markup (CSP)", originalHref: "/admin/markup", panel: <MarkupPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/config`} tabs={tabs} activeTab={tab ?? "general"} />;
}
