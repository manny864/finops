import { NextRequest, NextResponse } from "next/server";
import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { errorMessage } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    const cacheKey = `recommendations:v1:${tenantId}:${subscriptionId || 'all'}`;
    const { unattachedDisks, unusedIps } = await getWithStaleWhileRevalidate(cacheKey, async () => {
        const resourceGraphClient = await getResourceGraphClient(tenantId);

        const disksQuery = `Resources | where type =~ 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project id, name, location, resourceGroup, subscriptionId, sku=sku.name, diskSizeGB=properties.diskSizeGB`;
        const ipsQuery = `Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup, subscriptionId`;

        const queryOptions: any = {};
        if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
            queryOptions.subscriptions = [subscriptionId];
        } else {
            const credential = await getAzureCredential(tenantId);
            queryOptions.subscriptions = await getSubscriptionsForTenant(tenantId, credential);
        }

        let unattachedDisks = [];
        let unusedIps = [];

        try {
          const diskResponse = await resourceGraphClient.resources({
            query: disksQuery,
            ...queryOptions
          });
          unattachedDisks = diskResponse.data || [];
        } catch (e) {
          console.error("Resource Graph Query Disks Error", e);
          throw new Error(`Fallo en Query Disks: ${errorMessage(e)}`);
        }

        try {
          const ipResponse = await resourceGraphClient.resources({
            query: ipsQuery,
            ...queryOptions
          });
          unusedIps = ipResponse.data || [];
        } catch (e) {
          console.error("Resource Graph Query IPs Error", e);
          throw new Error(`Fallo en Query IPs: ${errorMessage(e)}`);
        }

        return { unattachedDisks, unusedIps };
    }, 1800, 600);

    return NextResponse.json({
        success: true,
        tenantId,
        mode: subscriptionId ? "single-subscription" : "tenant-wide",
        unattachedDisks,
        unusedIps
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const err = error as { message?: string; code?: string; name?: string; statusCode?: number; status?: number };
    const errorMessage = err?.message || String(error);
    const errorCode = err?.code || err?.name || "";
    const errorStatus = err?.statusCode || err?.status || 0;

    console.error(`[Recommendations] ERROR capturado:`, {
      name: err?.name,
      code: errorCode,
      statusCode: errorStatus,
      message: errorMessage,
    });

    if (errorMessage.includes("AADSTS7000215") || errorMessage.includes("invalid_client") || errorMessage.includes("Invalid client secret")) {
      return NextResponse.json({
        error: "INVALID_CLIENT_SECRET",
        details: "El Client Secret de la aplicación Azure AD es inválido o ha expirado. Genere uno nuevo en Azure Portal > App Registrations > Certificates & secrets."
      }, { status: 401 });
    }

    if (errorCode === "AccessDenied" || errorStatus === 403 || errorMessage.includes("AccessDenied") || errorMessage.includes("AuthorizationFailed")) {
      return NextResponse.json({ error: "MISSING_RBAC_ROLE", details: "La aplicación no tiene permisos de Lector." }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
