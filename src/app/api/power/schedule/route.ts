import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import {
  upsertPowerSchedule,
  listPowerSchedules,
  deletePowerSchedule,
  executeDueSchedules,
} from "@/services/powerScheduleService";
import { effectiveOffsetMinutes, isValidTimeZone } from "@/lib/timezone";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_TYPES = new Set(["shutdown", "start", "restart"]);
// CSV de días ISO (1=Lunes..7=Domingo), sin espacios, ej. "1,2,3,4,5".
const DAYS_OF_WEEK_RE = /^[1-7](,[1-7]){0,6}$/;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator"]);

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
      actionType,
      shutdownTime,
      gmtOffset,
      timeZone,
      scheduleDate,
      daysOfWeek,
      smartShutdownEnabled,
      maxCpuPercentage,
      idleDurationMinutes,
    } = body || {};

    if (!tenantId || !subscriptionId || !resourceGroup || !vmName || !shutdownTime || !gmtOffset) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }
    if (!TIME_RE.test(shutdownTime)) {
      return NextResponse.json({ error: "Hora inválida (formato HH:MM)" }, { status: 400 });
    }
    if (!OFFSET_RE.test(gmtOffset)) {
      return NextResponse.json({ error: "gmtOffset inválido (formato +HH:MM o -HH:MM)" }, { status: 400 });
    }
    // La zona IANA es opcional para no romper clientes viejos, pero si viene
    // tiene que ser válida: una zona inventada haría que el schedule caiga
    // silenciosamente al offset fijo y se corra con el horario de verano.
    if (timeZone && !isValidTimeZone(timeZone)) {
      return NextResponse.json({ error: "timeZone inválida (se espera un nombre IANA, ej. Europe/Madrid)" }, { status: 400 });
    }
    if (actionType && !ACTION_TYPES.has(actionType)) {
      return NextResponse.json({ error: "actionType inválido (shutdown/start/restart)" }, { status: 400 });
    }
    if (scheduleDate && !DATE_RE.test(scheduleDate)) {
      return NextResponse.json({ error: "scheduleDate inválida (formato YYYY-MM-DD)" }, { status: 400 });
    }
    if (daysOfWeek && !DAYS_OF_WEEK_RE.test(daysOfWeek)) {
      return NextResponse.json({ error: "daysOfWeek inválido (CSV de días 1-7, ej. \"1,2,3,4,5\")" }, { status: 400 });
    }

    // Horario "one-off" (fecha específica, no recurrente): si la fecha+hora
    // local ya pasó, `executeDueSchedules` nunca lo va a considerar "debido"
    // (solo mira hacia adelante desde `nowUtc`, nunca hacia atrás) — antes
    // esto se guardaba en silencio y quedaba inválido para siempre, sin
    // ningún aviso (bug reportado: "el apagado/encendido calendarizado no
    // funciona"). Se rechaza acá con un mensaje claro en vez de aceptar un
    // horario que ya nació vencido.
    if (scheduleDate) {
      const [hh, mm] = String(shutdownTime).split(":").map((n: string) => parseInt(n, 10));
      const [y, mo, d] = scheduleDate.split("-").map((n: string) => parseInt(n, 10));
      const offsetMin = effectiveOffsetMinutes(timeZone, gmtOffset);
      const scheduledUtcMs = Date.UTC(y, mo - 1, d, hh, mm) - offsetMin * 60000;
      if (scheduledUtcMs <= Date.now()) {
        return NextResponse.json({
          error: "La fecha y hora elegidas ya pasaron. Como es un horario de fecha específica (no diario), nunca se va a ejecutar — elegí una fecha/hora futura.",
        }, { status: 400 });
      }
    }

    const identity = await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator"]);
    // Power Schedules es feature Business (ver Sidebar.tsx/routeTiers.ts). El
    // candado de tier era solo client-side — un Owner/Admin/Operator de un
    // tenant Professional podía crear/editar horarios pegándole
    // directo a esta ruta. La 2ª capa (rol de Azure Start/Stop VM del
    // onboarding) no cubre esto porque programar un horario no ejecuta nada
    // por sí solo hasta el próximo tick del cron.
    await requireTenantTier(request, tenantId, "Business");

    await upsertPowerSchedule({
      tenantId,
      subscriptionId,
      resourceGroup,
      vmName,
      actionType: ACTION_TYPES.has(actionType) ? actionType : "shutdown",
      shutdownTime,
      gmtOffset,
      timeZone: timeZone || null,
      scheduleDate: scheduleDate || null,
      daysOfWeek: daysOfWeek || null,
      smartShutdownEnabled: Boolean(smartShutdownEnabled),
      maxCpuPercentage: Number.isFinite(maxCpuPercentage) ? Number(maxCpuPercentage) : 10,
      idleDurationMinutes: Number.isFinite(idleDurationMinutes) ? Number(idleDurationMinutes) : 60,
      createdBy: identity.email || "unknown@tenant.local",
    });

    const schedules = await listPowerSchedules(tenantId);

    // Disparo oportunista: si el horario recién creado/editado ya está
    // "vencido" (dentro de la ventana de ejecución) en el momento de guardarlo
    // — ej. el usuario programó "dentro de 2 minutos" — no tiene sentido
    // esperar hasta el próximo tick del cron externo (cada pocos minutos, ver
    // crontab del VPS) para que se ejecute. No se espera esta llamada (no se
    // bloquea la respuesta al cliente): corre en background sobre el mismo
    // proceso Node persistente (no serverless), y cualquier error queda
    // logueado para que lo levante el próximo tick normal igual.
    executeDueSchedules().catch((err) => {
      console.error("[/api/power/schedule] Error en disparo inmediato post-guardado:", err);
    });

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

    await requireTenantRole(request, tenantId, ["Owner", "Admin", "Operator"]);

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
