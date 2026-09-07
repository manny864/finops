"use client";
import { useTenant } from "@/components/TenantProvider";
import { getTagsForRoute, hasAnyTag } from "@/lib/pageRoleTags";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import { hasAccess } from "@/lib/tierLogic";
import TierLockedNotice from "@/components/TierLockedNotice";
import AdminTabBar from "./AdminTabBar";
import { useTranslations } from "next-intl";

export type HubTab = {
    key: string;
    label: string;
    originalHref: string;
    panel: React.ReactNode;
};

// Replica, a nivel de tab, la misma lógica de gating de Sidebar.tsx (permisos
// por tag y restricciones por rol Reader/Colaborador) — necesaria porque
// varias páginas antes independientes ahora viven como tabs de un mismo hub,
// y no todas deben ser visibles para todos los roles/permisos.
export default function AdminHubGate({
    basePath,
    tabs,
    activeTab,
}: {
    basePath: string;
    tabs: HubTab[];
    activeTab: string;
}) {
    const t = useTranslations("AdminHub");
    const { userRole, userPermissions, selectedTenant, systemRole } = useTenant();
    const currentTier = (selectedTenant as any)?.tier || "Professional";
    const restrictByPermissions = userPermissions.length > 0 && userRole !== "Admin" && userRole !== "Owner";

    const visibleTabs = tabs.filter((tab) => {
        if (restrictByPermissions && !hasAnyTag(userPermissions, getTagsForRoute(tab.originalHref))) return false;
        if (userRole === "Reader" && !tab.originalHref.includes("report")) return false;
        if (
            userRole === "Colaborador" &&
            (tab.originalHref.includes("users") || tab.originalHref.includes("config") || tab.originalHref.includes("pricing-units"))
        )
            return false;
        return true;
    });

    if (visibleTabs.length === 0) {
        return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">{t("noAccess")}</div>;
    }

    const resolvedTab = visibleTabs.some((t) => t.key === activeTab) ? activeTab : visibleTabs[0].key;
    const current = visibleTabs.find((t) => t.key === resolvedTab)!;

    /*
     * GATE DE TIER POR PESTAÑA.
     *
     * `routeTiers` declara el tier de cada una de estas rutas --SSO y Lighthouse
     * son Enterprise, Reportes es Business-- pero esa declaracion no se aplicaba
     * a ninguna: `RouteTierGate` resuelve el tier con `usePathname()`, y desde que
     * estas paginas pasaron a ser pestañas de un hub el pathname es el del hub
     * (`/admin/access`), no el de la pestaña. Este componente filtraba por
     * permisos y rol, nunca por tier. La declaracion decia Enterprise y la
     * realidad era "cualquiera".
     *
     * Se descubrio al restringir Lighthouse (2026-09-04) y afecta a los CINCO
     * hubs que usan este componente, no solo a Cuentas y Accesos.
     *
     * La pestaña se sigue mostrando en la barra, con el aviso adentro: es como se
     * comportaban estas paginas cuando eran independientes --`RouteTierGate`
     * renderiza el mismo aviso-- y ademas es la unica forma de que el cliente se
     * entere de que la capacidad existe. Ocultarla convierte una oportunidad de
     * venta en una feature invisible.
     *
     * Esto NO es el limite de seguridad: las rutas de API chequean su propio
     * tier. Un bloqueo de UI se saltea con un `fetch`.
     */
    const requiredTier = getRequiredTierForPath(current.originalHref);
    const bloqueadaPorTier =
        systemRole !== "SUPERADMIN" && !!requiredTier && !hasAccess(currentTier, requiredTier);

    return (
        <div>
            <AdminTabBar
                basePath={basePath}
                tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
                activeTab={resolvedTab}
            />
            {bloqueadaPorTier ? (
                <div className="p-6">
                    <TierLockedNotice
                        requiredTier={requiredTier!}
                        currentTier={currentTier}
                        featureName={current.label}
                    />
                </div>
            ) : (
                current.panel
            )}
        </div>
    );
}
