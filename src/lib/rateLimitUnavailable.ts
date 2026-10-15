import { NextResponse } from "next/server";

/**
 * PERIM-06: la ruta usa cuota distribuida estricta (`failurePolicy: "reject"`)
 * y Redis no respondió. Es indisponibilidad, no un exceso confirmado: 503, no 429.
 */
export const RATE_LIMIT_UNAVAILABLE_HEADERS = { "Retry-After": "5", "Cache-Control": "no-store" };

export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Service temporarily unavailable" },
    { status: 503, headers: RATE_LIMIT_UNAVAILABLE_HEADERS }
  );
}
