import { getPaddleBaseUrl } from "@/lib/paddleTierMap";

export interface ResultadoPaddle {
  ok: boolean;
  status: number;
  /** `error.code` de Paddle cuando rechazó el pedido. */
  code?: string;
  detail?: string;
}

/**
 * Cancela una suscripción en Paddle (`POST /subscriptions/{id}/cancel`,
 * https://developer.paddle.com/api-reference/subscriptions/cancel-subscription). Requiere `subscription.write`.
 *
 * NO lanza si Paddle contesta con un rechazo: devuelve `{ ok: false, status, code, detail }` para que cada llamador decida
 * (una suscripción que ya estaba cancelada no es un error de un reembolso; sí lo es de un pedido del cliente). Lanza sólo si
 * falta la clave o el pedido no llegó a Paddle (red, timeout), que es el caso en que reintentar tiene sentido.
 */
export async function cancelarSuscripcion(
  subscriptionId: string,
  effectiveFrom: "immediately" | "next_billing_period"
): Promise<ResultadoPaddle> {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("Falta PADDLE_API_KEY en este entorno: no se puede cancelar en Paddle.");

  const res = await fetch(`${getPaddleBaseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ effective_from: effectiveFrom }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return { ok: true, status: res.status };
  const cuerpo: any = await res.json().catch(() => ({}));
  return { ok: false, status: res.status, code: cuerpo?.error?.code, detail: cuerpo?.error?.detail };
}
