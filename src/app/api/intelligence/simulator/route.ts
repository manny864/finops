// RBAC: requiere membresía al tenant (requireTenantAccess) — previene IDOR
// (lectura de gasto real vía CostSnapshots y escritura en ActionLogs).
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { runScenario, parseInputs } from "@/lib/simulator/engine";
import { AuthError, requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, scenario } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        // Simulador What-If es feature Business (ver pricing.business.features:
        // "Escenarios What-If (Simulador de Costos)"), antes exigía Enterprise.
        if (isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        } else {
            await requireTenantTier(request, tenantId, 'Business', { allowSuperAdmin: true });
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
        return serverError(error, { message: "Fallo al ejecutar simulación.", status: 500 });
    }
}
