"use client";
/**
 * Widget Registry — catálogo central de tableros pinneables al "Mi Dashboard".
 *
 * Cómo agregar un nuevo widget pinneable:
 *
 * 1) Asegúrate de que el componente esté disponible como Client Component.
 * 2) Importalo abajo (usá `next/dynamic` para evitar engordar el bundle del
 *    dashboard si el widget es pesado).
 * 3) Registralo en WIDGETS con una key estable, título corto y descripción.
 * 4) En la página donde vive el widget, envolvelo con <PinButton widgetKey="..." />
 *    para que el usuario pueda pinearlo desde ahí.
 *
 * La key NO debe cambiar nunca (es la PK lógica). Si renombrás o eliminás un
 * widget, asegurate de hacer cleanup en UserDashboardPins.
 */
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import React from "react";
import { parsePageWidgetKey, type PageEntry } from "@/lib/pageRegistry";

const Loading = () => (
    <div className="flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 animate-spin text-brand-deep" />
    </div>
);

const HABreakdownCard = dynamic(() => import("./HABreakdownCard"), { loading: Loading, ssr: false });
const AksChargebackCard = dynamic(() => import("./AksChargebackCard"), { loading: Loading, ssr: false });
const ContainerAppsCard = dynamic(() => import("./ContainerAppsCard"), { loading: Loading, ssr: false });
const LogAnalyticsCard = dynamic(() => import("./LogAnalyticsCard"), { loading: Loading, ssr: false });
const ExpiringCredentialsPanel = dynamic(() => import("../governance/CredentialsExpiryPanel"), { loading: Loading, ssr: false });
const ShortcutWidget = dynamic(() => import("./ShortcutWidget"), { loading: Loading, ssr: false });
const WhiteboardPinnedWidget = dynamic(() => import("./WhiteboardPinnedWidget"), { loading: Loading, ssr: false });

const whiteboardWidget = (kind: "budgets" | "forecast" | "services" | "governance" | "advisor" | "quick-wins") => {
    const Wrapped: React.ComponentType<any> = () => <WhiteboardPinnedWidget kind={kind} />;
    Wrapped.displayName = `WhiteboardWidget(${kind})`;
    return Wrapped;
};

export interface WidgetDef {
    key: string;
    title: string;
    description: string;
    sourcePage: string;
    Component: React.ComponentType<any>;
    minHeightRem?: number;
}

export const WIDGETS: Record<string, WidgetDef> = {
    "whiteboard.budgets": {
        key: "whiteboard.budgets",
        title: "Presupuesto por Centro de Costos",
        description: "Gasto MTD contra presupuesto mensual.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("budgets"),
        minHeightRem: 16,
    },
    "whiteboard.forecast": {
        key: "whiteboard.forecast",
        title: "Proyección de Gastos",
        description: "Forecast ejecutivo al cierre del mes.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("forecast"),
        minHeightRem: 14,
    },
    "whiteboard.services": {
        key: "whiteboard.services",
        title: "Top Servicios Dominantes",
        description: "Servicios con mayor costo MTD.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("services"),
        minHeightRem: 16,
    },
    "whiteboard.governance": {
        key: "whiteboard.governance",
        title: "Gobernanza y Etiquetado",
        description: "Cobertura de tags y costo no asignado.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("governance"),
        minHeightRem: 14,
    },
    "whiteboard.advisor": {
        key: "whiteboard.advisor",
        title: "Seguridad y Advisor",
        description: "Recomendaciones por pilar de Azure Advisor.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("advisor"),
        minHeightRem: 16,
    },
    "whiteboard.quick-wins": {
        key: "whiteboard.quick-wins",
        title: "Top Quick Wins",
        description: "Oportunidades de optimización con mayor impacto.",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("quick-wins"),
        minHeightRem: 18,
    },
    "governance.ha-breakdown": {
        key: "governance.ha-breakdown",
        title: "Alta Disponibilidad por tipo de recurso",
        description: "Distribución de hallazgos HA por tipo de recurso afectado.",
        sourcePage: "/governance/ha",
        Component: HABreakdownCard,
        minHeightRem: 22,
    },
    "intelligence.aks-chargeback": {
        key: "intelligence.aks-chargeback",
        title: "AKS Chargeback",
        description: "Asignación de costos AKS a workloads / namespaces.",
        sourcePage: "/intelligence/aks-chargeback",
        Component: AksChargebackCard,
        minHeightRem: 22,
    },
    "intelligence.container-apps": {
        key: "intelligence.container-apps",
        title: "Infraestructura de Contenedores",
        description: "Costo de Azure Container Apps, Container Registries y Managed Environments.",
        sourcePage: "/intelligence/container-apps",
        Component: ContainerAppsCard,
        minHeightRem: 22,
    },
    "intelligence.log-analytics": {
        key: "intelligence.log-analytics",
        title: "Log Analytics",
        description: "Costo de Log Analytics Workspaces: ingesta, retención y Commitment Tiers.",
        sourcePage: "/intelligence/log-analytics",
        Component: LogAnalyticsCard,
        minHeightRem: 22,
    },
    "governance.expiring-credentials": {
        key: "governance.expiring-credentials",
        title: "Credenciales por Expirar",
        description: "Secretos y certificados de App Registrations próximos a vencer.",
        sourcePage: "/governance/credentials",
        Component: ExpiringCredentialsPanel,
        minHeightRem: 30,
    },
};

export function getWidget(key: string): WidgetDef | null {
    if (WIDGETS[key]) return WIDGETS[key];
    // Fallback: pin de página tipo `page:<id>` → ShortcutWidget dinámico.
    const pageEntry = parsePageWidgetKey(key);
    if (pageEntry) {
        return buildShortcutDef(pageEntry);
    }
    return null;
}

function buildShortcutDef(entry: PageEntry): WidgetDef {
    const Wrapped: React.ComponentType<any> = () => <ShortcutWidget entry={entry} />;
    Wrapped.displayName = `Shortcut(${entry.id})`;
    return {
        key: `page:${entry.id}`,
        title: entry.title,
        description: entry.description,
        sourcePage: entry.path,
        Component: Wrapped,
        minHeightRem: 11,
    };
}

export function listWidgetKeys(): string[] {
    return Object.keys(WIDGETS);
}
