import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { resolveSubscription, activateSubscription } from '@/lib/marketplace/azure';
import { azurePlanToTier } from '@/lib/marketplace/planMapping';

interface ActivationRequest {
  token: string;
}

/**
 * POST /api/webhooks/marketplace/azure/activate
 *
 * 1. Resolves the marketplace token with Microsoft SaaS Fulfillment API.
 * 2. Creates a Tenant linked to that subscription (or reuses existing).
 * 3. Calls activateSubscription on the Microsoft API to confirm fulfillment.
 * 4. Returns a redirectUrl for the customer to complete signup.
 */
export async function POST(request: NextRequest) {
  let body: ActivationRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  let resolved;
  try {
    resolved = await resolveSubscription(body.token);
  } catch (error) {
    console.error('Azure resolveSubscription error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve marketplace token', details: (error as Error).message },
      { status: 502 }
    );
  }

  const subscriptionId = resolved.id || resolved.subscription?.id;
  const planId = resolved.planId || resolved.subscription?.planId;
  if (!subscriptionId || !planId) {
    return NextResponse.json(
      { error: 'Resolved subscription missing id or planId' },
      { status: 502 }
    );
  }
  const tier = azurePlanToTier(planId);
  const tenantId = `azure-${subscriptionId.slice(0, 24)}`;
  const purchaserEmail =
    resolved.subscription?.beneficiary?.emailId ||
    resolved.subscription?.purchaser?.emailId ||
    null;

  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query(
      'SELECT tenant_id FROM Tenants WHERE marketplace_subscription_id = ? AND marketplace_source = ?',
      [subscriptionId, 'azure_marketplace']
    );
    const exists = Array.isArray(existing) && existing.length > 0;

    if (!exists) {
      await connection.query(
        `INSERT INTO Tenants (
          tenant_id, company_name, marketplace_source, marketplace_subscription_id,
          marketplace_plan_id, tier, subscription_status, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          resolved.subscription?.name || `Azure Customer ${subscriptionId.slice(0, 8)}`,
          'azure_marketplace',
          subscriptionId,
          planId,
          tier,
          'ACTIVE',
          'active',
        ]
      );
    }

    try {
      await activateSubscription(subscriptionId, planId, resolved.quantity);
    } catch (error) {
      console.error('Azure activateSubscription API error:', error);
      // Continue: tenant is created, Microsoft will retry via webhooks if needed
    }

    await connection.query(
      `INSERT INTO MarketplaceEvents (tenant_id, marketplace, event_type, subscription_id, raw_payload, processed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        'azure',
        'SubscriptionActivated',
        subscriptionId,
        JSON.stringify({ planId, purchaserEmail, reused: exists }),
        true,
      ]
    );

    return NextResponse.json({
      success: true,
      tenantId,
      subscriptionId,
      planId,
      tier,
      purchaserEmail,
      redirectUrl: `/signup?marketplace=azure&tenantId=${encodeURIComponent(tenantId)}&plan=${tier}`,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Subscription already registered' }, { status: 409 });
    }
    console.error('Azure activation DB error:', error);
    return NextResponse.json(
      { error: 'Failed to activate subscription', details: (error as Error).message },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
