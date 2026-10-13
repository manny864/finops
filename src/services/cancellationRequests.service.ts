import pool from "@/modules/storage/db";
import { cancelarSuscripcion } from "@/lib/paddleSubscriptions";
import { registrarAuditoria } from "@/lib/auditTrail";
import { correoInternoDeCancelaciones } from "@/lib/billingAlerts";
import { getCancellationApprovalRequestEmailHtml, getCancellationResolvedEmailHtml, sendEmailAsync } from "@/lib/emailHelper";
import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";

/**
 * Solicitudes de cancelación que un SuperAdmin aprueba o rechaza.
 *
 * Una cancelación pedida por el cliente se ejecuta SOLA cuando el tenant tiene una suscripción de Paddle y Paddle acepta la baja
 * (`cancelTenantSubscription`). En los demás casos no hay nada que la ejecute, y antes sólo quedaba una marca en la base que nadie
 * veía. Esos casos (`MotivoSolicitud`) generan una solicitud PENDING que avisa al SuperAdmin por mail y espera su decisión:
 *  - `no-paddle-subscription`: alta manual o Enterprise, sin suscripción en Paddle.
 *  - `azure-marketplace`: factura Microsoft; la baja se gestiona por su canal.
 *  - `paddle-rejected`: Paddle rechazó el pedido de baja (el detalle queda en la solicitud).
 *
 * Mientras está PENDING el cliente conserva el servicio y ve su pedido «en revisión»: no se corta nada hasta que se apruebe.
 * Nunca se aprueba sola; si nadie responde, un recordatorio cada `DIAS_ENTRE_RECORDATORIOS` días (lo dispara el cron diario de
 * vencimientos).
 */
export type MotivoSolicitud = "no-paddle-subscription" | "azure-marketplace" | "paddle-rejected";
export type EstadoSolicitud = "PENDING" | "APPROVED" | "REJECTED";

export const DIAS_ENTRE_RECORDATORIOS = 3;

function errorHttp(mensaje: string, status: number): Error {
  return Object.assign(new Error(mensaje), { status });
}

const MS_DIA = 86_400_000;

/**
 * Reintenta una operación que MySQL abortó por un bloqueo (deadlock 1213 o espera agotada 1205). El `INSERT ... WHERE NOT EXISTS` de
 * `crearSolicitud` toma bloqueos de hueco: dos pedidos del mismo tenant a la vez pueden bloquearse entre sí y MySQL aborta uno. La
 * transacción abortada no deja nada (nunca hubo duplicados), pero el error le llegaba al cliente en vez de su solicitud. Medido contra
 * MySQL 8.0: 86 deadlocks en 750 pedidos simultáneos (30 por tenant). Al reintentar, el ganador ya existe y el `NOT EXISTS` lo ve.
 */
export async function reintentarSiHuboBloqueo<T>(operacion: () => Promise<T>, intentos = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await operacion();
    } catch (e: any) {
      const bloqueo = e?.errno === 1213 || e?.errno === 1205 || e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT";
      if (!bloqueo || i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 25));
    }
  }
}

/**
 * Crea la solicitud PENDING del tenant, o devuelve la que ya tenía (una sola abierta por tenant: pedirla dos veces no duplica el
 * aviso). El `INSERT ... WHERE NOT EXISTS` es la garantía; no hay un índice único porque MySQL no admite CASCADE en la FK de la
 * columna base de una columna generada.
 */
export async function crearSolicitud(p: { tenantId: string; requestedBy: string; reasonCode: MotivoSolicitud; detail?: string | null }): Promise<{ id: number; creada: boolean }> {
  const detalle = p.detail ? p.detail.slice(0, 1000) : null;
  const [res]: any = await reintentarSiHuboBloqueo(() =>
    pool.query(
      `INSERT INTO CancellationRequests (tenant_id, requested_by, reason_code, detail)
       SELECT ?, ?, ?, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING')`,
      [p.tenantId, p.requestedBy, p.reasonCode, detalle, p.tenantId]
    )
  );
  if (!res?.affectedRows) {
    const [abiertas]: any = await pool.query("SELECT id FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING' LIMIT 1", [p.tenantId]);
    return { id: Number(abiertas?.[0]?.id ?? 0), creada: false };
  }

  const id = Number(res.insertId);
  await registrarAuditoria(p.tenantId, "CANCELLATION_REQUEST_CREATED", p.requestedBy, `Solicitud de cancelación #${id} pendiente de aprobación (${p.reasonCode}).${detalle ? ` ${detalle}` : ""}`);
  await avisarAlSuperAdmin({ tenantId: p.tenantId, requestedBy: p.requestedBy, reasonCode: p.reasonCode, detail: detalle });
  return { id, creada: true };
}

