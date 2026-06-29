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
const ExpiringCredentialsPanel = dynamic(() => import("./ExpiringCredentialsPanel"), { loading: Loading, ssr: false });
const ShortcutWidget = dynamic(() => import("./ShortcutWidget"), { loading: Loading, ssr: false });

export interface WidgetDef {
    key: string;
    title: string;
    description: string;
    sourcePage: string;
    Component: React.ComponentType<any>;
    minHeightRem?: number;
}

export const WIDGETS: Record<string, WidgetDef> = {
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
    "governance.expiring-credentials": {
        key: "governance.expiring-credentials",
        title: "Credenciales por Expirar",
        description: "Secretos y certificados de App Registrations próximos a vencer.",
        sourcePage: "/governance",
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
