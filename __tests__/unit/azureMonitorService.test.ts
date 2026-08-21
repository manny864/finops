import { describe, it, expect } from "vitest";
import {
  generateMockAzureMonitorData,
  calculateAzureMonitorSummary,
  generateAzureMonitorRecommendations,
} from "@/services/azureMonitor.service";
import { buildAzureMonitorRemediationCommand } from "@/lib/aiRemediations";
import type {
  AzureAlertResource,
  AzureMonitorRemediationAction,
} from "@/types/azureMonitor.types";

describe("Azure Monitor & Alerting FinOps Service", () => {
  it("should generate mock Azure Monitor data with valid structure and metrics", () => {
    const data = generateMockAzureMonitorData();
    expect(data.source).toBe("mock");
    expect(data.alerts.length).toBeGreaterThan(0);
    expect(data.summary.totalAlertsCount).toBeGreaterThan(0);
    expect(data.summary.totalMonthlyCostUSD).toBeGreaterThan(0);
    expect(data.summary.logSearchDataProcessedGB).toBeGreaterThan(0);
    expect(data.summary.breakdownByAlertType.length).toBeGreaterThan(0);
    expect(data.dailyTrend.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should calculate summary metrics and evaluate FinOps alert optimization rules", () => {
    const testAlerts: AzureAlertResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/scheduledqueryrules/alert-heavy-kql",
        name: "alert-heavy-kql",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        alertType: "logSearch",
        targetResourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.operationalinsights/workspaces/law-prod",
        targetResourceName: "law-prod",
        isEnabled: true,
        currentSeverity: "Sev2",
        isFiring: false,
        runFrequency: "1m",
        evaluationWindow: "5m",
        dataProcessedGB_MTD: 120.0,
        costMtdUSD: 276.0, // 120 * 2.30
        specializedCostUSD: 0,
        totalRealCostUSD: 276.0,
        potentialSavingsUSD: 0,
        queryText: "Heartbeat | summarize count() by Computer",
        isWasteful: true,
        wasteReason: "High volume scan",
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/microsoft.insights/scheduledqueryrules/alert-dev-freq",
        name: "alert-dev-freq",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        alertType: "logSearch",
        targetResourceId: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-dev",
        targetResourceName: "vm-dev",
        isEnabled: true,
        currentSeverity: "Sev3",
        isFiring: false,
        runFrequency: "1m",
        evaluationWindow: "5m",
        dataProcessedGB_MTD: 25.0,
        costMtdUSD: 57.5,
        specializedCostUSD: 0,
        totalRealCostUSD: 57.5,
        potentialSavingsUSD: 0,
        queryText: "Perf | where ObjectName == 'Processor'",
        isWasteful: true,
        wasteReason: "Excessive Dev frequency",
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/metricalerts/alert-cpu-metric",
        name: "alert-cpu-metric",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        alertType: "metric",
        targetResourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-db",
        targetResourceName: "vm-db",
        isEnabled: true,
        currentSeverity: "Sev1",
        isFiring: false,
        runFrequency: "1m",
        evaluationWindow: "5m",
        dataProcessedGB_MTD: 0,
        costMtdUSD: 0.10,
        specializedCostUSD: 0,
        totalRealCostUSD: 0.10,
        potentialSavingsUSD: 0,
        isWasteful: false,
      },
    ];

    const recommendations = generateAzureMonitorRecommendations(testAlerts);
    expect(recommendations.length).toBeGreaterThan(0);

    const summary = calculateAzureMonitorSummary(testAlerts, recommendations);
    expect(summary.totalAlertsCount).toBe(3);
    expect(summary.enabledCount).toBe(3);
    expect(summary.disabledCount).toBe(0);
    expect(summary.logSearchDataProcessedGB).toBe(145.0);
    expect(summary.totalMonthlyCostUSD).toBeCloseTo(333.6, 1);
    expect(summary.potentialSavingsUSD).toBeGreaterThan(0);
  });

  it("should generate valid Azure CLI and PowerShell remediation scripts", () => {
    const action: AzureMonitorRemediationAction = {
      id: "rem-kql-1",
      resourceId:
        "/subscriptions/sub-1/resourceGroups/rg-monitoring/providers/microsoft.insights/scheduledqueryrules/alert-heavy-scan",
      resourceName: "alert-heavy-scan",
      title: "Optimizar Consulta KQL de Log Search Alert",
      description: "Reducir escaneo de telemetría KQL",
      category: "KQL_OPTIMIZE",
      estimatedSavingsUSD: 145.5,
      confidence: "HIGH",
      actionType: "OPTIMIZE_KQL_QUERY",
      recommendedQuery: "traces | where TimeGenerated > ago(5m)",
    };

    const command = buildAzureMonitorRemediationCommand(action);
    expect(command.cli).toContain("az monitor scheduled-query update");
    expect(command.cli).toContain("alert-heavy-scan");
    expect(command.cli).toContain("rg-monitoring");
    expect(command.powershell).toContain("Update-AzScheduledQueryRule");
  });
});
