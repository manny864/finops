/**
 * GET /api/billing/invoices/[id]/pdf — Factura de suscripción del tenant en PDF.
 *
 * Esta ruta no existía. El botón "Descargar PDF" del Historial de Facturas
 * apunta a `inv.downloadPdfUrl || /api/billing/invoices/${id}/pdf`, y ninguna
 * de las dos ramas resolvía: el dataset demo apuntaba a esta misma ruta
 * inexistente y en real el campo llega vacío. El 404 era para todos.
 *
 * Lee la MISMA fuente que la tabla (`getTenantBillingDetails`, que ya resuelve
 * isMockTenant) para que el documento no pueda decir un importe distinto al de
 * la fila que el usuario clickeó.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getTenantBillingDetails } from "@/services/saasBilling.service";
import { generateSubscriptionInvoicePdf } from "@/services/billingReport.service";

const LOCALES = ["es", "en", "pt-BR"];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");
    const localeParam = searchParams.get("locale") || "es";
    const locale = LOCALES.includes(localeParam) ? localeParam : "es";

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    const isDemo = isMockTenant(tenantId);
    // isMockTenant ANTES del guard, como el resto de las rutas.
    if (!isDemo) {
      await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
    }

    const billing = await getTenantBillingDetails(tenantId);
    const invoice = (billing.invoices || []).find((inv) => String(inv.id) === String(id));

    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    const pdf = generateSubscriptionInvoicePdf(
      invoice,
      isDemo ? "Demo Tenant" : tenantId,
      billing.planTier || "Professional",
      locale,
      isDemo
    );

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="CSCloudSolutions-${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
    console.error("[Billing] GET /invoices/[id]/pdf error:", error);
    return NextResponse.json({ error: "Error generando la factura PDF" }, { status: 500 });
  }
}
