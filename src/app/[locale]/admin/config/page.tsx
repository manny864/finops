import AdminHubGate from "@/components/admin/AdminHubGate";
import ConfigGeneralPanel from "@/components/admin/panels/ConfigGeneralPanel";
import AiConfigPanel from "@/components/admin/panels/AiConfigPanel";
import NotificationsPanel from "@/components/admin/panels/NotificationsPanel";
import CloudAccountsPanel from "@/components/admin/panels/CloudAccountsPanel";
import MarkupPanel from "@/components/admin/panels/MarkupPanel";

import { getTranslations } from "next-intl/server";

export default async function ConfigHubPage({
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
        { key: "general", label: t("tab_general"), originalHref: "/admin/config", panel: <ConfigGeneralPanel /> },
        { key: "ai", label: t("tab_ai"), originalHref: "/admin/ai-config", panel: <AiConfigPanel /> },
        { key: "notifications", label: t("tab_notifications"), originalHref: "/admin/notifications", panel: <NotificationsPanel /> },
        { key: "cloud-accounts", label: t("tab_cloud_accounts"), originalHref: "/admin/cloud-accounts", panel: <CloudAccountsPanel /> },
        { key: "markup", label: t("tab_markup"), originalHref: "/admin/markup", panel: <MarkupPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/config`} tabs={tabs} activeTab={tab ?? "general"} />;
}
