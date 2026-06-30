/**
 * AWS CUR (Cost and Usage Report) S3 ingestion.
 *
 * AWS CUR exports to S3 daily/hourly as compressed Parquet (preferred) or CSV.
 * Each report has a `manifest.json` (or `Manifest.json` in v2) at the
 * partition root listing the data files for that billing period.
 *
 * Layout (CUR 1.0):
 *   s3://<bucket>/<prefix>/<reportName>/<yyyymmdd>-<yyyymmdd>/<reportName>-Manifest.json
 *   s3://<bucket>/<prefix>/<reportName>/<yyyymmdd>-<yyyymmdd>/<reportName>-00001.snappy.parquet
 *
 * For MVP we ingest only the *current* billing period (most recent
 * yyyymmdd-yyyymmdd folder), processing all listed Parquet files. CUR 2.0 has
 * a different layout (`data/` partition) — supported best-effort.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { AwsTempCredentials } from './sts';
import { mapCurRowToFocus, type AwsCurLineItem, type FocusLineItem } from '@/modules/collectors/aws/awsFocusMapper';

export interface CurManifest {
  assemblyId: string;
  account: string;
  columns: { category: string; name: string }[];
  charset?: string;
  compression?: string;
  contentType?: string;
  reportId?: string;
  reportName?: string;
  billingPeriod?: { start: string; end: string };
  bucket?: string;
  reportKeys: string[];               // S3 keys of the Parquet/CSV files
  additionalArtifactKeys?: { artifactType: string; name: string }[];
}

function buildS3Client(creds: AwsTempCredentials, region: string): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });
}

async function streamToString(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function streamToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Find the most recent billing period folder for a given CUR report.
 * Returns the partition prefix (e.g. "cur/finops-report/20260601-20260701/")
 * or null if none found.
 */
export async function findLatestBillingPeriod(
  creds: AwsTempCredentials,
  bucket: string,
  prefix: string,
  reportName: string,
  region: string = 'us-east-1'
): Promise<string | null> {
  const s3 = buildS3Client(creds, region);
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const reportRoot = `${normalizedPrefix}${reportName}/`;

  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: reportRoot,
      Delimiter: '/',
    })
  );

  const folders = (out.CommonPrefixes || [])
    .map((p) => p.Prefix || '')
    .filter((p) => /\d{8}-\d{8}\/$/.test(p))
    .sort();
  if (folders.length === 0) return null;
  return folders[folders.length - 1];
}

/**
 * Read and parse a CUR manifest.json from S3.
 */
export async function readManifest(
  creds: AwsTempCredentials,
  bucket: string,
  manifestKey: string,
  region: string = 'us-east-1'
): Promise<CurManifest> {
  const s3 = buildS3Client(creds, region);
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
  if (!obj.Body) throw new Error(`Empty manifest at s3://${bucket}/${manifestKey}`);
  const text = await streamToString(obj.Body as Readable);
  return parseManifestJson(text);
}

/**
 * Pure parser separated for testability.
 */
export function parseManifestJson(json: string): CurManifest {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const reportKeys = (raw.reportKeys as string[]) || [];
  return {
    assemblyId: (raw.assemblyId as string) || '',
    account: (raw.account as string) || '',
    columns: (raw.columns as { category: string; name: string }[]) || [],
    charset: raw.charset as string | undefined,
    compression: raw.compression as string | undefined,
    contentType: raw.contentType as string | undefined,
    reportId: raw.reportId as string | undefined,
    reportName: raw.reportName as string | undefined,
    billingPeriod: raw.billingPeriod as { start: string; end: string } | undefined,
    bucket: raw.bucket as string | undefined,
    reportKeys,
    additionalArtifactKeys: raw.additionalArtifactKeys as
      | { artifactType: string; name: string }[]
      | undefined,
  };
}

/**
 * Locate the manifest.json key inside a billing-period partition folder.
 * Returns null if not found.
 */
