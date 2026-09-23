// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * El mock del interceptor tiene que tener la misma FORMA que lo que sirve la
 * ruta (MEJ-03).
 *
 * `TenantProvider` parchea `window.fetch` en tenants demo y responde con
 * `getMockDataForRoute(...)`. Cuando esa forma se queda atrás del contrato que
 * la ruta devuelve, no hay error: el panel queda vacío o absurdo, y se ve como
 * "la demo no tiene datos". Así aparecieron los seis casos que MEJ-03 ya
 * documenta —`/api/advisor` con los KPIs en 0, `top-expenses` todo en $0.00,
 * `resources/*` a 46.000 USD por recurso— y ninguno tiró una excepción.
 *
 * La regla: toda clave que la RUTA devuelve tiene que existir en el mock del
 * interceptor. Al revés no importa; una clave de más nadie la lee.
 *
 * Se invoca el handler de verdad en vez de comparar contra una constante
 * exportada: así el test sigue al contrato aunque la ruta lo arme sobre la
 * marcha, que es como lo arman tres de estas cuatro.
 */

vi.mock("@/lib/requestAuth", () => ({
    AuthError: class extends Error { status = 403; },
    requireTenantAccess: async () => ({ email: "demo@demo" }),
    requireTenantTier: async () => ({ email: "demo@demo" }),
    requireTenantRole: async () => ({ email: "demo@demo" }),
    requireSuperAdmin: async () => ({ email: "demo@demo" }),
}));
vi.mock("@/modules/storage/db", () => ({
    default: { query: async () => [[]] },
    insertAICostSnapshotRow: async () => {},
}));

import { getMockDataForRoute } from "@/lib/mockData";

/** Claves hasta dos niveles, con `[]` para el primer elemento de un array. */
function claves(v: any, prefijo = "", nivel = 0): string[] {
    if (nivel > 1 || !v || typeof v !== "object") return [];
    if (Array.isArray(v)) return v.length ? claves(v[0], `${prefijo}[]`, nivel) : [];
    return Object.keys(v).flatMap((k) => {
        const p = prefijo ? `${prefijo}.${k}` : k;
        return [p, ...claves(v[k], p, nivel + 1)];
    });
}

/**
 * `billing` NO está acá y es deuda conocida, no un olvido.
 *
 * La ruta devuelve el contrato nuevo (`services`, `top5ShareOfWallet`,
 * `byRegion`, `overview`, `period`...) que leen `RealConsumptionDashboard` y
 * `BillingDashboard`; el interceptor todavía sirve el viejo (`data[]`), así que
 * en la demo esa pantalla está vacía. Arreglarlo pide una de dos decisiones, y
 * ninguna es una limpieza:
 *
 *   a. Servir el mock ANTES del auth en `/api/intelligence/billing` —como ya
 *      hace `aks-chargeback`— y sacar la intercepción. Una sola fuente, diff
 *      negativo, pero amplía lo que se responde sin token, que es justo lo que
 *      SEC-02 de la auditoría 2026-09-21 dejó anotado para no ampliar.
 *   b. Duplicar las ~400 líneas de `getMockRealConsumptionOverview` en un
 *      módulo importable desde el cliente. No amplía nada y vuelve a poner dos
 *      copias de lo mismo a divergir.
 */
const CASOS: { ruta: string; clave: string; url: string }[] = [
    { ruta: "ai-analytics", clave: "ai-analytics", url: "https://x/api/intelligence/ai-analytics?tenantId=demo" },
    { ruta: "anomalies", clave: "anomalies", url: "https://x/api/intelligence/anomalies?tenantId=demo" },
    { ruta: "aks-chargeback", clave: "aks_chargeback", url: "https://x/api/intelligence/aks-chargeback?tenantId=demo" },
];

describe("forma del mock del interceptor vs la de la ruta (MEJ-03)", () => {
    it.each(CASOS)("$ruta: el interceptor trae todo lo que la ruta devuelve", async ({ ruta, clave, url }) => {
        const mod = await import(`@/app/api/intelligence/${ruta}/route`);
        const respuesta = await mod.GET(new NextRequest(new URL(url)) as any);

        // Un 500 acá deja el test en verde comparando `{error}` contra el mock y
        // no prueba nada: el caso util es la ruta respondiendo su payload.
        expect(respuesta.status, `la ruta ${ruta} no respondio 200 con el tenant demo`).toBe(200);

        const delInterceptor = new Set(claves(getMockDataForRoute(clave, "demo")));
        const faltantes = claves(await respuesta.json()).filter((k) => !delInterceptor.has(k));

        expect(
            faltantes,
            `el mock de '${clave}' en mockData.ts no trae estas claves que la ruta si devuelve: en la demo van a salir vacias`
        ).toEqual([]);
    });
});
