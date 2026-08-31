import { listBlobs, downloadBlob, isBlobStorageEnabled } from "@/lib/azureBlobStorage";
import pool from "@/modules/storage/db";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";
import { errorMessage } from '@/lib/apiErrors';

export interface IngestionResult {
    success: boolean;
    tenantId: string;
    blobsProcessed: number;
    rowsIngested: number;
    error?: string;
}

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_COST_EXPORTS || "finops-cost-exports";

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

        // Ordenar para procesar el más reciente primero
        const csvBlobs = blobNames.filter(b => b.endsWith(".csv") || b.endsWith(".csv.gz") || b.endsWith(".json"));
        let totalRows = 0;
        let processedCount = 0;

        for (const blobName of csvBlobs.slice(-5)) {
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
            const costIdx = header.findIndex(h => h.includes("effectivecost") || h.includes("billedcost") || h.includes("costinbillingcurrency") || h.includes("costusd") || h.includes("cost"));
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

                const exactCost = toMoneyNumber(costDecimal);

                const tagsJson = tagsIdx >= 0 ? parseExportTags(cols[tagsIdx]) : null;
                const resourceId = resourceIdIdx >= 0 ? (cols[resourceIdIdx] || null) : null;

                // COALESCE en el UPDATE: si una re-ingesta trae la fila sin tags
                // (export legacy sin esa columna), no borra los que ya estaban.
                await pool.query(
                    `INSERT INTO CostSnapshots (tenant_id, subscription_id, date, resource_group, service_name, cost_usd, EffectiveCost, currency, Tags, ResourceId)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?)
                     ON DUPLICATE KEY UPDATE
                        cost_usd = VALUES(cost_usd),
                        EffectiveCost = VALUES(EffectiveCost),
                        Tags = COALESCE(VALUES(Tags), Tags),
                        ResourceId = COALESCE(VALUES(ResourceId), ResourceId)`,
                    [tenantId, subId, isoDate, rg, srv, exactCost, exactCost, tagsJson, resourceId]
                );
                totalRows++;
            }
            processedCount++;
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
