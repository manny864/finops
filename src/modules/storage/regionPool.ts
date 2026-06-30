import pool from "./db";

/**
 * Data Residency Pool Abstraction
 * 
 * Currently, all regions map to the same physical pool (single deployment).
 * This abstraction is in place to facilitate future per-region database routing:
 * 
 * Future state:
 * - import poolEu from "./db-eu"
 * - import poolUs from "./db-us"
 * - import poolLatam from "./db-latam"
 * - import poolApac from "./db-apac"
 * 
 * Today: tenant-declared region preference is stored but all read/write routes
 * through the same MySQL pool. This allows us to:
 * 1. Track compliance: declared residency per tenant
 * 2. Audit region changes: logged in DataResidencyChanges table
 * 3. Route when ready: swap pool references without changing calling code
 */

const POOL_BY_REGION: Record<string, typeof pool> = {
    EU: pool,
    US: pool,
    LATAM: pool,
    APAC: pool,
    GLOBAL: pool,
};

/**
 * Get the connection pool for a given region.
 * @param region Region name (EU, US, LATAM, APAC, GLOBAL) or undefined
 * @returns MySQL pool for the region
 */
export function getTenantPool(region: string | undefined | null) {
    const normalized = (region || "GLOBAL").toUpperCase();
    return POOL_BY_REGION[normalized] || pool;
}

/**
 * Resolve the tenant's declared region and return the appropriate pool.
 * This queries the Tenants table to get the tenant's data_residency setting.
 * 
 * @param tenantId Tenant ID
 * @returns Object with pool and resolved region
 */
export async function resolveTenantPool(tenantId: string) {
    try {
        const [rows]: any = await pool.query(
            "SELECT data_residency FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        const region = rows?.[0]?.data_residency || "GLOBAL";
        return { pool: getTenantPool(region), region };
    } catch (error) {
        // Fallback on query error
        return { pool: getTenantPool("GLOBAL"), region: "GLOBAL" };
    }
}
