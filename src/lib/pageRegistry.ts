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
    title: string;
    description: string;
    /** Icono lucide-react (nombre del export). */
    icon: string;
    category: "intelligence" | "governance" | "cleanup" | "admin" | "overview" | "remediation";
}

export const PAGES: PageEntry[] = [
    // Intelligence
    { id: "int-rates", path: "/intelligence/rates", title: "Rate Optimizer", description: "Tarifas y descuentos aplicables.", icon: "Percent", category: "intelligence" },
    { id: "int-commitments", path: "/intelligence/commitments", title: "Reservas & Savings Plans", description: "Coverage, utilization y oportunidades de commitment.", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-licenses", path: "/intelligence/licenses", title: "Licencias", description: "Inventario y consumo de licencias.", icon: "BadgeCheck", category: "intelligence" },
    { id: "int-ai-analytics", path: "/intelligence/ai-analytics", title: "AI Analytics", description: "Insights de IA sobre tu billing.", icon: "BrainCircuit", category: "intelligence" },
    { id: "int-chargeback", path: "/intelligence/chargeback", title: "Chargeback", description: "Asignación de costos por tag/centro de costo.", icon: "Receipt", category: "intelligence" },
    { id: "int-aks-chargeback", path: "/intelligence/aks-chargeback", title: "AKS Chargeback", description: "Asignación de costos AKS por workload/namespace.", icon: "Container", category: "intelligence" },
    { id: "int-compute-efficiency", path: "/intelligence/compute-efficiency", title: "Compute Efficiency", description: "Eficiencia y costo por core de compute.", icon: "Cpu", category: "intelligence" },
    { id: "int-network", path: "/intelligence/network", title: "Networking", description: "Análisis de costos de red y egreso.", icon: "Network", category: "intelligence" },
    { id: "int-macc", path: "/intelligence/macc", title: "MACC", description: "Microsoft Azure Consumption Commitment.", icon: "FileText", category: "intelligence" },
    { id: "int-rs-appservice", path: "/intelligence/rightsizing/appservice", title: "Rightsizing — App Service", description: "Recomendaciones de tamaño para App Service.", icon: "Maximize2", category: "intelligence" },
    { id: "int-rs-vmss", path: "/intelligence/rightsizing/vmss", title: "Rightsizing — VMSS", description: "Recomendaciones para Virtual Machine Scale Sets.", icon: "Server", category: "intelligence" },
    { id: "int-rs-storage", path: "/intelligence/rightsizing/storage", title: "Rightsizing — Storage", description: "Optimización de tiers y redundancia de Storage.", icon: "HardDrive", category: "intelligence" },
    { id: "int-rs-sqldb", path: "/intelligence/rightsizing/sqldb", title: "Rightsizing — SQL DB", description: "Recomendaciones de DTU/vCore para SQL Database.", icon: "Database", category: "intelligence" },
    { id: "int-rs", path: "/intelligence/rightsizing", title: "Rightsizing (resumen)", description: "Resumen de todas las recomendaciones de rightsizing.", icon: "Maximize2", category: "intelligence" },
    { id: "int-anomalies", path: "/intelligence/anomalies", title: "Anomalías de Costo", description: "Detección automática de spikes y caídas.", icon: "AlertTriangle", category: "intelligence" },
    { id: "int-unit-economics", path: "/intelligence/unit-economics", title: "Unit Economics", description: "Costo por unidad de negocio (req, GB, etc).", icon: "TrendingUp", category: "intelligence" },
    { id: "int-aks", path: "/intelligence/aks", title: "AKS Overview", description: "Visión general de clusters AKS.", icon: "Container", category: "intelligence" },
    { id: "int-container-apps", path: "/intelligence/container-apps", title: "Container Apps", description: "Control de costos de Azure Container Apps y oportunidades de scale-to-zero.", icon: "Boxes", category: "intelligence" },
    { id: "int-cosmos-db", path: "/intelligence/cosmos-db", title: "Cosmos DB", description: "Cuentas Cosmos DB en Provisioned Throughput con consumo real bajo, candidatas a Serverless/Autoscale.", icon: "Database", category: "intelligence" },
    { id: "cleanup-backup-orphans", path: "/cleanup/backup-orphans", title: "Backups Huérfanos", description: "Instancias protegidas en Recovery Services Vault cuyo recurso original ya no existe.", icon: "ShieldAlert", category: "cleanup" },
    { id: "int-defender", path: "/intelligence/defender", title: "Defender for Cloud", description: "Costo por plan de Microsoft Defender for Cloud (Standard/Free) por suscripción.", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-network-perimeter", path: "/intelligence/network-perimeter", title: "Red Perimetral", description: "Costo real de Firewall, App Gateway/WAF, NAT Gateway, Front Door, VPN Gateway/ExpressRoute.", icon: "Router", category: "intelligence" },
    { id: "int-app-insights", path: "/intelligence/app-insights", title: "Application Insights", description: "Costo real por recurso Application Insights, separado de Log Analytics.", icon: "Activity", category: "intelligence" },
    { id: "int-misc-services", path: "/intelligence/misc-services", title: "Otros Servicios", description: "Costo de AVD, ACI, Batch, NetApp Files, PostgreSQL/MySQL, Synapse/Data Factory, Databricks, Redis, Key Vault.", icon: "Blocks", category: "intelligence" },
    { id: "int-log-analytics", path: "/intelligence/log-analytics", title: "Log Analytics", description: "Control de costos de Log Analytics Workspaces: ingesta, retención y Commitment Tiers.", icon: "ScrollText", category: "intelligence" },
    { id: "int-alerts", path: "/intelligence/alerts", title: "Alertas Self-Service", description: "Reglas de alerta de costo configurables.", icon: "Bell", category: "intelligence" },
    { id: "int-simulator", path: "/intelligence/simulator", title: "Simulador de Costos", description: "Simulá cambios y proyectá impacto.", icon: "Calculator", category: "intelligence" },
    { id: "int-cost-projection", path: "/intelligence/cost-projection", title: "Proyección de Gastos", description: "Proyección de gasto a futuro (12m + % crecimiento).", icon: "TrendingUp", category: "intelligence" },
    { id: "int-budgets", path: "/intelligence/budgets", title: "Presupuestos", description: "Gestión y seguimiento de budgets.", icon: "Wallet", category: "intelligence" },
    { id: "int-zero-cost", path: "/intelligence/zero-cost", title: "Zero Cost Initiative", description: "Recursos sin uso real con costo cero esperado.", icon: "ZapOff", category: "intelligence" },
    { id: "int-storage-eff", path: "/intelligence/storage-efficiency", title: "Storage Efficiency", description: "Eficiencia y oportunidades en Storage.", icon: "HardDrive", category: "intelligence" },
    { id: "int-cost-by-category", path: "/intelligence/cost-by-category", title: "Cost by Category", description: "Desglose de costo por categoría FinOps.", icon: "PieChart", category: "intelligence" },
    { id: "int-commitment-sim", path: "/intelligence/commitment-simulator", title: "Savings Plan vs Reservation", description: "Comparación de compromiso: qué ahorra más.", icon: "PiggyBank", category: "intelligence" },
    { id: "int-hybrid-benefit", path: "/intelligence/hybrid-benefit", title: "Azure Hybrid Benefit", description: "Aplicación y oportunidades de AHUB.", icon: "ShieldCheck", category: "intelligence" },
    { id: "int-scorecard", path: "/intelligence/scorecard", title: "FinOps Scorecard", description: "Indicadores clave de madurez FinOps.", icon: "Trophy", category: "intelligence" },
    { id: "int-billing", path: "/intelligence/billing", title: "Billing Engine (CSP)", description: "Motor de facturación Partner / CSP.", icon: "Receipt", category: "intelligence" },
    { id: "int-upload", path: "/intelligence/upload", title: "Carga de Datos", description: "Importación manual de facturación.", icon: "Upload", category: "intelligence" },
    { id: "int-allocation", path: "/intelligence/allocation", title: "Allocation", description: "Reglas de distribución de costos.", icon: "Layers", category: "intelligence" },
    { id: "int-cost-centers", path: "/intelligence/cost-centers", title: "Presupuesto por Centro de Costos", description: "Gasto real vs. presupuesto asignado por CostCenter.", icon: "Wallet", category: "intelligence" },

    // Governance
    { id: "gov-power", path: "/governance/power", title: "Horario de Apagado", description: "Schedules de power on/off de recursos.", icon: "Power", category: "governance" },
    { id: "gov-policies", path: "/governance/policies", title: "Policies", description: "Azure Policies y compliance FinOps.", icon: "FileLock", category: "governance" },
    { id: "gov-reporting", path: "/governance/reporting", title: "Governance Reporting", description: "Score de gobernanza, compliance de políticas, inventario y accesos (RBAC).", icon: "ShieldCheck", category: "governance" },
    { id: "gov-tags", path: "/governance/tags", title: "Gobernanza de Tags", description: "Coverage y consistencia de tagging.", icon: "Tags", category: "governance" },
    { id: "gov-ha", path: "/governance/ha", title: "Alta Disponibilidad", description: "Hallazgos HA por recurso, SLA risk.", icon: "ShieldAlert", category: "governance" },
    { id: "gov-credentials", path: "/governance/credentials", title: "Credenciales por Expirar", description: "Secrets y certs de App Registrations próximos a vencer.", icon: "KeyRound", category: "governance" },

    // Cleanup
    { id: "clean-ttl", path: "/cleanup/ttl", title: "TTL & Lifecycle", description: "Reglas de expiración de recursos.", icon: "Timer", category: "cleanup" },
    { id: "clean-zombies", path: "/cleanup/zombies", title: "Recursos Zombie", description: "Recursos huérfanos sin uso.", icon: "Ghost", category: "cleanup" },
    { id: "clean-zombies-net", path: "/cleanup/zombies/networking", title: "Zombies — Networking", description: "Public IPs, NICs y NSGs huérfanos.", icon: "Network", category: "cleanup" },

    // Overview
    { id: "over-progress", path: "/overview/progress", title: "Progreso FinOps", description: "Avance del programa FinOps.", icon: "TrendingUp", category: "overview" },
    { id: "over-maturity", path: "/overview/maturity", title: "Madurez FinOps", description: "Nivel de madurez por capability.", icon: "Trophy", category: "overview" },
    { id: "over-sustainability", path: "/overview/sustainability", title: "Sustentabilidad", description: "Footprint de carbono y green ops.", icon: "Leaf", category: "overview" },
    { id: "over-whiteboard", path: "/overview/whiteboard", title: "White Board", description: "Dashboard ejecutivo consolidado: costos, seguridad, gobernanza y recomendaciones.", icon: "LayoutDashboard", category: "overview" },
    { id: "over-captured-savings", path: "/overview/captured-savings", title: "Ahorro Capturado", description: "Tendencia histórica del ahorro potencial detectado.", icon: "PiggyBank", category: "overview" },
    { id: "over-financial-leaks", path: "/overview/financial-leaks", title: "Fugas Financieras", description: "Distribución del gasto desperdiciado por categoría de recurso.", icon: "Recycle", category: "overview" },

    // Remediation
    { id: "rem-approvals", path: "/remediation/approvals", title: "Cola de Aprobaciones", description: "Acciones automatizadas pendientes de aprobación.", icon: "CheckSquare", category: "remediation" },

    // Admin (solo los que tienen sentido como tablero)
    { id: "adm-copilot-m365", path: "/admin/copilot-m365", title: "Copilot M365", description: "Configuración y costos de Copilot M365.", icon: "Bot", category: "admin" },
    { id: "adm-markup", path: "/admin/markup", title: "Markup / Margen", description: "Configuración de markup para clientes.", icon: "Percent", category: "admin" },
    { id: "adm-audit", path: "/admin/audit", title: "Auditoría", description: "Log de acciones del tenant.", icon: "FileSearch", category: "admin" },
    { id: "adm-report", path: "/admin/report", title: "Reportes", description: "Reportes ejecutivos y exports.", icon: "FileText", category: "admin" },
    { id: "adm-workbooks", path: "/admin/workbooks", title: "Artefactos y Workbooks", description: "Plantillas y deploys de workbooks.", icon: "BookOpen", category: "admin" },
    { id: "adm-focus-export", path: "/admin/focus-export", title: "FOCUS 1.1 Export", description: "Exportá billing en formato FinOps FOCUS estándar.", icon: "FileSpreadsheet", category: "admin" },
    // "adm-cloud-accounts" (/admin/cloud-accounts, AWS) removido: no hacemos referencia a AWS
    // por ahora (2026-07-05). findPageById/parsePageWidgetKey devuelven null para pines
    // existentes con este id — el widget simplemente no renderiza, sin romper nada.
];

const BY_PATH = new Map<string, PageEntry>(PAGES.map(p => [p.path, p]));
const BY_ID = new Map<string, PageEntry>(PAGES.map(p => [p.id, p]));

export function findPageForPath(pathname: string): PageEntry | null {
    const path = stripLocale(pathname);
    return BY_PATH.get(path) || null;
}

export function findPageById(id: string): PageEntry | null {
    return BY_ID.get(id) || null;
}

export function pageWidgetKey(entry: PageEntry): string {
    return `page:${entry.id}`;
}

export function parsePageWidgetKey(widgetKey: string): PageEntry | null {
    if (!widgetKey.startsWith("page:")) return null;
    const id = widgetKey.slice("page:".length);
    return findPageById(id);
}
