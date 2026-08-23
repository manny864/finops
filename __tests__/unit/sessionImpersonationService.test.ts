import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startImpersonation,
  stopImpersonation,
  getImpersonationStatus,
  encodeSessionData,
  decodeSessionData,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";
import pool from "@/modules/storage/db";

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("Session Impersonation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Cookie Encoding and Decoding", () => {
    it("should encode and decode session data correctly", () => {
      const session = {
        isImpersonating: true,
        originalAdminUserId: "admin-1",
        originalAdminEmail: "admin@cscloudsolutions.com",
        targetTenantId: "tenant-client-123",
        targetTenantName: "Cliente Alpha Corp",
        startedAtIso: new Date().toISOString(),
        role: "TENANT_ADMIN",
      };

      const encoded = encodeSessionData(session);
      expect(typeof encoded).toBe("string");

      const decoded = decodeSessionData(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded?.isImpersonating).toBe(true);
      expect(decoded?.targetTenantId).toBe("tenant-client-123");
      expect(decoded?.targetTenantName).toBe("Cliente Alpha Corp");
    });

    it("should return null for invalid or corrupted cookie", () => {
      expect(decodeSessionData(null)).toBeNull();
      expect(decodeSessionData("")).toBeNull();
      expect(decodeSessionData("invalid-base64-random-string")).toBeNull();
    });
  });

  describe("startImpersonation", () => {
    it("should create session and set HTTP-only cookie for demo tenant", async () => {
      const result = await startImpersonation({
        originalAdminUserId: "super-1",
        originalAdminEmail: "super@cscloudsolutions.com",
        targetTenantId: "demo-enterprise",
      });

      expect(result.response.success).toBe(true);
      expect(result.response.session?.targetTenantId).toBe("demo-enterprise");
      expect(result.cookieOptions.name).toBe(IMPERSONATION_COOKIE_NAME);
      expect(result.cookieOptions.httpOnly).toBe(true);
      expect(result.cookieOptions.maxAge).toBeGreaterThan(0);
    });

    it("should query MySQL and log in AuditTrailLogs for real tenant", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("FROM Tenants")) {
          return [[{ name: "Acme Production", company_name: "Acme Corp" }]] as any;
        }
        if (sql.includes("INSERT INTO AuditTrailLogs")) {
          return [{ insertId: 1 }] as any;
        }
        return [[]] as any;
      });

      const result = await startImpersonation({
        originalAdminUserId: "super-2",
        originalAdminEmail: "admin@cscloudsolutions.com",
        targetTenantId: "tenant-real-acme",
      });

      expect(result.response.success).toBe(true);
      expect(result.response.session?.targetTenantName).toBe("Acme Corp");
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO AuditTrailLogs"),
        expect.any(Array)
      );
    });
  });

  describe("stopImpersonation", () => {
    it("should clear the cookie and log audit event", async () => {
      vi.mocked(pool.query).mockResolvedValueOnce([{ insertId: 2 }] as any);

      const currentSession = {
        isImpersonating: true,
        originalAdminUserId: "super-2",
        originalAdminEmail: "admin@cscloudsolutions.com",
        targetTenantId: "tenant-real-acme",
        targetTenantName: "Acme Corp",
        startedAtIso: new Date().toISOString(),
      };

      const result = await stopImpersonation({
        currentSession,
      });

      expect(result.response.success).toBe(true);
      expect(result.clearCookieOptions.name).toBe(IMPERSONATION_COOKIE_NAME);
      expect(result.clearCookieOptions.maxAge).toBe(0);
      expect(result.clearCookieOptions.value).toBe("");
    });
  });

  describe("getImpersonationStatus", () => {
    it("should return isImpersonating true when valid cookie is present", () => {
      const session = {
        isImpersonating: true,
        originalAdminUserId: "admin-1",
        originalAdminEmail: "admin@cscloudsolutions.com",
        targetTenantId: "tenant-1",
        targetTenantName: "Tenant Uno",
        startedAtIso: new Date().toISOString(),
      };
      const cookie = encodeSessionData(session);

      const status = getImpersonationStatus(cookie);
      expect(status.success).toBe(true);
      expect(status.isImpersonating).toBe(true);
      expect(status.session?.targetTenantId).toBe("tenant-1");
    });

    it("should return isImpersonating false when cookie is absent", () => {
      const status = getImpersonationStatus(undefined);
      expect(status.success).toBe(true);
      expect(status.isImpersonating).toBe(false);
      expect(status.session).toBeNull();
    });
  });
});