async function avisarAlSuperAdmin(p: {
  tenantId: string;
  requestedBy: string;
  reasonCode: string;
  detail: string | null;
  recordatorio?: boolean;
  diasPendiente?: number;
  companyName?: string | null;
  tier?: string | null;
}): Promise<void> {
  try {
    let companyName = p.companyName ?? null;
    let tier = p.tier ?? null;
    if (companyName === null && tier === null) {
      const [t]: any = await pool.query("SELECT company_name, tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [p.tenantId]);
      companyName = t?.[0]?.company_name ?? null;
      tier = t?.[0]?.tier ?? null;
    }
    const html = getCancellationApprovalRequestEmailHtml({ ...p, companyName, tier });
    await sendEmailAsync(`${p.recordatorio ? "Recordatorio: cancelación" : "Cancelación"} pendiente de aprobación — ${companyName || p.tenantId}`, html, correoInternoDeCancelaciones());
  } catch (e) {
    console.error("[Cancelaciones] No se pudo avisar al SuperAdmin:", (e as Error)?.message);
  }
}

export interface SolicitudDeCancelacion {
  id: number;
  tenantId: string;
  companyName: string | null;
  tier: string | null;
  subscriptionStatus: string | null;
  accessUntil: string | null;
  tienePaddle: boolean;
  requestedBy: string;
  reasonCode: MotivoSolicitud;
  detail: string | null;
  status: EstadoSolicitud;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** Cuotas del comercial que todavía no son exigibles y que la baja cancelaría, y su monto. */
  cuotasPendientes: number;
  montoPendiente: string;
}

export async function listarSolicitudes(estado?: EstadoSolicitud): Promise<SolicitudDeCancelacion[]> {
  const [rows]: any = await pool.query(
    `SELECT r.id, r.tenant_id, r.requested_by, r.reason_code, r.detail, r.status, r.created_at, r.resolved_by, r.resolved_at, r.resolution_note,
            t.company_name, t.tier, t.subscription_status, t.access_until, t.paddle_subscription_id,
            (SELECT COUNT(*) FROM Commissions c WHERE c.tenant_id = r.tenant_id AND c.beneficiary_type = 'sales_rep' AND c.status = 'PENDING') AS cuotas_pendientes,
            (SELECT COALESCE(SUM(c.commission_amount), 0) FROM Commissions c WHERE c.tenant_id = r.tenant_id AND c.beneficiary_type = 'sales_rep' AND c.status = 'PENDING') AS monto_pendiente
       FROM CancellationRequests r
       JOIN Tenants t ON t.tenant_id = r.tenant_id
      WHERE (? IS NULL OR r.status = ?)
      ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC
      LIMIT 100`,
    [estado ?? null, estado ?? null]
  );
  const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    companyName: r.company_name ?? null,
    tier: r.tier ?? null,
    subscriptionStatus: r.subscription_status ?? null,
    accessUntil: iso(r.access_until),
    tienePaddle: Boolean(r.paddle_subscription_id),
    requestedBy: r.requested_by,
    reasonCode: r.reason_code,
    detail: r.detail ?? null,
    status: r.status,
    createdAt: iso(r.created_at) as string,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: iso(r.resolved_at),
    resolutionNote: r.resolution_note ?? null,
    cuotasPendientes: Number(r.cuotas_pendientes || 0),
    montoPendiente: String(r.monto_pendiente ?? "0"),
  }));
}

/** ¿Hay una solicitud de este tenant esperando decisión? Lo usa la pantalla de facturación del cliente («en revisión»). */
export async function tieneSolicitudPendiente(tenantId: string): Promise<boolean> {
  const [rows]: any = await pool.query("SELECT id FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING' LIMIT 1", [tenantId]);
  return Array.isArray(rows) && rows.length > 0;
}

