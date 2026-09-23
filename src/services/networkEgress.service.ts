/**
 * Mapa de egress: a dónde se va la plata de transferencia de datos (MEJ-19).
 *
 * NO HAY TABLA NUEVA NI COLECTOR NUEVO. El costo de transferencia ya se ingiere
 * en `CostMeterSnapshots` desde la query B del sync, que agrupa por
 * `ServiceName` + `Meter` + `ResourceLocation` y guarda también `Quantity`. Lo
 * único que faltaba era clasificar esas filas y mostrarlas: lo que ya existe,
 * `/api/intelligence/network/service-cost-v2`, desglosa el costo de los
 * RECURSOS de red (VNet, NSG, Firewall, ExpressRoute…) y no toca el del
 * TRÁFICO, que es entre el 15% y el 35% de la factura de red.
 *
 * LOS NOMBRES DE METER ESTÁN VERIFICADOS CONTRA LA RETAIL PRICES API, no
 * escritos de memoria (2026-09-22, `serviceName eq 'Bandwidth'`). Dos cosas que
 * salieron de ahí y contradicen lo que asumía la propuesta original de MEJ-19:
 *
 *   - El servicio se llama **`Bandwidth`** (familia `Networking`), no
 *     "Virtual Network". Filtrar por el nombre equivocado devuelve cero filas y
 *     cero filas se lee igual que "este cliente no transfiere nada".
 *   - El `Data Processed` del NAT Gateway vive en el servicio **`NAT Gateway`**,
 *     con su propio medidor por GB, no bajo Bandwidth.
 *
 * DOS LÍMITES QUE LA PANTALLA TIENE QUE DECIR, no esconder:
 *
 *   1. **Las filas de costo 0 no se ingieren.** El sync descarta `cost === 0`,
 *      así que los GB del tier gratuito y de `Standard Data Transfer Out - Free`
 *      no están. El costo es exacto; los GB son un piso.
 *   2. **`UnitOfMeasure` llega vacío** en las filas de meter: la query B no lo
 *      pide. Por eso los GB sólo se suman para los medidores que la Retail API
 *      confirma en `1 GB`, y los de China —que se cobran por Mbps/hora— quedan
 *      fuera del total de GB aunque su costo sí se cuente.
 */

import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";

export type CategoriaEgress =
    | "internet"
    | "entre_continentes"
    | "entre_regiones"
    | "entre_zonas"
    | "nat_gateway"
    | "procesamiento"
    | "entrada";

export interface FlujoEgress {
    categoria: CategoriaEgress;
    /** Región de Azure desde la que sale el tráfico. Vacía si Azure no la informó. */
    region: string;
    costoUsd: number;
    /** GB, sólo cuando el medidor se cobra por GB. `null` cuando no se puede afirmar. */
    gigabytes: number | null;
    medidor: string;
    /** El servicio de Azure que emite el cargo. `Standard Data Processed` lo usan siete. */
    servicio: string;
}

export interface MapaEgress {
    flujos: FlujoEgress[];
    porCategoria: Array<{ categoria: CategoriaEgress; costoUsd: number; gigabytes: number | null }>;
    costoTotalUsd: number;
    /** Lo que se paga por mover datos, sin contar la entrada (que suele ser gratis). */
    costoSalidaUsd: number;
    dias: number;
    /** true cuando hay algún medidor cuyos GB no se pueden afirmar: el total de GB es parcial. */
    gigabytesParciales: boolean;
}

/**
 * Clasificación en SQL y no en JS, para no traerse miles de filas y agruparlas
 * acá. `m` es el nombre del medidor en minúscula; `s`, el del servicio.
 *
 * EL ORDEN DE LOS WHEN ES LA LÓGICA, no un detalle de estilo. Dos trampas, las
 * dos verificadas contra la Retail Prices API y las dos silenciosas:
 *
 *   1. `Standard Inter-Availability Zone Data Transfer Out` también matchea un
 *      `%data transfer out%` genérico. Con el orden al revés, todo el inter-AZ
 *      —el hallazgo que justifica la pantalla— se contaría como salida a
 *      internet y nadie vería el problema.
 *
 *   2. **`Data Processed` no es del NAT Gateway.** Lo usan SIETE servicios, y
 *      `Azure Firewall` tiene un medidor con el nombre EXACTAMENTE igual,
 *      `Standard Data Processed`. También `Load Balancer` (`Standard`,
 *      `Gateway`, `Global`), `Application Gateway` (`Small`/`Medium`/`Large`),
 *      `Azure DDOS Protection`, `Virtual WAN` y `Virtual Network` (que es donde
 *      vive el procesamiento de Private Link, como `Standard Data Processed -
 *      Egress` / `- Ingress`). Por eso el NAT se reconoce por SERVICIO y el
 *      resto cae en `procesamiento`: filtrar sólo por el nombre del medidor le
 *      atribuía al NAT el costo de un firewall, que es plata real cargada al
 *      lugar equivocado.
 */
