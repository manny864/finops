import pool from "@/modules/storage/db";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";
import { cancelarSuscripcion } from "@/lib/paddleSubscriptions";
import { minorUnitsToDecimalString } from "@/lib/money";
import { registrarAuditoria } from "@/lib/auditTrail";

/**
 * Reembolsos de un cobro de Paddle: PROPORCIONALES (lo normal) o TOTALES (sólo SuperAdmin).
 *
 * PROPORCIONAL: se devuelve la parte del período que NO se usó. Los días usados van desde el pago hasta el pedido (cualquier
 * fracción de día cuenta como día usado) y el período es el que cubre el cobro; lo que se devuelve es
 * `total × (días del período − días usados) / días del período`, ítem por ítem y con impuestos incluidos (`tax_mode: internal` de
 * Paddle). Como lo devuelto es el tiempo no usado, aprobado el reembolso el servicio TERMINA (acceso cortado, módulo dado de baja,
 * suscripción cancelada), igual que en uno total. TOTAL: el cobro entero; lo elige el SuperAdmin.
 *
 * Quién los pide: el SuperAdmin (sin ventana) o un Admin/Owner del tenant, dentro de `VENTANA_REEMBOLSO_DIAS` desde el cobro.
 *
 * Esta pieza sólo PIDE el reembolso a Paddle (`POST /adjustments`,
 * https://developer.paddle.com/api-reference/adjustments/create-adjustment; requiere `adjustment.write`). Los EFECTOS en la
 * plataforma (marcar el cobro, revocar el módulo, cortar el acceso, comisiones) los aplica el webhook cuando Paddle lo APRUEBA
 * (`aplicarReembolsoAprobado`): en vivo la mayoría de los reembolsos nacen `pending_approval` y puede rechazarlos, y así también
 * quedan cubiertos los que se hacen desde el panel de Paddle sin pasar por acá. Mientras el pedido está pendiente, las comisiones de
 * ese cobro NO entran en una corrida de pago (`payoutRuns.service`).
 *
 * Estado del cobro en `BillingTransactions.status`: `completed` → `refund_pending` (pedido) → `refunded` (aprobado) o de vuelta a
 * `completed` (rechazado). No hay tabla nueva: el pedido y el efecto quedan en `SecurityAuditTrail`.
 */
export const VENTANA_REEMBOLSO_DIAS = 7;

export type MotivoNoReembolsable = "ya-reembolsado" | "en-proceso" | "fuera-de-ventana" | "no-cobrado" | "periodo-agotado" | "sin-periodo";
export type ModoReembolso = "proporcional" | "total";

export interface DatosProrrateo {
  diasPeriodo: number;
  diasUsados: number;
  /** Lo que se devuelve, en unidades mayores (ej. "269.99"). */
  monto: string;
}

export interface CobroReembolsable {
  transactionId: string;
  subscriptionId: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  billedAt: string | null;
  /** Add-on acreditado por este cobro, si lo hubo. */
  addonKey: string | null;
  reembolsable: boolean;
  motivo?: MotivoNoReembolsable;
  /** Lo que se devolvería en un reembolso proporcional hoy; ausente si no se puede calcular (ver `motivoProrrateo`). */
  prorrateo?: DatosProrrateo;
  motivoProrrateo?: "periodo-agotado" | "sin-periodo";
}

function errorHttp(mensaje: string, status: number): Error {
  return Object.assign(new Error(mensaje), { status });
}

const MS_DIA = 86_400_000;

interface LineaDelCobro {
  id: string;
  /** Total de la línea con impuestos, en unidad menor de la moneda (como lo manda Paddle). */
  totalMinor: number;
}

export type ResultadoProrrateo =
  | { ok: true; diasPeriodo: number; diasUsados: number; items: Array<{ item_id: string; amount: string }>; montoMinor: number }
  | { ok: false; motivo: "periodo-agotado" | "sin-periodo" };

