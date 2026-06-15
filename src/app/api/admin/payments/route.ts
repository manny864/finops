import { NextRequest, NextResponse } from "next/server";
import { getPaymentConfig, savePaymentConfig } from "@/lib/paymentConfig";

export async function GET(request: NextRequest) {
  try {
    const config = getPaymentConfig();
    return NextResponse.json({ success: true, config });
  } catch (err: any) {
    return NextResponse.json({ error: "No se pudo leer la configuración." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    savePaymentConfig(body);
    return NextResponse.json({ success: true, message: "Configuración guardada exitosamente." });
  } catch (err: any) {
    return NextResponse.json({ error: "Error guardando la configuración." }, { status: 500 });
  }
}
