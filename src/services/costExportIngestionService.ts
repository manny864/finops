import { listBlobs, downloadBlob, isBlobStorageEnabled } from "@/lib/azureBlobStorage";
import pool from "@/modules/storage/db";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";
import { errorMessage } from '@/lib/apiErrors';
import { allocationKey, hashAllocationKey } from "@/lib/allocationTags";

export interface IngestionResult {
    success: boolean;
    tenantId: string;
    blobsProcessed: number;
    rowsIngested: number;
    error?: string;
}

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_COST_EXPORTS || "finops-cost-exports";

/** Cuántas ejecuciones de export se leen por corrida, de la más vieja a la más nueva. */
const MAX_EJECUCIONES = 5;

/**
 * Separa una línea CSV respetando las comillas.
 *
 * El parseo anterior era `line.split(",")`, que alcanzaba mientras sólo se
 * leían fecha, suscripción, RG, servicio y costo — ninguno lleva comas. Deja de
 * alcanzar al leer la columna de etiquetas: Azure la exporta entre comillas y
 * CON comas adentro (`"{""env"":""prod"",""owner"":""x""}"`), así que un split
 * plano la parte en pedazos y **desalinea todas las columnas siguientes**,
 * corrompiendo el costo. Por eso el parser va junto con MEJ-30 y no después.
 *
 * Implementa lo que usa Azure: comillas dobles para citar y `""` para escapar
 * una comilla dentro del campo (RFC 4180). No cubre saltos de línea dentro de
 * un campo — el llamador ya divide por líneas antes de llegar acá.
 */
export function splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // comilla escapada: consume la segunda
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            fields.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields.map((f) => f.trim());
}

/**
 * Normaliza la columna de etiquetas del export a JSON válido para la columna
 * `Tags` (tipo JSON en MySQL).
 *
 * Azure usa dos formatos según el tipo de export:
 *   - FOCUS / exports nuevos: JSON completo — `{"env":"prod"}`
 *   - Exports legacy: los pares SIN llaves — `"env": "prod","owner": "x"`
 * Devuelve null si no hay etiquetas o si no se puede interpretar, para no
 * escribir basura en una columna JSON (MySQL rechazaría el INSERT completo).
 */
export function parseExportTags(raw: string | undefined): string | null {
    const value = (raw || "").trim();
    if (!value) return null;

    const candidate = value.startsWith("{") ? value : `{${value}}`;
    try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (Object.keys(parsed).length === 0) return null;
        return JSON.stringify(parsed);
    } catch {
        return null;
    }
}

/**
 * Importe de una columna opcional del export.
 *
 * Devuelve null —y no 0— cuando la columna no vino o no es numérica. La
 * diferencia importa: 0 en `ListCost` significaría "precio de lista cero", que
 * al calcular la tasa de ahorro se lee como 100% de descuento. null significa
 * "no lo sabemos", y esa fila queda fuera del cálculo y se reporta aparte.
 */
