/**
 * GET /api/intelligence/security/key-vault
 * Azure Key Vault — Gobernanza de Identidades, Telemetria de API y FinOps
 *
 * RBAC: requireTenantTier(Business) para tenants reales; bypass para demo/mock.
 * `isMockTenant` corre ANTES del guard: la rama mock son literales sinteticos
 * puros, sin acceso a Azure, DB ni Redis. Tolerancia cero a fallback mock en
 * tenants conectados.
 *
 * RBAC Azure minimo: `Reader` (Resource Graph + metricas de Azure Monitor). No
 * se pide ningun rol de plano de datos: el servicio nunca lee el VALOR de un
 * secreto, solo metadata y telemetria del plano de control.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  fetchLiveKeyVaultData,
  getMockKeyVaultPayload,
} from "@/services/azureKeyVault.service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId parameter" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockKeyVaultPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Business");

    const payload = await fetchLiveKeyVaultData(tenantId);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Key Vault Governance] Error:", error);
    return NextResponse.json(
      { error: "Error interno procesando Azure Key Vault" },
      { status: 500 }
    );
  }
}
