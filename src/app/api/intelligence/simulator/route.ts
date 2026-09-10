// RBAC: requiere membresía al tenant (requireTenantAccess) — previene IDOR
// (lectura de gasto real vía CostSnapshots y escritura en ActionLogs).
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { runScenario, parseInputs } from "@/lib/simulator/engine";
import { AuthError, requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from '@/lib/apiErrors';

async function fetchTenantBaseCost(tenantId: string): Promise<number | null> {
    try {
        const [costRows]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
             FROM CostSnapshots
             WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
            [tenantId]
        );
        if (Array.isArray(costRows) && costRows[0] && costRows[0].total != null) {
            return Number(costRows[0].total);
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * GET /api/intelligence/simulator?tenantId=... — devuelve el costo base real
 * del tenant (mismo cálculo que usa el POST), para precargar el campo
 * editable "Costo Base" en el simulador antes de correr nada.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
            const mock = getMockDataForRoute("dashboard_summary", tenantId) as { actualCost?: number };
            return NextResponse.json({ success: true, baseCost: mock?.actualCost ?? null });
        }

        await requireTenantTier(request, tenantId, 'Enterprise', { allowSuperAdmin: true });
        const baseCost = await fetchTenantBaseCost(tenantId);
        return NextResponse.json({ success: true, baseCost });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("Simulator GET base cost error:", error);
        return serverError(error, { message: "Fallo al obtener el costo base.", status: 500 });
    }
}

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
            await requireTenantTier(request, tenantId, 'Enterprise', { allowSuperAdmin: true });
        }

        const hasClientBaseCost = typeof scenario?.baseCost === 'number' && scenario.baseCost > 0;

        // El campo "Costo Base" del simulador se precarga con el gasto real del
        // tenant (GET de este mismo endpoint) pero el usuario puede editarlo a
        // mano para simular escenarios hipotéticos ("¿y si arrancáramos desde
        // $50k?"). scenario.overrideBaseCost=true indica que el valor que viene
        // en el body es una edición intencional del usuario y debe respetarse
        // tal cual — sin eso, seguimos prefiriendo el gasto real (evita que un
        // baseCost hardcodeado/stale en el cliente pise el dato real por error,
        // que fue el bug original de esta pantalla).
        let baseCost: number | null = null;
        if (scenario?.overrideBaseCost === true && hasClientBaseCost) {
            baseCost = scenario.baseCost;
        } else {
            const tenantBaseCost = isMockTenant(tenantId) ? null : await fetchTenantBaseCost(tenantId);
            baseCost = tenantBaseCost ?? (hasClientBaseCost ? scenario.baseCost : null);
        }

        if (baseCost == null || baseCost <= 0) {
            return NextResponse.json(
                { error: "baseCost requerido: no hay gasto histórico para este tenant. Provea scenario.baseCost o ejecute el sync de costos." },
                { status: 400 }
            );
        }

        const inputs = parseInputs(scenario);
        // El default de ahorro por licencias es el valor calibrado del Azure
        // Hybrid Benefit (ver src/lib/simulator/engine.ts).
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

    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("Simulator API Error:", error);
        return serverError(error, { message: "Fallo al ejecutar simulación.", status: 500 });
    }
}
