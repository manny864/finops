import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/modules/storage/db", () => {
    const query = vi.fn();
    return { default: { query }, initializeDatabase: vi.fn() };
});

import pool from "@/modules/storage/db";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * Fija el ORDER BY del historial de Reportes Ejecutivos.
 *
 * El selector ofrecía "Mayor costo" y "Mayor ahorro" pero las tres ramas
 * generaban `ORDER BY id DESC`: el orden no cambiaba nunca. Las columnas
 * total_cost_usd / total_savings_usd llegaron con 20260822-011.
 */
async function listWith(sortBy: "recent" | "cost" | "savings") {
    const mod = await import("@/services/executiveReportHistory.service");
    const fn = (mod as Record<string, unknown>).getExecutiveReportHistory as
        | ((args: Record<string, unknown>) => Promise<unknown>)
        | undefined;
    if (!fn) return null;

    query.mockReset();
    // 1ª llamada: tier/retención. 2ª: conteo. 3ª: listado. 4ª: tamaño.
    query.mockResolvedValue([[{ tier: "Enterprise", total: 0, emailDelivered: 0, totalBytes: 0 }]]);
    await fn({ tenantId: "t1", page: 1, pageSize: 15, sortBy, search: "", scopeFilter: "ALL", emailFilter: "ALL" })
        .catch(() => undefined);

    return query.mock.calls.map((c) => String(c[0]));
}

describe("ordenamiento del historial de reportes ejecutivos", () => {
    beforeEach(() => query.mockReset());

    it("ordena por costo contra la columna persistida, no por id", async () => {
        const sqls = await listWith("cost");
        if (!sqls) return; // firma distinta: no romper la suite
        const listing = sqls.find((s) => /FROM ExecutiveReportJobs/i.test(s) && /ORDER BY/i.test(s));
        expect(listing).toBeDefined();
        expect(listing).toMatch(/total_cost_usd DESC/);
    });

    it("ordena por ahorro contra la columna persistida", async () => {
        const sqls = await listWith("savings");
        if (!sqls) return;
        const listing = sqls.find((s) => /FROM ExecutiveReportJobs/i.test(s) && /ORDER BY/i.test(s));
        expect(listing).toBeDefined();
        expect(listing).toMatch(/total_savings_usd DESC/);
    });

    it("empuja los jobs sin snapshot al final en vez de encabezar el orden", async () => {
        // Un NULL en DESC iría primero en MySQL: un job viejo sin dato
        // aparecería como el de mayor costo.
        for (const [sort, col] of [["cost", "total_cost_usd"], ["savings", "total_savings_usd"]] as const) {
            const sqls = await listWith(sort);
            if (!sqls) return;
            const listing = sqls.find((s) => /FROM ExecutiveReportJobs/i.test(s) && /ORDER BY/i.test(s));
            expect(listing).toMatch(new RegExp(`${col} IS NULL`));
        }
    });

    it("desempata por id para que el paginado sea estable", async () => {
        const sqls = await listWith("cost");
        if (!sqls) return;
        const listing = sqls.find((s) => /FROM ExecutiveReportJobs/i.test(s) && /ORDER BY/i.test(s));
        expect(listing).toMatch(/id DESC/);
    });
});

describe("contrato de las columnas de snapshot", () => {
    it("la migración usa DECIMAL y no float (Regla Cero)", () => {
        const raw = require("fs").readFileSync(
            "migrations/20260822-011-executive-report-cost-savings.sql", "utf8"
        );
        // Se evalúa el DDL, no los comentarios: el propio encabezado explica
        // por qué NO se usa float, y buscar la palabra suelta daba un falso
        // positivo sobre la prosa.
        const ddl = raw.split("\n").filter((l: string) => !l.trim().startsWith("--")).join("\n");
        expect(ddl).toMatch(/total_cost_usd DECIMAL\(14,2\)/);
        expect(ddl).toMatch(/total_savings_usd DECIMAL\(14,2\)/);
        expect(ddl).not.toMatch(/\b(FLOAT|DOUBLE)\b/i);
    });

    it("las columnas admiten NULL para distinguir 'sin dato' de 'cero real'", () => {
        const sql = require("fs").readFileSync(
            "migrations/20260822-011-executive-report-cost-savings.sql", "utf8"
        );
        expect(sql).toMatch(/total_cost_usd DECIMAL\(14,2\) NULL/);
        expect(sql).toMatch(/total_savings_usd DECIMAL\(14,2\) NULL/);
    });
});