export function importeDeColumna(cols: string[], idx: number): number | null {
    if (idx < 0 || idx >= cols.length) return null;
    const raw = (cols[idx] || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return toMoneyNumber(new Decimal(n));
}

/**
 * Agrupa los blobs por la carpeta de ejecución que los contiene.
 *
 * Un export de Cost Management escribe en
 * `Contenedor/Directorio/NombreExport/[YYYYMMDD-YYYYMMDD]/[RunID]/`, y dentro
 * de esa carpeta deja el manifiesto y **varias particiones** del mismo dataset.
 * El particionado está siempre activo y no se puede desactivar, ni siquiera
 * para exports chicos (learn.microsoft.com, "Create and manage exports" →
 * File partitioning).
 *
 * Por eso la unidad de agregación es la CARPETA y no el archivo: la carpeta es
 * el dataset completo de un período. Sumar por archivo y pisar dejaría sólo la
 * última partición —el mismo bug que este cambio viene a arreglar, movido un
 * nivel más arriba—. Y sumar entre carpetas multiplicaría el mes: con
 * "Overwrite data" apagado hay un RunID por día y cada uno reexpone el mes
 * entero, así que 30 carpetas serían 30 veces el mismo costo.
 */
export function agruparPorEjecucion(blobNames: string[]): Map<string, string[]> {
    const porCarpeta = new Map<string, string[]>();
    for (const name of blobNames) {
        const corte = name.lastIndexOf("/");
        const carpeta = corte >= 0 ? name.slice(0, corte) : "";
        const actual = porCarpeta.get(carpeta);
        if (actual) actual.push(name);
        else porCarpeta.set(carpeta, [name]);
    }
    return porCarpeta;
}

/** Acumulador de una fila de `CostSnapshots` mientras se leen las líneas del export. */
interface FilaAgregada {
    subId: string;
    isoDate: string;
    rg: string;
    srv: string;
    allocHash: string;
    tagsComunes: Record<string, unknown>;
    cost: Decimal;
    billed: Decimal;
    effective: Decimal;
    list: Decimal;
    contracted: Decimal;
    lineas: number;
    conListCost: number;
    conContractedCost: number;
    resourceId: string | null;
}

/**
 * Ingiere archivos exportados de Azure Cost Management (FOCUS / CSV)
 * desde el Storage Account configurado en Terraform y los vuelca
 * a la tabla MySQL CostSnapshots.
 */
export async function ingestCostExportsForTenant(tenantId: string): Promise<IngestionResult> {
    if (!isBlobStorageEnabled()) {
        return {
            success: false,
            tenantId,
            blobsProcessed: 0,
            rowsIngested: 0,
            error: "Blob Storage no está habilitado (falta AZURE_STORAGE_CONNECTION_STRING)"
        };
    }

    try {
        const prefix = `focus-cost-data/${tenantId}/`;
        let blobNames = await listBlobs(CONTAINER_NAME, prefix);
        if (blobNames.length === 0) {
            // Probar sin prefijo de tenant (ej. root folder focus-cost-data)
            blobNames = await listBlobs(CONTAINER_NAME, "focus-cost-data/");
        }

        if (blobNames.length === 0) {
            return {
                success: true,
                tenantId,
                blobsProcessed: 0,
                rowsIngested: 0,
            };
        }

        // El manifiesto acompaña a cada ejecución pero no trae filas de costo.
        const csvBlobs = blobNames.filter(b =>
            (b.endsWith(".csv") || b.endsWith(".csv.gz") || b.endsWith(".json"))
            && !b.endsWith("manifest.json"));
        let totalRows = 0;
        let processedCount = 0;

        // La ventana se cuenta en ejecuciones, no en archivos: cortar por
        // archivo podía partir una ejecución al medio y quedarse con algunas de
        // sus particiones, que es leer una fracción del período.
        const ejecuciones = [...agruparPorEjecucion(csvBlobs).values()].slice(-MAX_EJECUCIONES);

        for (const blobsDeLaEjecucion of ejecuciones) {
            // Una entrada por clave única de CostSnapshots. El export es a nivel
            // de línea —un renglón por recurso, por medidor y por día—, así que
            // muchísimas líneas caen en la misma clave y hay que SUMARLAS. El
            // upsert de antes las pisaba una a una y sobrevivía sólo la última.
            const agregado = new Map<string, FilaAgregada>();

            for (const blobName of blobsDeLaEjecucion) {
                const buffer = await downloadBlob(CONTAINER_NAME, blobName);
                if (!buffer) continue;

                const text = buffer.toString("utf-8");
                const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                if (lines.length <= 1) continue;

                const header = splitCsvLine(lines[0]).map(h => h.replace(/^["']|["']$/g, "").trim().toLowerCase());

                // Localizar índices de columnas estándar de FOCUS / Azure Cost Export
                const dateIdx = header.findIndex(h => h.includes("date") || h.includes("chargeperiodstart") || h.includes("usagedatetime"));
                const subIdx = header.findIndex(h => h.includes("subscriptionid") || h.includes("subscription_guid"));
                const rgIdx = header.findIndex(h => h.includes("resourcegroup") || h.includes("resourcegroupname"));
                const srvIdx = header.findIndex(h => h.includes("servicename") || h.includes("consumedservice") || h.includes("service"));

                // Las columnas de costo se buscan por nombre EXACTO. La búsqueda
                // laxa de antes (`includes("cost")`) devolvía la PRIMERA columna que
                // contuviera la palabra: en un export FOCUS eso es siempre
                // BilledCost, y ese mismo número se escribía además en
                // `EffectiveCost`. Las dos columnas quedaban idénticas y el
                // descuento por compromiso —lo único que separa una de otra—
                // desaparecía de la base. Nombres verificados contra la referencia
                // del dataset FOCUS de Azure (learn.microsoft.com, "FOCUS cost and
                // usage details file schema", versiones 1.0 y 1.2-preview).
                const billedIdx = header.indexOf("billedcost");
                const effectiveIdx = header.indexOf("effectivecost");
                const listIdx = header.indexOf("listcost");
                const contractedIdx = header.indexOf("contractedcost");

                // `cost_usd` es el costo que suma el resto del producto. Toma el
                // mismo valor que ya venía tomando (BilledCost en un export FOCUS)
                // para que este cambio no mueva ningún tablero; la búsqueda laxa
                // queda sólo como último recurso para exports legacy.
                const costIdx = billedIdx >= 0
                    ? billedIdx
                    : header.findIndex(h => h.includes("effectivecost") || h.includes("billedcost") || h.includes("costinbillingcurrency") || h.includes("costusd") || h.includes("cost"));
                // MEJ-30: estas dos columnas se descartaban, y son las que faltaban
                // para que un Cost Group por etiqueta diera el costo exacto de los
                // recursos etiquetados en vez de aproximarlo por Resource Group.
                // `tags` es exacto en FOCUS; en exports legacy viene como pares sin
                // llaves (ver parseExportTags).
                const tagsIdx = header.findIndex(h => h === "tags" || h.endsWith("tags"));
                // El id del recurso cambia de nombre según el export: ResourceId
                // (FOCUS), InstanceId o InstanceName (legacy de Azure).
                const resourceIdIdx = header.findIndex(h => h === "resourceid" || h === "instanceid" || h === "instancename");

                if (costIdx === -1) continue;
                processedCount++;

                for (let i = 1; i < lines.length; i++) {
                    // Sin el `replace` de comillas que había antes: `splitCsvLine` ya
                    // las consume. Aplicarlo acá destruiría un campo de tags legacy,
                    // que empieza y termina con comilla (`"env": "prod"`).
                    const cols = splitCsvLine(lines[i]);
                    if (cols.length <= costIdx) continue;

                    const rawDate = dateIdx >= 0 ? cols[dateIdx] : new Date().toISOString().slice(0, 10);
                    const isoDate = rawDate.slice(0, 10);
                    const subId = subIdx >= 0 ? cols[subIdx] : "default";
                    const rg = rgIdx >= 0 ? (cols[rgIdx] || "ungrouped") : "ungrouped";
                    const srv = srvIdx >= 0 ? (cols[srvIdx] || "Other") : "Other";
                    const rawCost = cols[costIdx] || "0";

                    const costDecimal = new Decimal(isNaN(Number(rawCost)) ? 0 : rawCost);
                    if (costDecimal.isZero()) continue;

                    // Precio de lista y precio contratado: los dos escalones que
                    // faltaban para que `ListCost - EffectiveCost` sea el ahorro
                    // real. Si el export no los trae (los legacy no los tienen) van
                    // null, no 0.
                    const listCost = importeDeColumna(cols, listIdx);
                    const contractedCost = importeDeColumna(cols, contractedIdx);
                    const effectiveCost = importeDeColumna(cols, effectiveIdx) ?? toMoneyNumber(costDecimal);
                    const billedCost = importeDeColumna(cols, billedIdx) ?? toMoneyNumber(costDecimal);

                    const tagsRaw = tagsIdx >= 0 ? parseExportTags(cols[tagsIdx]) : null;
                    const tagsObj = tagsRaw ? JSON.parse(tagsRaw) : null;
                    // Las etiquetas de asignación entran en la clave única, así que
                    // dos recursos con distinto centro de costo NO se suman entre
                    // sí. Sin esto todo caía en el cubo '' (sin asignar) y el
                    // colapso era todavía mayor (ver allocationTags.ts).
                    const allocHash = hashAllocationKey(allocationKey(tagsObj));

                    const resourceId = resourceIdIdx >= 0 ? (cols[resourceIdIdx] || null) : null;
                    const clave = [subId, isoDate, rg, srv, allocHash].join("\u0001");

                    let fila = agregado.get(clave);
                    if (!fila) {
                        fila = {
                            subId, isoDate, rg, srv, allocHash,
                            tagsComunes: { ...(tagsObj || {}) },
                            cost: new Decimal(0),
                            billed: new Decimal(0),
                            effective: new Decimal(0),
                            list: new Decimal(0),
                            contracted: new Decimal(0),
                            lineas: 0,
                            conListCost: 0,
                            conContractedCost: 0,
                            resourceId,
                        };
                        agregado.set(clave, fila);
                    } else {
                        // `Tags` queda con la INTERSECCIÓN de las etiquetas de
                        // las líneas sumadas: los pares que traen todas con el
                        // mismo valor. Guardar el JSON de una sola línea
                        // afirmaría que sus etiquetas valen para las otras, que
                        // es justo lo que una fila agregada no puede afirmar.
                        //
                        // No se recorta al subconjunto de asignación a
                        // propósito: un Cost Group puede definirse sobre
                        // CUALQUIER clave de tag (`JSON_EXTRACT(Tags,
                        // CONCAT('$.', ?))` en api/cost-groups), así que tirar
                        // las claves de afuera de esa lista dejaría esos grupos
                        // en $0 sin ningún error.
                        const propias = (tagsObj || {}) as Record<string, unknown>;
                        for (const k of Object.keys(fila.tagsComunes)) {
                            if (JSON.stringify(propias[k]) !== JSON.stringify(fila.tagsComunes[k])) {
                                delete fila.tagsComunes[k];
                            }
                        }
                    }

                    fila.cost = fila.cost.plus(costDecimal);
                    fila.billed = fila.billed.plus(billedCost);
                    fila.effective = fila.effective.plus(effectiveCost);
                    fila.lineas++;
                    if (listCost !== null) {
                        fila.list = fila.list.plus(listCost);
                        fila.conListCost++;
                    }
                    if (contractedCost !== null) {
                        fila.contracted = fila.contracted.plus(contractedCost);
                        fila.conContractedCost++;
                    }
                    // Una fila agregada puede venir de muchos recursos distintos.
                    // Guardar el id de uno haría creer que la fila es de ese
                    // recurso; si no son todos el mismo, no se guarda ninguno.
                    // Una vez en null ya no vuelve: cualquier id posterior
                    // difiere de null y lo deja en null.
                    if (fila.resourceId !== resourceId) fila.resourceId = null;
                }
            }

            for (const fila of agregado.values()) {
                // Un precio de lista PARCIAL es peor que ninguno: sumar sólo las
                // líneas que lo traen da un ListCost menor que el EffectiveCost
                // del grupo entero y el ESR leería un descuento negativo, o peor,
                // inventado. Si alguna línea del grupo no lo trae, el grupo queda
                // en null, que es lo que el resto del pipeline ya interpreta como
                // "no lo sabemos" y deja fuera del cálculo.
                const list = fila.conListCost === fila.lineas ? toMoneyNumber(fila.list) : null;
                const contracted = fila.conContractedCost === fila.lineas ? toMoneyNumber(fila.contracted) : null;
                const tagsJson = Object.keys(fila.tagsComunes).length > 0
                    ? JSON.stringify(fila.tagsComunes)
                    : null;

                // Idempotencia: se elige PISAR el total ya agregado, y no borrar el
                // período para reinsertarlo.
                //
                // Azure reexpone el mes en curso en cada ejecución, así que una
                // segunda pasada del mismo período tiene que dejar el total, no
                // sumarlo de nuevo. Con la agregación hecha en memoria, el total
                // que llega al UPDATE ya es el del período completo y pisarlo
                // alcanza — sin un DELETE previo, que acá sería peligroso por dos
                // razones concretas:
                //
                //   1. `CostSnapshots` la escriben DOS caminos. El principal
                //      (cron/sync, vía insertCostSnapshotRow) escribe el mismo
                //      tenant y las mismas fechas desde la Query API. Un DELETE por
                //      período borraría también esas filas, que este proceso no
                //      sabe reconstruir.
                //   2. Entre el DELETE y el INSERT el período queda en cero. Si el
                //      proceso muere ahí, el tenant ve su costo desaparecido en vez
                //      de ver el valor viejo.
                //
                // ponytail: lo que esto NO limpia es una clave que dejó de
                // aparecer en la reexposición (un recurso reclasificado). Su fila
                // vieja queda con el valor anterior. Si llega a pasar, el arreglo
                // es un DELETE acotado a (tenant, período, claves no vistas en esta
                // corrida), no un DELETE del período entero.
                await pool.query(
                    `INSERT INTO CostSnapshots (tenant_id, subscription_id, date, resource_group, service_name,
                                                cost_usd, BilledCost, EffectiveCost, ListCost, ContractedCost,
                                                currency, Tags, ResourceId, allocation_tag_hash)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        cost_usd = VALUES(cost_usd),
                        BilledCost = VALUES(BilledCost),
                        EffectiveCost = VALUES(EffectiveCost),
                        ListCost = COALESCE(VALUES(ListCost), ListCost),
                        ContractedCost = COALESCE(VALUES(ContractedCost), ContractedCost),
                        Tags = COALESCE(VALUES(Tags), Tags),
                        ResourceId = COALESCE(VALUES(ResourceId), ResourceId)`,
                    [tenantId, fila.subId, fila.isoDate, fila.rg, fila.srv,
                        toMoneyNumber(fila.cost), toMoneyNumber(fila.billed), toMoneyNumber(fila.effective),
                        list, contracted, tagsJson, fila.resourceId, fila.allocHash]
                );
                totalRows++;
            }
        }

        return {
            success: true,
            tenantId,
            blobsProcessed: processedCount,
            rowsIngested: totalRows
        };
    } catch (err) {
        console.error(`[CostExportIngestion] Error procesando exports para tenant ${tenantId}:`, err);
        return {
            success: false,
            tenantId,
            blobsProcessed: 0,
            rowsIngested: 0,
            error: errorMessage(err) || String(err)
        };
    }
}
