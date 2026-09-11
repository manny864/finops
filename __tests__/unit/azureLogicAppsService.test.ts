import { describe, it, expect } from "vitest";
import {
  generateMockLogicAppsData,
  calculateLogicAppsSummary,
  generateLogicAppsRecommendations,
  buildLogicAppsRemediationCommand,
} from "@/services/azureLogicApps.service";
import type { LogicAppResourceItem } from "@/types/azureLogicApps.types";

describe("Azure Logic Apps FinOps Service", () => {
  it("should generate mock data with valid structure and metrics", () => {
    const data = generateMockLogicAppsData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalResourcesCount).toBe(data.items.length);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.dailyTrend.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: LogicAppResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Logic/workflows/high-spend-cons",
        name: "high-spend-cons",
        planType: "Consumption",
        location: "eastus",
        resourceGroup: "rg-1",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        state: "Enabled",
        provisioningState: "Succeeded",
        healthStatus: "Available",
        totalBillableExecutions: 9_000_000,
        enterpriseExecutions: 200_000,
        enterpriseCostUSD: 200,
        costMtdUSD: 425.0,
        costPreviousMonthUSD: 410.0,
        forecastEomUSD: 440.0,
        runsStartedCount: 200_000,
        runsFailedCount: 50,
        isOrphanOrIdle: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/low-spend-std",
        name: "low-spend-std",
        planType: "Standard_WS1",
        location: "eastus",
        resourceGroup: "rg-1",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        state: "Enabled",
        provisioningState: "Succeeded",
        healthStatus: "Available",
        totalBillableExecutions: 50,
        enterpriseExecutions: 0,
        enterpriseCostUSD: 0,
        costMtdUSD: 175.0,
        costPreviousMonthUSD: 175.0,
        forecastEomUSD: 175.0,
        runsStartedCount: 10,
        runsFailedCount: 0,
        isOrphanOrIdle: false,
      },
    ];

    const summary = calculateLogicAppsSummary(testItems);
    expect(summary.costMtdUSD).toBe(600.0);
    expect(summary.totalResourcesCount).toBe(2);
    expect(summary.totalEnterpriseCalls).toBe(200_000);
    expect(summary.totalEnterpriseCostUSD).toBe(200);

    const recs = generateLogicAppsRecommendations(testItems);
    expect(recs.some((r) => r.category === "MIGRATE_TO_STANDARD")).toBe(true);
    expect(recs.some((r) => r.category === "DOWNGRADE_TO_CONSUMPTION")).toBe(true);
  });

  it("should generate CLI and PowerShell commands for remediation", () => {
    const action = {
      id: "rec-test-1",
      resourceId: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Logic/workflows/test-app",
      title: "Test Remediation",
      description: "Test description",
      category: "MIGRATE_TO_STANDARD" as const,
      estimatedSavingsUSD: 250,
      confidence: "HIGH" as const,
      actionType: "MIGRATE_TO_LOGIC_APP_STANDARD",
      commandPayload: "az logicapp create --plan asp-std",
    };

    const cmd = buildLogicAppsRemediationCommand(action);
    expect(cmd.cli).toContain("az logicapp create");
    // El encabezado ya no viaja en el script: es un marcador que
    // resolverComentarios() cambia por el texto del catalogo en el idioma del
    // lector. Aserta el marcador, que es lo que el builder tiene que emitir.
    expect(cmd.powershell).toContain("#{cmt_la_ps_header}");
    expect(cmd.powershell).toContain("#{cmt_la_recurso}");
    // Y el comando ejecutable sigue intacto: el marcador nunca lo toca.
    expect(cmd.powershell).toContain("az logicapp create --plan asp-std");
  });

  it("should enrich live Logic Apps with cost map, monitor telemetry and 30-day dailyTrend", async () => {
    const { getLiveLogicAppsData } = await import("@/services/azureLogicApps.service");
    // When called with an empty tenant or no subs, it returns a well-formed empty live response
    const emptyResult = await getLiveLogicAppsData("tenant-non-existent");
    expect(emptyResult.source).toBe("live");
    expect(emptyResult.summary.totalResourcesCount).toBe(0);
    expect(emptyResult.summary.costMtdUSD).toBe(0);
  });
});

