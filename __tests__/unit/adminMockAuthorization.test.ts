// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantRole: vi.fn(),
  requireTenantTier: vi.fn(),
  portal: vi.fn(),
  audit: vi.fn(),
  publicKeys: vi.fn(),
  mcpKeys: vi.fn(),
}));

vi.mock("@/lib/requestAuth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/requestAuth")>();
  return { ...original, requireTenantRole: mocks.requireTenantRole, requireTenantTier: mocks.requireTenantTier };
});
vi.mock("@/services/saasBilling.service", () => ({ getCustomerPortalUrl: mocks.portal }));
vi.mock("@/services/auditTrail.service", () => ({ getAuditTrailLogs: mocks.audit, serializeAuditTrailCsv: vi.fn() }));
vi.mock("@/services/publicApiKey.service", () => ({ listPublicApiKeys: mocks.publicKeys, createPublicApiKey: vi.fn() }));
vi.mock("@/services/mcpApiKey.service", () => ({ listMcpKeys: mocks.mcpKeys, createMcpKey: vi.fn(), revokeMcpKey: vi.fn() }));

import { AuthError } from "@/lib/requestAuth";
import { GET as portal } from "@/app/api/admin/billing/customer-portal/route";
import { GET as audit } from "@/app/api/admin/audit-trail/export/route";
import { GET as publicKeys } from "@/app/api/admin/public-api-keys/route";
import { GET as mcpKeys } from "@/app/api/admin/mcp-keys/route";

describe("admin mock flag cannot bypass authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantRole.mockRejectedValue(new AuthError("Unauthorized", 401));
    mocks.requireTenantTier.mockRejectedValue(new AuthError("Unauthorized", 401));
  });

  it.each([
    ["billing/customer-portal", portal, mocks.portal],
    ["audit-trail/export", audit, mocks.audit],
    ["public-api-keys", publicKeys, mocks.publicKeys],
    ["mcp-keys", mcpKeys, mocks.mcpKeys],
  ] as const)("protects %s real tenant data with mock=true", async (path, handler, service) => {
    const request = new NextRequest(`https://example.com/api/admin/${path}?tenantId=11111111-1111-1111-1111-111111111111&mock=true`);
    const response = await handler(request);
    expect(response.status).toBe(401);
    expect(service).not.toHaveBeenCalled();
  });
});