/**
 * Azure Monitor Workbooks — Gobernanza de Dashboards y Atribucion de Costo de Consultas
 *
 * RBAC minimo requerido en Azure: `Reader` sobre las suscripciones (para el
 * inventario via Azure Resource Graph). No se requiere `Monitoring Contributor`
 * porque este servicio solo lee: la remediacion se entrega como comando CLI para
 * que la ejecute el operador.
 *
 * El recurso Workbook es gratuito. Lo que este modulo gobierna es el gasto
 * INDIRECTO: cada consulta KQL embebida escanea datos de Log Analytics a
 * $2.30/GB, y el auto-refresh multiplica ese escaneo por la cantidad de
 * ejecuciones del mes.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  HEAVY_QUERY_GB_THRESHOLD,
  HIGH_VOLUME_TABLES,
  LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB,
  STALE_WORKBOOK_DAYS,
  WORKBOOK_SOURCE_COLORS,
  WORKBOOK_SOURCE_LABELS,
  type WorkbookDataSource,
  type WorkbookHealthStatus,
  type WorkbookQuerySummary,
  type WorkbookRemediationAction,
  type WorkbookResourceItem,
  type WorkbooksPayload,
  type WorkbooksSummaryMetrics,
  type WorkbookType,
} from "@/types/azureWorkbooks.types";

// ─────────────────────────────────────────────────────────────────────────────
// Parsing de la definicion del workbook (`properties.serializedData`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza el intervalo de auto-refresh a segundos.
 * Azure lo expresa de formas distintas segun la version del workbook:
 * numero en segundos, ISO 8601 (`PT5M`) o etiqueta (`5 minutes`).
 * Devuelve 0 cuando no hay auto-refresh.
 */
