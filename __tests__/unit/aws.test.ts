import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapCeDailyToFocus,
  mapCurRowToFocus,
  awsServiceToCategory,
  type AwsCurLineItem,
} from '@/modules/collectors/aws/awsFocusMapper';
import type { CeDailyRow } from '@/lib/aws/costExplorer';
import { parseManifestJson } from '@/lib/aws/cur';
import {
  encryptExternalId,
  decryptExternalId,
  generateExternalId,
  clearAssumeRoleCache,
} from '@/lib/aws/sts';

// Ensure MFA_ENCRYPTION_KEY exists for crypto tests (must be 64 hex chars = 32 bytes)
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY
  || 'a'.repeat(64);

describe('awsServiceToCategory', () => {
  it('maps EC2 family to Compute', () => {
    expect(awsServiceToCategory('AmazonEC2')).toBe('Compute');
    expect(awsServiceToCategory('AWSLambda')).toBe('Compute');
  });
  it('maps storage services to Storage', () => {
    expect(awsServiceToCategory('AmazonS3')).toBe('Storage');
    expect(awsServiceToCategory('AmazonEBS')).toBe('Storage');
  });
  it('maps databases', () => {
    expect(awsServiceToCategory('AmazonRDS')).toBe('Databases');
    expect(awsServiceToCategory('AmazonDynamoDB')).toBe('Databases');
  });
  it('maps networking', () => {
    expect(awsServiceToCategory('AmazonCloudFront')).toBe('Networking');
    expect(awsServiceToCategory('AmazonVPC')).toBe('Networking');
  });
  it('maps ML', () => {
    expect(awsServiceToCategory('AmazonSageMaker')).toBe('AI & Machine Learning');
  });
  it('falls back to Other for unknown', () => {
    expect(awsServiceToCategory('SomethingNew2099')).toBe('Other');
  });
});

