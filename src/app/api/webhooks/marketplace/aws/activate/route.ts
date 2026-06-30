import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { resolveCustomer, getEntitlements } from '@/lib/marketplace/aws';
import { awsDimensionToTier } from '@/lib/marketplace/planMapping';

interface ActivationRequest {
  token: string; // x-amzn-marketplace-token (registration token)
}

/**
 * POST /api/webhooks/marketplace/aws/activate
 *
 * 1. Calls ResolveCustomer on the Marketplace Metering Service to translate the
 *    POST token from the AWS landing redirect into a CustomerIdentifier.
 * 2. Reads entitlements for that customer to determine the tier dimension.
 * 3. Creates a Tenant linked to the CustomerIdentifier (idempotent).
 * 4. Returns a redirectUrl to complete signup.
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
    resolved = await resolveCustomer(body.token);
  } catch (error) {
    console.error('AWS resolveCustomer error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve marketplace token', details: (error as Error).message },
      { status: 502 }
    );
  }

  let dimension: string | undefined;
  try {
    const entitlements = await getEntitlements(resolved.customerIdentifier, resolved.productCode);
    dimension = entitlements[0]?.Dimension;
  } catch (error) {
    console.warn('AWS getEntitlements warning (continuing):', error);
  }
  const tier = awsDimensionToTier(dimension);
  const tenantId = `aws-${resolved.customerIdentifier.slice(0, 24)}`;

  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query(
      'SELECT tenant_id FROM Tenants WHERE marketplace_subscription_id = ? AND marketplace_source = ?',
      [resolved.customerIdentifier, 'aws_marketplace']
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
          `AWS Customer ${resolved.customerIdentifier.slice(0, 8)}`,
          'aws_marketplace',
          resolved.customerIdentifier,
          dimension || 'unknown',
          tier,
          'ACTIVE',
          'active',
        ]
      );
    }

    await connection.query(
      `INSERT INTO MarketplaceEvents (tenant_id, marketplace, event_type, subscription_id, raw_payload, processed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        'aws',
        'EntitlementCreated',
        resolved.customerIdentifier,
        JSON.stringify({
          dimension,
          productCode: resolved.productCode,
          customerAWSAccountId: resolved.customerAWSAccountId,
          reused: exists,
        }),
        true,
      ]
    );

    return NextResponse.json({
      success: true,
      tenantId,
      customerId: resolved.customerIdentifier,
      productCode: resolved.productCode,
      tier,
      dimension,
      redirectUrl: `/signup?marketplace=aws&tenantId=${encodeURIComponent(tenantId)}&plan=${tier}`,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Subscription already registered' }, { status: 409 });
    }
    console.error('AWS activation DB error:', error);
    return NextResponse.json(
      { error: 'Failed to activate subscription', details: (error as Error).message },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
