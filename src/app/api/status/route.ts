import { NextResponse } from "next/server";
import { readPublicStatus } from "@/lib/publicStatus";

// PERIM-02: ruta anónima. No mide dependencias ni lee la query: sirve el último
// snapshot del cron `status-snapshot` desde una caché de clave fija. Sin
// snapshot válido responde 503 "unknown", nunca disponibilidad del 100%.

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(): Promise<NextResponse> {
  const status = await readPublicStatus();
  if (!status) {
    return NextResponse.json(
      { status: "unknown" },
      { status: 503, headers: { ...CORS, "Cache-Control": "no-store", "Retry-After": "30" } }
    );
  }
  return NextResponse.json(status, {
    headers: { ...CORS, "Cache-Control": "public, max-age=30" },
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}
