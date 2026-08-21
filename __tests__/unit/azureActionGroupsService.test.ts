import { describe, it, expect } from "vitest";
import {
  deriveActionType,
  getMockActionGroupsPayload,
  calculateActionGroupsSummary,
  generateActionGroupsRecommendations,
  fetchLiveActionGroupsData,
} from "@/services/azureActionGroups.service";
import { buildActionGroupRemediationCommand } from "@/lib/aiRemediations";
import type { ActionGroupResource, ActionGroupRemediationAction } from "@/types/azureActionGroups.types";

describe("Azure Action Groups & Notification Governance Service", () => {
  it("should derive correct primary action type from channel counts", () => {
    expect(deriveActionType(2, 0, 0, 0, 0)).toBe("Email");
    expect(deriveActionType(0, 1, 0, 0, 0)).toBe("Webhook");
    expect(deriveActionType(0, 0, 1, 0, 0)).toBe("Logic App");
    expect(deriveActionType(0, 0, 0, 1, 0)).toBe("Azure Function");
    expect(deriveActionType(0, 0, 0, 0, 2)).toBe("SMS / Voz");
    expect(deriveActionType(2, 1, 0, 0, 0)).toBe("Multi-Canal");
    expect(deriveActionType(0, 0, 0, 0, 0)).toBe("Sin Destinatarios");
  });

  it("should generate mock Action Groups dataset for demo tenant with valid metrics and recommendations", () => {
    const payload = getMockActionGroupsPayload("demo-tenant-123");
    expect(payload.source).toBe("mock");
    expect(payload.actionGroups.length).toBeGreaterThan(5);
    expect(payload.summary.totalResourcesCount).toBe(payload.actionGroups.length);
    expect(payload.summary.breakdownByActionType.length).toBeGreaterThan(0);
    expect(payload.remediations.length).toBeGreaterThan(0);
    expect(payload.dailyTrend?.length).toBe(30);
    expect(payload.availableSubscriptions?.length).toBeGreaterThan(0);
  });

  it("should detect orphan groups, empty receivers, bounced emails, and failing webhooks in recommendations", () => {
    const actionGroups: ActionGroupResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/actionGroups/ag-orphan-test",
        name: "ag-orphan-test",
        location: "global",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Production Core",
        state: "Enabled",
        emailReceiversCount: 1,
        webhookReceiversCount: 0,
        logicAppReceiversCount: 0,
        functionReceiversCount: 0,
        specializedActionType: "Email",
        healthStatus: "Orphan",
        specializedCostUSD: 0,
        totalRealCostUSD: 0,
        potentialSavingsUSD: 0,
        iswasteful: true,
        bouncedEmailCount: 0,
        failedWebhookCount: 0,
        totalNotificationsMTD: 0,
        associatedAlertsCount: 0,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/actionGroups/ag-empty-test",
        name: "ag-empty-test",
        location: "global",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Production Core",
        state: "Enabled",
        emailReceiversCount: 0,
        webhookReceiversCount: 0,
        logicAppReceiversCount: 0,
        functionReceiversCount: 0,
        specializedActionType: "Sin Destinatarios",
        healthStatus: "Valid",
        specializedCostUSD: 0,
        totalRealCostUSD: 0,
        potentialSavingsUSD: 0.30,
        iswasteful: true,
        bouncedEmailCount: 0,
        failedWebhookCount: 0,
        totalNotificationsMTD: 0,
        associatedAlertsCount: 3,
      },
      {
        id: "/subscriptions/sub-2/resourceGroups/rg-dev/providers/microsoft.insights/actionGroups/ag-bounces-test",
        name: "ag-bounces-test",
        location: "global",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-2",
        subscriptionName: "Dev Core",
        state: "Enabled",
        emailReceiversCount: 4,
        webhookReceiversCount: 0,
        logicAppReceiversCount: 0,
        functionReceiversCount: 0,
        specializedActionType: "Email",
        healthStatus: "Invalid_Bounces",
        specializedCostUSD: 0,
        totalRealCostUSD: 0,
        potentialSavingsUSD: 0,
        iswasteful: false,
        bouncedEmailCount: 2,
        failedWebhookCount: 0,
        totalNotificationsMTD: 100,
        associatedAlertsCount: 2,
      },
      {
        id: "/subscriptions/sub-2/resourceGroups/rg-dev/providers/microsoft.insights/actionGroups/ag-failed-wh-test",
        name: "ag-failed-wh-test",
        location: "global",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-2",
        subscriptionName: "Dev Core",
        state: "Enabled",
        emailReceiversCount: 1,
        webhookReceiversCount: 1,
        logicAppReceiversCount: 0,
        functionReceiversCount: 0,
        specializedActionType: "Webhook",
        healthStatus: "Invalid_Endpoint_Error",
        specializedCostUSD: 0.50,
        totalRealCostUSD: 0.50,
        potentialSavingsUSD: 0,
        iswasteful: false,
        bouncedEmailCount: 0,
        failedWebhookCount: 12,
        totalNotificationsMTD: 40,
        associatedAlertsCount: 1,
      },
    ];

    const remediations = generateActionGroupsRecommendations(actionGroups);
    expect(remediations.length).toBeGreaterThanOrEqual(4);

    const orphanRem = remediations.find((r) => r.category === "ORPHAN_PURGE");
    expect(orphanRem).toBeDefined();

    const emptyRem = remediations.find((r) => r.category === "FIX_NOTIFICATION" && r.resourceName === "ag-empty-test");
    expect(emptyRem).toBeDefined();

    const bounceRem = remediations.find((r) => r.category === "FIX_NOTIFICATION" && r.resourceName === "ag-bounces-test");
    expect(bounceRem).toBeDefined();

    const failedWhRem = remediations.find((r) => r.category === "ENDPOINT_DEBUG");
    expect(failedWhRem).toBeDefined();

    const consolidateRem = remediations.find((r) => r.category === "EMAIL_CONSOLIDATE");
    expect(consolidateRem).toBeDefined();
  });

  it("should build accurate Azure CLI and PowerShell remediation commands", () => {
    const action: ActionGroupRemediationAction = {
      id: "rem-1",
      resourceId: "/subscriptions/sub-1/resourceGroups/rg-alerts/providers/microsoft.insights/actionGroups/ag-orphan-test",
      resourceName: "ag-orphan-test",
      title: "Eliminar Action Group huérfano",
      description: "Test description",
      category: "ORPHAN_PURGE",
      estimatedSavingsUSD: 0.00,
      confidence: "HIGH",
      actionType: "DELETE_ORPHAN_ACTION_GROUP",
    };

    const cmd = buildActionGroupRemediationCommand(action);
    expect(cmd.cli).toContain("az monitor action-group delete");
    expect(cmd.powershell).toContain("Remove-AzActionGroup");
  });

  it("should return empty valid live payload without fake mocks when tenant is live but has no credentials", async () => {
    const result = await fetchLiveActionGroupsData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.actionGroups).toEqual([]);
    expect(result.summary.totalResourcesCount).toBe(0);
    expect(result.summary.specializedCostUSD).toBe(0);
  });
});
