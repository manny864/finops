/**
 * Test notification channel endpoint.
 * Sends a test payload to a specific channel.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { deliverToChannel } from "@/lib/notifications";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Fetch channel
        const [rows] = await pool.query(
            "SELECT id, type, name, config_json FROM NotificationChannels WHERE id=? AND tenant_id=?",
            [parseInt(id), tenantId]
        );

        if ((rows as any[]).length === 0) {
            return NextResponse.json({ success: false, error: "Channel not found" }, { status: 404 });
        }

        const channel = (rows as any[])[0];

        // Se entrega SÓLO a este canal. Antes se llamaba a notifyTenant (fan-out
        // a todos los canales habilitados) y se filtraba el resultado del canal
        // pedido: probar Slack disparaba también Teams y Email, con una línea de
        // NotificationLog por cada uno — un mensaje de prueba en todos los
        // canales de producción del tenant.
        //
        // Tampoco se consulta el interruptor maestro: la prueba debe poder
        // verificar que el canal funciona aunque las notificaciones globales
        // estén apagadas, que es justo cuando se está configurando.
        const outcome = await deliverToChannel(tenantId, channel, {
            title: `Prueba de canal: ${channel.name}`,
            message: "Mensaje de prueba de CSCloudSolutions FinOps. Si lo estás viendo, este canal está configurado correctamente y va a recibir las alertas de anomalías, presupuestos y remediaciones.",
            severity: "info",
        });

        const testedAt = new Date().toISOString();

        if (outcome.success) {
            await pool.query(
                "UPDATE NotificationChannels SET last_delivered_at = NOW(), last_delivery_status = 'SUCCESS' WHERE id = ? AND tenant_id = ?",
                [channel.id, tenantId]
            ).catch(() => { /* 20260822-008 puede no haber corrido todavía */ });

            return NextResponse.json({
                success: true,
                latencyMs: outcome.latencyMs,
                message: "Mensaje de prueba entregado correctamente.",
                testedAt,
            });
        }

        await pool.query(
            "UPDATE NotificationChannels SET last_delivered_at = NOW(), last_delivery_status = 'FAILED' WHERE id = ? AND tenant_id = ?",
            [channel.id, tenantId]
        ).catch(() => { /* idem */ });

        // 200 y no 500: la petición se procesó bien; lo que falló es el destino,
        // y el detalle del fallo es justamente el resultado que el admin pidió.
        return NextResponse.json({
            success: false,
            latencyMs: outcome.latencyMs,
            error: outcome.error || "No se pudo entregar el mensaje de prueba.",
            message: outcome.error || "No se pudo entregar el mensaje de prueba.",
            testedAt,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}
