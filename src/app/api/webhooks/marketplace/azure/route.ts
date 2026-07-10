import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifyWebhookJwt, getSubscription } from '@/lib/marketplace/azure';
import { azurePlanToTier } from '@/lib/marketplace/planMapping';
import { notifyInternalCancellation } from '@/lib/billingAlerts';

interface AzureWebhookEvent {
  id?: string;
  activityId?: string;
  publisherId?: string;
  action: string;
  subscriptionId: string;
  planId?: string;
  quantity?: number;
  operationRequestSource?: string;
  status?: string;
  timeStamp?: string;
}

const ACTION_TO_STATUS: Record<string, string | null> = {
  Suspended: 'PAST_DUE',
  Unsubscribed: 'CANCELED',
  Reinstated: 'ACTIVE',
  Renew: 'ACTIVE',
  ChangePlan: 'ACTIVE',
  ChangeQuantity: 'ACTIVE',
};

/**
 * POST /api/webhooks/marketplace/azure
 *
 * Receives Azure Marketplace lifecycle events. JWT signed by Microsoft is
 * verified against AAD signing keys (jose) unless MARKETPLACE_SKIP_VERIFY=true.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyWebhookJwt(request.headers.get('authorization'));
  } catch (error) {
    return NextResponse.json(
      { error: 'Webhook authentication failed', details: (error as Error).message },
      { status: 401 }
    );
  }

  let event: AzureWebhookEvent;
  try {
    event = (await request.json()) as AzureWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, subscriptionId, planId, quantity } = event;
  if (!action || !subscriptionId) {
    return NextResponse.json(
      { error: 'Missing required fields: action, subscriptionId' },
      { status: 400 }
    );
  }

  const connection = await pool.getConnection();
  try {
    const [tenants] = await connection.query(
      'SELECT tenant_id FROM Tenants WHERE marketplace_subscription_id = ? AND marketplace_source = ?',
      [subscriptionId, 'azure_marketplace']
    );
    const tenant = Array.isArray(tenants) && tenants.length > 0
      ? (tenants[0] as { tenant_id: string })
      : null;

    if (!tenant) {
      // Always 200 so Microsoft does not retry forever for orphan subs
      return NextResponse.json({ message: 'Subscription not found in our system' });
    }

    const newStatus = ACTION_TO_STATUS[action];
    if (newStatus === 'CANCELED') {
      // 'Unsubscribed' no trae la fecha de fin de término en el payload del
      // webhook — a diferencia de Paddle (current_billing_period.ends_at)
      // acá hay que pedirla aparte a la Fulfillment API. Azure Marketplace
      // ya factura el período por adelantado, así que el acceso debe seguir
      // vigente hasta term.endDate (no cortar de inmediato) — mismo
      // mecanismo de access_until + /api/cron/subscription-expiry que Paddle.
      let accessUntil: Date | null = null;
      try {
        const sub = await getSubscription(subscriptionId);
        if (sub.term?.endDate) accessUntil = new Date(sub.term.endDate);
      } catch (err) {
        console.warn(`[Azure Webhook] No se pudo obtener term.endDate para ${subscriptionId}:`, (err as Error).message);
      }
      await connection.query(
        'UPDATE Tenants SET subscription_status = ?, access_until = COALESCE(?, access_until) WHERE tenant_id = ?',
        [newStatus, accessUntil, tenant.tenant_id]
      );
      await notifyInternalCancellation(tenant.tenant_id, 'Azure Marketplace', accessUntil);
    } else if (newStatus) {
      await connection.query(
        'UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?',
        [newStatus, tenant.tenant_id]
      );
    }
    if (action === 'ChangePlan' && planId) {
      await connection.query('UPDATE Tenants SET tier = ?, marketplace_plan_id = ? WHERE tenant_id = ?', [
        azurePlanToTier(planId),
        planId,
        tenant.tenant_id,
      ]);
    }
    if (action === 'ChangeQuantity' && typeof quantity === 'number') {
      // Persist quantity in plan_id JSON marker for now; future schema can dedicate column
      await connection.query('UPDATE Tenants SET marketplace_plan_id = ? WHERE tenant_id = ?', [
        `${planId || event.planId || 'unknown'}:qty=${quantity}`,
        tenant.tenant_id,
      ]);
    }

    await connection.query(
      `INSERT INTO MarketplaceEvents (tenant_id, marketplace, event_type, subscription_id, raw_payload, processed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenant.tenant_id, 'azure', action, subscriptionId, JSON.stringify(event), true]
    );

    return NextResponse.json({ message: 'Event processed', tenantId: tenant.tenant_id });
  } catch (error) {
    console.error('Azure webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook', details: (error as Error).message },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
