import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySnsMessage, confirmSubscription, type SnsMessage } from '@/lib/marketplace/aws';
import { awsDimensionToTier } from '@/lib/marketplace/planMapping';

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
      // Grace period: customer canceled but billing window still open
      await connection.query(
        "UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?",
        ['PENDING_CANCELLATION', tenant.tenant_id]
      );
    } else if (action === 'unsubscribe-success') {
      await connection.query(
        "UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?",
        ['CANCELED', tenant.tenant_id]
      );
    } else if (action === 'subscribe-success') {
      await connection.query(
        "UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?",
        ['ACTIVE', tenant.tenant_id]
      );
      // Update tier if plan changed (re-read entitlements via separate flow if needed)
      if (tenant.marketplace_plan_id) {
        await connection.query('UPDATE Tenants SET tier = ? WHERE tenant_id = ?', [
          awsDimensionToTier(tenant.marketplace_plan_id),
          tenant.tenant_id,
        ]);
      }
    } else if (action === 'subscribe-fail') {
      await connection.query(
        "UPDATE Tenants SET subscription_status = ? WHERE tenant_id = ?",
        ['PAYMENT_FAILED', tenant.tenant_id]
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