describe('mapCeDailyToFocus', () => {
  const sampleRow: CeDailyRow = {
    date: '2026-06-01',
    serviceCode: 'AmazonEC2',
    region: 'us-east-1',
    unblendedCost: 123.45,
    amortizedCost: 100.0,
    usageQuantity: 720,
  };

  it('maps basic fields with FOCUS shape', () => {
    const out = mapCeDailyToFocus(sampleRow, '123456789012');
    expect(out.ProviderName).toBe('AWS');
    expect(out.PublisherName).toBe('Amazon Web Services');
    expect(out.BillingAccountId).toBe('123456789012');
    expect(out.ServiceName).toBe('AmazonEC2');
    expect(out.ServiceCategory).toBe('Compute');
    expect(out.Region).toBe('us-east-1');
    expect(out.BilledCost).toBe(123.45);
    expect(out.EffectiveCost).toBe(100.0);
    expect(out.UsageQuantity).toBe(720);
    expect(out.BillingCurrency).toBe('USD');
    expect(out.ChargePeriodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(out.ChargePeriodEnd.toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });

  it('falls back to billedCost when amortized is 0', () => {
    const out = mapCeDailyToFocus({ ...sampleRow, amortizedCost: 0 }, '111');
    expect(out.EffectiveCost).toBe(sampleRow.unblendedCost);
  });

  it('treats NoRegion as undefined', () => {
    const out = mapCeDailyToFocus({ ...sampleRow, region: 'NoRegion' }, '111');
    expect(out.Region).toBeUndefined();
  });
});

describe('mapCurRowToFocus', () => {
  const baseCur = (over: Partial<AwsCurLineItem> = {}): AwsCurLineItem => ({
    'lineItem/UsageAccountId': '987654321098',
    'lineItem/ProductCode': 'AmazonEC2',
    'lineItem/UsageStartDate': '2026-06-15T00:00:00Z',
    'lineItem/UsageEndDate': '2026-06-15T01:00:00Z',
    'lineItem/BlendedCost': '0.50',
    'lineItem/UnblendedCost': '0.50',
    'lineItem/LineItemType': 'Usage',
    'lineItem/CurrencyCode': 'USD',
    'lineItem/UsageAmount': '1',
    'lineItem/ResourceId': 'i-0abc1234',
    'product/ProductName': 'Amazon Elastic Compute Cloud',
    'product/region': 'us-east-1',
    'product/instanceType': 't3.medium',
    ...over,
  } as AwsCurLineItem);

  it('maps a basic on-demand usage row', () => {
    const out = mapCurRowToFocus(baseCur(), '111122223333');
    expect(out.ProviderName).toBe('AWS');
    expect(out.BillingAccountId).toBe('111122223333');
    expect(out.SubAccountId).toBe('987654321098');
    expect(out.ServiceName).toBe('Amazon Elastic Compute Cloud');
    expect(out.ServiceCategory).toBe('Compute');
    expect(out.Region).toBe('us-east-1');
    expect(out.ResourceId).toBe('i-0abc1234');
    expect(out.ResourceType).toBe('t3.medium');
    expect(out.BilledCost).toBe(0.5);
    expect(out.EffectiveCost).toBe(0.5);
    expect(out.PricingCategory).toBe('On-Demand');
    expect(out.ChargeCategory).toBe('Usage');
    expect(out.BillingCurrency).toBe('USD');
  });

  it('classifies Reserved Instance discounted usage', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'lineItem/LineItemType': 'DiscountedUsage',
        'reservation/EffectiveCost': '0.25',
        'lineItem/UnblendedCost': '0.50',
      }),
      '111'
    );
    expect(out.PricingCategory).toBe('Reserved');
    expect(out.BilledCost).toBe(0.5);
    expect(out.EffectiveCost).toBe(0.25);
  });

  it('classifies Savings Plan covered usage', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'lineItem/LineItemType': 'SavingsPlanCoveredUsage',
        'savingsPlan/SavingsPlanEffectiveCost': '0.30',
        'lineItem/UnblendedCost': '0.50',
      }),
      '111'
    );
    expect(out.PricingCategory).toBe('Savings Plan');
    expect(out.EffectiveCost).toBe(0.3);
  });

  it('classifies Spot usage', () => {
    const out = mapCurRowToFocus(
      baseCur({ 'lineItem/UsageType': 'SpotUsage:t3.medium' }),
      '111'
    );
    expect(out.PricingCategory).toBe('Spot');
  });

  it('classifies Tax and Credit charges', () => {
    const tax = mapCurRowToFocus(baseCur({ 'lineItem/LineItemType': 'Tax' }), '111');
    expect(tax.ChargeCategory).toBe('Tax');
    const credit = mapCurRowToFocus(baseCur({ 'lineItem/LineItemType': 'Credit' }), '111');
    expect(credit.ChargeCategory).toBe('Credit');
  });

  it('extracts user resource tags', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'resourceTags/user:Environment': 'prod',
        'resourceTags/user:Team': 'platform',
      } as Partial<AwsCurLineItem>),
      '111'
    );
    expect(out.Tags).toEqual({ Environment: 'prod', Team: 'platform' });
  });
});

