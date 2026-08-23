import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeStorageRetentionCleanup,
  getRetentionDaysForTier,
  TIER_RETENTION_DAYS,
  BLOB_CONTAINER_REPORTS,
} from "@/services/storageRetentionCleaner.service";
import pool from "@/modules/storage/db";
import { deleteBlob } from "@/lib/azureBlobStorage";

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/azureBlobStorage", () => ({
  deleteBlob: vi.fn().mockResolvedValue(undefined),
  isBlobStorageEnabled: vi.fn().mockReturnValue(true),
}));

describe("Storage Retention Cleaner Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRetentionDaysForTier", () => {
    it("should return correct retention days per tier", () => {
      expect(getRetentionDaysForTier("Professional")).toBe(90);
      expect(getRetentionDaysForTier("pro")).toBe(90);
      expect(getRetentionDaysForTier("Business")).toBe(180);
      expect(getRetentionDaysForTier("Enterprise")).toBe(365);
      expect(getRetentionDaysForTier(null)).toBe(90);
    });
  });

  describe("executeStorageRetentionCleanup", () => {
    it("should identify expired reports and purge them", async () => {
      const now = Date.now();
      const ninetyFiveDaysAgo = new Date(now - 95 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(pool.query).mockImplementation(async (sql: string, params?: any) => {
        if (sql.includes("FROM Tenants")) {
          return [
            [
              { tenant_id: "tenant-pro", tier: "Professional" },
              { tenant_id: "tenant-ent", tier: "Enterprise" },
            ],
          ] as any;
        }
        if (sql.includes("FROM ExecutiveReportJobs")) {
          return [
            [
              {
                id: 1,
                tenant_id: "tenant-pro",
                scope_subscription_name: "Sub Pro 1",
                created_at: ninetyFiveDaysAgo,
                report_markdown: "# Markdown report with some bytes...",
                report_stored_name: "reports/tenant-pro/report_1.pdf",
              },
              {
                id: 2,
                tenant_id: "tenant-pro",
                scope_subscription_name: "Sub Pro 2",
                created_at: tenDaysAgo,
                report_markdown: "# Recent report...",
                report_stored_name: "reports/tenant-pro/report_2.pdf",
              },
            ],
          ] as any;
        }
        return [{ affectedRows: 1 }] as any;
      });

      const result = await executeStorageRetentionCleanup({ dryRun: false });

      expect(result.success).toBe(true);
      expect(result.totalCandidatesFound).toBe(1);
      expect(result.totalPurgedCount).toBe(1);
      expect(result.purgedReports?.[0].reportId).toBe("1");
      expect(result.purgedReports?.[0].planTier).toBe("Professional");

      // Verify blob deletions
      expect(deleteBlob).toHaveBeenCalledWith(
        BLOB_CONTAINER_REPORTS,
        "reports/tenant-pro/report_1.pdf"
      );
      expect(deleteBlob).toHaveBeenCalledWith(
        BLOB_CONTAINER_REPORTS,
        "reports/tenant-pro/report_1.json"
      );

      // Verify DB update
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE ExecutiveReportJobs SET deleted_at = NOW()"),
        [1]
      );
    });

    it("should respect dryRun mode without executing deletions", async () => {
      const now = Date.now();
      const twoHundredDaysAgo = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ tenant_id: "tenant-biz", tier: "Business" }]] as any;
        }
        if (sql.includes("FROM ExecutiveReportJobs")) {
          return [
            [
              {
                id: 50,
                tenant_id: "tenant-biz",
                created_at: twoHundredDaysAgo,
                report_markdown: "# Biz report",
                report_stored_name: "reports/tenant-biz/report_50.pdf",
              },
            ],
          ] as any;
        }
        return [{ affectedRows: 1 }] as any;
      });

      const result = await executeStorageRetentionCleanup({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.totalCandidatesFound).toBe(1);
      expect(result.totalPurgedCount).toBe(1);
      expect(deleteBlob).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE ExecutiveReportJobs SET deleted_at"),
        expect.anything()
      );
    });
  });
});
