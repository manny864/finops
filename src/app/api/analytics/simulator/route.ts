/**
 * GET / POST /api/analytics/simulator
 * FinOps What-If Scenario Modeling, Rate Optimization & Waterfall Attribution
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantAccess y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  simulateScenario,
  getMockWhatIfPayload,
  assembleLiveWhatIf,
} from "@/services/azureWhatIfSimulator.service";
import {
  type SavedWhatIfScenario,
  type WhatIfParameters,
} from "@/types/azureWhatIf.types";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockWhatIfPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    // Consultar gasto base real del tenant (últimos 30 días)
    const [spendRows]: any = await pool.query(
      `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS spend
       FROM CostSnapshots
       WHERE tenant_id=? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)`,
      [tenantId]
    );
    const realBaseCostUSD = Number(spendRows[0]?.spend || 0);

    // Consultar escenarios guardados en base de datos
    let savedScenarios: SavedWhatIfScenario[] = [];
    try {
      const [rows]: any = await pool.query(
        `SELECT id, name, base_cost, projected_cost, inputs_json, created_at
         FROM WhatIfScenarios
         WHERE tenant_id=?
         ORDER BY created_at DESC
         LIMIT 50`,
        [tenantId]
      );

      savedScenarios = rows.map((r: any) => {
        let params: WhatIfParameters;
        try {
          params = typeof r.inputs_json === "string" ? JSON.parse(r.inputs_json) : r.inputs_json;
        } catch {
          params = {
            baseCostUSD: Number(r.base_cost),
            computeGrowthPercentage: 0,
            storageGrowthPercentage: 0,
            networkEgressGrowthPercentage: 0,
            commitmentCoveragePercentage: 0,
            commitmentTerm: "1Year",
            spotMixPercentage: 0,
            offHoursShutdownPercentage: 0,
            enableAhbLicensing: false,
            enableArm64Modernization: false,
          };
        }

        const simResult = simulateScenario(params);
        return {
          id: r.id,
          name: r.name,
          baseCostUSD: Number(r.base_cost),
          projectedCostUSD: Number(r.projected_cost),
          deltaPercentage: simResult.deltaPercentage,
          parameters: params,
          simulationResult: simResult,
          createdAt: r.created_at,
        };
      });
    } catch {
      // Si la tabla no existiera o fallara
      savedScenarios = [];
    }

    const payload = assembleLiveWhatIf({
      realBaseCostUSD,
      savedScenarios,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Simulator] GET Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error procesando el simulador de escenarios" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { tenantId, action, parameters, name } = body || {};

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // Acción: Solo calcular simulación
    if (action === "CALCULATE" || !action) {
      if (!parameters) {
        return NextResponse.json({ error: "Faltan parámetros de simulación" }, { status: 400 });
      }
      const simulationResult = simulateScenario(parameters);
      return NextResponse.json({ success: true, simulationResult });
    }

    // Acción: Guardar Escenario
    if (action === "SAVE_SCENARIO") {
      if (!isMockTenant(tenantId)) {
        await requireTenantAccess(request, tenantId);
      }

      if (!parameters || !name) {
        return NextResponse.json({ error: "Falta nombre o parámetros" }, { status: 400 });
      }

      const simulationResult = simulateScenario(parameters);
      const scenarioId = `scen-${crypto.randomUUID().slice(0, 8)}`;

      if (!isMockTenant(tenantId)) {
        try {
          await pool.query(
            `INSERT INTO WhatIfScenarios
             (id, tenant_id, user_email, name, inputs_json, base_cost, projected_cost, compute_cost, storage_cost, network_cost, currency)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              scenarioId,
              tenantId,
              "user@finops.corp",
              name.slice(0, 120),
              JSON.stringify(parameters),
              parameters.baseCostUSD,
              simulationResult.netProjectedCostUSD,
              simulationResult.grossProjectedCostUSD * 0.6,
              simulationResult.grossProjectedCostUSD * 0.25,
              simulationResult.grossProjectedCostUSD * 0.15,
              "USD",
            ]
          );
        } catch (dbErr) {
          console.warn("[API Simulator] Save scenario DB warning:", errorMessage(dbErr));
        }
      }

      const savedScenario: SavedWhatIfScenario = {
        id: scenarioId,
        name,
        baseCostUSD: parameters.baseCostUSD,
        projectedCostUSD: simulationResult.netProjectedCostUSD,
        deltaPercentage: simulationResult.deltaPercentage,
        parameters,
        simulationResult,
        createdAt: new Date().toISOString(),
      };

      return NextResponse.json({ success: true, savedScenario });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Simulator] POST Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error ejecutando la simulación What-If" },
      { status: 500 }
    );
  }
}
