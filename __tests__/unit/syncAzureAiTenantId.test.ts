// @vitest-environment node
/**
 * `cron/sync-azure-ai` tiene que llamar a `/api/intelligence/azure-ai` con el `tenant_id` (el GUID de Entra), no con el
 * `id` de la fila de `Tenants`.
 *
 * La ruta hacía `SELECT id FROM Tenants` y mandaba `tenantId=${tenant.id}`: 34, 231, 344, 427, 543. `Tenants.id` es el
 * autoincremental; el identificador de tenant de toda la plataforma es `tenant_id`, y los otros 17 crons que recorren
 * tenants hacen `SELECT tenant_id AS id`. Con el id de la fila, los 8 colectores de cada tenant fallaban al listar
 * suscripciones (`AADSTS90002: Tenant '34' not found`, ≈117.000 veces en 30 días en producción), devolvían vacío, la
 * ruta cacheaba `Cached 0 capabilities` bajo `ai:capabilities:34` y el job terminaba «Succeeded»: el cron nunca
 * precalentó nada desde que existe (2026-08-12).
 *
 * El mock de `pool.query` del otro test de esta ruta devuelve filas fijas y acepta cualquier SELECT, por eso nadie lo vio.
 * Acá la base falsa tiene una tabla `Tenants` con las dos columnas, devuelve la que el SELECT pide (con su alias) y rechaza,
 * como MySQL, las que `Tenants` no tiene según el DDL del repo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { poolQuery } = vi.hoisted(() => {
    process.env.CRON_SECRET = "secreto-de-prueba"; // el módulo lo lee al importarse
    return { poolQuery: vi.fn() };
});
vi.mock("@/modules/storage/db", () => ({ default: { query: poolQuery } }));
vi.mock("@/lib/redis", () => ({ redis: { status: "end" } }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/sync-azure-ai/route";
import { columnasPorTabla } from "../helpers/ddlVersionado";

type FilaTenant = { id: number; tenant_id: string; tier: string };

/** `id` es el autoincremental de la fila; `tenant_id`, el GUID de Entra. */
const TENANTS: FilaTenant[] = [
    { id: 34, tenant_id: "5f0c1a52-8f4e-4c6e-9a53-0b6a1d2e7c11", tier: "Enterprise" },
    { id: 231, tenant_id: "a3b9d8f4-2c71-4e0a-b5d6-91c4f7e8a022", tier: "Enterprise" },
    { id: 344, tenant_id: "c7e1f0a9-6b3d-4a58-8e2f-d4a9b6c13355", tier: "Business" },
];

const COLUMNAS_DE_TENANTS = columnasPorTabla().get("tenants")!;

/** Un SELECT de UNA columna (`a` o `a AS b`) sobre `Tenants`; filtra por tier y, si se pide, por `(id = ? OR tenant_id = ?)`. */
function baseDeTenants(violaciones: string[]) {
    return async (sql: string, params: unknown[] = []) => {
        const m = /SELECT\s+(\w+)(?:\s+AS\s+(\w+))?\s+FROM\s+Tenants\s+WHERE\s+([\s\S]*)$/i.exec(sql);
        if (!m) throw new Error(`la base falsa no entiende esta consulta: ${sql.slice(0, 120)}`);
        const [, columna, alias = columna, donde] = m;
        if (!COLUMNAS_DE_TENANTS.has(columna.toLowerCase())) {
            violaciones.push(`Tenants no tiene la columna ${columna}`);
            throw Object.assign(new Error(`Unknown column '${columna}' in 'field list'`), { code: "ER_BAD_FIELD_ERROR" });
        }
        let filas = TENANTS.filter((t) => !/tier\s*=\s*'Enterprise'/i.test(donde) || t.tier === "Enterprise");
        if (/\(\s*id\s*=\s*\?\s+OR\s+tenant_id\s*=\s*\?\s*\)/i.test(donde)) {
            filas = filas.filter((t) => String(t.id) === String(params[0]) || t.tenant_id === params[1]);
        }
        return [filas.map((t) => ({ [alias]: t[columna as keyof FilaTenant] })), []];
    };
}

/** Un fetch que anota a quién se llamó. */
function fetchAnotado() {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ mock: false, capabilities: [] }) };
    }));
    return urls;
}

const pedir = (consulta = "") =>
    GET(new NextRequest(`http://localhost/api/cron/sync-azure-ai${consulta}`, { headers: { Authorization: "Bearer secreto-de-prueba" } }));

const tenantIdDe = (url: string) => new URL(url).searchParams.get("tenantId");

let violaciones: string[];

beforeEach(() => {
    violaciones = [];
    poolQuery.mockReset().mockImplementation(baseDeTenants(violaciones));
    vi.unstubAllGlobals();
});

describe("GET /api/cron/sync-azure-ai: qué identificador manda", () => {
    it("llama a azure-ai con el tenant_id (GUID) de cada tenant Enterprise, no con el id de la fila", async () => {
        const urls = fetchAnotado();

        const j = await (await pedir()).json();

        expect(urls.map(tenantIdDe)).toEqual([TENANTS[0].tenant_id, TENANTS[1].tenant_id]);
        expect(urls.some((u) => /tenantId=(34|231|344)\b/.test(u))).toBe(false);
        expect(j.results.map((r: { tenantId: string }) => r.tenantId)).toEqual([TENANTS[0].tenant_id, TENANTS[1].tenant_id]);
        expect(violaciones).toEqual([]);
    });

    it("el tenant que no es Enterprise no se sincroniza", async () => {
        const urls = fetchAnotado();
        await pedir();
        expect(urls.map(tenantIdDe)).not.toContain(TENANTS[2].tenant_id);
    });

    it("con ?tenantId= acepta el id de la fila o el tenant_id, y siempre llama con el tenant_id", async () => {
        const urls = fetchAnotado();

        await pedir("?tenantId=34");
        await pedir(`?tenantId=${TENANTS[1].tenant_id}`);

        expect(urls.map(tenantIdDe)).toEqual([TENANTS[0].tenant_id, TENANTS[1].tenant_id]);
        expect(violaciones).toEqual([]);
    });

    it("con ?tenantId= de un tenant que no es Enterprise no llama a nadie", async () => {
        const urls = fetchAnotado();

        const j = await (await pedir("?tenantId=344")).json();

        expect(urls).toEqual([]);
        expect(j).toMatchObject({ success: true, message: "No Enterprise tenants found", count: 0 });
    });
});
