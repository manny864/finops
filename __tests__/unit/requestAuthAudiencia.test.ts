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

/**
 * Audiencia de los tokens: cada ambiente acepta SÓLO los de su propia app registration. Staging compila con la suya
 * (NEXT_PUBLIC_CLIENT_ID) y antes seguía aceptando la de prod porque el ID de prod estaba fijo en la lista de audiencias
 * permitidas: un token emitido para la app de prod servía contra la API de staging.
 */
const PROD_LOGIN = "876d8a5b-6023-4484-b3ba-73c186e4a72b";
const PROD_SERVIDOR = "07d029f8-4ae4-4a79-b45f-e67083f92b30";
const STAGING = "ebc0781f-bf47-45b8-b0a4-e7f19f69b4fa";
const tenantId = "11111111-1111-1111-1111-111111111111";
const targetTenantId = "22222222-2222-2222-2222-222222222222";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({ format: "jwk" }), kid: "audiencia-test", kty: "RSA" };

function conAudiencia(aud: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    tid: tenantId,
    oid: "user-oid",
    aud,
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    preferred_username: "reader@cscloudsolutions.com.ar",
  })).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return new NextRequest("https://example.com/api/dashboard/summary", { headers: { authorization: `Bearer ${header}.${payload}.${signature}` } });
}

const configurar = (env: Record<string, string>) => {
  for (const nombre of ["AZURE_CLIENT_ID", "AZURE_AD_CLIENT_ID", "NEXT_PUBLIC_AZURE_CLIENT_ID", "NEXT_PUBLIC_CLIENT_ID"]) vi.stubEnv(nombre, "");
  for (const [nombre, valor] of Object.entries(env)) vi.stubEnv(nombre, valor);
};

const aceptado = async (aud: string) => {
  query.mockResolvedValueOnce([[{ found: 1 }]]);
  await expect(requireTenantAccess(conAudiencia(aud), targetTenantId)).resolves.toMatchObject({ tenantId });
};
const rechazado = (aud: string) => expect(requireTenantAccess(conAudiencia(aud), targetTenantId)).rejects.toMatchObject({ status: 401, message: "Audiencia de token inválida." });

describe("audiencia de los tokens por ambiente", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sin variables de cliente (desarrollo local y CI) rige el ID por defecto de siempre", async () => {
    configurar({});
    await aceptado(PROD_LOGIN);
  });

  it("staging, con su app registration en NEXT_PUBLIC_CLIENT_ID y AZURE_CLIENT_ID, acepta SÓLO esa", async () => {
    configurar({ NEXT_PUBLIC_CLIENT_ID: STAGING, AZURE_CLIENT_ID: STAGING });
    await aceptado(STAGING);
    await aceptado(`api://${STAGING}`);
  });

  it("staging NO acepta un token emitido para la app de prod", async () => {
    configurar({ NEXT_PUBLIC_CLIENT_ID: STAGING, AZURE_CLIENT_ID: STAGING });
    await rechazado(PROD_LOGIN);
    await rechazado(`api://${PROD_LOGIN}`);
    await rechazado(PROD_SERVIDOR);
  });

  it("prod acepta su app de login y su app de servidor, y NO la de staging", async () => {
    configurar({ NEXT_PUBLIC_CLIENT_ID: PROD_LOGIN, AZURE_CLIENT_ID: PROD_SERVIDOR });
    await aceptado(PROD_LOGIN);
    await aceptado(PROD_SERVIDOR);
    await rechazado(STAGING);
  });

  it("con sólo el cliente de servidor puesto (sin el del navegador) sigue aceptando el ID por defecto del login, como antes", async () => {
    configurar({ AZURE_CLIENT_ID: PROD_SERVIDOR });
    await aceptado(PROD_LOGIN);
    await aceptado(PROD_SERVIDOR);
  });

  it("una audiencia cualquiera se rechaza", async () => {
    configurar({ NEXT_PUBLIC_CLIENT_ID: STAGING, AZURE_CLIENT_ID: STAGING });
    await rechazado("00000000-0000-0000-0000-000000000000");
  });
});
