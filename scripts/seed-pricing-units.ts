/**
 * Seed inicial de PricingUnits derivado del toolkit Microsoft FinOps.
 * Subset curado de los UoMs más comunes en Azure billing.
 * Fuente: https://github.com/microsoft/finops-toolkit/blob/main/src/open-data/PricingUnits.csv
 *
 * Si la tabla está vacía, este seed corre. Para actualizar desde upstream:
 *   npm run seed:pricing-units
 */
import pool from "@/modules/storage/db";

interface SeedRow {
    uom_raw: string;
    block_size: number;
    base_unit: string;
    display_unit: string;
    category: string;
}

const SEED: SeedRow[] = [
    // Time-based
    { uom_raw: "1 Hour", block_size: 1, base_unit: "Hour", display_unit: "Hours", category: "Time" },
    { uom_raw: "100 Hours", block_size: 100, base_unit: "Hour", display_unit: "Hours", category: "Time" },
    { uom_raw: "1000 Hours", block_size: 1000, base_unit: "Hour", display_unit: "Hours", category: "Time" },
    { uom_raw: "10 Hours", block_size: 10, base_unit: "Hour", display_unit: "Hours", category: "Time" },
    { uom_raw: "1 Day", block_size: 24, base_unit: "Hour", display_unit: "Days", category: "Time" },
    { uom_raw: "1 Month", block_size: 730, base_unit: "Hour", display_unit: "Months", category: "Time" },
    { uom_raw: "1 Second", block_size: 0.000277778, base_unit: "Hour", display_unit: "Seconds", category: "Time" },
    { uom_raw: "1 Minute", block_size: 0.0166667, base_unit: "Hour", display_unit: "Minutes", category: "Time" },

    // Storage GB-based
    { uom_raw: "1 GB", block_size: 1, base_unit: "GB", display_unit: "GB", category: "Storage" },
    { uom_raw: "1 GB/Month", block_size: 1, base_unit: "GB", display_unit: "GB/Month", category: "Storage" },
    { uom_raw: "1 GB/Hour", block_size: 1, base_unit: "GB", display_unit: "GB/Hour", category: "Storage" },
    { uom_raw: "10 GB", block_size: 10, base_unit: "GB", display_unit: "GB", category: "Storage" },
    { uom_raw: "100 GB", block_size: 100, base_unit: "GB", display_unit: "GB", category: "Storage" },
    { uom_raw: "1000 GB", block_size: 1000, base_unit: "GB", display_unit: "GB", category: "Storage" },
    { uom_raw: "1 TB", block_size: 1000, base_unit: "GB", display_unit: "TB", category: "Storage" },
    { uom_raw: "1 TB/Month", block_size: 1000, base_unit: "GB", display_unit: "TB/Month", category: "Storage" },
    { uom_raw: "1 MB", block_size: 0.001, base_unit: "GB", display_unit: "MB", category: "Storage" },
    { uom_raw: "1 PB", block_size: 1_000_000, base_unit: "GB", display_unit: "PB", category: "Storage" },

    // Transactions
    { uom_raw: "1 Transaction", block_size: 1, base_unit: "Transaction", display_unit: "Transactions", category: "Transaction" },
    { uom_raw: "10K Transactions", block_size: 10000, base_unit: "Transaction", display_unit: "Transactions", category: "Transaction" },
    { uom_raw: "100K Transactions", block_size: 100000, base_unit: "Transaction", display_unit: "Transactions", category: "Transaction" },
    { uom_raw: "1M Transactions", block_size: 1_000_000, base_unit: "Transaction", display_unit: "Transactions", category: "Transaction" },
    { uom_raw: "10M Transactions", block_size: 10_000_000, base_unit: "Transaction", display_unit: "Transactions", category: "Transaction" },
    { uom_raw: "1 Operation", block_size: 1, base_unit: "Transaction", display_unit: "Operations", category: "Transaction" },
    { uom_raw: "10K Operations", block_size: 10000, base_unit: "Transaction", display_unit: "Operations", category: "Transaction" },
    { uom_raw: "1M Operations", block_size: 1_000_000, base_unit: "Transaction", display_unit: "Operations", category: "Transaction" },

    // Requests / API calls
    { uom_raw: "1 Request", block_size: 1, base_unit: "Transaction", display_unit: "Requests", category: "Transaction" },
    { uom_raw: "10K Requests", block_size: 10000, base_unit: "Transaction", display_unit: "Requests", category: "Transaction" },
    { uom_raw: "1M Requests", block_size: 1_000_000, base_unit: "Transaction", display_unit: "Requests", category: "Transaction" },
    { uom_raw: "1 Million Requests", block_size: 1_000_000, base_unit: "Transaction", display_unit: "Requests", category: "Transaction" },

    // AI / Tokens
    { uom_raw: "1K Tokens", block_size: 1000, base_unit: "Token", display_unit: "Tokens", category: "AI" },
    { uom_raw: "1M Tokens", block_size: 1_000_000, base_unit: "Token", display_unit: "Tokens", category: "AI" },
    { uom_raw: "1000000 Tokens", block_size: 1_000_000, base_unit: "Token", display_unit: "Tokens", category: "AI" },
    { uom_raw: "1 Token", block_size: 1, base_unit: "Token", display_unit: "Tokens", category: "AI" },
    { uom_raw: "1 Image", block_size: 1, base_unit: "Image", display_unit: "Images", category: "AI" },
    { uom_raw: "100 Images", block_size: 100, base_unit: "Image", display_unit: "Images", category: "AI" },

    // Networking (bandwidth)
    { uom_raw: "1/Hour", block_size: 1, base_unit: "Hour", display_unit: "/Hour", category: "Time" },
    { uom_raw: "100 Hours/Month", block_size: 100, base_unit: "Hour", display_unit: "Hours/Month", category: "Time" },

    // Units (generic)
    { uom_raw: "1 Unit", block_size: 1, base_unit: "Unit", display_unit: "Units", category: "Other" },
    { uom_raw: "10 Units", block_size: 10, base_unit: "Unit", display_unit: "Units", category: "Other" },
    { uom_raw: "100 Units", block_size: 100, base_unit: "Unit", display_unit: "Units", category: "Other" },
    { uom_raw: "1000 Units", block_size: 1000, base_unit: "Unit", display_unit: "Units", category: "Other" },

    // Compute vCPUs
    { uom_raw: "1 vCPU/Hour", block_size: 1, base_unit: "vCPUHour", display_unit: "vCPU/Hour", category: "Compute" },
    { uom_raw: "1 Core/Hour", block_size: 1, base_unit: "vCPUHour", display_unit: "Core/Hour", category: "Compute" },

    // Data transfer
    { uom_raw: "1 GB Data Transfer", block_size: 1, base_unit: "GB", display_unit: "GB Transferred", category: "Network" },
];

