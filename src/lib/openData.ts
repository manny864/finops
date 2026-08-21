/**
 * IT-08: Helper para los Open Data Sets del Microsoft FinOps Toolkit.
 * Sincroniza CSVs públicos a tablas MySQL locales y expone lookups.
 *
 * Fuente: https://github.com/microsoft/finops-toolkit/tree/main/src/open-data
 */
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';

const BASE = "https://raw.githubusercontent.com/microsoft/finops-toolkit/main/src/open-data";

const DATASETS = {
    services: { url: `${BASE}/Services.csv`, table: "OpenDataServices" },
    regions: { url: `${BASE}/Regions.csv`, table: "OpenDataRegions" },
    resourceTypes: { url: `${BASE}/ResourceTypes.csv`, table: "OpenDataResourceTypes" },
    pricingUnits: { url: `${BASE}/PricingUnits.csv`, table: "OpenDataPricingUnits" },
    commitmentEligibility: { url: `${BASE}/CommitmentDiscountEligibility.csv`, table: "OpenDataCommitmentEligibility" },
} as const;

export type OpenDataSet = keyof typeof DATASETS;

/** Parser CSV mínimo con soporte para campos entrecomillados y comas internas. */
export function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') { inQuotes = false; }
            else field += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { cur.push(field); field = ""; }
            else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ""; }
            else if (c === '\r') { /* skip */ }
            else field += c;
        }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

/** Convierte un valor textual en booleano. */
function asBool(v: string | undefined): boolean {
    if (!v) return false;
    const s = v.toLowerCase().trim();
    return s === "true" || s === "yes" || s === "1" || s === "y";
}

