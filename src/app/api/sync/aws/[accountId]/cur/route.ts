/**
 * POST /api/sync/aws/[accountId]/cur?tenantId=...
 *
 * Lee el ultimo periodo de facturacion del CUR desde S3 (manifest + Parquet) y
 * persiste en DOS niveles:
 *
 *   1. FocusLineItems  — grain original del CUR (recurso + hora). Es lo que
 *      habilita rightsizing, deteccion de huerfanos y chargeback por recurso.
 *   2. CostSnapshots   — agregado diario por (fecha, region, servicio), que es
 *      de donde leen los dashboards existentes. Se sigue escribiendo para no
 *      romper nada de lo ya construido sobre esa tabla.
 *
 * Antes solo se escribia (2), agregando en memoria y descartando ResourceId y
 * la hora: el dato granular no se guardaba en ningun lado.
 *
 * Idempotencia frente a restatements: se insertan las filas con el assemblyId
 * del manifest y DESPUES se borran las del mismo (tenant, cuenta, periodo) que
 * tengan otro assemblyId. Insertar-y-despues-borrar y no al reves: si el sync
 * muere a mitad de camino, el tenant se queda con los datos viejos completos
 * en vez de con un periodo vacio.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { AuthError, requireTenantRole, requireTenantTier } from '@/lib/requestAuth';
import { assertProviderIngestable, ProviderDisabledError } from '@/services/providerLifecycleService';
import { assumeRole, decryptExternalId } from '@/lib/aws/sts';
import { ingestLatestCurPeriod, type CurIngestContext } from '@/lib/aws/cur';
import type { FocusLineItem } from '@/modules/collectors/aws/awsFocusMapper';
import { allocationKey, allocationTagsForStorage, hashAllocationKey } from '@/lib/allocationTags';

interface AccountRow {
  id: string;
  tenant_id: string;
  account_id: string;
  role_arn: string;
  external_id_encrypted: string;
  cur_bucket: string | null;
  cur_prefix: string | null;
  cur_report_name: string | null;
  last_assembly_id: string | null;
}

interface AggKey {
  date: string;
  region: string;
  service: string;
  /** Etiquetas de asignacion serializadas de forma estable. */
  allocation: string;
}

function aggKey(k: AggKey): string {
  return `${k.date}|${k.region}|${k.service}|${k.allocation}`;
}

