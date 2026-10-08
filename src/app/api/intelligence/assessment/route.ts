import { NextRequest, NextResponse } from 'next/server';
import { getAssessment } from '@/modules/core/aiProvider';
import { requireTenantAccess, AuthError } from '@/lib/requestAuth';
import rateLimiter from '@/lib/rateLimiter';
import pool from '@/modules/storage/db';
import { isAiGloballyEnabled } from '@/services/aiService';
import type { RowDataPacket } from 'mysql2';

/** Assessment de IA: 5 por (tenant, usuario) cada 5 min — costoso (IA-4). */
const AI_RL_LIMIT = 5;
const AI_RL_WINDOW_MS = 5 * 60_000;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, metrics } = body;

        if (!tenantId || !metrics) {
            return NextResponse.json({ error: "Faltan parámetros (tenantId, metrics)" }, { status: 400 });
        }

        // Los mismos interruptores que ai-report: sin ellos, esta ruta seguía
        // gastando IA con la plataforma o el tenant apagados.
        if (!(await isAiGloballyEnabled())) {
            return NextResponse.json({
                error: "Las funciones de IA están deshabilitadas a nivel plataforma por un Super Administrador.",
                aiDisabled: true,
            }, { status: 403 });
        }

        const identity = await requireTenantAccess(request, tenantId);

        const [rows] = await pool.query<RowDataPacket[]>('SELECT ai_enabled FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (!rows[0]?.ai_enabled) {
            return NextResponse.json({
                error: "Las funciones de IA están deshabilitadas para este tenant. Un administrador puede reactivarlas en Configuración de IA.",
                aiDisabled: true,
            }, { status: 403 });
        }

        // Rate limit por (tenant, usuario) para evitar Denial-of-Wallet (IA-4).
        const rl = await rateLimiter.checkByKeyDistributed(`ai:assessment:${tenantId}:${identity.email}`, AI_RL_LIMIT, AI_RL_WINDOW_MS);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: `Límite de assessments IA alcanzado (${AI_RL_LIMIT} cada 5 min). Reintentá después de ${rl.resetAt.toISOString()}.` },
                { status: 429 }
            );
        }

        const markdownReport = await getAssessment(metrics, tenantId);

        return NextResponse.json({ success: true, report: markdownReport });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Error in /api/intelligence/assessment:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
