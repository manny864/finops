import { estimarRecursos, precioRetail } from "@/services/iacCostEstimator.service";
import { masReciente, normalizarRegion, type Attrs, type Componente } from "@/services/iacCostCatalog";

/**
 * El precio mensual de un recurso que YA EXISTE en el tenant (Zombies, Rightsizing,
 * Licencias), con el mismo catálogo y los mismos medidores que Shift-Left usa para uno
 * que todavía no existe. Un solo lugar sabe cómo publica la Retail API cada recurso:
 * MEJ-32 documenta la duplicación de catálogos de precios como bug recurrente.
 *
 * POR QUÉ NO `getMonthlyCostEstimate`. Esa función filtra la API por el identificador
 * que le pasen, y los llamadores le pasaban el de ARM: `Premium_LRS`, `Standard_v2`,
 * `GP_Gen5_2`, el servicio `App Service`. La API publica con otros nombres (un disco por
 * tier y tamaño, `P10 LRS`; el servicio es `Azure App Service`; SQL por `armSkuName`
 * `SQLDB_GP_Compute_Gen5_2`), así que contesta 200 con `Items: []`, el helper lo vuelve
 * 0 y cada llamador cae a su respaldo fijo. Nada falla y nadie se entera (medido contra
 * la API el 2026-10-09; el detalle está en el addendum 47 del LLD).
 *
 * CONTRATO. Cada función devuelve USD/mes o `null` cuando no se pudo tarifar: falta un
 * dato (el tamaño del disco), el recurso no tiene un precio fijo (Ultra, Y1...), la API
 * no publica ese medidor o no contestó. `null` NO es 0: es "usá tu respaldo", y quien
 * llama lo escribe con `??` para no confundirlo con un precio real de 0 (plan Free).
 * Nunca lanza: una página de zombis no puede caerse por un precio.
 *
 * Lo que ARM no trae se asume en cada función y queda dicho ahí. En todos los casos se
 * asume lo más barato, porque en un producto de ahorros subestimar es preferible a inflar.
 */

/** Tarifa un recurso del catálogo de Shift-Left como si se estuviera creando. */
async function precioDe(tipo: string, atributos: Attrs): Promise<number | null> {
    try {
        const { lineas } = await estimarRecursos([
            { direccion: tipo, tipo, accion: "create", clase: "costo", antes: null, despues: atributos, desconocidos: null },
        ]);
        return lineas[0].motivo ? null : lineas[0].mensualDespues;
    } catch {
        return null;
    }
}

/**
 * `tipo` es el `sku.name` del disco en ARM (`Premium_LRS`) y `sizeGb` su `diskSizeGB`:
 * el tier que se cobra (`P10 LRS`) sale de los dos, y el tamaño se redondea hacia arriba
 * al que Azure factura (200 GB Premium es un P15, no un P10).
 */
export const precioMensualDisco = (tipo: unknown, sizeGb: unknown, region: string) =>
    precioDe("azurerm_managed_disk", { location: region, storage_account_type: tipo, disk_size_gb: sizeGb });

/**
 * ARM trae la SKU (`Basic`/`Standard`) pero las consultas de zombis no proyectan la
 * asignación ni la versión: se asume IPv4 estática. Standard es siempre estática; para
 * una Basic la estática es la más barata (0,0036 contra 0,004 por hora).
 */
export const precioMensualIpPublica = (sku: unknown, region: string) =>
    precioDe("azurerm_public_ip", { location: region, sku, allocation_method: "Static" });

/**
 * `sku` es el `sku.name` del plan en ARM (`S1`, `P1v3`) y `reserved` su `properties.reserved`
 * tal como lo devuelve `emptyAppServicePlans` (Learn: "If Linux app service plan true, false
 * otherwise"): Linux y Windows tienen medidores y precios distintos. Resource Graph lo entrega
 * como el string "true"/"false" (con `tobool` llegaba como el número 1), y se acepta cualquiera
 * de las formas; ausente es Windows, la plataforma por defecto. Cotiza UNA instancia:
 * `sku.capacity` no entra, así que un plan escalado a varias queda subestimado.
 */
