import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { saveLocalCachedTags } from "@/services/azureTagGovernance.service";
import { applyTagInheritance, type ApplyOp } from "@/services/tagInheritanceService";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || "default";
    const isMock = isMockTenant(tenantId) || searchParams.get("mock") === "true";

    const body = await req.json();
    const resourceGroupId = body.resourceGroupId;
    const rgTags: Record<string, string> = body.rgTags || {};

    if (!resourceGroupId) {
      return NextResponse.json({ error: "resourceGroupId is required" }, { status: 400 });
    }

    if (isMock) {
      return NextResponse.json({
        success: true,
        message: `Etiquetas del Grupo de Recursos heredadas exitosamente a los recursos hijos`,
        inheritedCount: 12,
      });
    }

    // Propagar tags MUTA el Azure del cliente: Admin/Owner, igual que
    // tags/apply-inheritance. Era `requireTenantAccess` mientras esto sólo
    // escribía en la caché local.
    await requireTenantRole(req, tenantId, ["Admin", "Owner"]);
    // Misma feature Business que tags/apply y apply-inheritance: el rol Tag
    // Contributor del SP recién existe desde ese tier.
    await requireTenantTier(req, tenantId, "Business");
    const credential = await getAzureCredential(tenantId);
    const client = new ResourceGraphClient(credential);

    // Parse subscription and RG name from ID
    // ID format: /subscriptions/{subId}/resourceGroups/{rgName}
    const parts = resourceGroupId.split("/");
    const subIdx = parts.indexOf("subscriptions");
    const rgIdx = parts.indexOf("resourceGroups");
    const subId = subIdx !== -1 ? parts[subIdx + 1] : "";
    const rgName = rgIdx !== -1 ? parts[rgIdx + 1] : "";

    let updatedCount = 0;
    // Se acumulan y se aplican en lote: applyTagInheritance ya maneja
    // concurrencia y backoff ante 429 de ARM.
    const pendingOps: ApplyOp[] = [];
    const mergedByResource = new Map<string, Record<string, string>>();
    if (subId && rgName) {
      const query = `
        resources
        | where subscriptionId =~ '${subId}' and resourceGroup =~ '${rgName}'
        | project id, tags
      `;
      const res = await client.resources({ query, subscriptions: [subId] });
      if (Array.isArray(res.data)) {
        for (const r of res.data) {
          const resId = r.id;
          const currentTags = (r.tags && typeof r.tags === "object" ? r.tags : {}) as Record<string, string>;
          // Merge: only add tags from RG that are missing in child
          const mergedTags = { ...currentTags };
          let changed = false;
          for (const [k, v] of Object.entries(rgTags)) {
            if (!mergedTags[k] || mergedTags[k].trim() === "") {
              mergedTags[k] = v;
              changed = true;
            }
          }
          if (changed) {
            // Sólo las claves que faltaban: con `operation: Merge` alcanza el
            // delta y no se pisan las etiquetas propias del hijo.
            const delta: Record<string, string> = {};
            for (const [k, v] of Object.entries(mergedTags)) {
              if (currentTags[k] !== v) delta[k] = v;
            }
            pendingOps.push({ resourceId: resId, tagsToMerge: delta });
            mergedByResource.set(resId, mergedTags);
          }
        }
      }
    }

    // El PATCH real contra ARM. Antes este bucle sólo hacía saveLocalCachedTags:
    // reportaba "propagadas exitosamente" con Azure intacto.
    const results = await applyTagInheritance(credential, pendingOps);
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // La caché refleja únicamente lo que Azure aceptó.
    for (const r of succeeded) {
      const merged = mergedByResource.get(r.resourceId);
      if (merged) await saveLocalCachedTags(tenantId, r.resourceId, merged);
    }
    updatedCount = succeeded.length;

    if (succeeded.length === 0 && results.length > 0) {
      return NextResponse.json(
        {
          error: `Azure rechazó la propagación a los ${results.length} recursos hijos.`,
          details: failed[0]?.error,
          inheritedCount: 0,
          failedCount: failed.length,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        failed.length > 0
          ? `Etiquetas propagadas en Azure a ${updatedCount} de ${results.length} recursos (${failed.length} fallaron).`
          : `Etiquetas propagadas en Azure a ${updatedCount} recursos contenidos`,
      inheritedCount: updatedCount,
      failedCount: failed.length,
      failures: failed.slice(0, 5).map((f) => ({ resourceId: f.resourceId, error: f.error })),
    });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    }
    console.error("[api/governance/tags/inherit-rg] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
