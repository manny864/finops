// RBAC: requiere membresía al tenant (requireTenantAccess) — previene IDOR
// (lectura de gasto real vía CostSnapshots y escritura en ActionLogs).
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { runScenario, parseInputs } from "@/lib/simulator/engine";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, scenario } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

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

        const baseCost = (typeof scenario?.baseCost === 'number' && scenario.baseCost > 0)
            ? scenario.baseCost
            : tenantBaseCost;
        if (baseCost == null || baseCost <= 0) {
            return NextResponse.json(
                { error: "baseCost requerido: no hay gasto histórico para este tenant. Provea scenario.baseCost o ejecute el sync de costos." },
                { status: 400 }
            );
        }

        const inputs = parseInputs(scenario);
        const simulation = runScenario(baseCost, inputs);

        if (!isMockTenant(tenantId)) {
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status) 
                 VALUES (?, ?, ?, ?, ?)`,
                [tenantId, 'system@simulator', 'WhatIfSimulation', 'Tenant', 'Success']
            );
        }

        return NextResponse.json({
            success: true,
            simulation,
            inputs,
        });

    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Simulator API Error:", error);
        return NextResponse.json({ error: "Fallo al ejecutar simulación.", details: error.message }, { status: 500 });
    }
}
