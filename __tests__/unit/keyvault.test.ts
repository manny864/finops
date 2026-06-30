import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock @/modules/storage/db ANTES de importar tenantCredentials.
vi.mock("@/modules/storage/db", () => {
  const query = vi.fn();
  return { default: { query } };
});

// Mock @azure/keyvault-secrets — el client real no debe correr en tests.
const kvSetSecret = vi.fn(async (_n: string, _v: string) => ({ value: _v }));
const kvGetSecret = vi.fn();
const kvBeginDelete = vi.fn(async () => ({ pollUntilDone: async () => {} }));
vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: class {
    getSecret = kvGetSecret;
    setSecret = kvSetSecret;
    beginDeleteSecret = kvBeginDelete;
  },
}));
vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {},
}));

const ORIGINAL_ENV = { ...process.env };
function enableKv() {
  process.env.AZURE_KEYVAULT_ENABLED = "true";
  process.env.AZURE_KEYVAULT_URL = "https://test.vault.azure.net";
  process.env.AZURE_KEYVAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
  process.env.AZURE_KEYVAULT_CLIENT_ID = "00000000-0000-0000-0000-000000000002";
  process.env.AZURE_KEYVAULT_CLIENT_SECRET = "fake-secret";
  // Disable disk cache encryption by removing the keys → loadDiskCache no-op.
  delete process.env.AZURE_KEYVAULT_CACHE_KEY;
  delete process.env.MFA_ENCRYPTION_KEY;
}
function disableKv() {
  process.env.AZURE_KEYVAULT_ENABLED = "false";
  delete process.env.AZURE_KEYVAULT_URL;
  delete process.env.AZURE_KEYVAULT_TENANT_ID;
  delete process.env.AZURE_KEYVAULT_CLIENT_ID;
  delete process.env.AZURE_KEYVAULT_CLIENT_SECRET;
}

beforeEach(async () => {
  kvGetSecret.mockReset();
  kvSetSecret.mockReset();
  kvBeginDelete.mockReset();
  vi.resetModules();
  // Reset DB mock too — the vi.fn() inside the factory persists across resetModules.
  const db = (await import("@/modules/storage/db")).default as any;
  db.query.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("normalizeSecretName", () => {
  it("genera nombres válidos para UUIDs", async () => {
    const { normalizeSecretName } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    expect(
      normalizeSecretName("8b41364f-581a-4e43-b7cb-13138dac5517", "client-id")
    ).toBe("tenant-8b41364f-581a-4e43-b7cb-13138dac5517-client-id");
    expect(
      normalizeSecretName(
        "8B41364F-581A-4E43-B7CB-13138DAC5517",
        "client-secret"
      )
    ).toBe("tenant-8b41364f-581a-4e43-b7cb-13138dac5517-client-secret");
  });

  it("colapsa caracteres no permitidos y guiones duplicados", async () => {
    const { normalizeSecretName } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    expect(normalizeSecretName("foo__bar..baz", "client-id")).toBe(
      "tenant-foo-bar-baz-client-id"
    );
  });

  it("rechaza input vacío o solo símbolos", async () => {
    const { normalizeSecretName } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    expect(() => normalizeSecretName("___", "client-id")).toThrow();
  });
});

describe("isKeyVaultEnabled", () => {
  it("false cuando AZURE_KEYVAULT_ENABLED no es 'true'", async () => {
    disableKv();
    const { isKeyVaultEnabled } = await import("@/lib/secrets/keyvault");
    expect(isKeyVaultEnabled()).toBe(false);
  });

  it("true cuando todas las vars están presentes y enabled=true", async () => {
    enableKv();
    const { isKeyVaultEnabled } = await import("@/lib/secrets/keyvault");
    expect(isKeyVaultEnabled()).toBe(true);
  });

  it("false si falta AZURE_KEYVAULT_CLIENT_SECRET aunque enabled=true", async () => {
    enableKv();
    delete process.env.AZURE_KEYVAULT_CLIENT_SECRET;
    const { isKeyVaultEnabled } = await import("@/lib/secrets/keyvault");
    expect(isKeyVaultEnabled()).toBe(false);
  });
});

describe("getTenantCredentials", () => {
  const TID = "8b41364f-581a-4e43-b7cb-13138dac5517";

  it("retorna desde KV cuando ambos secrets existen", async () => {
    enableKv();
    kvGetSecret.mockImplementation(async (name: string) => {
      if (name.endsWith("client-id")) return { value: "kv-client-id" };
      if (name.endsWith("client-secret")) return { value: "kv-client-secret" };
      throw new Error("unexpected");
    });
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds).toEqual({
      clientId: "kv-client-id",
      clientSecret: "kv-client-secret",
      source: "keyvault",
    });
  });

  it("fallback a DB si KV no tiene los secrets", async () => {
    enableKv();
    kvGetSecret.mockImplementation(async (_name: string) => {
      const err: any = new Error("not found");
      err.code = "SecretNotFound";
      err.statusCode = 404;
      throw err;
    });
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValueOnce([
      [{ client_id: "db-client-id", client_secret: "db-client-secret" }],
    ]);
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds).toEqual({
      clientId: "db-client-id",
      clientSecret: "db-client-secret",
      source: "database",
    });
  });

  it("fallback a DB si KV throws (network error)", async () => {
    enableKv();
    kvGetSecret.mockRejectedValue(new Error("network down"));
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValueOnce([
      [{ client_id: "db-fallback", client_secret: "db-fallback-secret" }],
    ]);
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds?.source).toBe("database");
    expect(creds?.clientId).toBe("db-fallback");
  });

  it("retorna null si ni KV ni DB tienen credenciales", async () => {
    enableKv();
    kvGetSecret.mockImplementation(async () => {
      const err: any = new Error("nf");
      err.code = "SecretNotFound";
      err.statusCode = 404;
      throw err;
    });
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValueOnce([[]]);
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds).toBeNull();
  });

  it("usa SOLO DB cuando KV está deshabilitado", async () => {
    disableKv();
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValueOnce([
      [{ client_id: "db-only", client_secret: "db-only-secret" }],
    ]);
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds?.source).toBe("database");
    expect(kvGetSecret).not.toHaveBeenCalled();
  });

  it("limpia comillas accidentales en valores de KV", async () => {
    enableKv();
    kvGetSecret.mockImplementation(async (name: string) => {
      if (name.endsWith("client-id")) return { value: '"abc-123"' };
      return { value: "  secret-x  " };
    });
    const { getTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    const creds = await getTenantCredentials(TID);
    expect(creds?.clientId).toBe("abc-123");
    expect(creds?.clientSecret).toBe("secret-x");
  });
});

