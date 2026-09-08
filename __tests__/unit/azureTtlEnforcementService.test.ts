import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatDateIsoToLocal,
  computeTtlSummaryMetrics,
  getMockTtlSummaryMetrics,
} from "@/services/azureTtlEnforcement.service";
import {
  TtlPolicyItem,
  UntaggedTtlResourceItem,
  TtlTrackedResourceItem,
  TtlDeletionRecord,
} from "@/types/azureTtlEnforcement.types";

describe("Azure TTL Enforcement Service", () => {
  it("formatRelativeTime computes CRITICAL for expired dates, WARNING for <3 days, and ACTIVE for future dates", () => {
    const now = new Date("2026-08-20T12:00:00Z");

    const pastDate = new Date("2026-08-15T12:00:00Z");
    const warningDate = new Date("2026-08-21T18:00:00Z");
    const futureDate = new Date("2026-08-30T12:00:00Z");

    const pastResult = formatRelativeTime(pastDate, now);
    expect(pastResult.status).toBe("CRITICAL");
    // Clave + valor en vez del texto armado: el servicio no traduce, y asi la
    // asercion fija el numero exacto en lugar de un substring.
    expect(pastResult.key).toBe("relExpiredDays");
    expect(pastResult.value).toBe(5);

    const warnResult = formatRelativeTime(warningDate, now);
    expect(warnResult.status).toBe("WARNING");

    const futureResult = formatRelativeTime(futureDate, now);
    expect(futureResult.status).toBe("ACTIVE");
    expect(futureResult.key).toBe("relDueDays");
    expect(futureResult.value).toBe(10);
  });

  it("computeTtlSummaryMetrics accurately sums counts and potential savings", () => {
    const mockPolicies: TtlPolicyItem[] = [
      {
        id: "p1",
        name: "Policy 1",
        targetResourceType: "VIRTUALMACHINES",
        maxLifespanDays: 14,
        description: "Test policy",
        isEnabled: true,
        notifyDaysBefore: 3,
      },
      {
        id: "p2",
        name: "Policy 2",
        targetResourceType: "MANAGEDCLUSTERS",
        maxLifespanDays: 30,
        description: "Disabled policy",
        isEnabled: false,
        notifyDaysBefore: 3,
      },
    ];

    const mockTracked: TtlTrackedResourceItem[] = [
      {
        id: "r1",
        name: "vm-expired",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        expirationDateIso: "2026-08-10T00:00:00Z",
        formattedExpirationDate: "10/08/2026",
        relativeTimeKey: "relExpiredDays",
        relativeTimeValue: 10,
        status: "CRITICAL",
        monthlySavingsUSD: 100.0,
        isExempted: false,
      },
      {
        id: "r2",
        name: "vm-warn",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        expirationDateIso: "2026-08-21T00:00:00Z",
        formattedExpirationDate: "21/08/2026",
        relativeTimeKey: "relDueDays",
        relativeTimeValue: 1,
        status: "WARNING",
        monthlySavingsUSD: 50.0,
        isExempted: false,
      },
      {
        id: "r3",
        name: "vm-exempted-expired",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg1",
        subscriptionId: "sub1",
        subscriptionName: "Sub 1",
        expirationDateIso: "2026-08-01T00:00:00Z",
        formattedExpirationDate: "01/08/2026",
        relativeTimeKey: "relExpiredDays",
        relativeTimeValue: 20,
        status: "CRITICAL",
        monthlySavingsUSD: 80.0,
        isExempted: true, // Should be excluded from savings
      },
    ];

    const summary = computeTtlSummaryMetrics(mockPolicies, [], mockTracked, []);

    expect(summary.activePoliciesCount).toBe(1);
    expect(summary.expiredResourcesCount).toBe(1); // r1
    expect(summary.warningResourcesCount).toBe(1); // r2
    expect(summary.potentialSavingsMonthlyUSD).toBe(100.0); // only r1
  });

  it("getMockTtlSummaryMetrics generates robust structured metrics for demo tenants", () => {
    const mock = getMockTtlSummaryMetrics("demo_tenant");
    expect(mock.policies.length).toBeGreaterThan(0);
    expect(mock.trackedResources.length).toBeGreaterThan(0);
    expect(mock.untaggedResources.length).toBeGreaterThan(0);
    expect(mock.deletionHistory.length).toBeGreaterThan(0);
    expect(mock.expiredResourcesCount).toBeGreaterThan(0);
    expect(mock.potentialSavingsMonthlyUSD).toBeGreaterThan(0);
  });
});
