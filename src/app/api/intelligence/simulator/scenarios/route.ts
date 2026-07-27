/**
 * GET  /api/intelligence/simulator/scenarios?tenantId=...
 *   → list scenarios for tenant (most recent first), filtered to scenarios
 *     created by the calling user OR shared at tenant level. RBAC: any
 *     authenticated tenant member can list; ADMIN can see all.
 *
 * POST /api/intelligence/simulator/scenarios
 *   body: { tenantId, name, notes?, inputs, baseCost }
 *   → runs scenario, snapshots result and persists it.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { runScenario, parseInputs } from "@/lib/simulator/engine";
import { isMockTenant } from "@/lib/mockData";

interface ScenarioRow {
    id: string;
    tenant_id: string;
    user_email: string;
    name: string;
    notes: string | null;
    inputs_json: string | Record<string, unknown>;
    base_cost: string | number;
    projected_cost: string | number;
    compute_cost: string | number;
    storage_cost: string | number;
    network_cost: string | number;
    currency: string;
    created_at: string;
}

function normaliseRow(r: ScenarioRow) {
    const inputs = typeof r.inputs_json === "string" ? JSON.parse(r.inputs_json || "{}") : r.inputs_json;
    return {
        id: r.id,
        tenantId: r.tenant_id,
        userEmail: r.user_email,
        name: r.name,
        notes: r.notes,
        inputs,
        baseCost: Number(r.base_cost),
        projectedCost: Number(r.projected_cost),
        breakdown: {
            compute: Number(r.compute_cost),
            storage: Number(r.storage_cost),
            network: Number(r.network_cost),
        },
        delta: Number(r.projected_cost) - Number(r.base_cost),
        deltaPct: Number(r.base_cost) > 0
            ? Math.round(((Number(r.projected_cost) - Number(r.base_cost)) / Number(r.base_cost)) * 1000) / 10
            : 0,
        currency: r.currency || "USD",
        createdAt: r.created_at,
    };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) throw new AuthError("Falta tenantId", 400);

        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER", "Colaborador", "Reader"]);
        if (!isMockTenant(tenantId)) await requireTenantTier(request, tenantId, "Business");

        const [rows] = await pool.query(
            `SELECT id, tenant_id, user_email, name, notes, inputs_json,
                    base_cost, projected_cost, compute_cost, storage_cost, network_cost,
                    currency, created_at
               FROM WhatIfScenarios
              WHERE tenant_id = ?
              ORDER BY created_at DESC
              LIMIT 100`,
            [tenantId]
        );
        const scenarios = (rows as ScenarioRow[]).map(normaliseRow);
        return NextResponse.json({ success: true, scenarios });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = e instanceof Error ? e.message : "Error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, name, notes, inputs, baseCost, currency } = body || {};

        if (!tenantId) throw new AuthError("Falta tenantId", 400);
        if (!name || typeof name !== "string" || name.trim().length === 0) {
            throw new AuthError("name requerido", 400);
        }
        if (name.length > 120) throw new AuthError("name demasiado largo (máx 120)", 400);

        const identity = await requireTenantRole(request, tenantId, ["ADMIN", "OWNER", "Colaborador"]);
        if (!isMockTenant(tenantId)) await requireTenantTier(request, tenantId, "Business");

        const parsedInputs = parseInputs(inputs);
        const numericBase = Number(baseCost);
        if (!Number.isFinite(numericBase) || numericBase <= 0) {
            throw new AuthError("baseCost requerido y > 0", 400);
        }

        const result = runScenario(numericBase, parsedInputs);
        const id = crypto.randomUUID();

        await pool.query(
            `INSERT INTO WhatIfScenarios
               (id, tenant_id, user_email, name, notes, inputs_json,
                base_cost, projected_cost, compute_cost, storage_cost, network_cost, currency)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                tenantId,
                identity.email || "unknown",
                name.trim(),
                notes ? String(notes).slice(0, 2000) : null,
                JSON.stringify(parsedInputs),
                result.baseCost,
                result.projectedCost,
                result.breakdown.compute,
                result.breakdown.storage,
                result.breakdown.network,
                currency && typeof currency === "string" ? currency.slice(0, 8) : "USD",
            ]
        );

        // Audit log
        try {
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [tenantId, identity.email || "system", "WhatIfScenarioCreate", id, "SUCCESS"]
            );
        } catch { /* audit best-effort */ }

        return NextResponse.json({
            success: true,
            scenario: {
                id,
                tenantId,
                userEmail: identity.email,
                name: name.trim(),
                notes,
                inputs: parsedInputs,
                ...result,
                currency: currency || "USD",
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = e instanceof Error ? e.message : "Error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
