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
    invoiceNumber: "000842",
    billingDateIso: "2026-08-01T00:00:00.000Z",
    amount: 1200,
    currency: "USD",
    status: "PAID",
};

const TENANT = { name: "Acme Corp", id: "11111111-2222-3333-4444-555555555555" };
const texto = (b: Buffer) => b.toString("latin1");

describe("factura de suscripcion en PDF", () => {
    it("produce un PDF valido con el numero y el importe de la fila", () => {
        const pdf = generateSubscriptionInvoicePdf(factura, TENANT, "Enterprise", "en");
        expect(texto(pdf).startsWith("%PDF-")).toBe(true);
        expect(pdf.length).toBeGreaterThan(1000);
        expect(texto(pdf)).toContain("000842");
        expect(texto(pdf)).toContain("Enterprise");
        expect(texto(pdf)).toContain("$1,200.00");
    });

    it("«Facturado a» lleva el nombre de la empresa y el id del tenant", () => {
        const pdf = texto(generateSubscriptionInvoicePdf(factura, TENANT, "Business", "es"));
        expect(pdf).toContain("(FACTURADO A)");
        expect(pdf).toContain("Acme Corp");
        expect(pdf).toContain("ID del tenant: 11111111-2222-3333-4444-555555555555");
    });

    it("el número de factura es sólo numérico", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en"))).toContain("INVOICE # 000842");
    });

    it("con desglose muestra subtotal, impuestos y total; sin él, sólo el total", () => {
        const con = texto(generateSubscriptionInvoicePdf({ ...factura, subtotal: 1000, tax: 200, amount: 1200 }, TENANT, "Pro", "en"));
        expect(con).toContain("Subtotal $1,000.00");
        expect(con).toContain("Tax $200.00");
        expect(con).toContain("Total $1,200.00");
        const sin = texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en"));
        expect(sin).not.toContain("Subtotal $");
        expect(sin).not.toContain("Tax $");
    });

    it("trae la referencia de Paddle en la información de pago", () => {
        const pdf = texto(generateSubscriptionInvoicePdf({ ...factura, paddleTransactionId: "txn_01abc" }, TENANT, "Pro", "en"));
        expect(pdf).toContain("txn_01abc");
    });

    it("usa la moneda del cobro y traduce el reembolso", () => {
        const reembolsada: SaaSInvoiceItem = { ...factura, currency: "EUR", amount: 100.5, status: "REFUNDED" };
        const pdf = texto(generateSubscriptionInvoicePdf(reembolsada, TENANT, "Pro", "en"));
        expect(pdf).toContain("(Refunded)");
        expect(pdf).toContain("100.50");
        expect(pdf).not.toContain("$100.50");
    });

    it("redacta en el idioma pedido", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en"))).toContain("Subscription Invoice");
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "es"))).toContain("Factura de Suscripci");
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "pt-BR"))).toContain("Fatura de Assinatura");
    });

    it("traduce el estado y no lo imprime crudo", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en"))).toContain("(Paid)");
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "es"))).toContain("(Pagada)");
    });

    /*
     * El aviso de demo va en el documento y no solo en la pantalla: el PDF se
     * descarga y circula suelto, sin el banner de "datos de ejemplo" al lado.
     * Y NO puede aparecer en una factura real.
     */
    it("marca el documento como demo solo cuando lo es", () => {
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en", true))).toContain("DEMONSTRATION DOCUMENT");
        expect(texto(generateSubscriptionInvoicePdf(factura, TENANT, "Pro", "en", false))).not.toContain("DEMONSTRATION DOCUMENT");
    });
});
