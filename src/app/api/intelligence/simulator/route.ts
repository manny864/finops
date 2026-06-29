import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

// Simulated Retail API wrapper for What-If scenario
const fetchSimulatedPrices = async (scenarioData: any, tenantBaseCost: number | null) => {
    // Real implementations would call Azure Retail Prices API. Aquí calculamos a partir del
    // gasto histórico REAL del tenant (consultado por el caller). Si tenantBaseCost es null,
    // requerimos baseCost explícito en el payload — no inventamos un default.
    const baseCost = (typeof scenarioData.baseCost === 'number' && scenarioData.baseCost > 0)
        ? scenarioData.baseCost
        : tenantBaseCost;
    if (baseCost == null || baseCost <= 0) {
        throw new Error("baseCost requerido: no hay gasto histórico para este tenant. Provea scenario.baseCost o ejecute el sync de costos.");
    }
    
    // Calculate network egress factor
    const networkIncrease = scenarioData.networkIncrease || 0; // percentage
    const networkCost = (baseCost * 0.15) * (1 + (networkIncrease / 100)); // assuming 15% of cost is network
    
    // Calculate compute scaling
    const computeScale = scenarioData.computeScale || 1; // 1 = 100%, 1.5 = 150%
    const computeCost = (baseCost * 0.60) * computeScale; // assuming 60% of cost is compute
    
    // Storage scaling
    const storageScale = scenarioData.storageScale || 1;
    const storageCost = (baseCost * 0.25) * storageScale; // assuming 25% of cost is storage
    
    let projectedCost = networkCost + computeCost + storageCost;
    
    // License Inclusion (AHB)
    if (scenarioData.applyAhb) {
        projectedCost = projectedCost * 0.82; // roughly 18% savings globally for Windows/SQL
    }

    return {
        baseCost,
        projectedCost,
        breakdown: {
            compute: computeCost,
            storage: storageCost,
            network: networkCost
        }
    };
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, scenario } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        // Feature Gate Verification
        let normalizedTier = 'Enterprise'; // Default for mock tenants
        if (!isMockTenant(tenantId)) {
            const [tenants]: any = await pool.query('SELECT * FROM Tenants WHERE tenant_id = ?', [tenantId]);
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            
            const tier = tenants[0].tier;
            normalizedTier = tier.toLowerCase() === 'enterprise' ? 'Enterprise' : tier;
        }

        if (normalizedTier !== 'Enterprise') {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
        }

        // Resolver baseCost a partir del gasto real del último mes para tenants reales.
        let tenantBaseCost: number | null = null;
        if (!isMockTenant(tenantId)) {
            try {
                const [costRows]: any = await pool.query(
                    `SELECT SUM(EffectiveCost) AS total
                     FROM CostSnapshots
                     WHERE tenant_id = ? AND ChargePeriodStart >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
                    [tenantId]
                );
                if (Array.isArray(costRows) && costRows[0] && costRows[0].total != null) {
                    tenantBaseCost = Number(costRows[0].total);
                }
            } catch {
                tenantBaseCost = null;
            }
        }

        const simulation = await fetchSimulatedPrices(scenario, tenantBaseCost);

        if (!isMockTenant(tenantId)) {
            // Log simulation run only for real tenants
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status) 
                 VALUES (?, ?, ?, ?, ?)`,
                [tenantId, 'system@simulator', 'WhatIfSimulation', 'Tenant', 'Success']
            );
        }

        return NextResponse.json({ 
            success: true, 
            simulation
        });

    } catch (error: any) {
        console.error("Simulator API Error:", error);
        return NextResponse.json({ error: "Fallo al ejecutar simulación.", details: error.message }, { status: 500 });
    }
}