export function parseAutoRefreshSeconds(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw !== "string" || raw.length === 0) return 0;

  const iso = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) {
    const h = Number(iso[1] || 0);
    const m = Number(iso[2] || 0);
    const s = Number(iso[3] || 0);
    return h * 3600 + m * 60 + s;
  }

  const labelled = raw.match(/^(\d+)\s*(second|sec|s|minute|min|m|hour|hr|h)/i);
  if (labelled) {
    const n = Number(labelled[1]);
    const unit = labelled[2].toLowerCase();
    if (unit.startsWith("h")) return n * 3600;
    if (unit.startsWith("m")) return n * 60;
    return n;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

/** Etiqueta legible del intervalo; `undefined` cuando el auto-refresh esta apagado. */
export function formatRefreshLabel(seconds: number): string | undefined {
  if (seconds <= 0) return undefined;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
}

const KQL_OPERATORS =
  /^(where|project|projectaway|projectrename|summarize|extend|order|sort|take|limit|top|render|let|count|distinct|mv|mvexpand|mvapply|parse|make|makeseries|evaluate|invoke|search|find|range|print|datatable|union|join|on|by|kind|inner|innerunique|leftouter|rightouter|fullouter|leftanti|rightanti|leftsemi|rightsemi|anti|semi|as|serialize|partition|lookup|externaldata|consume|sample|getschema|withsource)$/i;

/**
 * Extrae las tablas de Log Analytics referenciadas por una consulta KQL.
 *
 * Se recorre por segmentos separados por `|` en vez de con una sola regex: en
 * `A | join B on C` el pipe y el `join` son delimitadores encadenados, y una
 * alternancia unica consume el pipe y deja `join` como candidato, perdiendo `B`.
 * Por segmento se saltean los operadores de apertura (`union`, `join`, `kind=…`)
 * y se toma el primer identificador que quede.
 *
 * No es un parser de KQL: alcanza para clasificar volumen, no para validar.
 */
export function extractKqlTables(query: string): string[] {
  const found = new Set<string>();
  for (const rawSegment of query.split("|")) {
    // `kind=inner` y anotaciones similares no son tablas.
    const segment = rawSegment.replace(/\b\w+\s*=\s*\w+/g, " ").trim();
    if (!segment) continue;
    for (const token of segment.split(/[^A-Za-z0-9_]+/)) {
      if (token.length < 3) continue;
      if (KQL_OPERATORS.test(token)) continue;
      // Solo el primer identificador no-operador del segmento es la tabla;
      // lo que sigue son columnas y funciones.
      found.add(token);
      break;
    }
  }
  return Array.from(found);
}

/**
 * Estima los GB escaneados por una consulta. Sin telemetria real de
 * `Usage`/`LAQueryLogs` esto es una heuristica declarada, no una medicion:
 * las tablas de alto volumen pesan mucho mas, y no acotar por TimeGenerated
 * multiplica el escaneo porque obliga a recorrer toda la retencion.
 *
 * ponytail: heuristica por tabla; cambiar a LAQueryLogs si se necesita exactitud.
 */
export function estimateQueryScanGB(tables: string[], lacksTimeFilter: boolean): number {
  if (tables.length === 0) return 0;
  const heavy = tables.filter((t) =>
    (HIGH_VOLUME_TABLES as readonly string[]).some((h) => h.toLowerCase() === t.toLowerCase())
  ).length;
  const light = tables.length - heavy;
  // GB por EJECUCION, no por tabla entera: un dashboard consulta una ventana
  // corta (la ultima hora o el ultimo dia), no toda la retencion.
  const base = heavy * 0.25 + light * 0.02;
  // Sin acotar por TimeGenerated el motor recorre toda la retencion del
  // workspace, no la ventana del panel.
  return Number((lacksTimeFilter ? base * 4 : base).toFixed(3));
}

/** Clasifica la fuente de datos de un item del workbook segun su `queryType`. */
function classifyQueryType(queryType: unknown, query: string): WorkbookDataSource {
  // queryType de Azure Workbooks: 0 = Log Analytics, 1 = Azure Resource Graph,
  // 8 = Azure Monitor Metrics, 10 = Azure Resource Health.
  if (queryType === 1 || /\bresources\b\s*\|/i.test(query)) return "ResourceGraph";
  if (queryType === 8) return "AzureMetrics";
  if (queryType === 0 || queryType === undefined || queryType === null) return "LogAnalytics";
  return "Unknown";
}

/** Reduce las fuentes de cada consulta a la fuente principal del workbook. */
export function derivePrimaryDataSource(queries: WorkbookQuerySummary[]): WorkbookDataSource {
  if (queries.length === 0) return "Unknown";
  const distinct = new Set(queries.map((q) => q.dataSource));
  distinct.delete("Unknown");
  if (distinct.size === 0) return "Unknown";
  if (distinct.size > 1) return "Mixed";
  return Array.from(distinct)[0];
}

export interface ParsedWorkbookDefinition {
  queries: WorkbookQuerySummary[];
  autoRefreshSeconds: number;
  /** IDs de recurso (workspaces, VMs, etc.) referenciados por los items. */
  referencedResourceIds: string[];
}

/**
 * Analiza el JSON de `serializedData` para extraer consultas, auto-refresh y
 * recursos objetivo. La definicion puede venir malformada o truncada: en ese
 * caso devuelve vacio en lugar de lanzar, para no tumbar el inventario entero
 * por un solo workbook corrupto.
 */
export function parseWorkbookDefinition(serializedData: unknown): ParsedWorkbookDefinition {
  const empty: ParsedWorkbookDefinition = { queries: [], autoRefreshSeconds: 0, referencedResourceIds: [] };
  if (typeof serializedData !== "string" || serializedData.length === 0) return empty;

  let def: Record<string, unknown>;
  try {
    def = JSON.parse(serializedData);
  } catch {
    return empty;
  }
  if (!def || typeof def !== "object") return empty;

  const queries: WorkbookQuerySummary[] = [];
  const resourceIds = new Set<string>();
  let autoRefreshSeconds = 0;

  const items = Array.isArray((def as { items?: unknown }).items) ? ((def as { items: unknown[] }).items) : [];

  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const item = node as Record<string, unknown>;
      const content = (item.content || {}) as Record<string, unknown>;

      // Auto-refresh: puede declararse a nivel item o a nivel raiz.
      const refresh =
        (content.autoRefreshSeconds as unknown) ??
        (content.refreshInterval as unknown) ??
        ((content.autoRefresh as Record<string, unknown> | undefined)?.interval as unknown);
      const parsedRefresh = parseAutoRefreshSeconds(refresh);
      if (parsedRefresh > 0) {
        // Se queda el intervalo mas agresivo: es el que domina el costo.
        autoRefreshSeconds =
          autoRefreshSeconds === 0 ? parsedRefresh : Math.min(autoRefreshSeconds, parsedRefresh);
      }

      for (const rid of [content.crossComponentResources, content.resourceIds] as unknown[]) {
        if (Array.isArray(rid)) {
          rid.filter((x): x is string => typeof x === "string").forEach((x) => resourceIds.add(x));
        }
      }

      const query = typeof content.query === "string" ? content.query : "";
      if (query.trim().length > 0) {
        const dataSource = classifyQueryType(content.queryType, query);
        const tables = dataSource === "LogAnalytics" ? extractKqlTables(query) : [];
        const lacksTimeFilter =
          dataSource === "LogAnalytics" && !/TimeGenerated|ago\s*\(|between\s*\(/i.test(query);
        const estimatedScanGB = dataSource === "LogAnalytics" ? estimateQueryScanGB(tables, lacksTimeFilter) : 0;
        queries.push({
          stepName: typeof item.name === "string" ? item.name : "query",
          dataSource,
          tablesReferenced: tables,
          estimatedScanGB,
          lacksTimeFilter,
          isHeavy: estimatedScanGB >= HEAVY_QUERY_GB_THRESHOLD,
          queryPreview: query.slice(0, 400),
        });
      }

      if (Array.isArray(item.items)) walk(item.items as unknown[]);
    }
  };

  walk(items);

  const rootRefresh = parseAutoRefreshSeconds(
    (def as { autoRefreshSeconds?: unknown; refreshInterval?: unknown }).autoRefreshSeconds ??
      (def as { refreshInterval?: unknown }).refreshInterval
  );
  if (rootRefresh > 0) {
    autoRefreshSeconds = autoRefreshSeconds === 0 ? rootRefresh : Math.min(autoRefreshSeconds, rootRefresh);
  }

  return { queries, autoRefreshSeconds, referencedResourceIds: Array.from(resourceIds) };
}

/**
 * Ejecuciones mensuales estimadas. Sin auto-refresh se asume apertura manual
 * ocasional (30 ejecuciones/mes) en vez de cero, porque el escaneo igual ocurre
 * cada vez que alguien abre el dashboard.
 */
export function estimateMonthlyRuns(autoRefreshSeconds: number): number {
  // El auto-refresh de un Workbook NO es un job programado: solo dispara
  // mientras alguien tiene el dashboard abierto en el navegador. Por eso las
  // horas de visualizacion son el factor que manda, no el intervalo solo.
  if (autoRefreshSeconds <= 0) return 30; // aperturas manuales sueltas
  const runsPerHour = 3600 / autoRefreshSeconds;
  // <= 5 min implica un tablero pensado para mirarse (patron NOC): se asume
  // proyectado 8 h/dia habil. El resto, ~1 h/dia.
  const viewingHours = autoRefreshSeconds <= 300 ? 8 * 22 : 1 * 22;
  return Math.round(runsPerHour * viewingHours);
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de deteccion de fugas
// ─────────────────────────────────────────────────────────────────────────────

/** `true` si alguna consulta toca una tabla de alto volumen. */
export function touchesHighVolumeTable(queries: WorkbookQuerySummary[]): boolean {
  return queries.some((q) =>
    q.tablesReferenced.some((t) =>
      (HIGH_VOLUME_TABLES as readonly string[]).some((h) => h.toLowerCase() === t.toLowerCase())
    )
  );
}

/**
 * Regla 2 — Auto-refresh agresivo: intervalo <= 5 min sobre tablas de alto
 * volumen. Es el patron mas caro: 5 min de refresco sobre CommonSecurityLog
 * son ~2100 ejecuciones/mes.
 */
export function hasAggressiveRefresh(autoRefreshSeconds: number, queries: WorkbookQuerySummary[]): boolean {
  return autoRefreshSeconds > 0 && autoRefreshSeconds <= 300 && touchesHighVolumeTable(queries);
}

/** Determina el estado de salud del workbook y el motivo legible. */
export function deriveWorkbookHealth(input: {
  isOrphan: boolean;
  missingWorkspaceIds: string[];
  daysSinceModified: number;
  hasHeavyQueries: boolean;
}): { healthStatus: WorkbookHealthStatus; healthReason?: string } {
  if (input.missingWorkspaceIds.length > 0) {
    return {
      healthStatus: "SourceError",
      healthReason: `${input.missingWorkspaceIds.length} workspace(s) referenciados ya no existen en la suscripcion`,
    };
  }
  if (input.isOrphan) {
    return {
      healthStatus: "Orphan",
      healthReason: "El recurso vinculado en sourceId fue eliminado",
    };
  }
  // Regla 3 — Dashboard zombie: sin modificar hace mas de 180 dias Y con
  // consultas pesadas. Un workbook viejo pero liviano no es una fuga.
  if (input.daysSinceModified > STALE_WORKBOOK_DAYS && input.hasHeavyQueries) {
    return {
      healthStatus: "Stale",
      healthReason: `Sin modificaciones hace ${input.daysSinceModified} dias y con consultas de alto volumen`,
    };
  }
  return { healthStatus: "Valid" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion y recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function calculateWorkbooksSummary(
  workbooks: WorkbookResourceItem[],
  remediations: WorkbookRemediationAction[]
): WorkbooksSummaryMetrics {
  const totalCost = workbooks.reduce((acc, w) => acc + w.estimatedQueryCostUSD, 0);

  const bySource = new Map<WorkbookDataSource, { count: number; costUSD: number }>();
  for (const w of workbooks) {
    const cur = bySource.get(w.primaryDataSource) || { count: 0, costUSD: 0 };
    cur.count += 1;
    cur.costUSD += w.estimatedQueryCostUSD;
    bySource.set(w.primaryDataSource, cur);
  }

  const breakdownByDataSource = Array.from(bySource.entries())
    .map(([dataSource, v]) => ({
      dataSource,
      label: WORKBOOK_SOURCE_LABELS[dataSource],
      count: v.count,
      costUSD: Number(v.costUSD.toFixed(2)),
      percentage: totalCost > 0 ? Number(((v.costUSD / totalCost) * 100).toFixed(1)) : 0,
      color: WORKBOOK_SOURCE_COLORS[dataSource],
    }))
    .sort((a, b) => b.costUSD - a.costUSD);

  return {
    totalWorkbooksCount: workbooks.length,
    sharedCount: workbooks.filter((w) => w.workbookType === "Shared").length,
    privateCount: workbooks.filter((w) => w.workbookType === "Private").length,
    orphanCount: workbooks.filter((w) => w.healthStatus === "Orphan" || w.healthStatus === "SourceError").length,
    staleCount: workbooks.filter((w) => w.healthStatus === "Stale").length,
    autoRefreshCount: workbooks.filter((w) => w.autoRefreshSeconds > 0).length,
    aggressiveRefreshCount: workbooks.filter((w) => hasAggressiveRefresh(w.autoRefreshSeconds, w.queries)).length,
    heavyQueryCount: workbooks.filter((w) => w.hasHeavyQueries).length,
    estimatedMonthlyQueryCostUSD: Number(totalCost.toFixed(2)),
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
    breakdownByDataSource,
  };
}

export function generateWorkbooksRecommendations(
  workbooks: WorkbookResourceItem[]
): WorkbookRemediationAction[] {
  const out: WorkbookRemediationAction[] = [];

  for (const w of workbooks) {
    // Regla 1 — Huerfanos y origenes rotos: el escaneo se sigue pagando aunque
    // el dashboard ya no renderice nada util.
    if (w.healthStatus === "Orphan" || w.healthStatus === "SourceError") {
      out.push({
        id: `purge-${w.id}`,
        resourceId: w.id,
        title: `Eliminar workbook huerfano: ${w.displayName}`,
        description:
          w.missingWorkspaceIds.length > 0
            ? `Referencia ${w.missingWorkspaceIds.length} workspace(s) inexistentes. Sus consultas fallan pero el dashboard sigue programado, y cada apertura escanea datos facturables.`
            : "El recurso vinculado en sourceId fue eliminado. El workbook quedo sin origen valido.",
        category: "PURGE_ORPHAN",
        estimatedSavingsUSD: Number(w.estimatedQueryCostUSD.toFixed(2)),
        confidence: "HIGH",
        actionType: "DELETE_WORKBOOK",
      });
      continue;
    }

    // Regla 2 — Auto-refresh agresivo sobre tablas de alto volumen.
    if (hasAggressiveRefresh(w.autoRefreshSeconds, w.queries)) {
      // Bajar de <=5 min a 15 min recorta las ejecuciones en la misma proporcion.
      const targetRuns = estimateMonthlyRuns(900);
      const saving = Math.max(
        0,
        w.estimatedQueryCostUSD - (w.estimatedQueryCostUSD / w.estimatedMonthlyRuns) * targetRuns
      );
      out.push({
        id: `refresh-${w.id}`,
        resourceId: w.id,
        title: `Reducir auto-refresh de ${w.displayName} (${w.autoRefreshInterval})`,
        description: `Se refresca cada ${w.autoRefreshInterval} sobre tablas de alto volumen (${
          Array.from(new Set(w.queries.flatMap((q) => q.tablesReferenced))).slice(0, 3).join(", ") || "Log Analytics"
        }), ~${w.estimatedMonthlyRuns} ejecuciones/mes. Salvo que este proyectado en un NOC, 15 min es suficiente.`,
        category: "DISABLE_AUTOREFRESH",
        estimatedSavingsUSD: Number(saving.toFixed(2)),
        confidence: "HIGH",
        actionType: "ADJUST_REFRESH",
      });
      continue;
    }

    // Regla 3 — KQL sin filtro temporal: obliga a escanear toda la retencion.
    const unfiltered = w.queries.filter((q) => q.lacksTimeFilter && q.estimatedScanGB > 0);
    if (unfiltered.length > 0) {
      // Acotar por TimeGenerated evita el multiplicador x3 de la estimacion.
      const saving = w.estimatedQueryCostUSD * (2 / 3);
      out.push({
        id: `kql-${w.id}`,
        resourceId: w.id,
        title: `Optimizar ${unfiltered.length} consulta(s) KQL en ${w.displayName}`,
        description: `${unfiltered.length} consulta(s) agregan sin acotar antes por TimeGenerated, lo que fuerza a escanear toda la retencion del workspace. Mover el filtro temporal al inicio del pipeline reduce el volumen facturado.`,
        category: "OPTIMIZE_KQL",
        estimatedSavingsUSD: Number(saving.toFixed(2)),
        confidence: "MEDIUM",
        actionType: "OPTIMIZE_QUERY",
      });
      continue;
    }

    // Gobernanza: un workbook privado con consultas pesadas suele estar
    // duplicado por varios usuarios; promoverlo a compartido evita N escaneos.
    if (w.workbookType === "Private" && w.hasHeavyQueries) {
      out.push({
        id: `promote-${w.id}`,
        resourceId: w.id,
        title: `Promover a compartido: ${w.displayName}`,
        description:
          "Workbook privado con consultas de alto volumen. Los dashboards privados se duplican entre usuarios y cada copia escanea por separado; publicarlo como compartido consolida el escaneo.",
        category: "PROMOTE_TO_SHARED",
        estimatedSavingsUSD: Number((w.estimatedQueryCostUSD * 0.3).toFixed(2)),
        confidence: "MEDIUM",
        actionType: "PROMOTE_WORKBOOK",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function buildMockWorkbook(partial: Partial<WorkbookResourceItem> & { name: string }): WorkbookResourceItem {
  const queries = partial.queries || [];
  const autoRefreshSeconds = partial.autoRefreshSeconds ?? 0;
  const daysSinceModified = partial.daysSinceModified ?? 12;
  const missingWorkspaceIds = partial.missingWorkspaceIds || [];
  const isOrphan = partial.isOrphan ?? false;
  const hasHeavyQueries = queries.some((q) => q.isHeavy);
  const { healthStatus, healthReason } = deriveWorkbookHealth({
    isOrphan,
    missingWorkspaceIds,
    daysSinceModified,
    hasHeavyQueries,
  });
  const totalScanGBPerRun = Number(queries.reduce((a, q) => a + q.estimatedScanGB, 0).toFixed(2));
  const runs = estimateMonthlyRuns(autoRefreshSeconds);

  return {
    id: partial.id || `/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-observability/providers/microsoft.insights/workbooks/${partial.name}`,
    name: partial.name,
    displayName: partial.displayName || partial.name,
    workbookType: partial.workbookType || "Shared",
    location: partial.location || "eastus",
    resourceGroup: partial.resourceGroup || "rg-observability",
    subscriptionId: partial.subscriptionId || "00000000-0000-0000-0000-000000000001",
    subscriptionName: partial.subscriptionName || "Produccion CSCloudSolutions",
    category: partial.category || "workbook",
    primaryDataSource: derivePrimaryDataSource(queries),
    linkedSourceId: partial.linkedSourceId,
    autoRefreshInterval: formatRefreshLabel(autoRefreshSeconds),
    autoRefreshSeconds,
    lastModifiedDate: new Date(Date.now() - daysSinceModified * 86400000).toISOString(),
    daysSinceModified,
    version: partial.version || "Notebook/1.0",
    isOrphan,
    hasHeavyQueries,
    healthStatus,
    healthReason,
    estimatedQueryCostUSD: Number((totalScanGBPerRun * runs * LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB).toFixed(2)),
    estimatedMonthlyRuns: runs,
    totalScanGBPerRun,
    queries,
    missingWorkspaceIds,
  };
}

function q(
  stepName: string,
  dataSource: WorkbookDataSource,
  tables: string[],
  lacksTimeFilter: boolean,
  preview: string
): WorkbookQuerySummary {
  const estimatedScanGB = dataSource === "LogAnalytics" ? estimateQueryScanGB(tables, lacksTimeFilter) : 0;
  return {
    stepName,
    dataSource,
    tablesReferenced: tables,
    estimatedScanGB,
    lacksTimeFilter,
    isHeavy: estimatedScanGB >= HEAVY_QUERY_GB_THRESHOLD,
    queryPreview: preview,
  };
}

/**
 * Payload sintetico escalado por tier. Solo se sirve a tenants demo: la ruta
 * evalua `isMockTenant` antes del guard y nunca cae aca en un tenant real
 * (tolerancia cero a fallbacks mock — Directiva 24.1).
 */
export function getMockWorkbooksPayload(tenantId: string): WorkbooksPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const workbooks: WorkbookResourceItem[] = [
    buildMockWorkbook({
      name: "FinOps-Executive-Overview",
      displayName: "FinOps — Resumen Ejecutivo",
      workbookType: "Shared",
      daysSinceModified: 4,
      autoRefreshSeconds: 900,
      queries: [
        q("cost-trend", "ResourceGraph", [], false, "resources | where type =~ 'microsoft.compute/virtualmachines' | summarize count() by location"),
        q("usage", "LogAnalytics", ["Usage"], false, "Usage | where TimeGenerated > ago(30d) | summarize sum(Quantity) by DataType"),
      ],
    }),
    buildMockWorkbook({
      name: "SecOps-Live-Threats",
      displayName: "SecOps — Amenazas en Vivo",
      workbookType: "Shared",
      resourceGroup: "rg-security",
      daysSinceModified: 2,
      autoRefreshSeconds: 60,
      queries: [
        q("firewall", "LogAnalytics", ["CommonSecurityLog"], false, "CommonSecurityLog | where TimeGenerated > ago(1h) | summarize count() by DeviceAction"),
        q("signins", "LogAnalytics", ["SigninLogs"], false, "SigninLogs | where TimeGenerated > ago(1h) | where ResultType != 0"),
      ],
    }),
    buildMockWorkbook({
      name: "AKS-Container-Insights",
      displayName: "AKS — Container Insights",
      workbookType: "Shared",
      resourceGroup: "rg-aks-prod",
      daysSinceModified: 21,
      autoRefreshSeconds: 300,
      queries: [
        q("container-logs", "LogAnalytics", ["ContainerLogV2"], true, "ContainerLogV2 | summarize count() by ContainerName | order by count_ desc"),
      ],
    }),
    buildMockWorkbook({
      name: "Legacy-VM-Inventory",
      displayName: "Inventario VM (heredado)",
      workbookType: "Private",
      resourceGroup: "rg-legacy",
      daysSinceModified: 412,
      autoRefreshSeconds: 0,
      isOrphan: true,
      linkedSourceId:
        "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-legacy/providers/Microsoft.OperationalInsights/workspaces/law-decommissioned",
      missingWorkspaceIds: [
        "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-legacy/providers/Microsoft.OperationalInsights/workspaces/law-decommissioned",
      ],
      queries: [
        q("heartbeat", "LogAnalytics", ["Heartbeat"], true, "Heartbeat | summarize arg_max(TimeGenerated, *) by Computer"),
      ],
    }),
    buildMockWorkbook({
      name: "AppTraces-Deep-Dive",
      displayName: "App Traces — Analisis Profundo",
      workbookType: "Private",
      resourceGroup: "rg-observability",
      daysSinceModified: 233,
      autoRefreshSeconds: 0,
      queries: [
        q("traces", "LogAnalytics", ["AppTraces", "AppExceptions"], true, "AppTraces | join AppExceptions on OperationId | summarize count() by SeverityLevel"),
      ],
    }),
    buildMockWorkbook({
      name: "Network-Latency-Board",
      displayName: "Red — Latencia por Region",
      workbookType: "Shared",
      resourceGroup: "rg-network",
      daysSinceModified: 30,
      autoRefreshSeconds: 0,
      queries: [q("metrics", "AzureMetrics", [], false, "Microsoft.Network/connections | avg(BitsInPerSecond)")],
    }),
  ];

  if (isBusiness) {
    workbooks.push(
      buildMockWorkbook({
        name: "Syslog-Compliance-Audit",
        displayName: "Syslog — Auditoria de Cumplimiento",
        workbookType: "Shared",
        resourceGroup: "rg-compliance",
        subscriptionId: "00000000-0000-0000-0000-000000000002",
        subscriptionName: "Cumplimiento y Auditoria",
        daysSinceModified: 67,
        autoRefreshSeconds: 180,
        queries: [
          q("syslog", "LogAnalytics", ["Syslog", "SecurityEvent"], false, "Syslog | where TimeGenerated > ago(24h) | summarize count() by Facility"),
        ],
      }),
      buildMockWorkbook({
        name: "Storage-Capacity-Planner",
        displayName: "Almacenamiento — Planificador de Capacidad",
        workbookType: "Shared",
        resourceGroup: "rg-storage",
        subscriptionId: "00000000-0000-0000-0000-000000000002",
        subscriptionName: "Cumplimiento y Auditoria",
        daysSinceModified: 15,
        autoRefreshSeconds: 3600,
        queries: [q("capacity", "ResourceGraph", [], false, "resources | where type =~ 'microsoft.storage/storageaccounts'")],
      })
    );
  }

  if (isEnterprise) {
    workbooks.push(
      buildMockWorkbook({
        name: "Global-Multi-Region-NOC",
        displayName: "NOC Global Multi-Region",
        workbookType: "Shared",
        resourceGroup: "rg-noc",
        subscriptionId: "00000000-0000-0000-0000-000000000003",
        subscriptionName: "Operaciones Globales",
        location: "westeurope",
        daysSinceModified: 1,
        autoRefreshSeconds: 60,
        queries: [
          q("diag", "LogAnalytics", ["AzureDiagnostics", "W3CIISLog"], true, "AzureDiagnostics | union W3CIISLog | summarize count() by ResourceProvider"),
          q("arg", "ResourceGraph", [], false, "resources | summarize count() by subscriptionId"),
        ],
      }),
      buildMockWorkbook({
        name: "Abandoned-POC-Dashboard",
        displayName: "POC abandonado (Q1)",
        workbookType: "Private",
        resourceGroup: "rg-sandbox",
        subscriptionId: "00000000-0000-0000-0000-000000000003",
        subscriptionName: "Operaciones Globales",
        daysSinceModified: 520,
        autoRefreshSeconds: 300,
        isOrphan: true,
        queries: [q("poc", "LogAnalytics", ["ContainerLog"], true, "ContainerLog | summarize count()")],
      })
    );
  }

  const remediations = generateWorkbooksRecommendations(workbooks);
  const summary = calculateWorkbooksSummary(workbooks, remediations);

  // Tendencia de 30 dias derivada del costo mensual, con oscilacion determinista
  // (sin Math.random: el dataset demo debe ser estable entre renders y snapshots).
  const dailyBase = summary.estimatedMonthlyQueryCostUSD / 30;
  const costTrend = Array.from({ length: 30 }, (_, i) => {
    const wave = 1 + 0.18 * Math.sin((i / 30) * Math.PI * 4);
    const cost = Number((dailyBase * wave).toFixed(2));
    return {
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
      estimatedCostUSD: cost,
      scanGB: Number((cost / LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB).toFixed(2)),
    };
  });

  return {
    summary,
    workbooks,
    remediations,
    costTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(workbooks.map((w) => w.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo (Azure Resource Graph)
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = []): WorkbooksPayload {
  return {
    summary: calculateWorkbooksSummary([], []),
    workbooks: [],
    remediations: [],
    costTrend: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
  };
}

/**
 * Inventario vivo de `microsoft.insights/workbooks` y `microsoft.insights/myworkbooks`.
 *
 * Devuelve estado vacio legitimo cuando el tenant no tiene workbooks o no tiene
 * credenciales: NUNCA cae al dataset mock (Directiva 24.1, tolerancia cero).
 */
export async function fetchLiveWorkbooksData(tenantId: string): Promise<WorkbooksPayload> {
  try {
    const credentials = await getAzureCredential(tenantId);
    if (!credentials) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());
    const client = await getResourceGraphClient(tenantId);

    // Workbooks compartidos y privados. `serializedData` puede ser grande, pero
    // es la unica fuente de las consultas KQL embebidas.
    const workbooksQuery = `
      resources
      | where type =~ 'microsoft.insights/workbooks' or type =~ 'microsoft.insights/myworkbooks'
      | project id, name, type, location, resourceGroup, subscriptionId, kind, properties
    `;

    // Workspaces existentes, para detectar referencias rotas (Regla 1).
    const workspacesQuery = `
      resources
      | where type =~ 'microsoft.operationalinsights/workspaces'
      | project id
    `;

    const [wbResponse, wsResponse] = await withArgLimit(async () => {
      return await Promise.all([
        client.resources({ query: workbooksQuery }),
        client.resources({ query: workspacesQuery }),
      ]);
    });

    const rows: Array<Record<string, unknown>> = wbResponse.data || [];
    const availableSubscriptions = Array.from(subMap.values());
    if (rows.length === 0) return emptyPayload(availableSubscriptions);

    const existingWorkspaces = new Set<string>(
      ((wsResponse.data || []) as Array<{ id?: string }>)
        .map((r) => (typeof r.id === "string" ? r.id.toLowerCase() : ""))
        .filter(Boolean)
    );

    // Todos los IDs de recurso conocidos del tenant, para validar `sourceId`.
    const knownResourceIds = new Set<string>(
      rows.map((r) => String(r.id || "").toLowerCase()).filter(Boolean)
    );
    existingWorkspaces.forEach((id) => knownResourceIds.add(id));

    const now = Date.now();
    const workbooks: WorkbookResourceItem[] = rows.map((row) => {
      const props = (row.properties || {}) as Record<string, unknown>;
      const type = String(row.type || "").toLowerCase();
      const workbookType: WorkbookType = type.includes("myworkbooks") ? "Private" : "Shared";

      const parsed = parseWorkbookDefinition(props.serializedData);
      const totalScanGBPerRun = Number(parsed.queries.reduce((a, q2) => a + q2.estimatedScanGB, 0).toFixed(2));
      const runs = estimateMonthlyRuns(parsed.autoRefreshSeconds);

      const timeModified = typeof props.timeModified === "string" ? props.timeModified : "";
      const modifiedMs = timeModified ? Date.parse(timeModified) : NaN;
      const daysSinceModified = Number.isFinite(modifiedMs)
        ? Math.max(0, Math.floor((now - modifiedMs) / 86400000))
        : 0;

      // Regla 1 — origenes rotos: sourceId apuntando a un recurso inexistente,
      // o consultas cross-resource contra workspaces eliminados.
      const linkedSourceId = typeof props.sourceId === "string" ? props.sourceId : undefined;
      const missingWorkspaceIds = parsed.referencedResourceIds.filter((rid) => {
        const lower = rid.toLowerCase();
        // Solo se valida contra workspaces: otros tipos de recurso no se
        // inventariaron en esta consulta y marcarlos seria un falso positivo.
        if (!lower.includes("/providers/microsoft.operationalinsights/workspaces/")) return false;
        return !existingWorkspaces.has(lower);
      });

      const isOrphan =
        !!linkedSourceId &&
        linkedSourceId.startsWith("/subscriptions/") &&
        !knownResourceIds.has(linkedSourceId.toLowerCase());

      const hasHeavyQueries = parsed.queries.some((q2) => q2.isHeavy);
      const { healthStatus, healthReason } = deriveWorkbookHealth({
        isOrphan,
        missingWorkspaceIds,
        daysSinceModified,
        hasHeavyQueries,
      });

      const subscriptionId = String(row.subscriptionId || "");

      return {
        id: String(row.id || ""),
        name: String(row.name || ""),
        displayName:
          typeof props.displayName === "string" && props.displayName.length > 0
            ? props.displayName
            : String(row.name || ""),
        workbookType,
        location: String(row.location || ""),
        resourceGroup: String(row.resourceGroup || ""),
        subscriptionId,
        subscriptionName: subMap.get(subscriptionId) || subscriptionId,
        category: typeof props.category === "string" ? props.category : "workbook",
        primaryDataSource: derivePrimaryDataSource(parsed.queries),
        linkedSourceId,
        autoRefreshInterval: formatRefreshLabel(parsed.autoRefreshSeconds),
        autoRefreshSeconds: parsed.autoRefreshSeconds,
        lastModifiedDate: timeModified,
        daysSinceModified,
        version: typeof props.version === "string" ? props.version : "Notebook/1.0",
        isOrphan,
        hasHeavyQueries,
        healthStatus,
        healthReason,
        estimatedQueryCostUSD: Number((totalScanGBPerRun * runs * LOG_ANALYTICS_QUERY_SCAN_USD_PER_GB).toFixed(2)),
        estimatedMonthlyRuns: runs,
        totalScanGBPerRun,
        queries: parsed.queries,
        missingWorkspaceIds,
      };
    });

    const remediations = generateWorkbooksRecommendations(workbooks);
    const summary = calculateWorkbooksSummary(workbooks, remediations);

    return {
      summary,
      workbooks,
      remediations,
      costTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
    };
  } catch (error) {
    // Se registra server-side y se devuelve estado vacio real: inventar datos
    // aca seria exactamente el fallback mock que la Directiva 24.1 prohibe.
    console.error("[azureWorkbooks.service] fetchLiveWorkbooksData:", errorMessage(error));
    return emptyPayload();
  }
}
