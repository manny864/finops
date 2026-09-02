// @vitest-environment node
import { describe, it, expect } from "vitest";
import { filterByLifecycleRange, buildLifecycleCsv, tenureInMonths } from "@/lib/tenantLifecycleReport";
import type { SuperAdminTenantItem } from "@/types/superAdminTenants.types";

const t = (over: Partial<SuperAdminTenantItem>): SuperAdminTenantItem => ({
    tenantId: "id-1", entraTenantId: "id-1", organizationName: "Acme",
    subscriptionStatus: "ACTIVE", planTier: "Enterprise",
    salesRepName: "Directo", salesCommissionPercent: 0,
    isManualBypass: false, createdAtIso: "2026-01-01T00:00:00.000Z",
    ...over,
});

describe("filterByLifecycleRange — MEJ-12 criterio 3", () => {
    const tenants = [
        t({ tenantId: "a", activatedAtIso: "2026-03-10T12:00:00.000Z" }),
        t({ tenantId: "b", activatedAtIso: "2026-09-30T18:00:00.000Z" }),
        t({ tenantId: "c" }), // sin fecha de alta
    ];

    it("sin límites devuelve todo, incluidos los que no tienen fecha", () => {
        expect(filterByLifecycleRange(tenants, { field: "activatedAtIso" })).toHaveLength(3);
    });

    // El caso que rompe una comparación por timestamp: el input es un `date`,
    // así que "hasta el 30/09" tiene que incluir TODO ese día. Con
    // timestamps, `to` valdría medianoche y dejaría afuera a "b" (18:00).
    it("el límite 'hasta' incluye el día entero, no hasta la medianoche", () => {
        const r = filterByLifecycleRange(tenants, { field: "activatedAtIso", from: "2026-09-01", to: "2026-09-30" });
        expect(r.map((x) => x.tenantId)).toEqual(["b"]);
    });

    it("el límite 'desde' también es inclusive", () => {
        const r = filterByLifecycleRange(tenants, { field: "activatedAtIso", from: "2026-03-10" });
        expect(r.map((x) => x.tenantId)).toEqual(["a", "b"]);
    });

    // Si se pregunta "bajas de septiembre", un tenant que nunca se dio de baja
    // no es una respuesta vacía: no pertenece al conjunto.
    it("excluye a los que no tienen la fecha pedida cuando hay algún límite", () => {
        const r = filterByLifecycleRange(tenants, { field: "activatedAtIso", from: "2020-01-01" });
        expect(r.map((x) => x.tenantId)).not.toContain("c");
    });

    it("filtra por baja cuando se elige ese campo", () => {
        const conBaja = [
            t({ tenantId: "x", activatedAtIso: "2026-01-01T00:00:00.000Z", canceledAtIso: "2026-09-15T00:00:00.000Z" }),
            t({ tenantId: "y", activatedAtIso: "2026-09-20T00:00:00.000Z" }),
        ];
        const r = filterByLifecycleRange(conBaja, { field: "canceledAtIso", from: "2026-09-01", to: "2026-09-30" });
        expect(r.map((v) => v.tenantId)).toEqual(["x"]);
    });
});

describe("tenureInMonths", () => {
    it("mide alta -> baja para un tenant dado de baja", () => {
        const r = tenureInMonths(t({ activatedAtIso: "2026-01-01T00:00:00.000Z", canceledAtIso: "2026-07-01T00:00:00.000Z" }));
        expect(r).toBeGreaterThan(5.8);
        expect(r).toBeLessThan(6.2);
    });

    it("mide alta -> hoy para uno vigente", () => {
        const r = tenureInMonths(t({ activatedAtIso: "2026-01-01T00:00:00.000Z" }), new Date("2026-04-01T00:00:00.000Z"));
        expect(r).toBeGreaterThan(2.8);
    });

    it("da null si no hay fecha de alta, en vez de un número inventado", () => {
        expect(tenureInMonths(t({}))).toBeNull();
    });
});

describe("buildLifecycleCsv", () => {
    // Un nombre de empresa con coma partía la fila en dos y corría todas las
    // columnas siguientes.
    it("entrecomilla los campos con coma y dobla las comillas internas", () => {
        const csv = buildLifecycleCsv([t({ organizationName: 'Acme, S.A. "La Buena"' })]);
        expect(csv).toContain('"Acme, S.A. ""La Buena"""');
        // La fila sigue teniendo una sola línea de datos.
        expect(csv.trim().split("\r\n")).toHaveLength(2);
    });

    it("lleva BOM para que Excel muestre bien los acentos", () => {
        expect(buildLifecycleCsv([])).toMatch(/^﻿/);
    });

    it("incluye la cabecera aun sin filas", () => {
        expect(buildLifecycleCsv([])).toContain("Permanencia (meses)");
    });

    it("vuelca las fechas como YYYY-MM-DD y el motivo", () => {
        const csv = buildLifecycleCsv([
            t({ activatedAtIso: "2026-01-05T10:00:00.000Z", canceledAtIso: "2026-06-05T10:00:00.000Z", cancellationReason: "payment_delinquency" }),
        ]);
        expect(csv).toContain("2026-01-05");
        expect(csv).toContain("2026-06-05");
        expect(csv).toContain("payment_delinquency");
    });
});
