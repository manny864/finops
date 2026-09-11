import AdminHubGate from "@/components/admin/AdminHubGate";
import BillingPanel from "@/components/admin/panels/BillingPanel";
import AuditPanel from "@/components/admin/panels/AuditPanel";

import { getTranslations } from "next-intl/server";

export default async function AccountHubPage({
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
        { key: "billing", label: t("tab_billing"), originalHref: "/admin/billing", panel: <BillingPanel /> },
        { key: "audit", label: t("tab_audit"), originalHref: "/admin/audit", panel: <AuditPanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/account`} tabs={tabs} activeTab={tab ?? "billing"} />;
}