function asNum(v: string | undefined): number | null {
    if (!v || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Encuentra el índice de una columna por nombre (case-insensitive, tolera variantes). */
function colIdx(headers: string[], ...candidates: string[]): number {
    for (const cand of candidates) {
        const idx = headers.findIndex(h => h.replace(/\s+/g, "").toLowerCase() === cand.replace(/\s+/g, "").toLowerCase());
        if (idx >= 0) return idx;
    }
    return -1;
}

async function fetchCsv(url: string): Promise<string[][]> {
    const res = await fetch(url, { headers: { 'Accept': 'text/csv' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const text = await res.text();
    return parseCSV(text);
}

async function recordSync(dataset: string, status: string, rowCount: number, sourceUrl: string, errorMsg?: string) {
    await pool.query(
        `INSERT INTO OpenDataSyncState (dataset, last_sync_at, last_status, row_count, source_url, error_msg)
         VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_sync_at=CURRENT_TIMESTAMP, last_status=VALUES(last_status), row_count=VALUES(row_count), source_url=VALUES(source_url), error_msg=VALUES(error_msg)`,
        [dataset, status, rowCount, sourceUrl, errorMsg || null]
    );
}

async function chunkedUpsert(sql: string, rows: any[][], chunkSize = 500): Promise<number> {
    let total = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const placeholders = chunk.map(r => `(${r.map(() => "?").join(",")})`).join(",");
        const flat = chunk.flat();
        await pool.query(sql.replace("__VALUES__", placeholders), flat);
        total += chunk.length;
    }
    return total;
}

async function syncServices(): Promise<number> {
    const csv = await fetchCsv(DATASETS.services.url);
    if (csv.length < 2) return 0;
    const headers = csv[0];
    const iCons = colIdx(headers, "ConsumedService");
    const iRT = colIdx(headers, "ResourceType");
    const iName = colIdx(headers, "ServiceName");
    const iCat = colIdx(headers, "ServiceCategory");
    const iModel = colIdx(headers, "ServiceModel");
    if (iCons < 0 || iRT < 0) throw new Error("Services.csv: faltan columnas ConsumedService/ResourceType");

    const rows: any[][] = [];
    for (let r = 1; r < csv.length; r++) {
        const row = csv[r];
        rows.push([row[iCons] || "", row[iRT] || "", row[iName] || null, row[iCat] || null, row[iModel] || null]);
    }
    const sql = `INSERT INTO OpenDataServices (consumed_service, resource_type, service_name, service_category, service_model)
                 VALUES __VALUES__
                 ON DUPLICATE KEY UPDATE service_name=VALUES(service_name), service_category=VALUES(service_category), service_model=VALUES(service_model)`;
    return chunkedUpsert(sql, rows);
}

async function syncRegions(): Promise<number> {
    const csv = await fetchCsv(DATASETS.regions.url);
    if (csv.length < 2) return 0;
    const headers = csv[0];
    // El toolkit renombró la columna de valor crudo a 'OriginalValue' (antes
    // 'ResourceLocation'). Aceptamos ambos para no romper ante futuros renames.
    const iLoc = colIdx(headers, "OriginalValue", "ResourceLocation", "Location");
    const iId = colIdx(headers, "RegionId");
    const iName = colIdx(headers, "RegionName");
    if (iLoc < 0) throw new Error("Regions.csv: falta columna de valor crudo (OriginalValue/ResourceLocation)");
    const rows: any[][] = [];
    for (let r = 1; r < csv.length; r++) {
        const row = csv[r];
        const loc = (row[iLoc] || "").trim();
        if (!loc) continue;
        rows.push([loc, row[iId] || null, row[iName] || null]);
    }
    const sql = `INSERT INTO OpenDataRegions (resource_location, region_id, region_name)
                 VALUES __VALUES__
                 ON DUPLICATE KEY UPDATE region_id=VALUES(region_id), region_name=VALUES(region_name)`;
    return chunkedUpsert(sql, rows);
}

async function syncResourceTypes(): Promise<number> {
    const csv = await fetchCsv(DATASETS.resourceTypes.url);
    if (csv.length < 2) return 0;
    const headers = csv[0];
    const iType = colIdx(headers, "ResourceType");
    const iSing = colIdx(headers, "SingularDisplayName", "DisplayName");
    const iPlur = colIdx(headers, "PluralDisplayName");
    const iIcon = colIdx(headers, "Icon");
    if (iType < 0) throw new Error("ResourceTypes.csv: falta ResourceType");
    const rows: any[][] = [];
    for (let r = 1; r < csv.length; r++) {
        const row = csv[r];
        const rt = (row[iType] || "").trim();
        if (!rt) continue;
        rows.push([rt, row[iSing] || null, row[iPlur] || null, row[iIcon] || null]);
    }
    const sql = `INSERT INTO OpenDataResourceTypes (resource_type, singular_display_name, plural_display_name, icon)
                 VALUES __VALUES__
                 ON DUPLICATE KEY UPDATE singular_display_name=VALUES(singular_display_name), plural_display_name=VALUES(plural_display_name), icon=VALUES(icon)`;
    return chunkedUpsert(sql, rows);
}

async function syncPricingUnits(): Promise<number> {
    const csv = await fetchCsv(DATASETS.pricingUnits.url);
    if (csv.length < 2) return 0;
    const headers = csv[0];
    const iUOM = colIdx(headers, "UnitOfMeasure");
    const iDist = colIdx(headers, "DistinctUnits");
    const iBlock = colIdx(headers, "PricingBlockSize");
    const iPU = colIdx(headers, "PricingUnit");
    if (iUOM < 0) throw new Error("PricingUnits.csv: falta UnitOfMeasure");
    const rows: any[][] = [];
    for (let r = 1; r < csv.length; r++) {
        const row = csv[r];
        const uom = (row[iUOM] || "").trim();
        if (!uom) continue;
        rows.push([uom, asNum(row[iDist]), asNum(row[iBlock]), row[iPU] || null]);
    }
    const sql = `INSERT INTO OpenDataPricingUnits (unit_of_measure, distinct_units, pricing_block_size, pricing_unit)
                 VALUES __VALUES__
                 ON DUPLICATE KEY UPDATE distinct_units=VALUES(distinct_units), pricing_block_size=VALUES(pricing_block_size), pricing_unit=VALUES(pricing_unit)`;
    return chunkedUpsert(sql, rows);
}

async function syncCommitmentEligibility(): Promise<number> {
    const csv = await fetchCsv(DATASETS.commitmentEligibility.url);
    if (csv.length < 2) return 0;
    const headers = csv[0];
    const iMid = colIdx(headers, "MeterId");
    const iName = colIdx(headers, "MeterName");
    const iFam = colIdx(headers, "ServiceFamily");
    const iProd = colIdx(headers, "ProductName");
    const iSku = colIdx(headers, "SkuName");
    const iReg = colIdx(headers, "Region", "MeterRegion");
    // El toolkit migró a columnas FOCUS: x_CommitmentDiscountUsageEligibility
    // (uso → reserva) y x_CommitmentDiscountSpendEligibility (gasto → savings
    // plan), con valores 'Eligible'/'Not eligible'. Antes eran ReservationEligible
    // /SavingsPlanEligible booleanas. Aceptamos ambos esquemas.
    const iRi = colIdx(headers, "x_CommitmentDiscountUsageEligibility", "ReservationEligible", "RIEligible");
    const iSp = colIdx(headers, "x_CommitmentDiscountSpendEligibility", "SavingsPlanEligible", "SPEligible");
    if (iMid < 0) throw new Error("CommitmentDiscountEligibility.csv: falta MeterId");
    // 'Eligible' (esquema FOCUS) o true/yes/1 (esquema viejo) → elegible.
    const isEligible = (v: string | undefined) =>
        !!v && (v.trim().toLowerCase() === "eligible" || asBool(v));
    const seen = new Set<string>();
    const rows: any[][] = [];
    for (let r = 1; r < csv.length; r++) {
        const row = csv[r];
        const mid = (row[iMid] || "").trim();
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        rows.push([
            mid,
            iName >= 0 ? (row[iName] || null) : null,
            iFam >= 0 ? (row[iFam] || null) : null,
            iProd >= 0 ? (row[iProd] || null) : null,
            iSku >= 0 ? (row[iSku] || null) : null,
            iReg >= 0 ? (row[iReg] || null) : null,
            isEligible(row[iRi]),
            isEligible(row[iSp])
        ]);
    }
    const sql = `INSERT INTO OpenDataCommitmentEligibility (meter_id, meter_name, service_family, product_name, sku_name, region, ri_eligible, sp_eligible)
                 VALUES __VALUES__
                 ON DUPLICATE KEY UPDATE meter_name=VALUES(meter_name), service_family=VALUES(service_family), product_name=VALUES(product_name), sku_name=VALUES(sku_name), region=VALUES(region), ri_eligible=VALUES(ri_eligible), sp_eligible=VALUES(sp_eligible)`;
    return chunkedUpsert(sql, rows);
}

const SYNCERS: Record<OpenDataSet, () => Promise<number>> = {
    services: syncServices,
    regions: syncRegions,
    resourceTypes: syncResourceTypes,
    pricingUnits: syncPricingUnits,
    commitmentEligibility: syncCommitmentEligibility,
};

/** Sincroniza un dataset puntual o todos. */
export async function syncOpenDataSet(dataset: OpenDataSet | "all"): Promise<Record<string, { count: number; status: string; error?: string }>> {
    const targets: OpenDataSet[] = dataset === "all" ? (Object.keys(DATASETS) as OpenDataSet[]) : [dataset];
    const out: Record<string, { count: number; status: string; error?: string }> = {};
    for (const t of targets) {
        try {
            const count = await SYNCERS[t]();
            await recordSync(t, "ok", count, DATASETS[t].url);
            out[t] = { count, status: "ok" };
        } catch (e) {
            await recordSync(t, "error", 0, DATASETS[t].url, errorMessage(e));
            out[t] = { count: 0, status: "error", error: errorMessage(e) };
        }
    }
    return out;
}

export async function getSyncState(): Promise<any[]> {
    const [rows] = await pool.query("SELECT dataset, last_sync_at, last_status, row_count, source_url, error_msg FROM OpenDataSyncState");
    return rows as any[];
}

/** Lookup helpers (in-memory cached via simple TTL). */
const memCache: Map<string, { at: number; value: any }> = new Map();
const TTL_MS = 5 * 60_000;

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = memCache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
    const value = await loader();
    memCache.set(key, { at: Date.now(), value });
    return value;
}

export async function getServiceCategory(consumedService: string, resourceType: string): Promise<{ serviceName: string | null; serviceCategory: string | null } | null> {
    return cached(`svc:${consumedService}::${resourceType}`, async () => {
        const [rows]: any = await pool.query(
            `SELECT service_name AS serviceName, service_category AS serviceCategory
             FROM OpenDataServices WHERE consumed_service = ? AND resource_type = ? LIMIT 1`,
            [consumedService, resourceType]
        );
        return rows[0] || null;
    });
}

export async function getRegionFriendlyName(resourceLocation: string): Promise<string | null> {
    return cached(`reg:${resourceLocation}`, async () => {
        const [rows]: any = await pool.query(
            "SELECT region_name FROM OpenDataRegions WHERE resource_location = ? LIMIT 1",
            [resourceLocation]
        );
        return rows[0]?.region_name || null;
    });
}

export async function getResourceTypeMeta(resourceType: string): Promise<{ singularDisplayName: string | null; pluralDisplayName: string | null; icon: string | null } | null> {
    return cached(`rt:${resourceType}`, async () => {
        const [rows]: any = await pool.query(
            `SELECT singular_display_name AS singularDisplayName, plural_display_name AS pluralDisplayName, icon
             FROM OpenDataResourceTypes WHERE resource_type = ? LIMIT 1`,
            [resourceType]
        );
        return rows[0] || null;
    });
}
