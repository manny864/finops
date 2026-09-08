/**
 * Page Registry — catálogo central de páginas pineables al "Mi Dashboard".
 *
 * Cada entry define metadata para una ruta. El `<GlobalPagePinButton>` lee
 * el pathname actual, busca match acá y muestra el botón flotante.
 *
 * La key del widget para pins de página sigue el patrón `page:<route-id>`.
 * NO cambies route-id sin migrar los pins existentes en UserDashboardPins.
 */
import { stripLocale } from "./stripLocale";

export interface PageEntry {
    /** Identificador estable que se usa como sufijo del widgetKey (`page:<id>`). */
    id: string;
    /** Path relativo (sin locale). Comparado contra el pathname normalizado. */
    path: string;
    /**
     * El rotulo y la descripcion NO viven aca: se resuelven en runtime desde
     * el catalogo con las claves derivadas `page_<id>_title` / `page_<id>_desc`
     * del namespace MyDashboard. Ver pageTitleKey()/pageDescKey() mas abajo.
     *
     * Excepcion: las entradas sintetizadas por `buildFallbackEntry` para rutas
     * que no estan en PAGES no tienen clave de catalogo, asi que traen el
     * rotulo derivado del slug del path. Su presencia discrimina los dos casos.
     */
    titleFallback?: string;
    /** Icono lucide-react (nombre del export). */
    icon: string;
    category: "intelligence" | "governance" | "cleanup" | "admin" | "overview" | "remediation";
}