export interface DecisionSolicitud {
  id: number;
  decision: "approve" | "reject";
  actor: string;
  nota?: string | null;
  /** Hasta cuándo conserva el acceso un tenant SIN suscripción de Paddle (YYYY-MM-DD). Con Paddle manda Paddle. */
  fechaEfectiva?: string | null;
  /** El SuperAdmin ya canceló la suscripción a mano en el panel de Paddle: no se la vuelve a pedir a Paddle. */
  omitirPaddle?: boolean;
}

/**
 * Aprueba o rechaza una solicitud PENDING.
 *
 * RECHAZAR exige un motivo y avisa al cliente; no toca nada más. APROBAR ejecuta la baja:
 *  - con suscripción de Paddle: la cancela al final del período (`next_billing_period`; el `subscription.canceled` posterior deja el
 *    estado y corta las comisiones). Si Paddle la rechaza, la solicitud sigue PENDING y el error llega al SuperAdmin; `omitirPaddle`
 *    es la salida cuando la canceló él a mano en Paddle.
 *  - sin suscripción de Paddle: nadie más va a emitir la baja, así que se registra acá (`CANCELED`, que también corta las cuotas del
 *    comercial no exigibles) y se fija hasta cuándo conserva el acceso. Si el tenant no tiene fecha de acceso, la fecha es obligatoria:
 *    sin ella la baja lo dejaría sin servicio al instante.
 * Se toma la solicitud con un UPDATE condicionado a `PENDING` antes de ejecutar nada: dos SuperAdmin a la vez no la ejecutan dos veces.
 * Si la ejecución falla, la solicitud vuelve a PENDING.
 */
export async function resolverSolicitud(d: DecisionSolicitud): Promise<{ id: number; estado: EstadoSolicitud }> {
  if (d.decision !== "approve" && d.decision !== "reject") throw errorHttp("decision debe ser 'approve' o 'reject'.", 400);
  const nota = (d.nota ?? "").trim();
  if (nota.length > 1000) throw errorHttp("La nota no puede pasar de 1000 caracteres.", 400);
  if (d.decision === "reject" && nota.length < 5) throw errorHttp("Indicá el motivo del rechazo (al menos 5 caracteres): se le informa al cliente.", 400);

  let fecha: string | null = null;
  if (d.fechaEfectiva) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEfectiva) || Number.isNaN(new Date(`${d.fechaEfectiva}T00:00:00Z`).getTime())) throw errorHttp("fechaEfectiva debe ser una fecha YYYY-MM-DD.", 400);
    if (new Date(`${d.fechaEfectiva}T23:59:59Z`).getTime() < Date.now()) throw errorHttp("fechaEfectiva no puede estar en el pasado.", 400);
    fecha = d.fechaEfectiva;
  }

  const [rows]: any = await pool.query(
    `SELECT r.id, r.tenant_id, r.requested_by, r.status, t.company_name, t.paddle_subscription_id, t.access_until
       FROM CancellationRequests r JOIN Tenants t ON t.tenant_id = r.tenant_id WHERE r.id = ? LIMIT 1`,
    [d.id]
  );
  const s = Array.isArray(rows) ? rows[0] : null;
  if (!s) throw errorHttp("No se encontró la solicitud.", 404);
  if (s.status !== "PENDING") throw errorHttp(`La solicitud ya fue resuelta (${s.status}).`, 409);

  const tienePaddle = Boolean(s.paddle_subscription_id);
  if (d.decision === "approve" && !tienePaddle && !s.access_until && !fecha) {
    throw errorHttp("Este tenant no tiene suscripción de Paddle ni fecha de acceso: indicá hasta cuándo conserva el acceso (fechaEfectiva).", 400);
  }

  const estadoFinal: EstadoSolicitud = d.decision === "approve" ? "APPROVED" : "REJECTED";
  const [tomada]: any = await pool.query(
    `UPDATE CancellationRequests SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution_note = ?, effective_date = ?
      WHERE id = ? AND status = 'PENDING'`,
    [estadoFinal, d.actor, nota || null, tienePaddle ? null : fecha, d.id]
  );
  if (!tomada?.affectedRows) throw errorHttp("La solicitud ya fue resuelta por otra persona.", 409);

  if (d.decision === "approve") {
    try {
      if (tienePaddle && !d.omitirPaddle) {
        const r = await cancelarSuscripcion(s.paddle_subscription_id, "next_billing_period");
        if (!r.ok) throw errorHttp(r.detail ? `Paddle no pudo programar la baja: ${r.detail}` : `Paddle no pudo programar la baja (HTTP ${r.status}).`, 502);
      }
      if (!tienePaddle && fecha) {
        await pool.query("UPDATE Tenants SET cancel_at_period_end = TRUE, access_until = ? WHERE tenant_id = ?", [`${fecha} 23:59:59`, s.tenant_id]);
      } else {
        await pool.query("UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?", [s.tenant_id]);
      }
      if (!tienePaddle) {
        await recordTenantLifecycleTransition(s.tenant_id, "CANCELED", { actor: d.actor, reason: "voluntary_churn", metadata: { cancellationRequestId: d.id } });
      }
    } catch (e) {
      await pool.query(
        "UPDATE CancellationRequests SET status = 'PENDING', resolved_by = NULL, resolved_at = NULL, resolution_note = NULL, effective_date = NULL WHERE id = ?",
        [d.id]
      );
      throw e;
    }
  }

  await registrarAuditoria(
    s.tenant_id,
    d.decision === "approve" ? "CANCELLATION_REQUEST_APPROVED" : "CANCELLATION_REQUEST_REJECTED",
    d.actor,
    `Solicitud de cancelación #${d.id} ${d.decision === "approve" ? "aprobada" : "rechazada"}.${nota ? ` ${nota}` : ""}`
  );
  await avisarAlSolicitante(s.requested_by, { companyName: s.company_name ?? null, aprobada: d.decision === "approve", note: nota || null, effectiveDate: !tienePaddle ? fecha : null });
  return { id: d.id, estado: estadoFinal };
}

