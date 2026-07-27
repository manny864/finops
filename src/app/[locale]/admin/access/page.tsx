import AdminHubGate from "@/components/admin/AdminHubGate";
import UsersPanel from "@/components/admin/panels/UsersPanel";
import SecurityPanel from "@/components/admin/panels/SecurityPanel";
import SsoPanel from "@/components/admin/panels/SsoPanel";
import OnboardingPanel from "@/components/admin/panels/OnboardingPanel";
import LighthousePanel from "@/components/admin/panels/LighthousePanel";

export default async function AccessHubPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ tab?: string }>;
}) {
    const { locale } = await params;
    const { tab } = await searchParams;

    const tabs = [
        { key: "users", label: "Usuarios y Permisos", originalHref: "/admin/users", panel: <UsersPanel /> },
        { key: "security", label: "Seguridad (2FA)", originalHref: "/admin/security", panel: <SecurityPanel /> },
        { key: "sso", label: "SSO SAML", originalHref: "/admin/sso", panel: <SsoPanel /> },
        { key: "onboarding", label: "Onboarding de Clientes", originalHref: "/admin/onboarding", panel: <OnboardingPanel /> },
        { key: "lighthouse", label: "Onboarding Lighthouse", originalHref: "/admin/onboarding/lighthouse", panel: <LighthousePanel /> },
    ];

    return <AdminHubGate basePath={`/${locale}/admin/access`} tabs={tabs} activeTab={tab ?? "users"} />;
}
