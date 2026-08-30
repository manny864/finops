import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
  scanTagGovernanceLive,
  getMockTagGovernanceSummary,
  saveLocalCachedTags,
} from "@/services/azureTagGovernance.service";
import { applyTagInheritance } from "@/services/tagInheritanceService";
import { TagUpdatePayload } from "@/types/azureTagGovernance.types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const subscriptionId = searchParams.get("subscriptionId") || undefined;
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    // 1. Mock Tenant check PRIMERO
    if (isMock) {
      const mockData = getMockTagGovernanceSummary(tenantId);
      return NextResponse.json(mockData);
    }

    // 2. Tenant Real: Validación obligatoria de RBAC
    await requireTenantAccess(req, tenantId);

    const credential = await getAzureCredential(tenantId);
    let subs: string[] = [];
    if (subscriptionId && subscriptionId !== "All") {
      subs = [subscriptionId];
    } else {
      subs = await getSubscriptionsForTenant(tenantId);
    }

    const liveData = await scanTagGovernanceLive(credential, subs, tenantId);
    return NextResponse.json(liveData);
  } catch (err: any) {
    console.error("[api/governance/tags] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    const body = (await req.json()) as TagUpdatePayload;
    if (!body || !Array.isArray(body.resourceIds) || !body.tags) {
      return NextResponse.json({ error: "Invalid payload: resourceIds and tags are required" }, { status: 400 });
    }

    if (isMock) {
      // Demo mode: simulate success
      return NextResponse.json({
        success: true,
        message: `Etiquetas actualizadas correctamente (${body.resourceIds.length} recursos)`,
        updatedCount: body.resourceIds.length,
      });
    }

    // Escribir etiquetas MUTA el Azure del cliente, así que exige Admin/Owner —
    // no alcanza con ser miembro del tenant. Mismo criterio que
    // tags/apply-inheritance, /api/remediation y remediation/downgrade.
    // Antes era `requireTenantAccess`, lo cual era inocuo mientras esto sólo
    // escribía en una tabla local; en cuanto empieza a tocar Azure, dejarlo
    // abierto a cualquier miembro sería una escalada de privilegios.
    await requireTenantRole(req, tenantId, ["Admin", "Owner"]);
    // Escribir tags ES la remediación de etiquetas, feature Business: lo define
    // `canRemediateTags` (tierLogic.ts) nombrando esta misma pantalla, y ya lo
    // exigen las dos rutas que sí escribían en Azure (tags/apply y
    // apply-inheritance). No es sólo comercial: el rol Tag Contributor se le
    // asigna al SP recién desde Business (onboardingScriptTemplate.ts), así que
    // sin este guard un Professional recibiría un AuthorizationFailed opaco de
    // Azure en lugar de un mensaje claro de tier.
    await requireTenantTier(req, tenantId, "Business");

    // El PATCH real contra ARM. Antes esta ruta SÓLO hacía saveLocalCachedTags:
    // devolvía success y la UI decía "etiquetas aplicadas", pero el recurso en
    // Azure quedaba intacto — el bug reportado ("dice que etiqueta y no etiqueta
    // nada"). El camino de escritura ya existía en tagInheritanceService, que es
    // el que usa apply-inheritance; acá se reusa en vez de duplicarlo.
    const credential = await getAzureCredential(tenantId);
    const results = await applyTagInheritance(
      credential,
      body.resourceIds.map((resourceId) => ({ resourceId, tagsToMerge: body.tags })),
    );

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // La caché local guarda SOLO lo que Azure aceptó. Guardar también los
    // fallidos haría que la UI los muestre como conformes contra un Azure que
    // no cambió: exactamente la mentira que este fix elimina.
    for (const r of succeeded) {
      await saveLocalCachedTags(tenantId, r.resourceId, body.tags);
    }

    if (succeeded.length === 0 && results.length > 0) {
      return NextResponse.json(
        {
          error: `Azure rechazó el etiquetado de los ${results.length} recursos.`,
          details: failed[0]?.error,
          updatedCount: 0,
          failedCount: failed.length,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        failed.length > 0
          ? `Etiquetas aplicadas en Azure a ${succeeded.length} de ${results.length} recursos (${failed.length} fallaron).`
          : `Etiquetas aplicadas en Azure (${succeeded.length} recursos).`,
      updatedCount: succeeded.length,
      failedCount: failed.length,
      failures: failed.slice(0, 5).map((f) => ({ resourceId: f.resourceId, error: f.error })),
    });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    }
    console.error("[api/governance/tags:POST] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