async function avisarAlSolicitante(email: string, p: { companyName: string | null; aprobada: boolean; note: string | null; effectiveDate: string | null }): Promise<void> {
  if (!email || !email.includes("@")) return;
  try {
    await sendEmailAsync(p.aprobada ? "Tu cancelación fue aprobada" : "Tu solicitud de cancelación no fue aprobada", getCancellationResolvedEmailHtml(p), email);
  } catch (e) {
    console.error("[Cancelaciones] No se pudo avisar al solicitante:", (e as Error)?.message);
  }
}

/**
 * Recordatorio de las solicitudes que siguen PENDING pasados `DIAS_ENTRE_RECORDATORIOS` días desde el pedido o del último recordatorio.
 * Lo llama el cron diario de vencimientos: no hay cron propio. Nunca resuelve nada.
 */
export async function recordarSolicitudesPendientes(): Promise<{ recordadas: number }> {
  const [rows]: any = await pool.query(
    `SELECT r.id, r.tenant_id, r.requested_by, r.reason_code, r.detail, r.created_at, t.company_name, t.tier
       FROM CancellationRequests r JOIN Tenants t ON t.tenant_id = r.tenant_id
      WHERE r.status = 'PENDING' AND COALESCE(r.last_reminded_at, r.created_at) <= (NOW() - INTERVAL ${DIAS_ENTRE_RECORDATORIOS} DAY)
      ORDER BY r.created_at ASC LIMIT 50`
  );
  let recordadas = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    await avisarAlSuperAdmin({
      tenantId: r.tenant_id,
      requestedBy: r.requested_by,
      reasonCode: r.reason_code,
      detail: r.detail ?? null,
      recordatorio: true,
      diasPendiente: Math.max(1, Math.floor((Date.now() - new Date(r.created_at).getTime()) / MS_DIA)),
      companyName: r.company_name ?? null,
      tier: r.tier ?? null,
    });
    await pool.query("UPDATE CancellationRequests SET last_reminded_at = NOW() WHERE id = ? AND status = 'PENDING'", [r.id]);
    recordadas++;
  }
  return { recordadas };
}