/**
 * Cuánto se devuelve de un cobro por el tiempo que NO se usó. Pura: no toca la base ni Paddle.
 * Días usados = días desde el pago hasta el pedido, redondeando hacia ARRIBA (pedirlo a las 3 horas ya cuenta 1 día). Cada línea
 * devuelve `floor(total × días no usados / días del período)`, sin pasarse nunca de lo cobrado.
 */
export function calcularProrrateo(p: { billedAt: Date; periodo: { inicio: Date; fin: Date } | null; lineas: LineaDelCobro[]; ahora: number }): ResultadoProrrateo {
  if (!p.periodo || p.lineas.length === 0) return { ok: false, motivo: "sin-periodo" };
  const diasPeriodo = Math.round((p.periodo.fin.getTime() - p.periodo.inicio.getTime()) / MS_DIA);
  if (!(diasPeriodo >= 1)) return { ok: false, motivo: "sin-periodo" };

  const diasUsados = Math.max(0, Math.ceil((p.ahora - p.billedAt.getTime()) / MS_DIA));
  if (diasUsados >= diasPeriodo) return { ok: false, motivo: "periodo-agotado" };

  const noUsados = diasPeriodo - diasUsados;
  const items = p.lineas
    .map((l) => ({ item_id: l.id, minor: Math.floor((l.totalMinor * noUsados) / diasPeriodo) }))
    .filter((i) => i.minor > 0);
  if (items.length === 0) return { ok: false, motivo: "periodo-agotado" };

  return {
    ok: true,
    diasPeriodo,
    diasUsados,
    items: items.map((i) => ({ item_id: i.item_id, amount: String(i.minor) })),
    montoMinor: items.reduce((t, i) => t + i.minor, 0),
  };
}

