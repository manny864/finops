/**
 * PAL (Partner Admin Link): asocia nuestro Partner ID (MPN/PartnerID de
 * Partner Center) a las credenciales del Service Principal de FinOps
 * DENTRO del tenant del cliente, vía Azure Management API. Solo se ejecuta
 * tras la aprobación explícita del cliente (ver partner-link route).
 *
 * CPOR NO se automatiza acá: el claim se hace en Partner Center (por
 * workload, con evidencia y revisión de Microsoft); la aprobación
 * registrada en Tenants es la evidencia de consentimiento.
 *
 * Porteado de M365Proyect/saas/src/lib/partner/pal.ts, adaptado a las
 * credenciales por-tenant (ClientSecretCredential) de este proyecto en vez
 * de un app token de Graph.
 */

import { getAzureCredential } from "@/lib/azure";
import { getSecret, isKeyVaultEnabled } from "@/lib/secrets/keyvault";

const ARM_SCOPE = "https://management.azure.com/.default";
const ARM_BASE = "https://management.azure.com";
const API_VERSION = "2018-02-01";

export async function getPartnerId(): Promise<string | null> {
  if (isKeyVaultEnabled()) {
    try {
      // Backward-compatible lookup: algunos entornos históricos guardaron el
      // Partner ID con nombres distintos.
      const kvCandidates = [
        "finops-infra-partner-id",
        "partner-mpn-id",
        "partner-mpn",
      ];
      for (const secretName of kvCandidates) {
        const fromKv = await getSecret(secretName);
        if (fromKv?.trim()) return fromKv.trim();
      }
    } catch (e: unknown) {
      console.warn("[pal] KV no respondió para el Partner ID:", e instanceof Error ? e.message : String(e));
    }
  }
  const fromEnv =
    process.env.PARTNER_MPN_ID ??
    process.env.FINOPS_INFRA_PARTNER_ID ??
    process.env.PARTNER_ID ??
    null;
  return fromEnv?.trim() || null;
}

export interface PalResult {
  linked: boolean;
  detail: string;
  reason?: "NOT_CONFIGURED" | "CONFLICT" | "HTTP_ERROR";
}

/**
 * Vincula (o confirma) el PAL en el tenant del cliente. Idempotente:
 * si ya existe una asociación con nuestro ID la damos por vinculada; si
 * existe con OTRO ID no la pisamos (lo reportamos).
 */
export async function linkPal(azureTenantId: string): Promise<PalResult> {
  const partnerId = await getPartnerId();
  if (!partnerId) {
    return {
      linked: false,
      reason: "NOT_CONFIGURED",
      detail: "Partner ID no configurado (PARTNER_MPN_ID / FINOPS_INFRA_PARTNER_ID / finops-infra-partner-id)",
    };
  }

  const credential = await getAzureCredential(azureTenantId);
  const tokenResponse = await credential.getToken(ARM_SCOPE);
  const headers = { Authorization: "Bearer " + tokenResponse.token, "Content-Type": "application/json" };

  // ¿Ya hay una asociación para esta credencial en este tenant?
  const current = await fetch(
    `${ARM_BASE}/providers/Microsoft.ManagementPartner/partners/${partnerId}?api-version=${API_VERSION}`,
    { headers }
  );
  if (current.ok) {
    return { linked: true, detail: `PAL ya vinculado al Partner ID ${partnerId}` };
  }

  const res = await fetch(
    `${ARM_BASE}/providers/Microsoft.ManagementPartner/partners/${partnerId}?api-version=${API_VERSION}`,
    { method: "PUT", headers }
  );
  if (res.ok) {
    return { linked: true, detail: `PAL vinculado al Partner ID ${partnerId}` };
  }

  const body = await res.text();
  if (res.status === 409) {
    // Conflict: la credencial ya tiene OTRO partner asociado; no pisar.
    return {
      linked: false,
      reason: "CONFLICT",
      detail: `Ya existe otra asociación PAL para esta credencial (409): ${body.slice(0, 200)}`,
    };
  }
  return {
    linked: false,
    reason: "HTTP_ERROR",
    detail: `PAL falló (HTTP ${res.status}): ${body.slice(0, 250)}`,
  };
}
