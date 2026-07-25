import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySnsMessage, confirmSubscription, type SnsMessage } from '@/lib/marketplace/aws';
import { awsDimensionToTier } from '@/lib/marketplace/planMapping';
import { notifyInternalCancellation } from '@/lib/billingAlerts';
import { applyTierChange } from '@/services/providerLifecycleService';

interface EntitlementNotification {
  action: 'subscribe-success' | 'subscribe-fail' | 'unsubscribe-pending' | 'unsubscribe-success' | string;
  'customer-identifier': string;
  'product-code': string;
  'time-stamp'?: string;
}

/**
 * POST /api/webhooks/marketplace/aws
 *
 * Receives AWS Marketplace entitlement notifications via SNS. Verifies the
 * SNS message signature against the Amazon signing cert (unless
 * MARKETPLACE_SKIP_VERIFY=true) and auto-confirms SubscriptionConfirmation.
 */
export async function POST(request: NextRequest) {
  let msg: SnsMessage;
  try {
    msg = (await request.json()) as SnsMessage;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!msg.Type) {
    return NextResponse.json({ error: 'Missing SNS Type' }, { status: 400 });
  }

  try {
    const valid = await verifySnsMessage(msg);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid SNS signature' }, { status: 401 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'SNS verification failed', details: (error as Error).message },
      { status: 401 }
    );
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    try {
      await confirmSubscription(msg);
      return NextResponse.json({ message: 'SNS subscription confirmed' });
    } catch (error) {
      console.error('SNS confirm error:', error);
      return NextResponse.json(
        { error: 'Failed to confirm SNS subscription', details: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (msg.Type !== 'Notification') {
    return NextResponse.json({ message: 'Ignored message type' });
  }

  let payload: EntitlementNotification;
  try {
    payload = JSON.parse(msg.Message) as EntitlementNotification;
  } catch {
    return NextResponse.json({ error: 'Invalid SNS Message payload' }, { status: 400 });
  }

  const customerId = payload['customer-identifier'];
  const action = payload.action;
  if (!customerId || !action) {
    return NextResponse.json(
      { error: 'Missing customer-identifier or action' },
      { status: 400 }
    );
  }

  const connection = await pool.getConnection();
  try {
    const [tenants] = await connection.query(
      'SELECT tenant_id, marketplace_plan_id FROM Tenants WHERE marketplace_subscription_id = ? AND marketplace_source = ?',
      [customerId, 'aws_marketplace']
    );
    const tenant = Array.isArray(tenants) && tenants.length > 0
      ? (tenants[0] as { tenant_id: string; marketplace_plan_id: string | null })
      : null;

    if (!tenant) {
      // Acknowledge so SNS does not infinitely retry. Activation flow will create it.
      return NextResponse.json({ message: 'Tenant not yet provisioned' });
    }

    if (action === 'unsubscribe-pending') {
      // Grace period: el cliente canceló pero AWS todavía no cerró la
      // ventana de facturación — 'PENDING_CANCELLATION' no es un valor
      // válido del ENUM subscription_status (TRIAL/ACTIVE/PAST_DUE/
      // CANCELED/EXPIRED en Tenants), así que la UPDATE fallaba o
      // corrompía el campo según sql_mode. Usamos 'CANCELED' (sí es
      // válido) — no bloquea acceso por sí solo (ver ClientShell.tsx /
      // access_until), que es exactamente lo que se busca en este período
      // de gracia. No conocemos la fecha exacta de corte en este evento
      // (AWS no la manda), así que no seteamos access_until: el corte
      // real llega cuando AWS confirma 'unsubscribe-success' abajo.
      await connection.query(
        "UPDATE Tenants SET subscription_status = 'CANCELED' WHERE tenant_id = ?",
        [tenant.tenant_id]
      );
      await notifyInternalCancellation(tenant.tenant_id, 'AWS Marketplace', null);
    } else if (action === 'unsubscribe-success') {
      // AWS confirma acá que la ventana de facturación ya cerró — a
      // diferencia de Paddle, este evento YA es la señal autoritativa de
      // "el período pagado terminó", así que pasamos directo a EXPIRED
      // (revoca acceso ya — ver isPendingPayment en ClientShell.tsx) en
      // vez de depender de /api/cron/subscription-expiry.
      await connection.query(
        "UPDATE Tenants SET subscription_status = 'EXPIRED' WHERE tenant_id = ?",
        [tenant.tenant_id]
      );
    } else if (action === 'subscribe-success') {
      await connection.query(
        "UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?",
        ['ACTIVE', tenant.tenant_id]
      );
      // Update tier if plan changed (re-read entitlements via separate flow if needed)
      if (tenant.marketplace_plan_id) {
        const [tierRows] = await connection.query('SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1', [
          tenant.tenant_id,
        ]);
        const previousTier = (tierRows as Array<{ tier?: string }>)[0]?.tier ?? null;
        const nextTier = awsDimensionToTier(tenant.marketplace_plan_id);

        await connection.query('UPDATE Tenants SET tier = ? WHERE tenant_id = ?', [
          nextTier,
          tenant.tenant_id,
        ]);

        if (previousTier && nextTier) {
          await applyTierChange({
            tenantId: tenant.tenant_id,
            previousTier,
            nextTier,
            actor: 'aws-marketplace-webhook',
          });
        }
      }
    } else if (action === 'subscribe-fail') {
      // 'PAYMENT_FAILED' tampoco es un valor válido del ENUM — el estado
      // correcto y ya soportado en toda la app (banner PAST_DUE en
      // TrialBanner.tsx) es 'PAST_DUE'.
      await connection.query(
        "UPDATE Tenants SET subscription_status = 'PAST_DUE' WHERE tenant_id = ?",
        [tenant.tenant_id]
      );
    }

    await connection.query(
      `INSERT INTO MarketplaceEvents (tenant_id, marketplace, event_type, subscription_id, raw_payload, processed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenant.tenant_id, 'aws', action, customerId, JSON.stringify(payload), true]
    );

    return NextResponse.json({ message: 'Event processed', tenantId: tenant.tenant_id });
  } catch (error) {
    console.error('AWS webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook', details: (error as Error).message },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
