# Marketplace Integration Overview

## Summary

FinOps SaaS Platform is available on both **Azure Marketplace** and **AWS Marketplace**, in addition to direct billing via Paddle. This document provides a high-level overview of the marketplace integration strategy, billing flows, and key technical decisions.

---

## Table of Contents

1. [Dual Marketplace Strategy](#dual-marketplace-strategy)
2. [Billing Flow Diagram](#billing-flow-diagram)
3. [Tenant Sources](#tenant-sources)
4. [Implementation Status](#implementation-status)
5. [Next Steps](#next-steps)

---

## Dual Marketplace Strategy

### Why Marketplaces?

- **Market penetration**: Enterprise customers often prefer consuming SaaS from their cloud provider's marketplace
- **Simplified procurement**: One bill, consolidated with other cloud services
- **Trust & compliance**: Customers trust software from official marketplaces
- **Frictionless onboarding**: Automatic entitlement provisioning reduces sales cycle

### Additive Approach

Marketplace integration is **additive** — Paddle billing for direct customers continues unchanged. Customers can be sourced from:

1. **Direct (Paddle)** — Traditional SaaS signup, customer manages subscription
2. **Azure Marketplace** — Microsoft bills customer; we receive notifications
3. **AWS Marketplace** — AWS bills customer; we receive notifications

### Tier Alignment

All three channels offer the same tier structure:

- **Essential**: $99/month
- **Professional**: $299/month  
- **Business**: $799/month
- **Enterprise**: Custom pricing (contact sales)

Prices are in USD, auto-converted for local currency where applicable.

---

## Billing Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          CUSTOMER                               │
└────────────────────┬────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┬───────────────┐
        │                         │               │
        ▼                         ▼               ▼
   ┌─────────┐          ┌──────────────┐   ┌──────────┐
   │ DIRECT  │          │ AZURE        │   │ AWS      │
   │ (Paddle)│          │ MARKETPLACE  │   │ PLACE... │
   └────┬────┘          └──────┬───────┘   └────┬─────┘
        │                      │               │
        │                      ▼               ▼
        │            ┌──────────────────┐  ┌─────────────┐
        │            │ Microsoft Inbox  │  │ AWS SQS/SNS │
        │            │ (Fulfillment API)│  │             │
        │            └────────┬─────────┘  └──────┬──────┘
        │                     │                   │
        │                     ▼                   ▼
        └────────────────────┬─────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │ FINOPS APP       │
                    │ Webhook Receiver │
                    └────────┬─────────┘
                             │
                    ┌────────▼────────┐
                    │ Update Tenant   │
                    │ Update Status   │
                    │ Log Event       │
                    └─────────────────┘
```

### Direct (Paddle) Flow

1. Customer signs up at app.cscloudsolutions.com.ar
2. Selects tier and billing frequency
3. Paddle collects payment, stores subscription ID
4. User account created with `marketplace_source='direct'`

### Azure Marketplace Flow

1. Customer finds offer on Azure Marketplace
2. Clicks "Get It Now" → redirected to landing page with token
3. Token exchanged with Microsoft SaaS Fulfillment API
4. Tenant auto-provisioned with `marketplace_source='azure_marketplace'`
5. Microsoft sends webhook notifications for lifecycle events (suspend, renew, cancel, etc.)
6. We update tenant status and send email notifications

### AWS Marketplace Flow

1. Customer subscribes on AWS Marketplace
2. AWS redirects to landing page with registration token
3. Token exchanged with AWS Marketplace Metering Service API
4. Tenant auto-provisioned with `marketplace_source='aws_marketplace'`
5. AWS sends SNS notifications for entitlement changes
6. We update tenant status and send email notifications

---

## Tenant Sources

Each tenant in the database has a `marketplace_source` field:

```sql
ALTER TABLE Tenants ADD COLUMN marketplace_source 
  ENUM('direct','azure_marketplace','aws_marketplace') DEFAULT 'direct';

ALTER TABLE Tenants ADD COLUMN marketplace_subscription_id VARCHAR(255) NULL;
ALTER TABLE Tenants ADD COLUMN marketplace_plan_id VARCHAR(255) NULL;
```

### Data Model

```
Tenant
├── marketplace_source: 'direct' | 'azure_marketplace' | 'aws_marketplace'
├── marketplace_subscription_id: str (provided by marketplace)
├── marketplace_plan_id: str (e.g., 'professional-monthly')
├── tier: 'Essential' | 'Professional' | 'Business' | 'Enterprise'
└── subscription_status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | etc.
```

### Billing Portal Integration

In `/admin/billing`, we show:

- ✅ Paddle controls for direct customers
- ❌ Disabled plan change for marketplace customers (redirect to Azure Portal / AWS Console)
- ℹ️ Marketplace status badge with link to provider portal

---

## Implementation Status

### ✅ Completed

- [x] Database schema updates (marketplace columns + MarketplaceEvents table)
- [x] Landing pages (Azure + AWS with token resolution mocks)
- [x] Webhook handlers (Azure + AWS event processing)
- [x] Marketplace metadata files (listings + technical configs)
- [x] Billing page UI (marketplace status display)
- [x] Environment variables in `.env.development`
- [x] Integration tests (database operations, event logging)
- [x] Documentation (this file + per-marketplace guides)

### ⏳ Requires Partner Center Setup (Out of Scope for Code)

- [ ] Register with Microsoft Partner Center
- [ ] Create Azure Marketplace offer
- [ ] Register with AWS Marketplace
- [ ] Configure Azure AD app and credentials
- [ ] Configure AWS IAM role and credentials
- [ ] Update `.env.production` with live credentials
- [ ] Sandbox testing in marketplace partner portals
- [ ] Submission to Azure/AWS for review
- [ ] Launch offer (publish to production)

### ⚠️ Production Readiness Notes

**API Integration:**
- Landing pages currently use mock token resolution
- In production, these MUST call the actual fulfillment APIs
- See `marketplace/{azure,aws}/technical-config.md` for API details

**Security:**
- JWT signature validation for Azure webhooks not yet implemented (needs public cert from Microsoft)
- SNS signature validation for AWS webhooks not yet implemented (needs AWS SDK validation)
- Both must be added before production deployment

**Monitoring:**
- Add CloudWatch/Application Insights monitoring for webhook delivery failures
- Set up alerts for failed tenant provisioning
- Log all marketplace events for audit trail

---

## Next Steps

### For Development

1. **Test locally with mocks:**
   ```bash
   npm run dev
   # Visit http://localhost:3000/marketplace/azure/landing?token=test_token_xyz
   # Visit http://localhost:3000/marketplace/aws/landing?x-amzn-marketplace-token=test_token_xyz
   ```

2. **Run integration tests:**
   ```bash
   npm test -- api-marketplace.test.ts
   ```

3. **Review webhook handlers:**
   - Add real JWT/SNS signature validation
   - Implement retry logic for webhook failures
   - Set up monitoring/alerting

### For Product/Sales

1. **Partner Center Registration:**
   - Create accounts in Microsoft and AWS Partner Centers
   - Complete company verification
   - Register organization details

2. **Offer Configuration:**
   - Use the metadata from `marketplace/{azure,aws}/` folders
   - Upload logos, screenshots, videos
   - Set up pricing and support tiers

3. **Sandbox Testing:**
   - Test the full flow: purchase → landing page → tenant creation → billing
   - Test webhook lifecycle: suspend, renew, cancel
   - Test plan changes and upgrades

4. **Launch & Marketing:**
   - Publish offers to staging (sandbox) first
   - Run customer pilots with marketplace-sourced subscriptions
   - Monitor adoption and customer feedback
   - Publish to production marketplace

### For Operations

1. **Credentials Management:**
   - Store Azure AD credentials in secure vault (e.g., GitHub Secrets, Azure Key Vault)
   - Store AWS credentials in secure vault (e.g., AWS Secrets Manager)
   - Rotate credentials on schedule

2. **Monitoring Setup:**
   - Dashboard for marketplace vs. direct signups
   - Alert on webhook delivery failures
   - Monitor tenant provisioning latency
   - Track marketplace conversion rates

3. **Billing Reconciliation:**
   - Ensure marketplace billing aligns with actual usage
   - Reconcile Microsoft/AWS invoices monthly
   - Cross-check tenant counts and subscription statuses

---

## Key Files

| File | Purpose |
|------|---------|
| `marketplace/azure/offer-listing.md` | Azure Marketplace listing content |
| `marketplace/azure/technical-config.md` | Azure API integration guide |
| `marketplace/aws/listing.md` | AWS Marketplace listing content |
| `marketplace/aws/technical-config.md` | AWS API integration guide |
| `src/app/[locale]/marketplace/azure/landing/page.tsx` | Azure landing page (token → tenant) |
| `src/app/[locale]/marketplace/aws/landing/page.tsx` | AWS landing page (token → tenant) |
| `src/app/api/webhooks/marketplace/azure/route.ts` | Azure webhook handler |
| `src/app/api/webhooks/marketplace/azure/activate/route.ts` | Azure activation endpoint |
| `src/app/api/webhooks/marketplace/aws/route.ts` | AWS webhook handler |
| `src/app/api/webhooks/marketplace/aws/activate/route.ts` | AWS activation endpoint |
| `src/modules/storage/db.ts` | Database schema (marketplace columns) |
| `__tests__/integration/api-marketplace.test.ts` | Integration tests |
| `.env.development` | Marketplace env variables |

---

## Support & Questions

**For technical implementation issues:**
- See `marketplace/{azure,aws}/technical-config.md`
- Check integration test examples in `__tests__/integration/api-marketplace.test.ts`

**For marketplace questions:**
- Microsoft Partner Center: https://partner.microsoft.com/
- AWS Marketplace: https://aws.amazon.com/marketplace/

**For internal discussion:**
- Contact engineering team
- Reference: GitHub Issues / Slack #marketplace-launch
