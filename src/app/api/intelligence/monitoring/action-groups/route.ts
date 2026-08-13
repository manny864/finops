/**
 * GET /api/intelligence/monitoring/action-groups
 * Endpoint para listar action groups (mock data) - expandible para datos reales de Azure Monitor
 *
 * POST /api/intelligence/monitoring/action-groups
 * Crear un nuevo action group
 *
 * PUT /api/intelligence/monitoring/action-groups/[actionGroupId]
 * Editar un action group existente
 *
 * DELETE /api/intelligence/monitoring/action-groups/[actionGroupId]
 * Eliminar un action group
 *
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

interface ActionGroupConfig {
  id?: string;
  name: string;
  description: string;
  resourceGroup: string;
  region: string;
  enabled: boolean;
  receivers?: Array<{
    type: string; // email, sms, webhook, etc
    value: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
  monthlyCost?: number;
}

// Mock storage (in production, use database)
const mockActionGroups = new Map<string, Map<string, ActionGroupConfig>>();

function getMockActionGroups(tenantId: string): ActionGroupConfig[] {
  if (!mockActionGroups.has(tenantId)) {
    mockActionGroups.set(tenantId, new Map([
      ["ag-1", {
        id: "ag-1",
        name: "Production Alerts",
        description: "Action group for production environment alerts",
        resourceGroup: "prod-rg",
        region: "eastus",
        enabled: true,
        receivers: [
          { type: "email", value: "ops-team@company.com" },
          { type: "sms", value: "+1234567890" },
        ],
        createdAt: new Date(Date.now() - 86400000 * 45).toISOString(),
        updatedAt: new Date().toISOString(),
        monthlyCost: 0.50,
      }],
      ["ag-2", {
        id: "ag-2",
        name: "Development Team",
        description: "Action group for dev environment notifications",
        resourceGroup: "dev-rg",
        region: "westus",
        enabled: true,
        receivers: [
          { type: "email", value: "dev-team@company.com" },
        ],
        createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
        updatedAt: new Date().toISOString(),
        monthlyCost: 0.25,
      }],
      ["ag-3", {
        id: "ag-3",
        name: "Webhook Integration",
        description: "Send alerts to external webhook service",
        resourceGroup: "prod-rg",
        region: "eastus",
        enabled: false,
        receivers: [
          { type: "webhook", value: "https://webhook.example.com/alerts" },
        ],
        createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
        monthlyCost: 0.75,
      }],
    ]));
  }
  return Array.from(mockActionGroups.get(tenantId)!.values());
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const actionGroups = getMockActionGroups(tenantId);
    const totalMonthlyCost = actionGroups.reduce((sum, ag) => sum + (ag.monthlyCost || 0), 0);

    return NextResponse.json({
      resources: actionGroups,
      totalMonthlyCost,
      actionGroupCount: actionGroups.length,
    });
  } catch (error) {
    console.error("[Monitoring Action Groups] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const body: ActionGroupConfig = await request.json();
    const actionGroupId = `ag-${Date.now()}`;
    const newActionGroup: ActionGroupConfig = {
      ...body,
      id: actionGroupId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockActionGroups.get(tenantId)!.set(actionGroupId, newActionGroup);
    return NextResponse.json(newActionGroup, { status: 201 });
  } catch (error) {
    console.error("[Monitoring Action Groups] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const actionGroupId = searchParams.get("actionGroupId");

    if (!tenantId || !actionGroupId) {
      return NextResponse.json({ error: "Missing tenantId or actionGroupId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const actionGroups = mockActionGroups.get(tenantId);
    if (!actionGroups || !actionGroups.has(actionGroupId)) {
      return NextResponse.json({ error: "Action group not found" }, { status: 404 });
    }

    const body: Partial<ActionGroupConfig> = await request.json();
    const existing = actionGroups.get(actionGroupId)!;
    const updated: ActionGroupConfig = {
      ...existing,
      ...body,
      id: actionGroupId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    actionGroups.set(actionGroupId, updated);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[Monitoring Action Groups] PUT Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const actionGroupId = searchParams.get("actionGroupId");

    if (!tenantId || !actionGroupId) {
      return NextResponse.json({ error: "Missing tenantId or actionGroupId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const actionGroups = mockActionGroups.get(tenantId);
    if (!actionGroups || !actionGroups.has(actionGroupId)) {
      return NextResponse.json({ error: "Action group not found" }, { status: 404 });
    }

    actionGroups.delete(actionGroupId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Monitoring Action Groups] DELETE Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
