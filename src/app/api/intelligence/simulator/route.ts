import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";

// Simulated Retail API wrapper for What-If scenario
const fetchSimulatedPrices = async (scenarioData: any) => {
    // In a real implementation, this would call Azure Retail Prices API
    // https://prices.azure.com/api/retail/prices
    
    let baseCost = scenarioData.baseCost || 10000;
    
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
        const [tenants]: any = await pool.query('SELECT * FROM Tenants WHERE id = ?', [tenantId]);
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        
        const tier = tenants[0].tier;
        const normalizedTier = tier.toLowerCase() === 'enterprise' ? 'Enterprise' : tier;
        if (normalizedTier !== 'Enterprise') {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
        }

        const simulation = await fetchSimulatedPrices(scenario);

        // Log simulation run
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, 'WhatIfSimulation', 'Tenant', 'Simulation', 'Success', JSON.stringify({ scenario, simulation }), 'system@simulator']
        );

        return NextResponse.json({ 
            success: true, 
            simulation
        });

    } catch (error: any) {
        console.error("Simulator API Error:", error);
        return NextResponse.json({ error: "Fallo al ejecutar simulación.", details: error.message }, { status: 500 });
    }
}
