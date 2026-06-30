/**
 * AWS implementation of the CloudProvider interface.
 *
 * - getBillingData: Cost Explorer GetCostAndUsage (last N days)
 * - getActiveResources: EC2 DescribeInstances per region (default us-east-1)
 * - getRecommendations: stub for v2 (requires Compute Optimizer / Trusted Advisor)
 *
 * Tenant is identified by tenantId; the AWS account to query is selected via
 * the second parameter (overloaded "subscriptionId" → AWS account_id in our
 * AwsAccounts table). We fetch the role_arn + encrypted external_id from DB
 * and AssumeRole.
 */

import { CloudProvider } from '../types';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import pool from '@/modules/storage/db';
import { assumeRole, decryptExternalId, type AwsTempCredentials } from '@/lib/aws/sts';
import { getCostAndUsage } from '@/lib/aws/costExplorer';
import { mapCeDailyToFocus } from './awsFocusMapper';

interface AwsAccountRow {
    id: string;
    tenant_id: string;
    account_id: string;
    role_arn: string;
    external_id_encrypted: string;
}

async function getCredsForAccount(tenantId: string, awsAccountId: string): Promise<{ creds: AwsTempCredentials; row: AwsAccountRow }> {
    const [rows] = await pool.query(
        `SELECT id, tenant_id, account_id, role_arn, external_id_encrypted
           FROM AwsAccounts WHERE tenant_id = ? AND account_id = ? LIMIT 1`,
        [tenantId, awsAccountId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`AWS account ${awsAccountId} not configured for tenant ${tenantId}`);
    }
    const row = rows[0] as AwsAccountRow;
    const externalId = decryptExternalId(row.external_id_encrypted);
    const creds = await assumeRole(row.role_arn, externalId, `FinOps-${tenantId.slice(0, 8)}`);
    return { creds, row };
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export class AwsProvider implements CloudProvider {
    async getBillingData(tenantId: string, awsAccountId: string, timeframe: string = 'MonthToDate'): Promise<unknown> {
        const { creds, row } = await getCredsForAccount(tenantId, awsAccountId);
        const end = new Date();
        const start = new Date();
        if (timeframe === 'MonthToDate') {
            start.setDate(1);
        } else {
            start.setDate(start.getDate() - 30);
        }
        const ceRows = await getCostAndUsage(creds, isoDate(start), isoDate(end));
        const focus = ceRows.map((r) => mapCeDailyToFocus(r, row.account_id));
        const totalCost = focus.reduce((acc, r) => acc + r.BilledCost, 0);
        return {
            provider: 'AWS',
            account_id: awsAccountId,
            timeframe,
            totalCost,
            currency: 'USD',
            rows: focus,
        };
    }

    async getActiveResources(tenantId: string, awsAccountId: string, resourceType: string = 'ec2'): Promise<unknown[]> {
        if (resourceType !== 'ec2') {
            // MVP only supports EC2; defer RDS/S3/Lambda.
            return [];
        }
        const { creds } = await getCredsForAccount(tenantId, awsAccountId);
        const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
        const ec2 = new EC2Client({
            region,
            credentials: {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken,
            },
        });

        const out = await ec2.send(new DescribeInstancesCommand({}));
        const instances: unknown[] = [];
        for (const r of out.Reservations || []) {
            for (const i of r.Instances || []) {
                instances.push({
                    id: i.InstanceId,
                    type: i.InstanceType,
                    state: i.State?.Name,
                    region,
                    az: i.Placement?.AvailabilityZone,
                    launchedAt: i.LaunchTime,
                    tags: Object.fromEntries((i.Tags || []).map((t) => [t.Key || '', t.Value || ''])),
                });
            }
        }
        return instances;
    }

    async getRecommendations(_tenantId: string, _awsAccountId: string): Promise<unknown[]> {
        // v2: Compute Optimizer + Trusted Advisor (requires Business Support tier).
        return [];
    }
}
