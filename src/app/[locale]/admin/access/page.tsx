import AdminHubGate from "@/components/admin/AdminHubGate";
import UsersPanel from "@/components/admin/panels/UsersPanel";
import SecurityPanel from "@/components/admin/panels/SecurityPanel";
import SsoPanel from "@/components/admin/panels/SsoPanel";
import OnboardingPanel from "@/components/admin/panels/OnboardingPanel";
import LighthousePanel from "@/components/admin/panels/LighthousePanel";

import { getTranslations } from "next-intl/server";

export default async function AccessHubPage({
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
        { key: "users", label: t("tab_users"), originalHref: "/admin/users", panel: <UsersPanel /> },
        { key: "security", label: t("tab_security"), originalHref: "/admin/security", panel: <SecurityPanel /> },
        { key: "sso", label: t("tab_sso"), originalHref: "/admin/sso", panel: <SsoPanel /> },
        { key: "onboarding", label: t("tab_onboarding"), originalHref: "/admin/onboarding", panel: <OnboardingPanel /> },
        { key: "lighthouse", label: t("tab_lighthouse"), originalHref: "/admin/onboarding/lighthouse", panel: <LighthousePanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/access`} tabs={tabs} activeTab={tab ?? "users"} />;
}
