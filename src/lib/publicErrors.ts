import crypto from "node:crypto";

/**
 * PERIM-09: errores de rutas públicas sin filtrar internals.
 *
 * `errorMessage` extrae el mensaje, no lo redacta: un error de driver, de SDK o de una
 * URL firmada puede traer SQL, passwords, SAS o tokens. Acá no se lee nunca `message`
 * ni `stack`: al cliente va un texto fijo con un `errorId` y al log, el mismo `errorId`
 * con la categoría (`code` o nombre de la clase), que alcanza para correlacionar.
 */

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

export function newErrorId(): string {
  return crypto.randomUUID();
}

/** `code` del error si es un identificador corto (ER_ACCESS_DENIED_ERROR, ECONNRESET), si no el nombre de la clase. */
export function errorCategory(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE.test(code)) return code;
    if (typeof code === "number" && Number.isInteger(code)) return String(code);
  }
  if (error instanceof Error && SAFE_CODE.test(error.name)) return error.name;
  return "UnknownError";
}

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { statusCode?: unknown; status?: unknown };
  const s = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : null;
  return s !== null && Number.isInteger(s) ? s : null;
}

/**
 * Registra el fallo sin mensaje ni stack y devuelve el `errorId` para la respuesta.
 * `label` es el prefijo del log, ej. `[mcp] get_budgets_status`.
 */
export function logSafeError(label: string, error: unknown, extra: Record<string, string | number | boolean> = {}): string {
  const errorId = newErrorId();
  const status = httpStatus(error);
  console.error(`${label} failed`, { errorId, category: errorCategory(error), ...(status ? { status } : {}), ...extra });
  return errorId;
}

/**
 * Causa accionable para quien llama, con texto FIJO elegido por código o status (nunca el
 * mensaje original). null si no es una causa conocida: entonces va el texto genérico.
 */
export function actionableCause(error: unknown): string | null {
  const category = errorCategory(error);
  if (category === "MISSING_RBAC_ROLE") return "Falta rol Lector en las suscripciones de Azure";
  const status = httpStatus(error);
  if (status === 429 || category === "TooManyRequests" || category === "RATE_LIMITED") {
    return "Azure limitó las solicitudes (429); reintentar más tarde";
  }
  if (status === 401 || status === 403 || category === "AuthorizationFailed") {
    return "Permisos insuficientes en Azure";
  }
  return null;
}
