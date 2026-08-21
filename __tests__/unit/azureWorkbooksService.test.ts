import { describe, it, expect } from "vitest";
import {
  parseAutoRefreshSeconds,
  formatRefreshLabel,
  extractKqlTables,
  estimateQueryScanGB,
  derivePrimaryDataSource,
  parseWorkbookDefinition,
  estimateMonthlyRuns,
  touchesHighVolumeTable,
  hasAggressiveRefresh,
  deriveWorkbookHealth,
  calculateWorkbooksSummary,
  generateWorkbooksRecommendations,
  getMockWorkbooksPayload,
  fetchLiveWorkbooksData,
} from "@/services/azureWorkbooks.service";
import { buildWorkbookRemediationCommand, shellQuote } from "@/lib/aiRemediations";
import type { WorkbookQuerySummary } from "@/types/azureWorkbooks.types";

const q = (over: Partial<WorkbookQuerySummary> = {}): WorkbookQuerySummary => ({
  stepName: "step",
  dataSource: "LogAnalytics",
  tablesReferenced: [],
  estimatedScanGB: 0,
  lacksTimeFilter: false,
  isHeavy: false,
  queryPreview: "",
  ...over,
});

describe("Azure Workbooks — parsing de la definicion", () => {
  it("normaliza el auto-refresh desde las tres formas que usa Azure", () => {
    expect(parseAutoRefreshSeconds(300)).toBe(300);
    expect(parseAutoRefreshSeconds("PT5M")).toBe(300);
    expect(parseAutoRefreshSeconds("PT1H")).toBe(3600);
    expect(parseAutoRefreshSeconds("PT1M30S")).toBe(90);
    expect(parseAutoRefreshSeconds("5 minutes")).toBe(300);
    expect(parseAutoRefreshSeconds("30 seconds")).toBe(30);
    expect(parseAutoRefreshSeconds("900")).toBe(900);
    // Ausencia de auto-refresh, no un intervalo de cero.
    expect(parseAutoRefreshSeconds(undefined)).toBe(0);
    expect(parseAutoRefreshSeconds("")).toBe(0);
    expect(parseAutoRefreshSeconds("nunca")).toBe(0);
    expect(parseAutoRefreshSeconds(-5)).toBe(0);
  });

  it("etiqueta el intervalo y devuelve undefined cuando esta apagado", () => {
    expect(formatRefreshLabel(0)).toBeUndefined();
    expect(formatRefreshLabel(30)).toBe("30 s");
    expect(formatRefreshLabel(300)).toBe("5 min");
    expect(formatRefreshLabel(3600)).toBe("1 h");
  });

  it("extrae tablas de KQL sin confundirlas con operadores", () => {
    const tables = extractKqlTables(
      "CommonSecurityLog | where TimeGenerated > ago(1d) | summarize count() by DeviceAction"
    );
    expect(tables).toContain("CommonSecurityLog");
    // `where` y `summarize` estan en posicion de tabla tras el pipe pero son operadores.
    expect(tables).not.toContain("where");
    expect(tables).not.toContain("summarize");

    const joined = extractKqlTables("AppTraces | join AppExceptions on OperationId");
    expect(joined).toContain("AppTraces");
    expect(joined).toContain("AppExceptions");
    expect(joined).not.toContain("join");
    expect(joined).not.toContain("on");
  });

  it("penaliza las tablas de alto volumen y la falta de filtro temporal", () => {
    const acotada = estimateQueryScanGB(["CommonSecurityLog"], false);
    const sinFiltro = estimateQueryScanGB(["CommonSecurityLog"], true);
    const liviana = estimateQueryScanGB(["Heartbeat"], false);

    expect(acotada).toBeGreaterThan(liviana);
    // No acotar por TimeGenerated obliga a recorrer toda la retencion.
    expect(sinFiltro).toBeGreaterThan(acotada);
    expect(estimateQueryScanGB([], false)).toBe(0);
  });

  it("deriva la fuente principal y marca Mixed cuando hay mas de una", () => {
    expect(derivePrimaryDataSource([])).toBe("Unknown");
    expect(derivePrimaryDataSource([q({ dataSource: "LogAnalytics" })])).toBe("LogAnalytics");
    expect(
      derivePrimaryDataSource([q({ dataSource: "LogAnalytics" }), q({ dataSource: "ResourceGraph" })])
    ).toBe("Mixed");
    // Unknown no debe contaminar la deteccion de fuente unica.
    expect(
      derivePrimaryDataSource([q({ dataSource: "AzureMetrics" }), q({ dataSource: "Unknown" })])
    ).toBe("AzureMetrics");
  });

  it("parsea serializedData anidado y se queda con el refresco mas agresivo", () => {
    const definition = JSON.stringify({
      version: "Notebook/1.0",
      items: [
        {
          name: "grupo",
          content: {
            autoRefreshSeconds: 900,
            items: [
              {
                name: "consulta-critica",
                content: {
                  queryType: 0,
                  autoRefreshSeconds: 60,
                  query: "ContainerLogV2 | summarize count() by ContainerName",
                  crossComponentResources: ["/subscriptions/s/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law-1"],
                },
              },
            ],
          },
          items: [
            {
              name: "consulta-critica",
              content: {
                queryType: 0,
                autoRefreshSeconds: 60,
                query: "ContainerLogV2 | summarize count() by ContainerName",
                crossComponentResources: ["/subscriptions/s/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law-1"],
              },
            },
          ],
        },
      ],
    });

    const parsed = parseWorkbookDefinition(definition);
    // Domina el intervalo mas corto: es el que manda el costo.
    expect(parsed.autoRefreshSeconds).toBe(60);
    expect(parsed.queries.length).toBeGreaterThan(0);
    expect(parsed.queries[0].tablesReferenced).toContain("ContainerLogV2");
    expect(parsed.queries[0].lacksTimeFilter).toBe(true);
    expect(parsed.referencedResourceIds.some((r) => r.includes("law-1"))).toBe(true);
  });

  it("no lanza ante definiciones corruptas: un workbook roto no debe tumbar el inventario", () => {
    expect(parseWorkbookDefinition("{ esto no es json").queries).toEqual([]);
    expect(parseWorkbookDefinition(undefined).queries).toEqual([]);
    expect(parseWorkbookDefinition("").autoRefreshSeconds).toBe(0);
    expect(parseWorkbookDefinition("null").queries).toEqual([]);
    expect(parseWorkbookDefinition(JSON.stringify({ items: "no-es-array" })).queries).toEqual([]);
  });
});

