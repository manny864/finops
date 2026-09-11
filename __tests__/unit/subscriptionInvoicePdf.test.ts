// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generateSubscriptionInvoicePdf } from "@/services/billingReport.service";
import type { SaaSInvoiceItem } from "@/types/saasBilling.types";

/**
 * El boton de Invoice History apuntaba a una ruta que no existia: en demo el
 * dataset traia downloadPdfUrl hacia esa misma ruta fantasma y en real el
 * campo llega vacio, asi que el 404 era para todos.
 *
 * Lo que puede romperse en silencio ahora es el ACUERDO entre la tabla y el
 * documento: el PDF toma el mismo SaaSInvoiceItem que pinta la fila, y si
 * alguien lo cambia por una fuente propia el importe deja de coincidir.
 */
const factura: SaaSInvoiceItem = {
    id: "inv-mock-0842",
    invoiceNumber: "INV-2026-0842",
    billingDateIso: "2026-08-01T00:00:00.000Z",
    formattedDate: "01/08/2026",
    amountUSD: 1200,
    status: "PAID",
};

const texto = (b: Buffer) => b.toString("latin1");

describe("factura de suscripcion en PDF", () => {
    it("produce un PDF valido con el numero y el importe de la fila", () => {
        const pdf = generateSubscriptionInvoicePdf(factura, "Demo Tenant", "Enterprise", "en");
        expect(texto(pdf).startsWith("%PDF-")).toBe(true);
        expect(pdf.length).toBeGreaterThan(1000);
        expect(texto(pdf)).toContain("INV-2026-0842");
        expect(texto(pdf)).toContain("Enterprise");
        expect(texto(pdf)).toContain("$1,200.00");
    });

    it("redacta en el idioma pedido", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "en"))).toContain("Subscription Invoice");
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "es"))).toContain("Factura de Suscripci");
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "pt-BR"))).toContain("Fatura de Assinatura");
    });

    it("traduce el estado y no lo imprime crudo", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "en"))).toContain("(Paid)");
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "es"))).toContain("(Pagada)");
    });

    /*
     * El aviso de demo va en el documento y no solo en la pantalla: el PDF se
     * descarga y circula suelto, sin el banner de "datos de ejemplo" al lado.
     * Y NO puede aparecer en una factura real.
     */
    it("marca el documento como demo solo cuando lo es", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "en", true))).toContain("DEMONSTRATION DOCUMENT");
        expect(texto(generateSubscriptionInvoicePdf(factura, "T", "Pro", "en", false))).not.toContain("DEMONSTRATION DOCUMENT");
    });
});
