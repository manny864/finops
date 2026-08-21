import { describe, it, expect } from "vitest";
import {
  mapAzureTypeToAlertType,
  calculateAlertMonthlyCost,
  getMockAlertsPayload,
  calculateAlertsSummary,
  generateAlertsRecommendations,
  fetchLiveAlertsData,
} from "@/services/azureAlertsRules.service";
import { buildAlertRemediationCommand } from "@/lib/aiRemediations";
import type { AlertRuleResource, AlertRemediationAction } from "@/types/azureAlerts.types";

describe("Azure Alerts Rules Management & FinOps Governance Service", () => {
  it("should correctly map raw Azure resource types to normalized AlertRuleType", () => {
    expect(mapAzureTypeToAlertType("microsoft.insights/metricalerts")).toBe("metric");
    expect(mapAzureTypeToAlertType("microsoft.insights/scheduledqueryrules")).toBe("scheduledQuery");
    expect(mapAzureTypeToAlertType("microsoft.insights/activitylogalerts")).toBe("activityLog");
    expect(mapAzureTypeToAlertType("microsoft.alertsmanagement/smartdetectoralertrules")).toBe("smartDetector");
    expect(mapAzureTypeToAlertType("microsoft.insights/webtests")).toBe("webTest");
  });

  it("should calculate correct monthly costs based on type and frequency", () => {
    expect(calculateAlertMonthlyCost("metric", "1m", true)).toBe(0.10);
    expect(calculateAlertMonthlyCost("metric", "1m", false)).toBe(0.00);
    expect(calculateAlertMonthlyCost("scheduledQuery", "1m", true)).toBe(1.50);
    expect(calculateAlertMonthlyCost("scheduledQuery", "5m", true)).toBe(0.50);
    expect(calculateAlertMonthlyCost("scheduledQuery", "1h", true)).toBe(0.10);
    expect(calculateAlertMonthlyCost("activityLog", "instant", true)).toBe(0.00);
    expect(calculateAlertMonthlyCost("smartDetector", "auto", true)).toBe(0.00);
    expect(calculateAlertMonthlyCost("webTest", "5m", true)).toBe(1.00);
  });

  it("should generate mock alerts dataset for demo tenant with valid metrics and recommendations", () => {
    const payload = getMockAlertsPayload("demo-tenant-123");
    expect(payload.source).toBe("mock");
    expect(payload.alerts.length).toBeGreaterThan(5);
    expect(payload.summary.totalAlertsCount).toBe(payload.alerts.length);
    expect(payload.summary.totalMonthlyCostUSD).toBeGreaterThan(0);
    expect(payload.summary.breakdownByType.length).toBe(5);
    expect(payload.remediations.length).toBeGreaterThan(0);
    expect(payload.availableSubscriptions?.length).toBeGreaterThan(0);
  });

  it("should detect orphan rules and frequency optimizations in recommendations", () => {
    const alerts: AlertRuleResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/alert-orphan-db",
        name: "alert-orphan-db",
        alertType: "metric",
        alertTypeDisplayName: "Alerta de Métrica",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Production Core",
        isEnabled: true,
        severity: "Sev1",
        targetResourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.sql/servers/sql-srv/databases/deleted-db",
        targetResourceName: "deleted-db",
        targetResourceType: "Microsoft.Sql/servers/databases",
        evaluationFrequency: "1m",
        windowSize: "5m",
        conditionSummary: "Average CPU > 90%",
        actionGroupIds: [],
        monthlyCostUSD: 0.10,
        isOrphan: true,
        isInefficient: true,
      },
      {
        id: "/subscriptions/sub-2/resourceGroups/rg-dev-backend/providers/microsoft.insights/scheduledqueryrules/alert-dev-fast-kql",
        name: "alert-dev-fast-kql",
        alertType: "scheduledQuery",
        alertTypeDisplayName: "Búsqueda en Logs (KQL)",
        location: "westus2",
        resourceGroup: "rg-dev-backend",
        subscriptionId: "sub-2",
        subscriptionName: "Dev Lab",
        isEnabled: true,
        severity: "Sev3",
        targetResourceId: "/subscriptions/sub-2/resourceGroups/rg-dev-backend/providers/microsoft.insights/components/appi-dev",
        targetResourceName: "appi-dev",
        targetResourceType: "Microsoft.Insights/components",
        evaluationFrequency: "1m",
        windowSize: "5m",
        conditionSummary: "Exceptions > 5",
        actionGroupIds: ["/subscriptions/sub-2/resourceGroups/rg-dev-backend/providers/microsoft.insights/actionGroups/ag-dev"],
        monthlyCostUSD: 1.50,
        isOrphan: false,
        isInefficient: true,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/alert-silent-metric",
        name: "alert-silent-metric",
        alertType: "metric",
        alertTypeDisplayName: "Alerta de Métrica",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Production Core",
        isEnabled: true,
        severity: "Sev0",
        targetResourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-main",
        targetResourceName: "vm-main",
        targetResourceType: "Microsoft.Compute/virtualMachines",
        evaluationFrequency: "5m",
        windowSize: "15m",
        conditionSummary: "Percentage CPU > 95%",
        actionGroupIds: [],
        monthlyCostUSD: 0.10,
        isOrphan: false,
        isInefficient: false,
      },
    ];

    const remediations = generateAlertsRecommendations(alerts);
    expect(remediations.length).toBe(3);

    const orphanRem = remediations.find((r) => r.category === "PURGE_ORPHAN");
    expect(orphanRem).toBeDefined();
    expect(orphanRem?.estimatedSavingsUSD).toBe(0.10);

    const freqRem = remediations.find((r) => r.category === "ADJUST_FREQUENCY");
    expect(freqRem).toBeDefined();
    expect(freqRem?.estimatedSavingsUSD).toBe(1.00); // 1.50 - 0.50

    const silentRem = remediations.find((r) => r.category === "ASSIGN_ACTION_GROUP");
    expect(silentRem).toBeDefined();
  });

  it("should build accurate Azure CLI and PowerShell remediation commands", () => {
    const action: AlertRemediationAction = {
      id: "rem-1",
      ruleId: "/subscriptions/sub-1/resourceGroups/rg-alerts/providers/microsoft.insights/scheduledqueryrules/alert-orphan-test",
      ruleName: "alert-orphan-test",
      title: "Eliminar alerta huérfana",
      description: "Test description",
      category: "PURGE_ORPHAN",
      estimatedSavingsUSD: 0.50,
      confidence: "HIGH",
      actionType: "DELETE_ORPHAN_RULE",
    };

    const cmd = buildAlertRemediationCommand(action);
    expect(cmd.cli).toContain("az monitor scheduled-query delete");
    expect(cmd.powershell).toContain("Remove-AzScheduledQueryRule");
  });

  it("should return empty valid live payload without fake mocks when tenant is live but has no credentials", async () => {
    const result = await fetchLiveAlertsData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.alerts).toEqual([]);
    expect(result.summary.totalMonthlyCostUSD).toBe(0);
    expect(result.summary.totalAlertsCount).toBe(0);
  });
});