export async function seedPricingUnits(force = false): Promise<{ inserted: number; skipped: number }> {
    const [countRows]: any = await pool.query("SELECT COUNT(*) as n FROM PricingUnits");
    const existing = Number(countRows?.[0]?.n || 0);
    if (existing > 0 && !force) {
        console.log(`[seed-pricing-units] tabla con ${existing} filas — skip (use force=true para reseed)`);
        return { inserted: 0, skipped: SEED.length };
    }
    let inserted = 0;
    for (const r of SEED) {
        try {
            await pool.query(
                `INSERT INTO PricingUnits (uom_raw, block_size, base_unit, display_unit, category)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE block_size = VALUES(block_size), base_unit = VALUES(base_unit),
                   display_unit = VALUES(display_unit), category = VALUES(category)`,
                [r.uom_raw, r.block_size, r.base_unit, r.display_unit, r.category]
            );
            inserted++;
        } catch (e: any) {
            console.error(`[seed-pricing-units] error en ${r.uom_raw}:`, e.message);
        }
    }
    console.log(`[seed-pricing-units] OK: ${inserted}/${SEED.length} filas`);
    return { inserted, skipped: 0 };
}

// CLI entry
if (require.main === module) {
    seedPricingUnits(process.argv.includes("--force"))
        .then(r => { console.log(r); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
}
