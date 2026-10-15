/**
 * POST /api/unit-metrics/ingest
 * Ingesta programada del volumen de negocio para Unit Economics.
 *
 * AUTENTICACION POR API KEY, no por JWT de usuario. Este endpoint esta pensado
 * para que un pipeline de CI/CD o un cron del cliente envie el volumen diario
 * con cURL: un script no puede completar un flujo OAuth interactivo. Se reutiliza
 * `verifyApiKey` de src/lib/publicApiAuth.ts, que resuelve el tenant desde la
 * propia clave — de modo que el llamador NO puede elegir el tenantId, y el scope
 * requerido se valida con `requireScope`.
 *
 * Ejemplo:
 *   curl -X POST https://<host>/api/unit-metrics/ingest \
 *     -H "x-api-key: pak_..." -H "Content-Type: application/json" \
 *     -d '[{"metricDate":"2026-08-21","metricType":"TRANSACTIONS","unitCount":14320}]'
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey, requireScope, ApiError } from "@/lib/publicApiAuth";
import { invalidateCache } from "@/lib/cache";
import { errorMessage } from "@/lib/apiErrors";
import rateLimiter, { RateLimitUnavailable } from "@/lib/rateLimiter";
import { rateLimitUnavailableResponse } from "@/lib/rateLimitUnavailable";
import { preAuthAllowed, touchKeyLastUsed } from "@/lib/apiKeyGuards";
import { readJsonCapped, BodyLimitError } from "@/lib/readJsonCapped";
import {
  upsertBusinessUnits,
  validateIngestBatch,
} from "@/services/azureUnitEconomics.service";

/** Tope de filas por lote: mantiene acotado el trabajo por request. */
const MAX_BATCH = 400;
/** Tope de bytes del body (PERIM-03): 400 filas holgadas, sin JSON ilimitado en memoria. */
const MAX_BODY_BYTES = 256 * 1024;

function tooManyRequests(error: string) {
  return NextResponse.json({ error }, { status: 429, headers: { "Retry-After": "60" } });
}

export async function POST(request: NextRequest) {
  try {
    // Cuota estricta (PERIM-06): con Redis caído responde 503 en vez de
    // multiplicar el presupuesto de la clave por el número de réplicas.
    if (!(await preAuthAllowed(request, "apikey", "reject"))) {
      return tooManyRequests("Too many requests");
    }
    const auth = await verifyApiKey(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Se requiere una API key valida en el header x-api-key o Authorization: Bearer pak_..." },
        { status: 401 }
      );
    }
    // El scope de escritura se valida aparte: una clave de solo lectura no debe
    // poder alterar el denominador de las metricas de negocio. Convencion del
    // repo: verbo:recurso, igual que read:cost / read:resources en /api/v1.
    requireScope(auth, "write:metrics");

    // Misma clave de cuota que /api/v1: una API key tiene un único presupuesto
    // por minuto, y se cobra antes de leer el body o escribir en MySQL.
    const quota = await rateLimiter.checkByKeyDistributed(`apikey:${auth.keyId}`, auth.rateLimitPerMin, undefined, "reject");
    if (!quota.allowed) {
      return tooManyRequests("Rate limit exceeded");
    }
    touchKeyLastUsed("PublicApiKeys", auth.keyId);

    let body: unknown;
    try {
      body = await readJsonCapped(request, MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyLimitError) {
        return NextResponse.json(
          { error: e.status === 413 ? `El body excede ${MAX_BODY_BYTES} bytes` : "Body JSON invalido" },
          { status: e.status }
        );
      }
      throw e;
    }
    if (body === null) {
      return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
    }

    const items = Array.isArray(body) ? body : [body];
    if (items.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `El lote excede el maximo de ${MAX_BATCH} filas; dividirlo en varias llamadas` },
        { status: 413 }
      );
    }

    const { valid, rejected } = validateIngestBatch(items);

    let ingested = 0;
    const failed: Array<{ index: number; reason: string }> = [...rejected];
    for (let i = 0; i < valid.length; i++) {
      try {
        await upsertBusinessUnits({
          // El tenant sale de la API key, nunca del body: si viniera del cliente
          // seria un IDOR directo sobre las metricas de otro tenant.
          tenantId: auth.tenantId,
          metricDate: valid[i].metricDate,
          metricType: valid[i].metricType,
          unitCount: valid[i].unitCount,
          source: "Webhook",
        });
        ingested++;
      } catch (e) {
        failed.push({ index: i, reason: errorMessage(e, "Error al persistir la fila") });
      }
    }

    if (ingested > 0) {
      for (const w of [30, 90, 365]) {
        await invalidateCache(`unit_economics:v3:cost:${auth.tenantId}:${w}`).catch(() => {});
      }
    }

    // 207 cuando el lote fue parcial: el cliente necesita distinguir "todo bien"
    // de "algunas filas quedaron afuera" sin tener que parsear el cuerpo.
    const status = failed.length === 0 ? 200 : ingested > 0 ? 207 : 400;
    return NextResponse.json({ success: failed.length === 0, ingested, rejected: failed }, { status });
  } catch (error) {
    if (error instanceof RateLimitUnavailable) return rateLimitUnavailableResponse();
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Unit Metrics Ingest] Error:", error);
    return NextResponse.json({ error: "Error interno procesando la ingesta" }, { status: 500 });
  }
}