export const PAGES: PageEntry[] = [
    // Intelligence
    { id: "int-rates", path: "/intelligence/rates", icon: "Percent", category: "intelligence" },
    { id: "int-commitments", path: "/intelligence/commitments", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-licenses", path: "/intelligence/licenses", icon: "BadgeCheck", category: "intelligence" },
    { id: "int-ai-analytics", path: "/intelligence/ai-analytics", icon: "BrainCircuit", category: "intelligence" },
    { id: "int-chargeback", path: "/intelligence/chargeback", icon: "Receipt", category: "intelligence" },
    { id: "int-aks-chargeback", path: "/intelligence/aks-chargeback", icon: "Container", category: "intelligence" },
    { id: "int-compute-efficiency", path: "/intelligence/compute-efficiency", icon: "Cpu", category: "intelligence" },
    { id: "int-network", path: "/intelligence/network", icon: "Network", category: "intelligence" },
    { id: "int-network-hub", path: "/intelligence/redes", icon: "Network", category: "intelligence" },
    { id: "int-advanced-analytics", path: "/intelligence/analitica-avanzada", icon: "BarChart3", category: "intelligence" },
    { id: "int-monitoring-hub", path: "/intelligence/monitoreo", icon: "Activity", category: "intelligence" },
    { id: "int-security-hub", path: "/intelligence/seguridad", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-integration-services-hub", path: "/intelligence/integration-services", icon: "Boxes", category: "intelligence" },
    { id: "int-optimization", path: "/intelligence/optimization", icon: "Target", category: "intelligence" },
    { id: "int-macc", path: "/intelligence/macc", icon: "FileText", category: "intelligence" },
    { id: "int-rs-appservice", path: "/intelligence/rightsizing/appservice", icon: "Maximize2", category: "intelligence" },
    { id: "int-rs-vmss", path: "/intelligence/rightsizing/vmss", icon: "Server", category: "intelligence" },
    { id: "int-rs-storage", path: "/intelligence/rightsizing/storage", icon: "HardDrive", category: "intelligence" },
    { id: "int-rs-sqldb", path: "/intelligence/rightsizing/sqldb", icon: "Database", category: "intelligence" },
    { id: "int-rs", path: "/intelligence/rightsizing", icon: "Maximize2", category: "intelligence" },
    { id: "int-anomalies", path: "/intelligence/anomalies", icon: "AlertTriangle", category: "intelligence" },
    { id: "int-unit-economics", path: "/intelligence/unit-economics", icon: "TrendingUp", category: "intelligence" },
    { id: "int-aks", path: "/intelligence/aks", icon: "Container", category: "intelligence" },
    { id: "int-container-apps", path: "/intelligence/container-apps", icon: "Boxes", category: "intelligence" },
    { id: "int-cosmos-db", path: "/intelligence/cosmos-db", icon: "Database", category: "intelligence" },
    { id: "cleanup-backup-orphans", path: "/cleanup/backup-orphans", icon: "ShieldAlert", category: "cleanup" },
    { id: "int-defender", path: "/intelligence/defender", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-app-insights", path: "/intelligence/app-insights", icon: "Activity", category: "intelligence" },
    { id: "int-log-analytics", path: "/intelligence/log-analytics", icon: "ScrollText", category: "intelligence" },
    { id: "int-alerts", path: "/intelligence/alerts", icon: "Bell", category: "intelligence" },
    { id: "int-simulator", path: "/intelligence/simulator", icon: "Calculator", category: "intelligence" },
    { id: "int-cost-projection", path: "/intelligence/cost-projection", icon: "TrendingUp", category: "intelligence" },
    { id: "int-budgets", path: "/intelligence/budgets", icon: "Wallet", category: "intelligence" },
    { id: "int-zero-cost", path: "/intelligence/zero-cost", icon: "ZapOff", category: "intelligence" },
    { id: "int-storage-eff", path: "/intelligence/storage-efficiency", icon: "HardDrive", category: "intelligence" },
    { id: "int-storage-hub", path: "/intelligence/almacenamiento", icon: "HardDrive", category: "intelligence" },
    { id: "int-cost-by-category", path: "/intelligence/cost-by-category", icon: "PieChart", category: "intelligence" },
    { id: "int-commitment-sim", path: "/intelligence/commitment-simulator", icon: "PiggyBank", category: "intelligence" },
    { id: "int-hybrid-benefit", path: "/intelligence/hybrid-benefit", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-scorecard", path: "/intelligence/scorecard", icon: "Trophy", category: "intelligence" },
    { id: "int-billing", path: "/intelligence/billing", icon: "Receipt", category: "intelligence" },
    { id: "int-upload", path: "/intelligence/upload", icon: "Upload", category: "intelligence" },
    { id: "int-allocation", path: "/intelligence/allocation", icon: "Layers", category: "intelligence" },
    { id: "int-cost-centers", path: "/intelligence/cost-centers", icon: "Wallet", category: "intelligence" },

    // Governance
    { id: "gov-power", path: "/governance/power", icon: "Power", category: "governance" },
    { id: "gov-policies", path: "/governance/policies", icon: "FileLock", category: "governance" },
    { id: "gov-reporting", path: "/governance/reporting", icon: "ShieldCheck", category: "governance" },
    { id: "gov-tags", path: "/governance/tags", icon: "Tags", category: "governance" },
    { id: "gov-ha", path: "/governance/ha", icon: "ShieldAlert", category: "governance" },
    { id: "gov-credentials", path: "/governance/credentials", icon: "KeyRound", category: "governance" },

    // Cleanup
    { id: "clean-ttl", path: "/cleanup/ttl", icon: "Timer", category: "cleanup" },
    { id: "clean-zombies", path: "/cleanup/zombies", icon: "Ghost", category: "cleanup" },
    { id: "clean-zombies-net", path: "/cleanup/zombies/networking", icon: "Network", category: "cleanup" },

    // Overview
    { id: "over-progress", path: "/overview/progress", icon: "TrendingUp", category: "overview" },
    { id: "over-maturity", path: "/overview/maturity", icon: "Trophy", category: "overview" },
    { id: "over-sustainability", path: "/overview/sustainability", icon: "Leaf", category: "overview" },
    { id: "over-whiteboard", path: "/overview/whiteboard", icon: "LayoutDashboard", category: "overview" },
    { id: "over-captured-savings", path: "/overview/captured-savings", icon: "PiggyBank", category: "overview" },
    { id: "over-financial-leaks", path: "/overview/financial-leaks", icon: "Recycle", category: "overview" },

    // Remediation
    { id: "rem-approvals", path: "/governance/approvals", icon: "CheckSquare", category: "governance" },

    // Admin (solo los que tienen sentido como tablero)
    { id: "adm-copilot-m365", path: "/admin/copilot-m365", icon: "Bot", category: "admin" },
    { id: "adm-markup", path: "/admin/markup", icon: "Percent", category: "admin" },
    { id: "adm-audit", path: "/admin/audit", icon: "FileSearch", category: "admin" },
    { id: "adm-report", path: "/admin/report", icon: "FileText", category: "admin" },
    { id: "adm-workbooks", path: "/admin/workbooks", icon: "BookOpen", category: "admin" },
    { id: "adm-focus-export", path: "/admin/focus-export", icon: "FileSpreadsheet", category: "admin" },
    // "adm-cloud-accounts" (/admin/cloud-accounts) removido junto con el segundo proveedor
    // por ahora (2026-07-05). findPageById/parsePageWidgetKey devuelven null para pines
    // existentes con este id — el widget simplemente no renderiza, sin romper nada.
];

const BY_PATH = new Map<string, PageEntry>(PAGES.map(p => [p.path, p]));
const BY_ID = new Map<string, PageEntry>(PAGES.map(p => [p.id, p]));

export function findPageForPath(pathname: string): PageEntry | null {
    const path = stripLocale(pathname);
    return BY_PATH.get(path) || null;
}

function titleFromPath(path: string): string {
    const parts = path.split("/").filter(Boolean);
    const raw = parts[parts.length - 1] || "page";
    return raw
        .split("-")
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
}

function categoryFromPath(path: string): PageEntry["category"] {
    if (path.startsWith("/intelligence/")) return "intelligence";
    if (path.startsWith("/governance/")) return "governance";
    if (path.startsWith("/cleanup/")) return "cleanup";
    if (path.startsWith("/remediation/")) return "remediation";
    if (path.startsWith("/overview/")) return "overview";
    return "admin";
}

function buildFallbackEntry(path: string): PageEntry {
    const clean = stripLocale(path);
    const id = `route-${clean.replace(/[^\w/-]/g, "").replace(/\//g, "-").replace(/^-+/, "") || "root"}`;
    return {
        id,
        path: clean,
        titleFallback: titleFromPath(clean),
        icon: "LayoutDashboard",
        category: categoryFromPath(clean),
    };
}

export function findPageById(id: string): PageEntry | null {
    return BY_ID.get(id) || null;
}

export function pageWidgetKey(entry: PageEntry): string {
    return `page:${entry.id}`;
}

export function pageWidgetKeyForPath(pathname: string): string {
    const entry = findPageForPath(pathname);
    if (entry) return pageWidgetKey(entry);
    const clean = stripLocale(pathname);
    return `route:${encodeURIComponent(clean)}`;
}

export function parsePageWidgetKey(widgetKey: string): PageEntry | null {
    if (widgetKey.startsWith("page:")) {
        const id = widgetKey.slice("page:".length);
        return findPageById(id);
    }
    if (widgetKey.startsWith("route:")) {
        const encoded = widgetKey.slice("route:".length);
        const decoded = decodeURIComponent(encoded || "");
        if (!decoded || decoded === "/" || decoded === "/login") return null;
        return buildFallbackEntry(decoded);
    }
    return null;
}

/** Clave de catalogo del rotulo de una pagina (namespace MyDashboard). */
export function pageTitleKey(id: string): string {
    return `page_${id}_title`;
}

/** Clave de catalogo de la descripcion de una pagina (namespace MyDashboard). */
export function pageDescKey(id: string): string {
    return `page_${id}_desc`;
}