describe("setTenantCredentials", () => {
  const TID = "8b41364f-581a-4e43-b7cb-13138dac5517";

  it("escribe en KV + DB cuando KV está habilitado", async () => {
    enableKv();
    kvSetSecret.mockResolvedValue({ value: "ok" });
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValue([{}]);
    const { setTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    await setTenantCredentials(TID, "new-id", "new-secret");
    expect(kvSetSecret).toHaveBeenCalledTimes(2);
    expect(kvSetSecret).toHaveBeenCalledWith(
      `tenant-${TID}-client-id`,
      "new-id"
    );
    expect(kvSetSecret).toHaveBeenCalledWith(
      `tenant-${TID}-client-secret`,
      "new-secret"
    );
    expect(db.query).toHaveBeenCalled(); // backup en DB
  });

  it("escribe SOLO en DB cuando KV está deshabilitado", async () => {
    disableKv();
    const db = (await import("@/modules/storage/db")).default as any;
    db.query.mockResolvedValue([{}]);
    const { setTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    await setTenantCredentials(TID, "x", "y");
    expect(kvSetSecret).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("rechaza input vacío", async () => {
    enableKv();
    const { setTenantCredentials } = await import(
      "@/lib/secrets/tenantCredentials"
    );
    await expect(setTenantCredentials(TID, "", "y")).rejects.toThrow();
    await expect(setTenantCredentials(TID, "x", "")).rejects.toThrow();
    await expect(setTenantCredentials("", "x", "y")).rejects.toThrow();
  });
});

describe("keyvault stale-while-revalidate", () => {
  const TID = "00000000-0000-0000-0000-00000000abcd";

  it("sirve desde cache stale cuando KV falla", async () => {
    enableKv();
    process.env.AZURE_KEYVAULT_CACHE_TTL_SECONDS = "1"; // fresh window: 1s
    process.env.AZURE_KEYVAULT_STALE_TTL_SECONDS = "3600";

    const kv = await import("@/lib/secrets/keyvault");
    kv._resetForTests();

    // Primer fetch: éxito.
    kvGetSecret.mockResolvedValueOnce({ value: "first-value" });
    const v1 = await kv.getSecret(`tenant-${TID}-client-id`);
    expect(v1).toBe("first-value");

    // Forzar expiración del fresh-window.
    kv._setCacheForTests(
      `tenant-${TID}-client-id`,
      "stale-value",
      Date.now() - 2000
    );

    // Segundo fetch: KV cae → debe servir stale.
    kvGetSecret.mockRejectedValueOnce(new Error("network down"));
    const v2 = await kv.getSecret(`tenant-${TID}-client-id`);
    expect(v2).toBe("stale-value");
  });

  it("propaga error si KV cae y no hay cache", async () => {
    enableKv();
    const kv = await import("@/lib/secrets/keyvault");
    kv._resetForTests();
    kvGetSecret.mockRejectedValueOnce(new Error("network down"));
    await expect(kv.getSecret(`tenant-${TID}-no-cache`)).rejects.toThrow(
      /network down/
    );
  });

  it("retorna null silenciosamente en 404", async () => {
    enableKv();
    const kv = await import("@/lib/secrets/keyvault");
    kv._resetForTests();
    kvGetSecret.mockRejectedValueOnce(
      Object.assign(new Error("nope"), {
        code: "SecretNotFound",
        statusCode: 404,
      })
    );
    const v = await kv.getSecret(`tenant-${TID}-missing`);
    expect(v).toBeNull();
  });
});
