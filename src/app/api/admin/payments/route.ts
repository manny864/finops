import { NextRequest, NextResponse } from "next/server";
import { getPaymentConfig, savePaymentConfig } from "@/lib/paymentConfig";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

function redact(v: string | undefined | null): string {
  if (!v) return "";
  if (v.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const config = getPaymentConfig();
    return NextResponse.json({
      success: true,
      config: {
        PADDLE_API_KEY: redact(config.PADDLE_API_KEY),
        PADDLE_WEBHOOK_SECRET: redact(config.PADDLE_WEBHOOK_SECRET),
        PADDLE_PRO_PRICE_ID: config.PADDLE_PRO_PRICE_ID,
        PADDLE_ENTERPRISE_PRICE_ID: config.PADDLE_ENTERPRISE_PRICE_ID,
        hasApiKey: !!config.PADDLE_API_KEY,
        hasWebhookSecret: !!config.PADDLE_WEBHOOK_SECRET,
      }
    });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "No se pudo leer la configuración." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json();
    // Sólo aceptamos campos conocidos para evitar inyección de claves arbitrarias.
    const sanitized: Record<string, string> = {};
    for (const k of ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_PRO_PRICE_ID", "PADDLE_ENTERPRISE_PRICE_ID"]) {
      if (typeof body?.[k] === "string" && body[k].length > 0) sanitized[k] = body[k];
    }
    savePaymentConfig(sanitized);
    return NextResponse.json({ success: true, message: "Configuración guardada exitosamente." });
  } catch (err: any) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Error guardando la configuración." }, { status: 500 });
  }
}
