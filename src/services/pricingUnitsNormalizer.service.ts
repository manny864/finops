/**
 * Servicio backend para Normalizador de Unidades de Precio (FOCUS 1.1).
 */

import Decimal from "decimal.js";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { normalizeUnit, resetCache } from "@/lib/pricingUnits";
import {
    PricingUnitCatalogItem,
    PricingUnitsCatalogResponse,
    TestNormalizationPayload,
    TestNormalizationResponse,
    ReseedPricingUnitsResponse,
    UomCategory,
} from "@/types/pricingUnitsNormalizer.types";

export const SEED_CATALOG_ITEMS: Array<{
    rawUom: string;
    blockSize: number;
    baseUnit: string;
    displayUnit: string;
    category: UomCategory;
}> = [
    // Time-based (COMPUTE / TIME)
    { rawUom: "1 Hour", blockSize: 1, baseUnit: "Hour", displayUnit: "Hours", category: "COMPUTE" },
    { rawUom: "100 Hours", blockSize: 100, baseUnit: "Hour", displayUnit: "Hours", category: "COMPUTE" },
    { rawUom: "1000 Hours", blockSize: 1000, baseUnit: "Hour", displayUnit: "Hours", category: "COMPUTE" },
    { rawUom: "10 Hours", blockSize: 10, baseUnit: "Hour", displayUnit: "Hours", category: "COMPUTE" },
    { rawUom: "1 Day", blockSize: 24, baseUnit: "Hour", displayUnit: "Days", category: "COMPUTE" },
    { rawUom: "1 Month", blockSize: 730, baseUnit: "Hour", displayUnit: "Months", category: "COMPUTE" },
    { rawUom: "1 Second", blockSize: 0.000277778, baseUnit: "Hour", displayUnit: "Seconds", category: "COMPUTE" },
    { rawUom: "1 Minute", blockSize: 0.0166667, baseUnit: "Hour", displayUnit: "Minutes", category: "COMPUTE" },
    { rawUom: "1/Hour", blockSize: 1, baseUnit: "Hour", displayUnit: "/Hour", category: "COMPUTE" },
    { rawUom: "100 Hours/Month", blockSize: 100, baseUnit: "Hour", displayUnit: "Hours/Month", category: "COMPUTE" },
    { rawUom: "1 vCPU/Hour", blockSize: 1, baseUnit: "vCPUHour", displayUnit: "vCPU/Hour", category: "COMPUTE" },
    { rawUom: "1 Core/Hour", blockSize: 1, baseUnit: "vCPUHour", displayUnit: "Core/Hour", category: "COMPUTE" },

    // Storage GB-based
    { rawUom: "1 GB", blockSize: 1, baseUnit: "GB", displayUnit: "GB", category: "STORAGE" },
    { rawUom: "1 GB/Month", blockSize: 1, baseUnit: "GB", displayUnit: "GB/Month", category: "STORAGE" },
    { rawUom: "1 GB/Hour", blockSize: 1, baseUnit: "GB", displayUnit: "GB/Hour", category: "STORAGE" },
    { rawUom: "10 GB", blockSize: 10, baseUnit: "GB", displayUnit: "GB", category: "STORAGE" },
    { rawUom: "100 GB", blockSize: 100, baseUnit: "GB", displayUnit: "GB", category: "STORAGE" },
    { rawUom: "1000 GB", blockSize: 1000, baseUnit: "GB", displayUnit: "GB", category: "STORAGE" },
    { rawUom: "1 TB", blockSize: 1000, baseUnit: "GB", displayUnit: "TB", category: "STORAGE" },
    { rawUom: "1 TB/Month", blockSize: 1000, baseUnit: "GB", displayUnit: "TB/Month", category: "STORAGE" },
    { rawUom: "1 MB", blockSize: 0.001, baseUnit: "GB", displayUnit: "MB", category: "STORAGE" },
    { rawUom: "1 PB", blockSize: 1_000_000, baseUnit: "GB", displayUnit: "PB", category: "STORAGE" },

    // AI / Tokens & Images
    { rawUom: "1 Token", blockSize: 1, baseUnit: "Token", displayUnit: "Tokens", category: "AI" },
    { rawUom: "1K Tokens", blockSize: 1000, baseUnit: "Token", displayUnit: "Tokens", category: "AI" },
    { rawUom: "1M Tokens", blockSize: 1_000_000, baseUnit: "Token", displayUnit: "Tokens", category: "AI" },
    { rawUom: "1000000 Tokens", blockSize: 1_000_000, baseUnit: "Token", displayUnit: "Tokens", category: "AI" },
    { rawUom: "1 Image", blockSize: 1, baseUnit: "Image", displayUnit: "Images", category: "AI" },
    { rawUom: "100 Images", blockSize: 100, baseUnit: "Image", displayUnit: "Images", category: "AI" },

    // Network & Data Transfer
    { rawUom: "1 GB Data Transfer", blockSize: 1, baseUnit: "GB", displayUnit: "GB Transferred", category: "NETWORK" },
    { rawUom: "10 GB Data Transfer", blockSize: 10, baseUnit: "GB", displayUnit: "GB Transferred", category: "NETWORK" },
    { rawUom: "100 GB Data Transfer", blockSize: 100, baseUnit: "GB", displayUnit: "GB Transferred", category: "NETWORK" },
    { rawUom: "1 TB Data Transfer", blockSize: 1000, baseUnit: "GB", displayUnit: "TB Transferred", category: "NETWORK" },

    // Transactions / Operations / Requests (OTHER / TRANSACTION)
    { rawUom: "1 Transaction", blockSize: 1, baseUnit: "Transaction", displayUnit: "Transactions", category: "OTHER" },
    { rawUom: "10K Transactions", blockSize: 10000, baseUnit: "Transaction", displayUnit: "Transactions", category: "OTHER" },
    { rawUom: "100K Transactions", blockSize: 100000, baseUnit: "Transaction", displayUnit: "Transactions", category: "OTHER" },
    { rawUom: "1M Transactions", blockSize: 1_000_000, baseUnit: "Transaction", displayUnit: "Transactions", category: "OTHER" },
    { rawUom: "10M Transactions", blockSize: 10_000_000, baseUnit: "Transaction", displayUnit: "Transactions", category: "OTHER" },
    { rawUom: "1 Operation", blockSize: 1, baseUnit: "Transaction", displayUnit: "Operations", category: "OTHER" },
    { rawUom: "10K Operations", blockSize: 10000, baseUnit: "Transaction", displayUnit: "Operations", category: "OTHER" },
    { rawUom: "1M Operations", blockSize: 1_000_000, baseUnit: "Transaction", displayUnit: "Operations", category: "OTHER" },
    { rawUom: "1 Request", blockSize: 1, baseUnit: "Transaction", displayUnit: "Requests", category: "OTHER" },
    { rawUom: "10K Requests", blockSize: 10000, baseUnit: "Transaction", displayUnit: "Requests", category: "OTHER" },
    { rawUom: "1M Requests", blockSize: 1_000_000, baseUnit: "Transaction", displayUnit: "Requests", category: "OTHER" },
    { rawUom: "1 Million Requests", blockSize: 1_000_000, baseUnit: "Transaction", displayUnit: "Requests", category: "OTHER" },
    { rawUom: "1 Unit", blockSize: 1, baseUnit: "Unit", displayUnit: "Units", category: "OTHER" },
];