export const CLASIFICACION = `
    CASE
        WHEN m LIKE '%inter-availability zone%'  THEN 'entre_zonas'
        WHEN m LIKE '%inter continent%out%'      THEN 'entre_continentes'
        WHEN m LIKE '%intra continent%out%'      THEN 'entre_regiones'
        WHEN s LIKE '%nat gateway%' AND m LIKE '%data processed%' THEN 'nat_gateway'
        WHEN m LIKE '%data processed%'           THEN 'procesamiento'
        WHEN m LIKE '%data transfer in%'         THEN 'entrada'
        WHEN m LIKE '%data transfer out%'        THEN 'internet'
        ELSE NULL
    END`;

/**
 * Medidores que la Retail Prices API confirma en `1 GB`. Los de China se cobran
 * por Mbps/hora ("China Data Transfer - 1 Mbps"), así que su `Quantity` no son
 * gigabytes y sumarla daría un número inventado.
 */
export const SE_COBRA_POR_GB = `m NOT LIKE '%mbps%'`;

export async function getMapaEgress(tenantId: string, dias = 30): Promise<MapaEgress> {
    const [filas] = await pool.query<RowDataPacket[]>(
        `SELECT
            ${CLASIFICACION} AS categoria,
            COALESCE(resource_location, '') AS region,
            MeterName AS medidor,
            service_name AS servicio,
            SUM(cost_usd) AS costo,
            SUM(CASE WHEN ${SE_COBRA_POR_GB} THEN COALESCE(Quantity, 0) ELSE 0 END) AS gb,
            SUM(CASE WHEN ${SE_COBRA_POR_GB} THEN 0 ELSE 1 END) AS sin_gb
           FROM (
                SELECT resource_location, MeterName, service_name, cost_usd, Quantity,
                       LOWER(COALESCE(NULLIF(MeterName, ''), MeterSubCategory, '')) AS m,
                       LOWER(COALESCE(service_name, '')) AS s
                  FROM CostMeterSnapshots
                 WHERE tenant_id = ?
                   AND date > DATE_SUB(CURDATE(), INTERVAL ? DAY)
           ) t
          WHERE ${CLASIFICACION} IS NOT NULL
          GROUP BY categoria, region, medidor, servicio
          ORDER BY costo DESC`,
        [tenantId, dias]
    );

    const flujos: FlujoEgress[] = (filas || []).map((f) => ({
        categoria: String(f.categoria) as CategoriaEgress,
        region: String(f.region || ""),
        medidor: String(f.medidor || ""),
        servicio: String(f.servicio || ""),
        costoUsd: redondear(Number(f.costo) || 0),
        gigabytes: Number(f.sin_gb) > 0 ? null : redondear(Number(f.gb) || 0),
    }));

    const porCategoria = new Map<CategoriaEgress, { costoUsd: number; gigabytes: number | null }>();
    for (const f of flujos) {
        const acum = porCategoria.get(f.categoria) || { costoUsd: 0, gigabytes: 0 as number | null };
        acum.costoUsd += f.costoUsd;
        // Un solo medidor sin GB fiables deja la categoría entera sin total de
        // GB. Sumar los que sí se saben daría un número que parece el total y no
        // lo es, que es peor que no mostrarlo.
        acum.gigabytes = f.gigabytes === null || acum.gigabytes === null ? null : acum.gigabytes + f.gigabytes;
        porCategoria.set(f.categoria, acum);
    }

    const costoTotalUsd = flujos.reduce((a, f) => a + f.costoUsd, 0);
    const costoSalidaUsd = flujos.filter((f) => f.categoria !== "entrada").reduce((a, f) => a + f.costoUsd, 0);

    return {
        flujos,
        porCategoria: [...porCategoria]
            .map(([categoria, v]) => ({ categoria, costoUsd: redondear(v.costoUsd), gigabytes: v.gigabytes === null ? null : redondear(v.gigabytes) }))
            .sort((a, b) => b.costoUsd - a.costoUsd),
        costoTotalUsd: redondear(costoTotalUsd),
        costoSalidaUsd: redondear(costoSalidaUsd),
        dias,
        gigabytesParciales: flujos.some((f) => f.gigabytes === null),
    };
}

function redondear(n: number): number {
    return Math.round(n * 100) / 100;
}
