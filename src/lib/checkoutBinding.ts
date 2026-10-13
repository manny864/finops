import crypto from "crypto";

/**
 * Vínculo firmado entre un checkout de Paddle y lo que se compró.
 *
 * POR QUÉ EXISTE. Paddle.js y el token de cliente son públicos: quien abre un checkout elige su `customData`. El webhook
 * leía de ahí a QUIÉN se acredita (`tenant_id`) y QUÉ (`addon_key`, `months`), así que alguien podía pagar el precio más
 * barato con `customData { tenant_id: <otro>, addon_key: <cualquiera>, months: 12 }` y (a) pisar el plan y la capacidad
 * de un tenant ajeno, o (b) quedarse con un módulo por años pagando un mes.
 *
 * QUÉ HACE. Las rutas del servidor que arman un checkout (autenticadas, con el tenant ya autorizado) agregan a su
 * `custom_data` una firma HMAC sobre (tenant, precio, add-on, tipo, meses, tier). El webhook sólo confía en un
 * `custom_data` cuya firma verifica Y cuyo precio firmado figura entre los ítems realmente pagados. Quien arma su propio
 * checkout no puede producir la firma; la de un checkout legítimo sólo sirve para ese mismo tenant y ese mismo precio.
 *
 * Paddle copia el `custom_data` de la transacción a la suscripción y de la suscripción a sus renovaciones
 * (https://developer.paddle.com/build/transactions/custom-data): la firma viaja con ellas sin hacer nada.
 *
 * La clave se deriva de PADDLE_WEBHOOK_SECRET (que el servidor ya tiene y Paddle no usa para esto) con una etiqueta de
 * propósito, así no se firma con el secreto crudo. Rotar ese secreto invalida los checkouts abiertos en ese momento: el
 * comprador tendría que reabrirlo.
 */
export interface VinculoCheckout {
  tenantId: string;
  priceId: string;
  addonKey?: string;
  addonType?: string;
  months?: number;
  tier?: string;
}

function clave(): Buffer {
  const secreto = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secreto) throw new Error("PADDLE_WEBHOOK_SECRET no está configurado: no se puede firmar el checkout.");
  return crypto.createHmac("sha256", secreto).update("finops/checkout-binding/v1").digest();
}

function canonico(v: VinculoCheckout): string {
  return JSON.stringify([v.tenantId, v.priceId, v.addonKey ?? "", v.addonType ?? "", String(v.months ?? ""), v.tier ?? ""]);
}

function firmar(v: VinculoCheckout): string {
  return crypto.createHmac("sha256", clave()).update(canonico(v)).digest("hex");
}

/** `custom_data` para el checkout: los campos que lee el webhook más `price_id` y `sig`. */
export function customDataFirmado(v: VinculoCheckout): Record<string, string | number> {
  return {
    tenant_id: v.tenantId,
    price_id: v.priceId,
    ...(v.addonKey ? { addon_key: v.addonKey } : {}),
    ...(v.addonType ? { addon_type: v.addonType } : {}),
    ...(v.months !== undefined ? { months: v.months } : {}),
    ...(v.tier ? { tier: v.tier } : {}),
    sig: firmar(v),
  };
}

/**
 * Devuelve el vínculo si `customData` trae una firma válida Y su precio está entre los pagados; si no, null.
 * Nunca lanza por un dato mal formado: un `custom_data` ajeno es un caso esperado, no un error.
 */
export function verificarVinculo(customData: unknown, preciosPagados: string[]): VinculoCheckout | null {
  const cd = customData as Record<string, unknown> | null | undefined;
  if (!cd || typeof cd !== "object") return null;
  const { tenant_id, price_id, sig } = cd;
  if (typeof tenant_id !== "string" || typeof price_id !== "string" || typeof sig !== "string") return null;
  if (!preciosPagados.includes(price_id)) return null;

  const texto = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
  const meses = cd.months === undefined || cd.months === null ? undefined : Number(cd.months);
  const v: VinculoCheckout = {
    tenantId: tenant_id,
    priceId: price_id,
    addonKey: texto(cd.addon_key),
    addonType: texto(cd.addon_type),
    months: meses,
    tier: texto(cd.tier),
  };

  const recibida = Buffer.from(sig, "hex");
  const esperada = Buffer.from(firmar(v), "hex");
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  return v;
}

/** Precios que el comprador pagó en un evento de transacción o suscripción de Paddle. */
export function preciosPagados(payload: any): string[] {
  const d = payload?.data;
  const ids: unknown[] = [
    ...(Array.isArray(d?.items) ? d.items.flatMap((i: any) => [i?.price?.id, i?.price_id]) : []),
    ...(Array.isArray(d?.details?.line_items) ? d.details.line_items.map((i: any) => i?.price_id) : []),
  ];
  return ids.filter((x): x is string => typeof x === "string");
}
