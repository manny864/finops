import AdminHubGate from "@/components/admin/AdminHubGate";
import BillingPanel from "@/components/admin/panels/BillingPanel";
import AuditPanel from "@/components/admin/panels/AuditPanel";

export default async function AccountHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const tabs = [
        { key: "billing", label: "Facturación", originalHref: "/admin/billing", panel: <BillingPanel /> },
        { key: "audit", label: "Audit Trail", originalHref: "/admin/audit", panel: <AuditPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/account`} tabs={tabs} activeTab={tab ?? "billing"} />;
}