describe("Azure Workbooks — motor de deteccion de fugas", () => {
  it("cuenta ejecuciones manuales cuando no hay auto-refresh, no cero", () => {
    // Sin auto-refresh el escaneo igual ocurre al abrir el dashboard.
    expect(estimateMonthlyRuns(0)).toBe(30);
    expect(estimateMonthlyRuns(3600)).toBeLessThan(estimateMonthlyRuns(60));
  });

  it("Regla 2: auto-refresh agresivo solo cuenta sobre tablas de alto volumen", () => {
    const pesada = [q({ tablesReferenced: ["CommonSecurityLog"] })];
    const liviana = [q({ tablesReferenced: ["Heartbeat"] })];

    expect(hasAggressiveRefresh(60, pesada)).toBe(true);
    expect(hasAggressiveRefresh(300, pesada)).toBe(true);
    // 15 min no es agresivo aunque la tabla sea pesada.
    expect(hasAggressiveRefresh(900, pesada)).toBe(false);
    // 1 min sobre una tabla liviana tampoco dispara la regla.
    expect(hasAggressiveRefresh(60, liviana)).toBe(false);
    expect(hasAggressiveRefresh(0, pesada)).toBe(false);

    expect(touchesHighVolumeTable(pesada)).toBe(true);
    expect(touchesHighVolumeTable(liviana)).toBe(false);
  });

  it("Regla 1 y 3: prioriza origen roto sobre huerfano, y no marca zombie a un workbook viejo pero liviano", () => {
    expect(
      deriveWorkbookHealth({ isOrphan: true, missingWorkspaceIds: ["/ws/x"], daysSinceModified: 5, hasHeavyQueries: false })
        .healthStatus
    ).toBe("SourceError");

    expect(
      deriveWorkbookHealth({ isOrphan: true, missingWorkspaceIds: [], daysSinceModified: 5, hasHeavyQueries: false })
        .healthStatus
    ).toBe("Orphan");

    expect(
      deriveWorkbookHealth({ isOrphan: false, missingWorkspaceIds: [], daysSinceModified: 400, hasHeavyQueries: true })
        .healthStatus
    ).toBe("Stale");

    // Viejo pero sin consultas pesadas no es una fuga: no debe ensuciar el tablero.
    expect(
      deriveWorkbookHealth({ isOrphan: false, missingWorkspaceIds: [], daysSinceModified: 400, hasHeavyQueries: false })
        .healthStatus
    ).toBe("Valid");

    expect(
      deriveWorkbookHealth({ isOrphan: false, missingWorkspaceIds: [], daysSinceModified: 10, hasHeavyQueries: true })
        .healthStatus
    ).toBe("Valid");
  });
});