// FOCUS distingue tres vistas del costo y el spec multi-cloud las pide por
// separado. El caso que importa es el upfront de RI/Savings Plan: aparece
// INTEGRO en BilledCost el mes de la compra, y amortizado se reparte en el
// termino. Si AmortizedCost colapsara a BilledCost, toda serie temporal
// mostraria un pico falso en el mes de compra.
describe('mapCurRowToFocus — BilledCost vs EffectiveCost vs AmortizedCost', () => {
  const baseCur = (over: Partial<AwsCurLineItem> = {}): AwsCurLineItem => ({
    'lineItem/UsageAccountId': '987654321098',
    'lineItem/ProductCode': 'AmazonEC2',
    'lineItem/UsageStartDate': '2026-06-15T00:00:00Z',
    'lineItem/UsageEndDate': '2026-06-15T01:00:00Z',
    'lineItem/BlendedCost': '0.50',
    'lineItem/UnblendedCost': '0.50',
    'lineItem/LineItemType': 'Usage',
    'lineItem/CurrencyCode': 'USD',
    ...over,
  } as AwsCurLineItem);

  it('en uso on-demand las tres vistas coinciden', () => {
    const out = mapCurRowToFocus(baseCur(), '111');
    expect(out.BilledCost).toBe(0.5);
    expect(out.EffectiveCost).toBe(0.5);
    expect(out.AmortizedCost).toBe(0.5);
  });

  it('separa el upfront prorrateado de un RI del costo facturado', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'lineItem/LineItemType': 'RIFee',
        'lineItem/UnblendedCost': '1200.00',            // upfront completo en la factura
        'reservation/AmortizedUpfrontCostForUsage': '100.00', // 1/12 del termino
      }),
      '111'
    );
    expect(out.BilledCost).toBe(1200);
    expect(out.AmortizedCost).toBe(100);
    expect(out.AmortizedCost).not.toBe(out.BilledCost);
  });

  it('separa el upfront prorrateado de un Savings Plan', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'lineItem/LineItemType': 'SavingsPlanRecurringFee',
        'lineItem/UnblendedCost': '3600.00',
        'savingsPlan/AmortizedUpfrontCommitmentForBillingPeriod': '300.00',
      }),
      '111'
    );
    expect(out.BilledCost).toBe(3600);
    expect(out.AmortizedCost).toBe(300);
  });

  it('cae a EffectiveCost cuando la linea no es de compromiso', () => {
    const out = mapCurRowToFocus(
      baseCur({
        'lineItem/LineItemType': 'DiscountedUsage',
        'lineItem/UnblendedCost': '0.50',
        'reservation/EffectiveCost': '0.25',
      }),
      '111'
    );
    expect(out.EffectiveCost).toBe(0.25);
    expect(out.AmortizedCost).toBe(0.25);
  });
});

describe('CUR manifest parser', () => {
  it('parses a well-formed CUR 1.0 manifest', () => {
    const json = JSON.stringify({
      assemblyId: 'a1b2',
      account: '111122223333',
      columns: [{ category: 'lineItem', name: 'UsageAccountId' }],
      reportId: 'rid',
      reportName: 'finops-report',
      billingPeriod: { start: '20260601T000000.000Z', end: '20260701T000000.000Z' },
      bucket: 'acme-cur',
      reportKeys: [
        'cur/finops-report/20260601-20260701/finops-report-00001.snappy.parquet',
        'cur/finops-report/20260601-20260701/finops-report-00002.snappy.parquet',
      ],
    });
    const m = parseManifestJson(json);
    expect(m.assemblyId).toBe('a1b2');
    expect(m.account).toBe('111122223333');
    expect(m.reportKeys).toHaveLength(2);
    expect(m.billingPeriod?.start).toBe('20260601T000000.000Z');
  });

  it('defaults to empty arrays for missing fields', () => {
    const m = parseManifestJson('{}');
    expect(m.assemblyId).toBe('');
    expect(m.reportKeys).toEqual([]);
    expect(m.columns).toEqual([]);
  });
});

describe('External ID crypto', () => {
  beforeEach(() => clearAssumeRoleCache());

  it('round-trips an external ID through encrypt/decrypt', () => {
    const id = generateExternalId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const enc = encryptExternalId(id);
    expect(enc).toMatch(/^\{/); // JSON blob
    const back = decryptExternalId(enc);
    expect(back).toBe(id);
  });

  it('generates distinct external IDs', () => {
    const a = generateExternalId();
    const b = generateExternalId();
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext via GCM auth tag', () => {
    const id = generateExternalId();
    const enc = encryptExternalId(id);
    const blob = JSON.parse(enc);
    blob.ciphertext = blob.ciphertext.replace(/.$/, (c: string) => (c === '0' ? '1' : '0'));
    const tampered = JSON.stringify(blob);
    expect(() => decryptExternalId(tampered)).toThrow();
  });
});
