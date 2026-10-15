import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";
import {
  verifyWebhookJwt,
  getSubscription,
  getOperation,
  MarketplaceVerifierNotConfigured,
  MarketplaceOperationNotFound,
  type AzureOperation,
} from '@/lib/marketplace/azure';
import { readJsonCapped, BodyLimitError } from '@/lib/readJsonCapped';
import { processWebhookOnce, inboxUnavailableResponse, type InboxEvent } from '@/lib/webhookInbox';
import { azurePlanToTier } from '@/lib/marketplace/planMapping';
import { notifyInternalCancellation } from '@/lib/billingAlerts';
import { applyTierChange } from '@/services/providerLifecycleService';

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
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const KNOWN_ACTIONS = new Set(['Suspended', 'Unsubscribed', 'Reinstated', 'Renew', 'ChangePlan', 'ChangeQuantity']);
/** Operaciones que Microsoft no aplicó: no tienen efecto de nuestro lado. */
const NOT_APPLIED_STATUSES = new Set(['Failed', 'Conflict']);

/**
 * Ámbito del cursor de orden. Plan y cantidad son independientes del estado: un cambio de
 * plan atrasado no tiene por qué descartarse por una suspensión posterior, ni al revés.
 * `Unsubscribed` se aplica siempre (una baja no se revierte) pero avanza el cursor, así un
 * `Reinstated` atrasado no la deshace.
 */
function inboxEventFor(op: AzureOperation, subscriptionId: string): InboxEvent {
  const scope = op.action === 'ChangePlan' ? 'plan' : op.action === 'ChangeQuantity' ? 'quantity' : 'status';
  const occurredAt = op.timeStamp ? new Date(op.timeStamp) : null;
  return {
    provider: 'azure',
    eventId: op.id.toLowerCase(),
    eventType: op.action,
    cursorKey: `sub:${subscriptionId.toLowerCase()}:${scope}`,
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
    enforceOrder: op.action !== 'Unsubscribed',
  };
}

