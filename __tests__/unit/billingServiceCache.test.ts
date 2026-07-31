import { describe, it, expect, vi } from "vitest";
import { CostQueryDiagnostics } from "@/modules/collectors/azure/billingService";

describe("CostQueryDiagnostics & Throttling", () => {
  it("tracks throttling state when perSubErrors contain 429", () => {
    const diagnostics: CostQueryDiagnostics = {
      scopeAttempted: "/subscriptions/sub-123",
      isFallback: false,
      isThrottled: true,
      subsDiscovered: 1,
      subsSucceeded: 0,
      subsWithData: 0,
      perSubErrors: [
        { subscriptionId: "sub-123", code: "429", message: "Too Many Requests" }
      ],
      totalRows: 0,
      subsList: ["sub-123"],
      timeframeUsed: "MonthToDate"
    };

    expect(diagnostics.isThrottled).toBe(true);
    expect(diagnostics.totalRows).toBe(0);
    expect(diagnostics.perSubErrors[0].code).toBe("429");
  });

  it("handles non-throttled successful diagnostics", () => {
    const diagnostics: CostQueryDiagnostics = {
      scopeAttempted: "All",
      isFallback: false,
      isThrottled: false,
      subsDiscovered: 2,
      subsSucceeded: 2,
      subsWithData: 2,
      perSubErrors: [],
      totalRows: 15,
      subsList: ["sub-1", "sub-2"],
      timeframeUsed: "MonthToDate"
    };

    expect(diagnostics.isThrottled).toBe(false);
    expect(diagnostics.totalRows).toBe(15);
    expect(diagnostics.subsSucceeded).toBe(2);
  });
});