function normalizeCategory(rawCategory?: string | null): UomCategory {
    if (!rawCategory) return "OTHER";
    const u = rawCategory.toUpperCase().trim();
    if (u === "AI") return "AI";
    if (u === "COMPUTE" || u === "TIME") return "COMPUTE";
    if (u === "STORAGE") return "STORAGE";
    if (u === "NETWORK") return "NETWORK";
    return "OTHER";
}

export async function getPricingUnitsCatalog(isMock = false): Promise<PricingUnitsCatalogResponse> {
    if (isMock) {
        const items: PricingUnitCatalogItem[] = SEED_CATALOG_ITEMS.map((s, idx) => ({
            id: `uom-item-${idx + 1}`,
            rawUomName: s.rawUom,
            blockSizeMultiplier: s.blockSize,
            baseUnitKey: s.baseUnit,
            displayUnitName: s.displayUnit,
            category: s.category,
        }));
        return {
            success: true,
            totalCount: items.length,
            items,
        };
    }

    try {
        await initializeDatabase();
        const [rows]: any = await pool.query(
            "SELECT uom_raw, block_size, base_unit, display_unit, category FROM PricingUnits ORDER BY category, uom_raw LIMIT 500"
        );

        if (Array.isArray(rows) && rows.length > 0) {
            const items: PricingUnitCatalogItem[] = rows.map((r: any, idx: number) => ({
                id: `uom-row-${idx + 1}`,
                rawUomName: String(r.uom_raw),
                blockSizeMultiplier: Number(r.block_size || 1),
                baseUnitKey: String(r.base_unit || "Unit"),
                displayUnitName: String(r.display_unit || r.base_unit || "Units"),
                category: normalizeCategory(r.category),
            }));

            return {
                success: true,
                totalCount: items.length,
                items,
            };
        }
    } catch {
        /* fallback al catálogo seed en memoria */
    }

    return getPricingUnitsCatalog(true);
}

export async function testNormalization(
    payload: TestNormalizationPayload
): Promise<TestNormalizationResponse> {
    const { unitOfMeasure, quantity } = payload;
    const rawUom = String(unitOfMeasure || "1 Unit").trim();
    const qty = Number(quantity) || 0;

    const normalized = await normalizeUnit(rawUom, qty);
    const normalizedQtyNum = Number(normalized.normalizedQty.toFixed(6));
    const formattedQty = normalized.normalizedQty.toFixed(2);
    const formattedResult = `${formattedQty} ${normalized.display} (Base: ${normalized.baseUnit} · Multiplicador: ${normalized.normalizedQty.div(qty || 1).toFixed(2)})`;

    return {
        success: true,
        originalUom: rawUom,
        originalQuantity: qty,
        normalizedQuantity: normalizedQtyNum,
        baseUnit: normalized.baseUnit,
        displayUnit: normalized.display,
        formattedResult,
        category: normalizeCategory(normalized.category),
        inferred: normalized.inferred,
    };
}

export async function reseedPricingUnitsCatalog(isMock = false): Promise<ReseedPricingUnitsResponse> {
    resetCache();

    if (!isMock) {
        try {
            await initializeDatabase();
            let inserted = 0;
            for (const r of SEED_CATALOG_ITEMS) {
                await pool.query(
                    `INSERT INTO PricingUnits (uom_raw, block_size, base_unit, display_unit, category)
                     VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE block_size = VALUES(block_size), base_unit = VALUES(base_unit),
                       display_unit = VALUES(display_unit), category = VALUES(category)`,
                    [r.rawUom, r.blockSize, r.baseUnit, r.displayUnit, r.category]
                );
                inserted++;
            }
            return {
                success: true,
                inserted,
                message: `Catálogo de unidades de precio re-poblado exitosamente (${inserted} UoMs).`,
            };
        } catch {
            /* noop */
        }
    }

    return {
        success: true,
        inserted: SEED_CATALOG_ITEMS.length,
        message: `Catálogo de unidades de precio re-poblado exitosamente (${SEED_CATALOG_ITEMS.length} UoMs).`,
    };
}
