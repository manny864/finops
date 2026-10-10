// @vitest-environment node
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, alcanceDelUsuario } = vi.hoisted(() => ({
  query: vi.fn(),
  alcanceDelUsuario: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({ default: { query } }));
vi.mock("@/services/userScope.service", () => ({ alcanceDelUsuario }));

import { requireTenantAccess } from "@/lib/requestAuth";

const tenantId = "11111111-1111-1111-1111-111111111111";
const targetTenantId = "22222222-2222-2222-2222-222222222222";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "tenant-access-test", kty: "RSA" };

function request() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    tid: tenantId,
    oid: "user-oid",
    aud: "876d8a5b-6023-4484-b3ba-73c186e4a72b",
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    preferred_username: "reader@cscloudsolutions.com.ar",
  })).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return new NextRequest("https://example.com/api/dashboard/summary", {
    headers: { authorization: `Bearer ${header}.${payload}.${signature}` },
  });
}

describe("requireTenantAccess corporate authorization", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([[]]);
    alcanceDelUsuario.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("openid-configuration")
        ? { issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`, jwks_uri: "https://example.com/jwks" }
        : { keys: [key] },
    ), { status: 200 })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("denies corporate users without membership or SUPERADMIN and never promotes them", async () => {
    await expect(requireTenantAccess(request(), targetTenantId)).rejects.toMatchObject({
      status: 403, code: "TENANT_ACCESS_MISSING_SUPERADMIN_ROLE",
    });
    expect(query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("denies access when the membership lookup fails", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(requireTenantAccess(request(), targetTenantId)).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("preserves explicit tenant membership", async () => {
    query.mockResolvedValueOnce([[{ found: 1 }]]);
    await expect(requireTenantAccess(request(), targetTenantId)).resolves.toMatchObject({ tenantId });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicitly assigned SUPERADMIN role", async () => {
    query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ found: 1 }]]);
    await expect(requireTenantAccess(request(), targetTenantId)).resolves.toMatchObject({ tenantId });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("honors allowSuperAdmin false even for corporate users", async () => {
    await expect(requireTenantAccess(request(), targetTenantId, { allowSuperAdmin: false }))
      .rejects.toMatchObject({ status: 403, code: "TENANT_ACCESS_SUPERADMIN_DISABLED" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});