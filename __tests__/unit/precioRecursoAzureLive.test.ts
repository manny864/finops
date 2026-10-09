// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    precioMensualAppGateway,
    precioMensualDisco,
    precioMensualIpPublica,
    precioMensualPlanAppService,
    precioMensualSqlDatabase,
} from "@/services/precioRecursoAzure";

/**
 * Contrato VIVO contra la Retail API para los precios de recursos existentes.
 * Opt-in: `npm run test:retail-live`.
 *
 * Si Azure renombra un medidor, la API sigue contestando 200 con `Items: []` y el
 * helper da `null`: en producción eso es un respaldo fijo silencioso. Los tests
 * normales corren contra respuestas capturadas y no se enteran; este vuelve a
 * preguntar y falla con el nombre del recurso que dejó de tener precio.
 *
 * Los valores son los capturados en westus2 (2026-10-08 y 2026-10-09). Tolerancia
 * ±30%: los precios de lista se mueven, los nombres no deberían.
 */
const VIVO = process.env.RETAIL_PRICES_LIVE === "1";

const CASOS: Array<[string, () => Promise<number | null>, number]> = [
    ["disco Premium_LRS de 64 GB (P6 LRS)", () => precioMensualDisco("Premium_LRS", 64, "westus2"), 9.2801],
    ["disco StandardSSD_LRS de 128 GB (E10 LRS)", () => precioMensualDisco("StandardSSD_LRS", 128, "westus2"), 9.6],
    ["disco Standard_LRS de 128 GB (S10 LRS)", () => precioMensualDisco("Standard_LRS", 128, "westus2"), 5.888],
    ["disco Premium_ZRS de 512 GB (P20 ZRS)", () => precioMensualDisco("Premium_ZRS", 512, "westus2"), 99.84],
    ["IP pública Standard", () => precioMensualIpPublica("Standard", "westus2"), 3.65],
    ["IP pública Basic", () => precioMensualIpPublica("Basic", "westus2"), 2.628],
    ["plan App Service S1 Linux", () => precioMensualPlanAppService("S1", "westus2", true), 58.4],
    ["plan App Service S1 Windows", () => precioMensualPlanAppService("S1", "westus2", false), 73],
    ["plan App Service P1v3 Linux", () => precioMensualPlanAppService("P1v3", "westus2", true), 113.15],
    ["Application Gateway Standard_v2", () => precioMensualAppGateway("Standard_v2", "westus2"), 146],
    ["Application Gateway WAF_v2", () => precioMensualAppGateway("WAF_v2", "westus2"), 262.8],
    ["SQL Database GP_Gen5_2 (licencia incluida)", () => precioMensualSqlDatabase("GP_Gen5_2", "westus2"), 368.19],
    ["SQL Database BC_Gen5_2 (licencia incluida)", () => precioMensualSqlDatabase("BC_Gen5_2", "westus2"), 991.98],
];

describe.skipIf(!VIVO)("precios de recursos existentes contra la Retail API en vivo", () => {
    it.each(CASOS)("%s", async (_nombre, precio, capturado) => {
        const vivo = await precio();
        expect(vivo, "la API ya no publica el medidor: el llamador cae a su respaldo").not.toBeNull();
        expect(Math.abs(vivo! - capturado) / capturado).toBeLessThan(0.3);
    }, 60_000);
});