function fechaValida(x: unknown): Date | null {
  if (typeof x !== "string") return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Líneas y período del cobro, del evento `transaction.completed` que guardamos (`raw_event`). El período es el `billing_period` de
 * la transacción (https://developer.paddle.com/webhooks/transactions/transaction-completed; viene `null` en un cobro único) y, si
 * no lo hay, la vigencia del pase que acreditó (`TenantAddons.starts_at`..`expires_at`).
 */
export function datosDelCobro(rawEvent: unknown, addon?: { startsAt?: unknown; expiresAt?: unknown } | null) {
  let raw: any = rawEvent;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const data = raw?.data;
  const lineas: LineaDelCobro[] = (Array.isArray(data?.details?.line_items) ? data.details.line_items : [])
    .map((l: any) => ({ id: l?.id, totalMinor: Number(l?.totals?.total) }))
    .filter((l: any) => typeof l.id === "string" && /^txnitm_/.test(l.id) && Number.isInteger(l.totalMinor) && l.totalMinor > 0);

  let inicio = fechaValida(data?.billing_period?.starts_at);
  let fin = fechaValida(data?.billing_period?.ends_at);
  if (!inicio || !fin || fin <= inicio) {
    inicio = addon?.startsAt ? new Date(addon.startsAt as any) : null;
    fin = addon?.expiresAt ? new Date(addon.expiresAt as any) : null;
  }
  const periodo = inicio && fin && !Number.isNaN(inicio.getTime()) && !Number.isNaN(fin.getTime()) && fin > inicio ? { inicio, fin } : null;
  return { lineas, periodo };
}


function motivoNoReembolsable(status: string, billedAt: Date | null, esSuperAdmin: boolean, ahora: number): MotivoNoReembolsable | undefined {
  if (status === "refunded") return "ya-reembolsado";
  if (status === "refund_pending") return "en-proceso";
  if (status !== "completed") return "no-cobrado";
  if (!esSuperAdmin && (!billedAt || ahora - billedAt.getTime() > VENTANA_REEMBOLSO_DIAS * MS_DIA)) return "fuera-de-ventana";
  return undefined;
}

export async function listarCobros(tenantId: string, esSuperAdmin: boolean): Promise<CobroReembolsable[]> {
  const [rows]: any = await pool.query(
    `SELECT bt.paddle_transaction_id AS transactionId, bt.paddle_subscription_id AS subscriptionId, bt.amount, bt.currency,
            bt.status, bt.billed_at AS billedAt, bt.raw_event AS rawEvent,
            a.addon_key AS addonKey, a.starts_at AS addonStartsAt, a.expires_at AS addonExpiresAt
       FROM BillingTransactions bt
       LEFT JOIN TenantAddons a ON a.tenant_id = bt.tenant_id AND a.paddle_transaction_id = bt.paddle_transaction_id
      WHERE bt.tenant_id = ? AND bt.paddle_transaction_id IS NOT NULL AND bt.status IN ('completed', 'refund_pending', 'refunded')
      ORDER BY bt.billed_at DESC, bt.id DESC
      LIMIT 50`,
    [tenantId]
  );
  const ahora = Date.now();
  return (Array.isArray(rows) ? rows : []).map((r: any) => {
    const billedAt = r.billedAt ? new Date(r.billedAt) : null;
    let motivo = motivoNoReembolsable(r.status, billedAt, esSuperAdmin, ahora);

    // Lo que se devolvería hoy por el tiempo no usado. El SuperAdmin puede igual pedir el total; un Admin/Owner sólo el proporcional.
    let prorrateo: DatosProrrateo | undefined;
    let motivoProrrateo: CobroReembolsable["motivoProrrateo"];
    if (billedAt && r.status === "completed") {
      const { lineas, periodo } = datosDelCobro(r.rawEvent, { startsAt: r.addonStartsAt, expiresAt: r.addonExpiresAt });
      const calculo = calcularProrrateo({ billedAt, periodo, lineas, ahora });
      if (calculo.ok) {
        prorrateo = { diasPeriodo: calculo.diasPeriodo, diasUsados: calculo.diasUsados, monto: montoMayor(calculo.montoMinor, r.currency) };
      } else {
        motivoProrrateo = calculo.motivo;
        if (!motivo && !esSuperAdmin) motivo = calculo.motivo;
      }
    }
    return {
      transactionId: r.transactionId,
      subscriptionId: r.subscriptionId ?? null,
      amount: r.amount ?? null,
      currency: r.currency ?? null,
      status: r.status,
      billedAt: billedAt ? billedAt.toISOString() : null,
      addonKey: r.addonKey ?? null,
      reembolsable: !motivo,
      ...(motivo ? { motivo } : {}),
      ...(prorrateo ? { prorrateo } : {}),
      ...(motivoProrrateo ? { motivoProrrateo } : {}),
    };
  });
}

/** Unidad menor → unidades mayores como texto ("26999" USD → "269.99"; JPY queda igual). */
function montoMayor(minor: number, currency?: string | null): string {
  return minorUnitsToDecimalString(String(minor), currency) ?? String(minor);
}

export interface PedidoReembolso {
  tenantId: string;
  transactionId: string;
  reason: string;
  email: string;
  esSuperAdmin: boolean;
  /** `total` sólo lo puede pedir un SuperAdmin; por omisión, proporcional. */
  modo?: ModoReembolso;
}

/** Pide a Paddle el reembolso del cobro (proporcional por defecto). Devuelve el ajuste creado; los efectos llegan por webhook. */
export async function solicitarReembolso(p: PedidoReembolso): Promise<{ adjustmentId: string; status: string; modo: ModoReembolso; monto?: string }> {
  const motivo = p.reason.trim();
  if (motivo.length < 5) throw errorHttp("Indicá el motivo del reembolso (al menos 5 caracteres).", 400);
  if (motivo.length > 500) throw errorHttp("El motivo no puede pasar de 500 caracteres.", 400);

  const modo: ModoReembolso = p.modo ?? "proporcional";
  if (modo !== "proporcional" && modo !== "total") throw errorHttp("modo debe ser 'proporcional' o 'total'.", 400);
  if (modo === "total" && !p.esSuperAdmin) throw errorHttp("Sólo un SuperAdmin puede pedir el reembolso total de un cobro.", 403);

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw errorHttp("Falta PADDLE_API_KEY en este entorno: no se puede pedir el reembolso a Paddle.", 500);

  // El cobro tiene que ser de ESTE tenant: `tenant_id` va en el WHERE, así que pedir el reembolso de un cobro ajeno da 404.
  const [rows]: any = await pool.query(
    `SELECT bt.id, bt.status, bt.billed_at, bt.currency, bt.raw_event, a.starts_at AS addon_starts_at, a.expires_at AS addon_expires_at
       FROM BillingTransactions bt
       LEFT JOIN TenantAddons a ON a.tenant_id = bt.tenant_id AND a.paddle_transaction_id = bt.paddle_transaction_id
      WHERE bt.tenant_id = ? AND bt.paddle_transaction_id = ? LIMIT 1`,
    [p.tenantId, p.transactionId]
  );
  const cobro = Array.isArray(rows) ? rows[0] : null;
  if (!cobro) throw errorHttp("No se encontró ese cobro en el tenant.", 404);

  const billedAt = cobro.billed_at ? new Date(cobro.billed_at) : null;
  const ahora = Date.now();
  const razon = motivoNoReembolsable(cobro.status, billedAt, p.esSuperAdmin, ahora);
  if (razon === "ya-reembolsado") throw errorHttp("Ese cobro ya fue reembolsado.", 409);
  if (razon === "en-proceso") throw errorHttp("Ese cobro ya tiene un reembolso en proceso.", 409);
  if (razon === "no-cobrado") throw errorHttp("Sólo se reembolsan cobros completados.", 409);
  if (razon === "fuera-de-ventana") {
    throw errorHttp(`Pasaron más de ${VENTANA_REEMBOLSO_DIAS} días desde el cobro: pedile el reembolso a soporte.`, 403);
  }

  // Lo que se pide a Paddle.
  let cuerpo: Record<string, unknown>;
  let resumen: string;
  let monto: string | undefined;
  if (modo === "total") {
    cuerpo = { type: "full" };
    resumen = "reembolso total";
  } else {
    const { lineas, periodo } = datosDelCobro(cobro.raw_event, { startsAt: cobro.addon_starts_at, expiresAt: cobro.addon_expires_at });
    const calculo = calcularProrrateo({ billedAt: billedAt as Date, periodo, lineas, ahora });
    if (!calculo.ok) {
      throw errorHttp(
        calculo.motivo === "periodo-agotado"
          ? "El período de este cobro ya se usó por completo: no queda nada que devolver."
          : "No se pudo calcular el período de este cobro: pedile el reembolso a soporte.",
        409
      );
    }
    monto = montoMayor(calculo.montoMinor, cobro.currency);
    cuerpo = { type: "partial", items: calculo.items.map((i) => ({ item_id: i.item_id, type: "partial", amount: i.amount })) };
    resumen = `reembolso proporcional de ${monto} ${cobro.currency ?? ""} (${calculo.diasUsados} de ${calculo.diasPeriodo} días usados)`.replace("  ", " ");
  }

  // Reserva atómica: dos pedidos a la vez no mandan dos reembolsos a Paddle.
  const [reserva]: any = await pool.query(
    "UPDATE BillingTransactions SET status = 'refund_pending' WHERE id = ? AND status = 'completed'",
    [cobro.id]
  );
  if (!reserva?.affectedRows) throw errorHttp("Ese cobro ya tiene un reembolso en proceso.", 409);

  const liberar = () => pool.query("UPDATE BillingTransactions SET status = 'completed' WHERE id = ? AND status = 'refund_pending'", [cobro.id]);

  let res: Response;
  try {
    res = await fetch(`${getPaddleBaseUrl()}/adjustments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refund",
        transaction_id: p.transactionId,
        reason: `[${p.email}] ${motivo}`,
        ...cuerpo,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    await liberar();
    throw errorHttp(`No se pudo contactar a Paddle: ${(e as Error)?.message || "error de red"}. Reintentá en un momento.`, 502);
  }

  if (!res.ok) {
    await liberar();
    const err: any = await res.json().catch(() => ({}));
    console.error("[Refunds] Paddle rechazó el reembolso:", res.status, err?.error?.code, err?.error?.detail);
    const detalle = err?.error?.detail || err?.error?.code;
    throw errorHttp(detalle ? `Paddle rechazó el reembolso: ${detalle}` : `Paddle rechazó el reembolso (HTTP ${res.status}).`, 502);
  }

  const data: any = await res.json();
  const adjustmentId: string = data?.data?.id;
  const status: string = data?.data?.status ?? "pending_approval";
  await registrarAuditoria(p.tenantId, "REFUND_REQUESTED", p.email, `Pedido de ${resumen}: txn ${p.transactionId}, ajuste ${adjustmentId} (${status}). Motivo: ${motivo}`);
  return { adjustmentId, status, modo, ...(monto ? { monto } : {}) };
}

/** Paddle rechazó un reembolso pendiente: el cobro vuelve a estar disponible. Idempotente. */
export async function liberarReembolsoRechazado(transactionId: string): Promise<void> {
  await pool.query("UPDATE BillingTransactions SET status = 'completed' WHERE paddle_transaction_id = ? AND status = 'refund_pending'", [transactionId]);
}

export interface EfectosReembolso {
  aplicado: boolean;
  addonRevocado: boolean;
  accesoCortado: boolean;
}

/**
 * Paddle APROBÓ un reembolso (o un contracargo) TOTAL: lo que el cliente ya no pagó deja de tenerse.
 *  - el cobro queda `refunded`;
 *  - si ese cobro acreditó un módulo, la fila de `TenantAddons` pasa a `cancelled` y, si era recurrente, se cancela su suscripción
 *    en Paddle (si no, el mes siguiente se cobra y el renovado vuelve a acreditar el módulo);
 *  - si es el ÚLTIMO cobro del plan del tenant, se corta el acceso ahora (`access_until = NOW()`) y se cancela la suscripción en
 *    Paddle (el `subscription.canceled` posterior deja el estado y la baja en el historial). Un cobro ANTERIOR no corta nada: ya
 *    se usó, y el período vigente sigue pago.
 *
 * Idempotente: `created` y `updated` del mismo ajuste, y los reintentos de Paddle, dan el mismo resultado. Si la cancelación en
 * Paddle falla por red o con 5xx, LANZA para que el webhook conteste 500 y Paddle reintente: el acceso ya quedó cortado y sin la
 * cancelación el cliente seguiría pagando. Un rechazo 4xx (ya estaba cancelada) se registra y se sigue.
 */
export async function aplicarReembolsoAprobado(transactionId: string, opciones: { soloSiPedido?: boolean } = {}): Promise<EfectosReembolso> {
  const [rows]: any = await pool.query(
    "SELECT tenant_id, paddle_subscription_id, status FROM BillingTransactions WHERE paddle_transaction_id = ? LIMIT 1",
    [transactionId]
  );
  const cobro = Array.isArray(rows) ? rows[0] : null;
  // Un reembolso PARCIAL sólo termina el servicio si lo pedimos nosotros por la vía proporcional (el cobro quedó `refund_pending`;
  // `refunded` cubre el reintento de un webhook que ya había marcado el cobro). Uno parcial hecho a mano en el panel de Paddle no
  // dice qué se quiere hacer con el servicio: sólo ajusta las comisiones.
  if (cobro && opciones.soloSiPedido && cobro.status !== "refund_pending" && cobro.status !== "refunded") {
    return { aplicado: false, addonRevocado: false, accesoCortado: false };
  }
  if (!cobro) {
    console.warn(`[Refunds] Reembolso aprobado de la txn ${transactionId}, que no está en BillingTransactions: no hay nada que aplicar.`);
    return { aplicado: false, addonRevocado: false, accesoCortado: false };
  }
  const tenantId: string = cobro.tenant_id;
  const subscriptionId: string | null = cobro.paddle_subscription_id ?? null;

  await pool.query("UPDATE BillingTransactions SET status = 'refunded' WHERE paddle_transaction_id = ?", [transactionId]);

  // Módulo del marketplace acreditado por este cobro.
  const [modulos]: any = await pool.query(
    "SELECT id, addon_key, addon_type FROM TenantAddons WHERE tenant_id = ? AND paddle_transaction_id = ? AND status = 'active'",
    [tenantId, transactionId]
  );
  const addons = Array.isArray(modulos) ? modulos : [];
  // Primero la cancelación en Paddle y DESPUÉS la fila: si Paddle falla y el webhook se reintenta, la fila sigue `active` y el
  // reintento vuelve a encontrar el módulo y a cancelar; al revés, el reintento no vería nada y la suscripción seguiría cobrando.
  if (addons.some((a: any) => a.addon_type === "recurring") && subscriptionId) {
    await cancelarOFallar(subscriptionId, "módulo recurrente reembolsado");
  }
  if (addons.length > 0) {
    await pool.query("UPDATE TenantAddons SET status = 'cancelled' WHERE tenant_id = ? AND paddle_transaction_id = ? AND status = 'active'", [tenantId, transactionId]);
  }
  const addonRevocado = addons.length > 0;

  // Plan: el último cobro de la suscripción que figura como la del tenant.
  let accesoCortado = false;
  if (subscriptionId && !addonRevocado) {
    const [plan]: any = await pool.query("SELECT 1 FROM Tenants WHERE tenant_id = ? AND paddle_subscription_id = ? LIMIT 1", [tenantId, subscriptionId]);
    if (Array.isArray(plan) && plan.length > 0) {
      const [ultimo]: any = await pool.query(
        `SELECT paddle_transaction_id FROM BillingTransactions
          WHERE paddle_subscription_id = ? AND status IN ('completed', 'refund_pending', 'refunded')
          ORDER BY billed_at DESC, id DESC LIMIT 1`,
        [subscriptionId]
      );
      if (Array.isArray(ultimo) && ultimo[0]?.paddle_transaction_id === transactionId) {
        await pool.query("UPDATE Tenants SET access_until = NOW() WHERE tenant_id = ?", [tenantId]);
        await cancelarOFallar(subscriptionId, "plan reembolsado");
        accesoCortado = true;
      }
    }
  }

  await registrarAuditoria(
    tenantId,
    "REFUND_APPLIED",
    "paddle-webhook",
    `Reembolso aprobado de la txn ${transactionId}: cobro marcado reembolsado${addonRevocado ? "; módulo revocado" : ""}${accesoCortado ? "; acceso cortado y suscripción cancelada" : ""}.`
  );
  return { aplicado: true, addonRevocado, accesoCortado };
}

async function cancelarOFallar(subscriptionId: string, motivo: string): Promise<void> {
  const r = await cancelarSuscripcion(subscriptionId, "immediately");
  if (r.ok) return;
  if (r.status >= 500) throw new Error(`Paddle no pudo cancelar ${subscriptionId} (${motivo}): HTTP ${r.status}`);
  // 4xx: lo habitual es que ya estuviera cancelada. Queda registrado por si no lo era.
  console.warn(`[Refunds] Paddle rechazó cancelar ${subscriptionId} (${motivo}): ${r.status} ${r.code ?? ""} ${r.detail ?? ""}`);
}