export const precioMensualPlanAppService = (sku: unknown, region: string, reserved: unknown) =>
    precioDe("azurerm_service_plan", {
        location: region,
        sku_name: sku,
        os_type: ["true", "1"].includes(String(reserved).toLowerCase()) ? "Linux" : "Windows",
    });

/**
 * `sku` es `properties.sku.name` (`Standard_v2`, `WAF_v2`...). Cobra el costo fijo del
 * gateway, sin unidades de capacidad ni datos procesados: para uno sin uso son lo mínimo.
 */
export const precioMensualAppGateway = (sku: unknown, region: string) =>
    precioDe("azurerm_application_gateway", { location: region, sku: { name: sku } });

const NIVEL_SQL: Record<string, string> = { GP: "General Purpose", BC: "Business Critical" };

/**
 * SQL Database provisionada Gen5 (`GP_Gen5_N`, `BC_Gen5_N`) con LICENCIA INCLUIDA, que es lo
 * que lista `missingAhubSql` (las bases con `licenseType != BasePrice`) y lo que Hybrid Benefit
 * recorta. La Retail API lo publica en dos partes, medidas el 2026-10-09:
 *
 *  - cómputo base: `armSkuName = SQLDB_GP_Compute_Gen5_2`, fila `vCore`, por TAMAÑO y no por
 *    vCore (`2 vCore`: 0,304434/h = 2 × 0,152217). Es la tarifa "base", sin SQL Server: la que
 *    paga quien trae su licencia (Learn: "License Included pricing is made up of base compute
 *    and SQL license components").
 *  - licencia de SQL Server: un medidor aparte en `Global`, por vCore (GP 0,099966/h, BC 0,375/h).
 *
 * Con sólo la primera se subestimaría el costo (y, aplicado el 30%/55%, el ahorro) a la mitad.
 * `Zone Redundancy vCore` es una tercera fila que se suma si la base es zonalmente
 * redundante; la consulta no trae `zoneRedundant`, así que no se cobra y se informa de menos.
 *
 * Sólo Gen5 provisionada. Pools (`ElasticPool`), serverless (`GP_S_`), Hyperscale (otra
 * forma: por vCore), DC y las demás familias devuelven `null` y siguen con el respaldo del
 * llamador. Cuando `iacCostCatalog` gane `azurerm_mssql_database`, estos dos componentes se
 * mudan allá tal cual.
 */
export async function precioMensualSqlDatabase(sku: unknown, region: string): Promise<number | null> {
    const m = String(sku ?? "").match(/^(GP|BC)_Gen5_(\d+)$/);
    const reg = normalizarRegion(region);
    if (!m || !reg) return null;
    const [, nivel, n] = m;

    const componentes: Componente[] = [
        {
            etiqueta: "cómputo base",
            consulta: { serviceName: "SQL Database", region: reg, filtro: { campo: "armSkuName", valor: `SQLDB_${nivel}_Compute_Gen5_${n}` } },
            elegir: (items) => masReciente(items.filter((i) => i.meterName === "vCore" && !i.tierMinimumUnits)),
            cantidad: 1,
        },
        {
            etiqueta: "licencia de SQL Server",
            consulta: { serviceName: "SQL Database", region: "Global", filtro: { campo: "skuName", valor: "vCore" } },
            elegir: (items) =>
                masReciente(items.filter((i) => i.productName === `SQL Database Single/Elastic Pool ${NIVEL_SQL[nivel]} - SQL License`)),
            cantidad: Number(n),
        },
    ];

    let total = 0;
    for (const c of componentes) {
        const p = await precioRetail(c);
        if (!p.ok) return null;
        total += p.mensual * c.cantidad;
    }
    return total;
}
