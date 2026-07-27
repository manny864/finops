"use client";
import { useTenant } from "@/components/TenantProvider";
import { getTagsForRoute, hasAnyTag } from "@/lib/pageRoleTags";
import AdminTabBar from "./AdminTabBar";

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
    const { userRole, userPermissions } = useTenant();
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
        return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">No tienes acceso a esta sección.</div>;
    }

    const resolvedTab = visibleTabs.some((t) => t.key === activeTab) ? activeTab : visibleTabs[0].key;
    const current = visibleTabs.find((t) => t.key === resolvedTab)!;

    return (
        <div>
            <AdminTabBar
                basePath={basePath}
                tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
                activeTab={resolvedTab}
            />
            {current.panel}
        </div>
    );
}
