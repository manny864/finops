import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import {
  upsertPowerSchedule,
  listPowerSchedules,
  deletePowerSchedule,
} from "@/services/powerScheduleService";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator", "Admin Cloud"]);

    const schedules = await listPowerSchedules(tenantId);
    return NextResponse.json({ success: true, schedules });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/power/schedule] GET error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tenantId,
      subscriptionId,
      resourceGroup,
      vmName,
      shutdownTime,
      gmtOffset,
      smartShutdownEnabled,
      maxCpuPercentage,
      idleDurationMinutes,
    } = body || {};

    if (!tenantId || !subscriptionId || !resourceGroup || !vmName || !shutdownTime || !gmtOffset) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }
    if (!TIME_RE.test(shutdownTime)) {
      return NextResponse.json({ error: "shutdownTime inválido (formato HH:MM)" }, { status: 400 });
    }
    if (!OFFSET_RE.test(gmtOffset)) {
      return NextResponse.json({ error: "gmtOffset inválido (formato +HH:MM o -HH:MM)" }, { status: 400 });
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator", "Admin Cloud"]);

    await upsertPowerSchedule({
      tenantId,
      subscriptionId,
      resourceGroup,
      vmName,
      shutdownTime,
      gmtOffset,
      smartShutdownEnabled: Boolean(smartShutdownEnabled),
      maxCpuPercentage: Number.isFinite(maxCpuPercentage) ? Number(maxCpuPercentage) : 10,
      idleDurationMinutes: Number.isFinite(idleDurationMinutes) ? Number(idleDurationMinutes) : 60,
      createdBy: identity.email || "unknown@tenant.local",
    });

    const schedules = await listPowerSchedules(tenantId);
    return NextResponse.json({ success: true, schedules });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/power/schedule] POST error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const idParam = searchParams.get("id");
    if (!tenantId || !idParam) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }
    const id = parseInt(idParam, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator", "Admin Cloud"]);

    await deletePowerSchedule(tenantId, id);
    const schedules = await listPowerSchedules(tenantId);
    return NextResponse.json({ success: true, schedules });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/power/schedule] DELETE error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
