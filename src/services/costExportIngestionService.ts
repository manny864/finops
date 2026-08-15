import { listBlobs, downloadBlob, isBlobStorageEnabled } from "@/lib/azureBlobStorage";
import pool from "@/modules/storage/db";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";

export interface IngestionResult {
    success: boolean;
    tenantId: string;
    blobsProcessed: number;
    rowsIngested: number;
    error?: string;
}

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_COST_EXPORTS || "finops-cost-exports";

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

            const header = lines[0].split(",").map(h => h.replace(/^["']|["']$/g, "").trim().toLowerCase());
            
            // Localizar índices de columnas estándar de FOCUS / Azure Cost Export
            const dateIdx = header.findIndex(h => h.includes("date") || h.includes("chargeperiodstart") || h.includes("usagedatetime"));
            const subIdx = header.findIndex(h => h.includes("subscriptionid") || h.includes("subscription_guid"));
            const rgIdx = header.findIndex(h => h.includes("resourcegroup") || h.includes("resourcegroupname"));
            const srvIdx = header.findIndex(h => h.includes("servicename") || h.includes("consumedservice") || h.includes("service"));
            const costIdx = header.findIndex(h => h.includes("effectivecost") || h.includes("billedcost") || h.includes("costinbillingcurrency") || h.includes("costusd") || h.includes("cost"));

            if (costIdx === -1) continue;

            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(",").map(c => c.replace(/^["']|["']$/g, "").trim());
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

                await pool.query(
                    `INSERT INTO CostSnapshots (tenant_id, subscription_id, date, resource_group, service_name, cost_usd, EffectiveCost, currency)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'USD')
                     ON DUPLICATE KEY UPDATE
                        cost_usd = VALUES(cost_usd),
                        EffectiveCost = VALUES(EffectiveCost)`,
                    [tenantId, subId, isoDate, rg, srv, exactCost, exactCost]
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
    } catch (err: any) {
        console.error(`[CostExportIngestion] Error procesando exports para tenant ${tenantId}:`, err);
        return {
            success: false,
            tenantId,
            blobsProcessed: 0,
            rowsIngested: 0,
            error: err.message || String(err)
        };
    }
}