/** Recorta a la longitud de la columna para que un valor largo no aborte el INSERT. */
function clamp(v: string | undefined | null, max: number): string | null {
  if (v === undefined || v === null) return null;
  return v.length > max ? v.slice(0, max) : v;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId: pkId } = await params;
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
    await requireTenantRole(request, tenantId, ['ADMIN', 'OWNER']);
    // Multi-cloud es Enterprise (ver docs/aws-multicloud-handoff.md).
    await requireTenantTier(request, tenantId, 'Enterprise');
    // Corta el sync si AWS quedo archivado por un downgrade: es donde esta el
    // costo real (Cost Explorer cobra USD 0.01 por request), y es lo que hace
    // que bajar de plan tenga efecto economico sin borrar datos.
    await assertProviderIngestable(tenantId, 'aws');

    const [rows] = await pool.query(
      `SELECT id, tenant_id, account_id, role_arn, external_id_encrypted,
              cur_bucket, cur_prefix, cur_report_name, last_assembly_id
         FROM AwsAccounts WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [pkId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 });
    }
    const row = rows[0] as AccountRow;
    if (!row.cur_bucket || !row.cur_prefix || !row.cur_report_name) {
      return NextResponse.json(
        { error: 'CUR no configurado en esta cuenta (faltan cur_bucket / cur_prefix / cur_report_name)' },
        { status: 400 }
      );
    }

    // ?force=1 re-ingiere aunque el assemblyId no haya cambiado (util para
    // reprocesar tras un fix del mapper).
    const force = request.nextUrl.searchParams.get('force') === '1';

    await pool.query(`UPDATE AwsAccounts SET sync_status = 'SYNCING' WHERE id = ?`, [pkId]);

    const externalId = decryptExternalId(row.external_id_encrypted);
    const creds = await assumeRole(row.role_arn, externalId, `FinOps-CUR-${tenantId.slice(0, 8)}`);

    // Agregado diario para CostSnapshots (se acumula mientras streameamos).
    const agg = new Map<string, {
      date: string; region: string; service: string;
      allocation: string; allocationTags: Record<string, string> | null;
      billed: number; effective: number; amortized: number; qty: number;
      serviceCategory?: string;
    }>();
    let granularRows = 0;

    const result = await ingestLatestCurPeriod(
      creds,
      row.cur_bucket,
      row.cur_prefix,
      row.cur_report_name,
      row.account_id,
      async (batch: FocusLineItem[], ctx: CurIngestContext) => {
        // --- (1) grain original: bulk insert en FocusLineItems ---
        const values: unknown[] = [];
        const placeholders: string[] = [];
        for (const r of batch) {
          placeholders.push('(' + new Array(26).fill('?').join(',') + ')');
          values.push(
            tenantId,
            r.ProviderName,
            clamp(r.PublisherName, 100),
            clamp(r.InvoiceIssuerName, 128),
            r.BillingAccountId,
            r.SubAccountId,
            clamp(r.ServiceName, 255) || 'Unknown',
            clamp(r.ServiceCategory, 100),
            clamp(r.Region, 64),
            clamp(r.ResourceId, 512) || '',
            clamp(r.ResourceType, 128),
            r.ChargePeriodStart,
            r.ChargePeriodEnd,
            ctx.billingPeriodStart,
            ctx.billingPeriodEnd,
            r.BilledCost,
            r.EffectiveCost,
            r.AmortizedCost,
            clamp(r.BillingCurrency, 10) || 'USD',
            r.UsageQuantity ?? null,
            clamp(r.UsageUnit, 64),
            clamp(r.PricingCategory, 64),
            clamp(r.ChargeCategory, 64),
            null, // CommitmentDiscountId: el CUR lo trae en reservation/ARN, pendiente
            Object.keys(r.Tags || {}).length > 0 ? JSON.stringify(r.Tags) : null,
            ctx.assemblyId || null
          );
        }
        if (placeholders.length > 0) {
          await pool.query(
            `INSERT INTO FocusLineItems
               (tenant_id, ProviderName, PublisherName, InvoiceIssuerName,
                BillingAccountId, SubAccountId, ServiceName, ServiceCategory,
                Region, ResourceId, ResourceType,
                ChargePeriodStart, ChargePeriodEnd, BillingPeriodStart, BillingPeriodEnd,
                BilledCost, EffectiveCost, AmortizedCost, BillingCurrency,
                UsageQuantity, UsageUnit, PricingCategory, ChargeCategory,
                CommitmentDiscountId, Tags, source_assembly_id)
             VALUES ${placeholders.join(',')}`,
            values
          );
          granularRows += placeholders.length;
        }

        // --- (2) agregado diario para los dashboards existentes ---
        for (const r of batch) {
          const date = r.ChargePeriodStart.toISOString().slice(0, 10);
          const region = r.Region || '*';
          const service = r.ServiceName || 'Unknown';
          // La dimension de asignacion entra en la clave: sin esto, dos
          // recursos del mismo dia y servicio con distinto centro de costo
          // colapsan en una sola fila y el costo queda sin repartir.
          const allocation = allocationKey(r.Tags);
          const k = aggKey({ date, region, service, allocation });
          const prev = agg.get(k);
          if (prev) {
            prev.billed += r.BilledCost;
            prev.effective += r.EffectiveCost;
            prev.amortized += r.AmortizedCost;
            prev.qty += r.UsageQuantity || 0;
          } else {
            agg.set(k, {
              date,
              region,
              service,
              allocation,
              allocationTags: allocationTagsForStorage(r.Tags),
              billed: r.BilledCost,
              effective: r.EffectiveCost,
              amortized: r.AmortizedCost,
              qty: r.UsageQuantity || 0,
              serviceCategory: r.ServiceCategory,
            });
          }
        }
      },
      { skipIfAssemblyId: force ? undefined : row.last_assembly_id || undefined }
    );

    if (result.skipped) {
      await pool.query(
        `UPDATE AwsAccounts SET sync_status = 'OK', last_sync_at = NOW(), last_error_message = NULL WHERE id = ?`,
        [pkId]
      );
      return NextResponse.json({
        success: true,
        source: 'cur-s3',
        skipped: true,
        reason: 'El CUR no cambio desde el ultimo sync (mismo assemblyId). Usar ?force=1 para reprocesar.',
        assemblyId: result.assemblyId,
      });
    }

    // Purga de restatements: las filas viejas del mismo periodo/cuenta.
    let purged = 0;
    if (result.rowCount > 0 && result.assemblyId && result.billingPeriodStart) {
      const [del] = await pool.query(
        `DELETE FROM FocusLineItems
          WHERE tenant_id = ? AND BillingAccountId = ? AND BillingPeriodStart = ?
            AND (source_assembly_id IS NULL OR source_assembly_id <> ?)`,
        [tenantId, row.account_id, result.billingPeriodStart, result.assemblyId]
      );
      purged = (del as { affectedRows?: number }).affectedRows || 0;
    }

    // Bulk upsert del agregado diario
    let upserts = 0;
    for (const v of agg.values()) {
      if (v.billed === 0 && v.effective === 0) continue;
      const start = new Date(`${v.date}T00:00:00Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO CostSnapshots
           (tenant_id, subscription_id, date, resource_group, service_name,
            cost_usd, currency,
            ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName,
            BillingAccountId, SubAccountId, BilledCost, EffectiveCost, AmortizedCost,
            Quantity, ServiceFamily, Tags, allocation_tag_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cost_usd = VALUES(cost_usd),
           BilledCost = VALUES(BilledCost),
           EffectiveCost = VALUES(EffectiveCost),
           AmortizedCost = VALUES(AmortizedCost),
           Quantity = VALUES(Quantity),
           ServiceFamily = VALUES(ServiceFamily),
           ProviderName = VALUES(ProviderName),
           PublisherName = VALUES(PublisherName),
           BillingAccountId = VALUES(BillingAccountId),
           SubAccountId = VALUES(SubAccountId),
           ChargePeriodStart = VALUES(ChargePeriodStart),
           ChargePeriodEnd = VALUES(ChargePeriodEnd),
           Tags = VALUES(Tags)`,
        [
          tenantId, row.account_id, v.date, v.region, v.service,
          v.billed, 'USD',
          start, end, 'AWS', 'Amazon Web Services',
          row.account_id, row.account_id, v.billed, v.effective, v.amortized,
          v.qty || null,
          v.serviceCategory || null,
          v.allocationTags ? JSON.stringify(v.allocationTags) : null,
          hashAllocationKey(v.allocation),
        ]
      );
      upserts++;
    }

    await pool.query(
      `UPDATE AwsAccounts
          SET sync_status = 'OK', last_sync_at = NOW(), last_error_message = NULL,
              last_assembly_id = ?
        WHERE id = ?`,
      [result.assemblyId || null, pkId]
    );

    return NextResponse.json({
      success: true,
      source: 'cur-s3',
      bucket: row.cur_bucket,
      reportName: row.cur_report_name,
      assemblyId: result.assemblyId,
      billingPeriodStart: result.billingPeriodStart,
      billingPeriodEnd: result.billingPeriodEnd,
      filesProcessed: result.filesProcessed,
      rowsRead: result.rowCount,
      granularRowsInserted: granularRows,
      staleRowsPurged: purged,
      aggregatedRows: agg.size,
      rowsUpserted: upserts,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ProviderDisabledError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Error';
    console.error('POST /api/sync/aws/[accountId]/cur:', e);
    try {
      await pool.query(
        `UPDATE AwsAccounts SET sync_status = 'ERROR', last_error_message = ? WHERE id = ?`,
        [msg.slice(0, 1000), pkId]
      );
    } catch { /* ignore */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