export async function findManifestKey(
  creds: AwsTempCredentials,
  bucket: string,
  partitionPrefix: string,
  region: string = 'us-east-1'
): Promise<string | null> {
  const s3 = buildS3Client(creds, region);
  const out = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: partitionPrefix, MaxKeys: 100 })
  );
  const objs = out.Contents || [];
  const manifest =
    objs.find((o) => /manifest\.json$/i.test(o.Key || '')) ||
    objs.find((o) => /Manifest\.json$/.test(o.Key || ''));
  return manifest?.Key || null;
}

/**
 * Stream parse a Parquet file from S3 and yield FOCUS rows.
 *
 * Uses @dsnp/parquetjs (pure JS). For large CURs (>1M rows), the caller should
 * batch the persistence to MySQL to avoid blowing the heap.
 */
export async function* iterateCurParquet(
  creds: AwsTempCredentials,
  bucket: string,
  key: string,
  payerAccountId: string,
  region: string = 'us-east-1'
): AsyncGenerator<FocusLineItem, void, unknown> {
  // Lazy-import: heavy native deps; only loaded when CUR sync runs.
  const { ParquetReader } = await import('@dsnp/parquetjs');

  const s3 = buildS3Client(creds, region);
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error(`Empty CUR file at s3://${bucket}/${key}`);
  const buf = await streamToBuffer(obj.Body as Readable);

  const reader = await ParquetReader.openBuffer(buf);
  const cursor = reader.getCursor();
  let record: Record<string, unknown> | null = null;
  while ((record = (await cursor.next()) as Record<string, unknown> | null)) {
    yield mapCurRowToFocus(record as AwsCurLineItem, payerAccountId);
  }
  await reader.close();
}

/**
 * High-level: process the latest billing period of a CUR report end-to-end,
 * invoking `onBatch(rows)` per batchSize records. Returns total row count.
 */
export async function ingestLatestCurPeriod(
  creds: AwsTempCredentials,
  bucket: string,
  prefix: string,
  reportName: string,
  payerAccountId: string,
  onBatch: (rows: FocusLineItem[]) => Promise<void>,
  options: { region?: string; batchSize?: number } = {}
): Promise<{ filesProcessed: number; rowCount: number; billingPeriodStart: string | null; billingPeriodEnd: string | null }> {
  const region = options.region || 'us-east-1';
  const batchSize = options.batchSize || 1000;

  const partition = await findLatestBillingPeriod(creds, bucket, prefix, reportName, region);
  if (!partition) {
    return { filesProcessed: 0, rowCount: 0, billingPeriodStart: null, billingPeriodEnd: null };
  }

  const manifestKey = await findManifestKey(creds, bucket, partition, region);
  if (!manifestKey) {
    throw new Error(`Manifest not found under s3://${bucket}/${partition}`);
  }

  const manifest = await readManifest(creds, bucket, manifestKey, region);
  const dataKeys = manifest.reportKeys.length > 0 ? manifest.reportKeys : [];
  if (dataKeys.length === 0) {
    return {
      filesProcessed: 0,
      rowCount: 0,
      billingPeriodStart: manifest.billingPeriod?.start || null,
      billingPeriodEnd: manifest.billingPeriod?.end || null,
    };
  }

  let rowCount = 0;
  let batch: FocusLineItem[] = [];
  for (const key of dataKeys) {
    for await (const row of iterateCurParquet(creds, bucket, key, payerAccountId, region)) {
      batch.push(row);
      if (batch.length >= batchSize) {
        await onBatch(batch);
        rowCount += batch.length;
        batch = [];
      }
    }
  }
  if (batch.length > 0) {
    await onBatch(batch);
    rowCount += batch.length;
  }

  return {
    filesProcessed: dataKeys.length,
    rowCount,
    billingPeriodStart: manifest.billingPeriod?.start || null,
    billingPeriodEnd: manifest.billingPeriod?.end || null,
  };
}
