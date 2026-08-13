/**
 * GET /api/intelligence/monitoring/alerts
 * Endpoint para listar alerts (mock data) - expandible para datos reales de Azure Monitor
 *
 * POST /api/intelligence/monitoring/alerts
 * Crear una nueva alerta
 *
 * PUT /api/intelligence/monitoring/alerts/[alertId]
 * Editar una alerta existente
 *
 * DELETE /api/intelligence/monitoring/alerts/[alertId]
 * Eliminar una alerta
 *
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

interface AlertConfig {
  id?: string;
  name: string;
  description: string;
  resourceGroup: string;
  region: string;
  type: string; // e.g., "Budget Alert", "Performance Alert", "Availability Alert"
  threshold: number;
  severity: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  notificationChannels?: string[];
  createdAt?: string;
  updatedAt?: string;
  monthlyCost?: number;
}

// Mock storage (in production, use database)
const mockAlerts = new Map<string, Map<string, AlertConfig>>();

function getMockAlerts(tenantId: string): AlertConfig[] {
  if (!mockAlerts.has(tenantId)) {
    mockAlerts.set(tenantId, new Map([
      ["alert-1", {
        id: "alert-1",
        name: "Budget Threshold Alert",
        description: "Alert when monthly cost exceeds $10,000",
        resourceGroup: "prod-rg",
        region: "eastus",
        type: "Budget Alert",
        threshold: 10000,
        severity: "high",
        enabled: true,
        notificationChannels: ["email"],
        createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
        updatedAt: new Date().toISOString(),
        monthlyCost: 0.50,
      }],
      ["alert-2", {
        id: "alert-2",
        name: "High CPU Usage Alert",
        description: "Alert when VM CPU exceeds 85%",
        resourceGroup: "prod-rg",
        region: "westus",
        type: "Performance Alert",
        threshold: 85,
        severity: "medium",
        enabled: true,
        notificationChannels: ["email", "teams"],
        createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
        updatedAt: new Date().toISOString(),
        monthlyCost: 0.30,
      }],
      ["alert-3", {
        id: "alert-3",
        name: "App Service Availability",
        description: "Alert when app availability drops below 99%",
        resourceGroup: "prod-rg",
        region: "eastus",
        type: "Availability Alert",
        threshold: 99,
        severity: "critical",
        enabled: false,
        notificationChannels: ["email"],
        createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        monthlyCost: 0.75,
      }],
    ]));
  }
  return Array.from(mockAlerts.get(tenantId)!.values());
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

    const alerts = getMockAlerts(tenantId);
    const totalMonthlyCost = alerts.reduce((sum, a) => sum + (a.monthlyCost || 0), 0);

    return NextResponse.json({
      resources: alerts,
      totalMonthlyCost,
      alertCount: alerts.length,
    });
  } catch (error) {
    console.error("[Monitoring Alerts] Error:", error);
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

    const body: AlertConfig = await request.json();
    const alertId = `alert-${Date.now()}`;
    const newAlert: AlertConfig = {
      ...body,
      id: alertId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockAlerts.get(tenantId)!.set(alertId, newAlert);
    return NextResponse.json(newAlert, { status: 201 });
  } catch (error) {
    console.error("[Monitoring Alerts] POST Error:", error);
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
    const alertId = searchParams.get("alertId");

    if (!tenantId || !alertId) {
      return NextResponse.json({ error: "Missing tenantId or alertId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const alerts = mockAlerts.get(tenantId);
    if (!alerts || !alerts.has(alertId)) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const body: Partial<AlertConfig> = await request.json();
    const existing = alerts.get(alertId)!;
    const updated: AlertConfig = {
      ...existing,
      ...body,
      id: alertId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    alerts.set(alertId, updated);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[Monitoring Alerts] PUT Error:", error);
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
    const alertId = searchParams.get("alertId");

    if (!tenantId || !alertId) {
      return NextResponse.json({ error: "Missing tenantId or alertId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId);
    }

    const alerts = mockAlerts.get(tenantId);
    if (!alerts || !alerts.has(alertId)) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    alerts.delete(alertId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Monitoring Alerts] DELETE Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
