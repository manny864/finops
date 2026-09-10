/**
 * POST /api/intelligence/simulator/compare
 *   body: { tenantId, ids: string[] }   // 2..4 saved scenario ids
 *
 * Returns the snapshotted results in a uniform structure for side-by-side UI.
 * We intentionally do NOT re-run the simulation: a saved scenario is a sealed
 * snapshot that stays comparable even if the tenant baseline drifts.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

interface Row {
    id: string;
    name: string;
    notes: string | null;
    user_email: string;
    inputs_json: string;
    base_cost: string | number;
    projected_cost: string | number;
    compute_cost: string | number;
    storage_cost: string | number;
    network_cost: string | number;
    currency: string;
    created_at: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const tenantId = body?.tenantId;
        const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];

        if (!tenantId) throw new AuthError("Falta tenantId", 400);
        if (ids.length < 2 || ids.length > 4) {
            throw new AuthError("Se requieren entre 2 y 4 escenarios para comparar.", 400);
        }

        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER", "Colaborador", "Reader"]);
        if (!isMockTenant(tenantId)) await requireTenantTier(request, tenantId, "Enterprise");

        const placeholders = ids.map(() => "?").join(",");
        const [rowsRaw] = await pool.query(
            `SELECT id, name, notes, user_email, inputs_json,
                    base_cost, projected_cost, compute_cost, storage_cost, network_cost,
                    currency, created_at
               FROM WhatIfScenarios
              WHERE tenant_id = ? AND id IN (${placeholders})`,
            [tenantId, ...ids]
        );
        const rows = rowsRaw as Row[];

        // Preserve caller order so the UI can show the user-chosen layout.
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = ids.map((id: string) => byId.get(id)).filter(Boolean) as Row[];

        if (ordered.length < 2) {
            return NextResponse.json(
                { error: "Algunos escenarios no fueron encontrados en el tenant." },
                { status: 404 }
            );
        }

        const scenarios = ordered.map((r) => ({
            id: r.id,
            name: r.name,
            notes: r.notes,
            userEmail: r.user_email,
            inputs: JSON.parse(r.inputs_json || "{}"),
            baseCost: Number(r.base_cost),
            projectedCost: Number(r.projected_cost),
            delta: Number(r.projected_cost) - Number(r.base_cost),
            deltaPct:
                Number(r.base_cost) > 0
                    ? Math.round(((Number(r.projected_cost) - Number(r.base_cost)) / Number(r.base_cost)) * 1000) / 10
                    : 0,
            breakdown: {
                compute: Number(r.compute_cost),
                storage: Number(r.storage_cost),
                network: Number(r.network_cost),
            },
            currency: r.currency || "USD",
            createdAt: r.created_at,
        }));

        // Compute pairwise diff vs the first scenario as a convenience.
        const base = scenarios[0];
        const diffs = scenarios.slice(1).map((s) => ({
            id: s.id,
            vsBaselineId: base.id,
            projectedDelta: Math.round((s.projectedCost - base.projectedCost) * 100) / 100,
            projectedDeltaPct:
                base.projectedCost > 0
                    ? Math.round(((s.projectedCost - base.projectedCost) / base.projectedCost) * 1000) / 10
                    : 0,
        }));

        return NextResponse.json({ success: true, scenarios, diffs });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        const msg = e instanceof Error ? e.message : "Error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