describe("Azure Workbooks — payload demo y agregacion", () => {
  it("genera dataset sintetico con metricas y recomendaciones coherentes", () => {
    const payload = getMockWorkbooksPayload("demo-tenant-123");
    expect(payload.source).toBe("mock");
    expect(payload.workbooks.length).toBeGreaterThan(4);
    expect(payload.summary.totalWorkbooksCount).toBe(payload.workbooks.length);
    expect(payload.summary.sharedCount + payload.summary.privateCount).toBe(payload.workbooks.length);
    expect(payload.summary.orphanCount).toBeGreaterThan(0);
    expect(payload.summary.aggressiveRefreshCount).toBeGreaterThan(0);
    expect(payload.remediations.length).toBeGreaterThan(0);
    expect(payload.costTrend?.length).toBe(30);
  });

  it("escala el dataset por tier", () => {
    const pro = getMockWorkbooksPayload("demo-1111");
    const business = getMockWorkbooksPayload("demo-2222");
    const enterprise = getMockWorkbooksPayload("demo-4444");

    expect(business.workbooks.length).toBeGreaterThan(pro.workbooks.length);
    expect(enterprise.workbooks.length).toBeGreaterThan(business.workbooks.length);
  });

  it("es determinista: dos llamadas producen el mismo costo (sin Math.random)", () => {
    const a = getMockWorkbooksPayload("demo-2222");
    const b = getMockWorkbooksPayload("demo-2222");
    expect(a.summary.estimatedMonthlyQueryCostUSD).toBe(b.summary.estimatedMonthlyQueryCostUSD);
    expect(a.costTrend?.map((p) => p.estimatedCostUSD)).toEqual(b.costTrend?.map((p) => p.estimatedCostUSD));
  });

  it("el desglose por fuente suma 100% y el ahorro no supera el costo total", () => {
    const payload = getMockWorkbooksPayload("demo-4444");
    const pct = payload.summary.breakdownByDataSource.reduce((a, b) => a + b.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
    expect(payload.summary.potentialSavingsUSD).toBeLessThanOrEqual(
      payload.summary.estimatedMonthlyQueryCostUSD
    );
  });

  it("summary vacio no divide por cero", () => {
    const summary = calculateWorkbooksSummary([], []);
    expect(summary.totalWorkbooksCount).toBe(0);
    expect(summary.estimatedMonthlyQueryCostUSD).toBe(0);
    expect(summary.potentialSavingsUSD).toBe(0);
    expect(summary.breakdownByDataSource).toEqual([]);
    expect(generateWorkbooksRecommendations([])).toEqual([]);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveWorkbooksData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.workbooks).toEqual([]);
    expect(result.summary.totalWorkbooksCount).toBe(0);
    expect(result.summary.estimatedMonthlyQueryCostUSD).toBe(0);
    expect(result.remediations).toEqual([]);
  });
});

describe("Azure Workbooks — comandos de remediacion", () => {
  it("entrega CLI y PowerShell por categoria", () => {
    const base = {
      id: "r1",
      resourceId:
        "/subscriptions/s/resourceGroups/rg-observability/providers/microsoft.insights/workbooks/wb-1",
      title: "t",
      description: "d",
      estimatedSavingsUSD: 10,
      confidence: "HIGH" as const,
      actionType: "X",
    };

    const purge = buildWorkbookRemediationCommand({ ...base, category: "PURGE_ORPHAN" });
    expect(purge.cli).toContain("workbook delete");
    expect(purge.powershell).toContain("Remove-AzApplicationInsightsWorkbook");

    const refresh = buildWorkbookRemediationCommand({ ...base, category: "DISABLE_AUTOREFRESH" });
    expect(refresh.cli).toContain("autoRefreshSeconds");
    expect(refresh.powershell).toContain("900");

    const kql = buildWorkbookRemediationCommand({ ...base, category: "OPTIMIZE_KQL" });
    expect(kql.cli).toContain("TimeGenerated");

    const promote = buildWorkbookRemediationCommand({ ...base, category: "PROMOTE_TO_SHARED" });
    expect(promote.cli).toContain("shared");
  });

  it("escapa nombres de recurso para que un nombre hostil no arme un comando destructivo", () => {
    // El nombre lo elige el cliente en Azure y el comando termina pegado en la
    // terminal del operador. Registrado en docs/security/audit-2026-08-21.md.
    expect(shellQuote('x"; rm -rf ~; #')).toBe('x\\"; rm -rf ~; #');
    expect(shellQuote("con $VAR y `backtick`")).toBe("con \\$VAR y \\`backtick\\`");
    expect(shellQuote("salto\nde linea")).toBe("salto de linea");
    expect(shellQuote(undefined)).toBe("");

    const hostil = buildWorkbookRemediationCommand({
      id: "r2",
      resourceId: '/subscriptions/s/resourceGroups/rg/providers/microsoft.insights/workbooks/evil"; rm -rf ~; #',
      title: "t",
      description: "d",
      category: "PURGE_ORPHAN",
      estimatedSavingsUSD: 0,
      confidence: "HIGH",
      actionType: "X",
    });
    // La comilla queda escapada: no cierra el string ni abre un comando nuevo.
    expect(hostil.cli).not.toMatch(/--name "evil"; rm/);
    expect(hostil.cli).toContain('evil\\"');
  });
});
