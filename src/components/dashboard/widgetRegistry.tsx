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
import { parsePageWidgetKey, pageTitleKey, pageDescKey, type PageEntry } from "@/lib/pageRegistry";

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
    /**
     * Clave de catalogo, no texto, y obligatoria. El registro es de nivel de
     * modulo y ahi no existe `t`; ademas los pines se guardan por `key` en
     * UserDashboardPins, no por rotulo, asi que el texto puede cambiar de idioma
     * sin tocar los datos. Los atajos de pagina (`page:<id>`) derivan la suya
     * del id de la ruta.
     *
     * Antes esto convivia con un `title?: string` de prosa suelta. Mientras el
     * campo existio, agregar un widget en castellano compilaba: por eso es
     * obligatoria y no opcional — que el compilador pida la clave es mas barato
     * que un test que revise que nadie use el atajo.
     */
    titleKey: string;
    descriptionKey: string;
    sourcePage: string;
    Component: React.ComponentType<any>;
    minHeightRem?: number;
}

export const WIDGETS: Record<string, WidgetDef> = {
    "whiteboard.budgets": {
        key: "whiteboard.budgets",
        titleKey: "w_budgets_title",
        descriptionKey: "w_budgets_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("budgets"),
        minHeightRem: 16,
    },
    "whiteboard.forecast": {
        key: "whiteboard.forecast",
        titleKey: "w_forecast_title",
        descriptionKey: "w_forecast_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("forecast"),
        minHeightRem: 14,
    },
    "whiteboard.services": {
        key: "whiteboard.services",
        titleKey: "w_services_title",
        descriptionKey: "w_services_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("services"),
        minHeightRem: 16,
    },
    "whiteboard.governance": {
        key: "whiteboard.governance",
        titleKey: "w_governance_title",
        descriptionKey: "w_governance_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("governance"),
        minHeightRem: 14,
    },
    "whiteboard.advisor": {
        key: "whiteboard.advisor",
        titleKey: "w_advisor_title",
        descriptionKey: "w_advisor_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("advisor"),
        minHeightRem: 16,
    },
    "whiteboard.quick-wins": {
        key: "whiteboard.quick-wins",
        titleKey: "w_quickwins_title",
        descriptionKey: "w_quickwins_desc",
        sourcePage: "/overview/whiteboard",
        Component: whiteboardWidget("quick-wins"),
        minHeightRem: 18,
    },
    "governance.ha-breakdown": {
        key: "governance.ha-breakdown",
        titleKey: "w_ha_title",
        descriptionKey: "w_ha_desc",
        sourcePage: "/governance/ha",
        Component: HABreakdownCard,
        minHeightRem: 22,
    },
    "intelligence.aks-chargeback": {
        key: "intelligence.aks-chargeback",
        titleKey: "w_aks_title",
        descriptionKey: "w_aks_desc",
        sourcePage: "/intelligence/aks-chargeback",
        Component: AksChargebackCard,
        minHeightRem: 22,
    },
    "intelligence.container-apps": {
        key: "intelligence.container-apps",
        titleKey: "w_containers_title",
        descriptionKey: "w_containers_desc",
        sourcePage: "/intelligence/container-apps",
        Component: ContainerAppsCard,
        minHeightRem: 22,
    },
    "intelligence.log-analytics": {
        key: "intelligence.log-analytics",
        titleKey: "w_loganalytics_title",
        descriptionKey: "w_loganalytics_desc",
        sourcePage: "/intelligence/log-analytics",
        Component: LogAnalyticsCard,
        minHeightRem: 22,
    },
    "governance.expiring-credentials": {
        key: "governance.expiring-credentials",
        titleKey: "w_credentials_title",
        descriptionKey: "w_credentials_desc",
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
        titleKey: pageTitleKey(entry.id),
        descriptionKey: pageDescKey(entry.id),
        sourcePage: entry.path,
        Component: Wrapped,
        minHeightRem: 11,
    };
}

export function listWidgetKeys(): string[] {
    return Object.keys(WIDGETS);
}
