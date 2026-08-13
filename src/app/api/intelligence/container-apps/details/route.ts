/**
 * GET /api/intelligence/container-apps/details
 * Obtiene detalles específicos de un Container App individual:
 * - Imagen desplegada
 * - Revisiones activas
 * - Configuración de scaling (KEDA rules)
 * - Métricas (CPU, memoria, réplicas)
 * - Ingress configuration
 * - Identidad administrada
 *
 * Query params:
 *   - tenantId: ID del tenant
 *   - subscriptionId: ID de suscripción
 *   - resourceGroup: Nombre del grupo de recursos
 *   - appName: Nombre del Container App
 *
 * RBAC: Same tier requirement as /api/intelligence/container-apps (Business+)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";

interface ContainerAppDetail {
  name: string;
  resourceGroup: string;
  region: string;
  state: string;
  provisioningState: string;
  image?: string;
  ingress?: {
    fqdn?: string;
    external: boolean;
    targetPort: number;
    transport: string;
  };
  replicas?: {
    minReplicas: number;
    maxReplicas: number;
    currentReplicas: number;
  };
  scaling?: {
    minReplicas: number;
    maxReplicas: number;
    rules?: Array<{
      name: string;
      ruleType: string;
      metadata?: Record<string, string>;
    }>;
  };
  managedIdentity?: {
    enabled: boolean;
    principalId?: string;
  };
  revisions?: Array<{
    name: string;
    active: boolean;
    creationTime: string;
    image: string;
  }>;
  environment?: string;
  cpu?: number;
  memory?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const subscriptionId = searchParams.get("subscriptionId");
    const resourceGroup = searchParams.get("resourceGroup");
    const appName = searchParams.get("appName");

    if (!tenantId || !subscriptionId || !resourceGroup || !appName) {
      return NextResponse.json(
        { error: "Missing required parameters: tenantId, subscriptionId, resourceGroup, appName" },
        { status: 400 }
      );
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantTier(request, tenantId, "Business");
    } else {
      await requireTenantAccess(request, tenantId);
    }

    // Mock data for demo tenants
    if (isMockTenant(tenantId)) {
      const mockDetail: ContainerAppDetail = {
        name: appName,
        resourceGroup,
        region: "eastus",
        state: "Running",
        provisioningState: "Succeeded",
        image: `mcr.microsoft.com/app:${Math.random().toString(36).substring(7)}`,
        ingress: {
          fqdn: `${appName}.eastus.azurecontainerapps.io`,
          external: true,
          targetPort: 8080,
          transport: "http",
        },
        replicas: {
          minReplicas: 1,
          maxReplicas: 10,
          currentReplicas: 3,
        },
        scaling: {
          minReplicas: 1,
          maxReplicas: 10,
          rules: [
            {
              name: "http-scaling",
              ruleType: "http",
              metadata: { concurrency: "100" },
            },
          ],
        },
        managedIdentity: {
          enabled: true,
          principalId: "00000000-0000-0000-0000-000000000000",
        },
        revisions: [
          {
            name: `${appName}--v1`,
            active: true,
            creationTime: new Date(Date.now() - 3600000).toISOString(),
            image: `mcr.microsoft.com/app:latest`,
          },
          {
            name: `${appName}--v0`,
            active: false,
            creationTime: new Date(Date.now() - 86400000).toISOString(),
            image: `mcr.microsoft.com/app:previous`,
          },
        ],
        environment: "production",
        cpu: 0.5,
        memory: 1.0,
      };

      return NextResponse.json(mockDetail);
    }

    // Real Azure API call
    const credential = await getAzureCredential(tenantId);
    if (!credential) {
      return NextResponse.json({ error: "Unable to obtain Azure credential" }, { status: 401 });
    }

    const apiVersion = "2024-03-01";
    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.App/containerApps/${encodeURIComponent(appName)}?api-version=${apiVersion}`;

    const token = await credential.getToken(["https://management.azure.com/.default"]);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Container App Details] Azure API error: ${response.status}`, errorBody);
      return NextResponse.json(
        { error: `Azure API error: ${response.status}` },
        { status: response.status }
      );
    }

    const azureApp = await response.json();

    // Extract relevant fields from Azure response
    const detail: ContainerAppDetail = {
      name: azureApp.name,
      resourceGroup: azureApp.properties?.resourceGroup || resourceGroup,
      region: azureApp.location || "-",
      state: azureApp.properties?.state || "Unknown",
      provisioningState: azureApp.properties?.provisioningState || "Unknown",
      image: azureApp.properties?.template?.containers?.[0]?.image,
      ingress: azureApp.properties?.ingress
        ? {
            fqdn: azureApp.properties.ingress.fqdn,
            external: azureApp.properties.ingress.external ?? false,
            targetPort: azureApp.properties.ingress.targetPort,
            transport: azureApp.properties.ingress.transport || "http",
          }
        : undefined,
      replicas: {
        minReplicas: azureApp.properties?.template?.scale?.minReplicas || 0,
        maxReplicas: azureApp.properties?.template?.scale?.maxReplicas || 10,
        currentReplicas: 0, // Not directly available; would need Azure Monitor
      },
      scaling: {
        minReplicas: azureApp.properties?.template?.scale?.minReplicas || 0,
        maxReplicas: azureApp.properties?.template?.scale?.maxReplicas || 10,
        rules: azureApp.properties?.template?.scale?.rules || [],
      },
      managedIdentity: azureApp.identity
        ? {
            enabled: azureApp.identity.type !== "None",
            principalId: azureApp.identity.principalId,
          }
        : undefined,
      environment: azureApp.properties?.managedEnvironmentId?.split("/").pop(),
      cpu: azureApp.properties?.template?.containers?.[0]?.resources?.cpu,
      memory: azureApp.properties?.template?.containers?.[0]?.resources?.memory,
    };

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[Container App Details] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
