import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import pool from "@/modules/storage/db";
import { randomUUID } from "crypto";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
// RBAC: GET requiere pertenencia al tenant. POST (crear allocation rules) requiere Admin/Owner.

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Valida token JWT + pertenencia al tenant (evita IDOR cross-tenant).
        await requireTenantAccess(request, tenantId);

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('allocation-rules', tenantId));
        }

        const [rows] = await pool.query(
            'SELECT * FROM AllocationRules WHERE tenantId = ? ORDER BY resourceName ASC',
            [tenantId]
        );

        return NextResponse.json({ success: true, data: rows });
    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        return NextResponse.json({ error: "Fallo al obtener reglas de asignación", details: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, rules } = body;
        
        // rules is expected to be an array of: { resourceName, targetCostCenter, allocationPercentage }
        
        if (!tenantId || !rules || !Array.isArray(rules)) {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        // Write privilegiado: requiere rol Admin/Owner del tenant.
        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, message: "Reglas guardadas (Mock)" });
        }

        const connection = await pool.getConnection();
        
        // We will process them within a transaction
        await connection.query('START TRANSACTION');
        
        try {
            // Limpiar reglas viejas para los recursos que estamos actualizando
            const resourcesToUpdate = [...new Set(rules.map((r: any) => r.resourceName))];
            if (resourcesToUpdate.length > 0) {
                const placeholders = resourcesToUpdate.map(() => '?').join(',');
                await connection.query(
                    `DELETE FROM AllocationRules WHERE tenantId = ? AND resourceName IN (${placeholders})`,
                    [tenantId, ...resourcesToUpdate]
                );
            }

            // Insertar nuevas reglas
            for (const rule of rules) {
                await connection.query(
                    `INSERT INTO AllocationRules (id, tenantId, resourceName, targetCostCenter, allocationPercentage)
                     VALUES (?, ?, ?, ?, ?)`,
                    [randomUUID(), tenantId, rule.resourceName, rule.targetCostCenter, rule.allocationPercentage]
                );
            }

            await connection.query('COMMIT');
            connection.release();
            return NextResponse.json({ success: true, message: "Reglas guardadas correctamente" });
        } catch (txnErr) {
            await connection.query('ROLLBACK');
            connection.release();
            throw txnErr;
        }

    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        return NextResponse.json({ error: "Fallo al guardar reglas de asignación", details: error.message }, { status: 500 });
    }
}