/**
 * POST /api/webhooks/marketplace/azure
 *
 * Receives Azure Marketplace lifecycle events. JWT signed by Microsoft is
 * verified against AAD signing keys (jose) with mandatory audience
 * (AZURE_MARKETPLACE_AAD_APP_ID) and issuer allow-list. Fail-closed (PERIM-07).
 *
 * PERIM-08: el JWT no firma el body. Del aviso sólo se toman los IDs; acción, plan,
 * cantidad y fecha salen de la operación en la Fulfillment API. Cada operación se
 * aplica una vez (inbox durable) y un aviso atrasado no revierte un estado más nuevo.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyWebhookJwt(request.headers.get('authorization'));
  } catch (error) {
    // Sin detalles del token en la respuesta: sólo en logs.
    if (error instanceof MarketplaceVerifierNotConfigured) {
      console.error('[marketplace-webhook] verifier not configured:', error.message);
      return NextResponse.json(
        { error: 'Webhook verifier not configured' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.warn('[marketplace-webhook] authentication failed:', (error as Error).message);
    return NextResponse.json({ error: 'Webhook authentication failed' }, { status: 401 });
  }

  let event: AzureWebhookEvent;
  try {
    event = (await readJsonCapped(request, MAX_BODY_BYTES)) as AzureWebhookEvent;
  } catch (error) {
    const status = error instanceof BodyLimitError ? error.status : 400;
    return NextResponse.json({ error: 'Invalid body' }, { status });
  }
  if (!event || typeof event !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { action, subscriptionId, id: operationId } = event;
  if (typeof action !== 'string' || typeof subscriptionId !== 'string' || typeof operationId !== 'string') {
    return NextResponse.json(
      { error: 'Missing required fields: id, action, subscriptionId' },
      { status: 400 }
    );
  }
  if (!GUID.test(subscriptionId) || !GUID.test(operationId)) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }
  if (!KNOWN_ACTIONS.has(action)) {
    console.warn('[marketplace-webhook] unknown action ignored:', action.slice(0, 32));
    return NextResponse.json({ message: 'Action ignored' });
  }

  let op: AzureOperation;
  try {
    op = await getOperation(subscriptionId, operationId);
  } catch (error) {
    if (error instanceof MarketplaceOperationNotFound) {
      console.warn('[marketplace-webhook] operation not found in Fulfillment API');
      return NextResponse.json({ error: 'Unknown operation' }, { status: 400 });
    }
    // Sin confirmar la operación no se aplica nada; Microsoft reintenta.
    console.error('[marketplace-webhook] getOperation failed:', (error as Error).message);
    return inboxUnavailableResponse();
  }
  if (
    typeof op?.id !== 'string' || op.id.toLowerCase() !== operationId.toLowerCase() ||
    typeof op.subscriptionId !== 'string' || op.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase() ||
    op.action !== action
  ) {
    console.warn('[marketplace-webhook] notification does not match Fulfillment operation');
    return NextResponse.json({ error: 'Operation mismatch' }, { status: 400 });
  }

  return processWebhookOnce(inboxEventFor(op, subscriptionId), () => applyOperation(op, subscriptionId));
}

async function applyOperation(op: AzureOperation, subscriptionId: string): Promise<Response> {
  const { action, planId, quantity } = op;
  if (op.status && NOT_APPLIED_STATUSES.has(op.status)) {
    return NextResponse.json({ message: 'Operation not applied by Marketplace' });
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

    // `marketplace_status` refleja lo que dice MICROSOFT, y se mantiene aparte
    // de `subscription_status` (el estado comercial nuestro, que también mueven
    // Paddle y las acciones de SuperAdmin). Mezclarlos haría que una suspensión
    // de Azure pisara el motivo real de una baja gestionada por otro canal.
    // ChangePlan/ChangeQuantity no tocan el estado (PERIM-08): ordenan en otro
    // ámbito, y uno atrasado reactivaría una suscripción suspendida después.
    // Microsoft sólo admite esos cambios sobre suscripciones activas.
    const MARKETPLACE_STATUS: Record<string, string> = {
      Suspended: 'Suspended',
      Unsubscribed: 'Unsubscribed',
      Reinstated: 'Subscribed',
      Renew: 'Subscribed',
    };
    const mpStatus = MARKETPLACE_STATUS[action];
    if (mpStatus) {
      await connection.query(
        'UPDATE Tenants SET marketplace_status = ? WHERE tenant_id = ?',
        [mpStatus, tenant.tenant_id]
      );
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
      // MEJ-12: el estado y `canceled_at` los aplica el servicio de ciclo de
      // vida; acá queda `access_until`, que es del mecanismo de facturación.
      await connection.query(
        'UPDATE Tenants SET access_until = COALESCE(?, access_until) WHERE tenant_id = ?',
        [accessUntil, tenant.tenant_id]
      );
      await recordTenantLifecycleTransition(tenant.tenant_id, 'CANCELED', {
        actor: 'marketplace-webhook',
        reason: 'voluntary_churn',
        metadata: { subscriptionId, accessUntil: accessUntil?.toISOString() ?? null },
      });
      await notifyInternalCancellation(tenant.tenant_id, 'Azure Marketplace', accessUntil);
    } else if (newStatus) {
      // Suspended -> PAST_DUE, Reinstated -> ACTIVE. Se enrutan por el servicio
      // para que queden con fecha y en el historial (MEJ-12); cualquier otro
      // estado sigue por el UPDATE directo.
      const lifecycleEvent = newStatus === 'PAST_DUE' ? 'SUSPENDED'
        : newStatus === 'ACTIVE' ? 'REACTIVATED'
        : null;
      if (lifecycleEvent) {
        await recordTenantLifecycleTransition(tenant.tenant_id, lifecycleEvent, {
          actor: 'marketplace-webhook',
          ...(lifecycleEvent === 'SUSPENDED' ? { reason: 'payment_delinquency' as const } : {}),
          metadata: { subscriptionId, action },
        });
      } else {
        await connection.query(
          'UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?',
          [newStatus, tenant.tenant_id]
        );
      }
    }
    if (action === 'ChangePlan' && planId) {
      const [tierRows] = await connection.query('SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1', [
        tenant.tenant_id,
      ]);
      const previousTier = (tierRows as Array<{ tier?: string }>)[0]?.tier ?? null;
      const nextTier = azurePlanToTier(planId);

      await connection.query('UPDATE Tenants SET tier = ?, marketplace_plan_id = ? WHERE tenant_id = ?', [
        nextTier,
        planId,
        tenant.tenant_id,
      ]);

      if (previousTier && nextTier) {
        // Punto de choque único ante un cambio de tier. Con un solo proveedor
        // (Azure) no hay nada que reconciliar y `applyTierChange` es no-op; se
        // conserva la llamada para no volver a cablear los 3 webhooks si el
        // modelo de proveedores vuelve a crecer.
        await applyTierChange({
          tenantId: tenant.tenant_id,
          previousTier,
          nextTier,
          actor: 'azure-marketplace-webhook',
        });
      }
    }
    if (action === 'ChangeQuantity' && typeof quantity === 'number') {
      // Persist quantity in plan_id JSON marker for now; future schema can dedicate column
      await connection.query('UPDATE Tenants SET marketplace_plan_id = ? WHERE tenant_id = ?', [
        `${planId || 'unknown'}:qty=${quantity}`,
        tenant.tenant_id,
      ]);
    }

    await connection.query(
      `INSERT INTO MarketplaceEvents (tenant_id, marketplace, event_type, subscription_id, raw_payload, processed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenant.tenant_id, 'azure', action, subscriptionId, JSON.stringify(op), true]
    );

    return NextResponse.json({ message: 'Event processed', tenantId: tenant.tenant_id });
  } finally {
    connection.release();
  }
}
