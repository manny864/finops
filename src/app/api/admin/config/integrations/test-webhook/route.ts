/**
 * Prueba de webhook de alertas proactivas (Teams / Slack).
 *
 * Manda un payload real al canal y reporta el status HTTP. No guarda nada: el
 * guardado es /api/admin/config/webhook.
 *
 * RBAC: `requireTenantRole(['Admin','Owner'])`. Es un POST saliente desde
 * nuestra infraestructura hacia una URL que elige el usuario — `requireTenantAccess`
 * (cualquier miembro del tenant) convertiría el endpoint en un relay de requests.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantRole } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { isMockTenant } from '@/lib/mockData';
import { assertSafeWebhookUrl } from '@/lib/webhookSecurity';

const TEST_TIMEOUT_MS = 8000;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, webhookUrl } = body as { tenantId?: string; webhookUrl?: string };

        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        if (!webhookUrl?.trim()) {
            return NextResponse.json({ error: 'Falta la URL del webhook.' }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, status: 200, message: 'Webhook de demo: envío simulado.' });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        // SSRF + allow-list (Slack/Teams/Logic Apps/PagerDuty…).
        let target: URL;
        try {
            target = await assertSafeWebhookUrl(webhookUrl.trim());
        } catch (urlErr) {
            return NextResponse.json({ ok: false, error: errorMessage(urlErr) }, { status: 400 });
        }

        // Payload que Slack y Teams renderizan igual: ambos leen `text`.
        const payload = {
            text: '✅ Prueba de conexión desde CSCloudSolutions FinOps. Si ves este mensaje, las alertas proactivas de anomalías, presupuestos y remediaciones van a llegar a este canal.',
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        try {
            const res = await fetch(target.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
                redirect: 'error', // un 302 podría llevar el POST fuera de la allow-list
            });

            const text = await res.text().catch(() => '');
            return NextResponse.json({
                ok: res.ok,
                status: res.status,
                // Slack responde "ok"/"invalid_payload" en texto plano; sirve para diagnosticar.
                detail: text.slice(0, 200) || undefined,
            });
        } catch (fetchErr) {
            const aborted = (fetchErr as Error).name === 'AbortError';
            return NextResponse.json({
                ok: false,
                error: aborted ? `El webhook no respondió en ${TEST_TIMEOUT_MS / 1000}s.` : errorMessage(fetchErr),
            });
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error('[/api/admin/config/integrations/test-webhook] error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
