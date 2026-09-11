import AdminHubGate from "@/components/admin/AdminHubGate";
import CopilotM365Panel from "@/components/admin/panels/CopilotM365Panel";
import McpKeysPanel from "@/components/admin/panels/McpKeysPanel";
import ApiKeysPanel from "@/components/admin/panels/ApiKeysPanel";

import { getTranslations } from "next-intl/server";

export default async function IntegrationsHubPage({
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
        { key: "copilot", label: t("tab_copilot"), originalHref: "/admin/copilot-m365", panel: <CopilotM365Panel /> },
        { key: "mcp-keys", label: t("tab_mcp_keys"), originalHref: "/admin/mcp-keys", panel: <McpKeysPanel /> },
        { key: "api-keys", label: t("tab_api_keys"), originalHref: "/admin/api-keys", panel: <ApiKeysPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/integrations`} tabs={tabs} activeTab={tab ?? "copilot"} />;
}
