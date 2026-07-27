import AdminHubGate from "@/components/admin/AdminHubGate";
import CopilotM365Panel from "@/components/admin/panels/CopilotM365Panel";
import McpKeysPanel from "@/components/admin/panels/McpKeysPanel";
import ApiKeysPanel from "@/components/admin/panels/ApiKeysPanel";

export default async function IntegrationsHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const tabs = [
        { key: "copilot", label: "Copilot M365", originalHref: "/admin/copilot-m365", panel: <CopilotM365Panel /> },
        { key: "mcp-keys", label: "MCP API Keys", originalHref: "/admin/mcp-keys", panel: <McpKeysPanel /> },
        { key: "api-keys", label: "API Pública", originalHref: "/admin/api-keys", panel: <ApiKeysPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/integrations`} tabs={tabs} activeTab={tab ?? "copilot"} />;
}
