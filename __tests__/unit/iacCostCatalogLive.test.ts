// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { estimarPlan } from "@/services/iacCostEstimator.service";
import { precioDeFixture } from "../helpers/retailFixture";

/**
 * Contrato VIVO contra la Retail API. Opt-in: `npm run test:retail-live`.
 *
 * La Retail API contesta 200 con `Items: []`, o con el medidor de otro recurso,
 * cuando un nombre cambia: el síntoma es un costo mal y no un error. Los tests
 * normales corren contra respuestas capturadas, así que no se enteran si Azure
 * renombra un medidor. Este vuelve a preguntar y compara contra esa captura.
 *
 * No va en CI por defecto: depende de la red, de la cuota de la API (que
 * responde 429 si se la castiga) y de que los precios no se hayan movido más
 * de la tolerancia.
 */
const VIVO = process.env.RETAIL_PRICES_LIVE === "1";
const PLAN = JSON.parse(readFileSync("__tests__/fixtures/terraform-plan-azurerm-completo.json", "utf8"));

describe.skipIf(!VIVO)("catálogo contra la Retail API en vivo", () => {
    it("cada recurso del plan real se tarifa y no se aleja de lo capturado", async () => {
        const vivo = await estimarPlan(PLAN, { concurrencia: 2 });
        const capturado = await estimarPlan(PLAN, { precio: precioDeFixture });

        const problemas: string[] = [];
        for (const l of vivo.lineas) {
            if (l.motivo === "por-uso") continue;
            const antes = capturado.lineas.find((c) => c.direccion === l.direccion);
            if (l.motivo) {
                problemas.push(`${l.direccion}: ${l.motivo}`);
                continue;
            }
            const base = antes?.mensualDespues ?? 0;
            // ±30%: los precios de lista se mueven, los nombres no deberían.
            if (base > 0 && Math.abs(l.mensualDespues - base) / base > 0.3) {
                problemas.push(`${l.direccion}: ${l.mensualDespues} contra ${base} capturado`);
            }
        }
        expect(problemas).toEqual([]);
    }, 120_000);
});
