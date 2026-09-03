# Azure Marketplace Integration Guide

## Quick Start

This guide walks through setting up FinOps SaaS Platform on Azure Marketplace, from development to production launch.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Microsoft Partner Center Registration](#microsoft-partner-center-registration)
3. [Offer Creation](#offer-creation)
4. [Sandbox Testing](#sandbox-testing)
5. [Production Deployment](#production-deployment)
6. [Troubleshooting](#troubleshooting)

---

## Development Setup

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- Azure subscription (free tier is fine for development)
- Microsoft Partner Center account

### Environment Configuration

1. **Create Azure AD app:**
   ```
   Azure Portal → Azure Active Directory → App registrations → New registration
   - Name: FinOps Marketplace App (Dev)
   - Supported account types: Accounts in any organizational directory
   - Redirect URI: https://finops.cscloudsolutions.com.ar/api/auth/callback
   ```

2. **Create application secret:**
   ```
   Azure Portal → App → Certificates & secrets → New client secret
   - Value expires in: 24 months
   - Copy the Secret value (not Client Secret ID)
   ```

3. **Get credentials:**
   ```
   From App registrations page, copy:
   - Application (client) ID → AZURE_MARKETPLACE_AAD_APP_ID
   - Directory (tenant) ID → AZURE_MARKETPLACE_AAD_TENANT_ID
   - Client Secret → AZURE_MARKETPLACE_AAD_APP_SECRET
   ```

4. **Update `.env.development`:**
   ```bash
   AZURE_MARKETPLACE_AAD_TENANT_ID=00000000-0000-0000-0000-000000000000
   AZURE_MARKETPLACE_AAD_APP_ID=00000000-0000-0000-0000-000000000001
   AZURE_MARKETPLACE_AAD_APP_SECRET=xxxxxxxxxxxxxxxxxxxxx
   AZURE_MARKETPLACE_OFFER_ID=finops-saas-azure-offer
   ```

5. **Test locally:**
   ```bash
   npm run dev
   
   # Visit landing page with mock token:
   # http://localhost:3000/marketplace/azure/landing?token=test_token_xyz
   
   # Should display: Welcome from Azure Marketplace
   ```

---

## Microsoft Partner Center Registration

### Create Partner Center Account

1. **Go to** https://partner.microsoft.com/
2. **Sign in** with Microsoft account (business email)
3. **Complete verification:**
   - Accept Partner Agreement
   - Provide company details
   - Add bank/tax information
4. **Enable Publisher Program:**
   - Partner Center → Settings → Publisher profile
   - Activate Commercial Marketplace Publisher

### Create Publisher Profile

1. **Partner Center → Settings → Publisher profile**
2. **Publisher ID:** Auto-assigned (e.g., `cscloudsolutions-prod-xyz`)
3. **Publisher name:** CSCloudSolutions
4. **Contact email:** sales@cscloudsolutions.com.ar
5. **Support email:** soporte@cscloudsolutions.com.ar

---

## Offer Creation

### Create SaaS Offer

1. **Partner Center → Commercial Marketplace → Overview**
2. **Create new offer → SaaS**
3. **Offer ID:** `finops-saas-azure-offer`
4. **Offer alias:** FinOps SaaS Platform

### Offer Setup Page

Fill in:
- **Offer ID:** `finops-saas-azure-offer`
- **Offer alias:** FinOps SaaS Platform
- **Publisher:** (auto-filled)

### Properties

- **Category:** Management Tools / Cloud Management
- **Industries:** Finance, IT, Healthcare (select applicable)
- **Legal documents:**
  - Privacy Policy: https://finops.cscloudsolutions.com.ar/legal/privacy
  - Terms: https://finops.cscloudsolutions.com.ar/legal/terms

### Offer Listing

Use content from `marketplace/azure/offer-listing.md`:

- **Title:** FinOps SaaS Platform · CSCloudSolutions
- **Summary:** Cloud cost management and FinOps automation for Azure environments. (100 chars max)
- **Description:** (Use HTML version from offer-listing.md, max 3000 chars)
- **Search keywords:** finops, cost management, azure cost, kubernetes cost, cloud optimization
- **Privacy policy URL:** https://finops.cscloudsolutions.com.ar/legal/privacy
- **Support URL:** https://finops.cscloudsolutions.com.ar/support

### Media

- **Logo (1 MB):** Upload finops-logo-216x216.png
- **Screenshots (up to 5):** Cost dashboard, K8s insights, reports, etc.
- **Videos (optional):** 2-3 min product demo

### Plans

Create 2 transactable plans (Enterprise stays contract-only).

The plan ID must be one of the strings in `planMapping.ts`. An ID outside that
table falls through to `inferTierByKeyword()`, which returns **Professional**
when it finds no tier word — so a mistyped ID sells the wrong tier silently.

#### Plan 1: Professional
- **Plan ID:** `professional-monthly`
- **Plan name:** Professional
- **Description:** Mid-tier plan for growing organizations
- **Pricing model:** Flat-rate subscription
- **Base price (USD):** $299/month

#### Plan 2: Business
- **Plan ID:** `business-monthly`
- **Plan name:** Business
- **Description:** Enterprise plan for large-scale deployments
- **Pricing model:** Flat-rate subscription
- **Base price (USD):** $999/month

#### Plan 3: Enterprise (Contact Sales — not published today)
- **Plan ID:** `enterprise-monthly`
- **Plan name:** Enterprise
- **Description:** Custom solution with dedicated support
- **Pricing model:** Contact sales
- **Price:** (leave blank)

### Technical Configuration

1. **Landing page URL:**
   ```
   https://finops.cscloudsolutions.com.ar/es/marketplace/azure/landing
   ```
   Sin `?token=`: Microsoft se lo agrega a la URL que se cargue acá. Y con el
   locale, que es parte de la ruta real (`src/app/[locale]/...`).

2. **Fulfillment API:**
   - Enabled: Yes
   - Azure AD tenant ID: (from AZURE_MARKETPLACE_AAD_TENANT_ID)
   - Azure AD app ID: (from AZURE_MARKETPLACE_AAD_APP_ID)

3. **Webhook:**
   ```
   https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/azure
   ```

4. **Webhook authentication:**
   - Use Azure AD token for validation
   - Partner Center will provide public certificate
   - Update webhook handler to validate JWT signature

### Plan Setup (for each plan)

1. **Plan details:**
   - Name, description, visibility (Public)

2. **Pricing and availability:**
   - Market: Select all or specific regions
   - Currency: USD
   - Price: $299 / $999 (or contact sales)

3. **Availability:**
   - Immediately (or schedule for specific date)

---

## Sandbox Testing

### Enable Sandbox

1. **Partner Center → Create offer → Technical configuration**
2. **Sandbox AAD tenant ID:** Provide sandbox Azure AD directory
3. **Sandbox Landing Page:** https://finops.cscloudsolutions.com.ar/marketplace/azure/landing?token=sandbox_token
4. **Sandbox Webhook:** https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/azure

### Test Scenarios

#### Scenario 1: Successful Purchase → Tenant Creation

1. **Create test subscription in Azure:**
   ```bash
   # In Azure Portal Marketplace, find "FinOps SaaS Platform (Sandbox)"
   # Click "Create"
   # Select plan and subscription
   ```

2. **Land on registration page:**
   - Should display "Welcome from Azure Marketplace"
   - Show plan, pricing, features
   - Display "Activate Subscription" button

3. **Click activation:**
   - Redirects to signup
   - Check DB: Tenant created with `marketplace_source='azure_marketplace'`
   - Check DB: MarketplaceEvents logged

4. **Verify in app:**
   - /admin/billing shows "Subscribed via Azure Marketplace"
   - Plan change button disabled
   - Link to Azure Portal provided

#### Scenario 2: Webhook Events

1. **Manual webhook test:**
   ```bash
   curl -X POST \
     http://localhost:3000/api/webhooks/marketplace/azure \
     -H "Authorization: Bearer test_token" \
     -H "Content-Type: application/json" \
     -d '{
       "action": "Suspended",
       "subscriptionId": "test-sub-123",
       "planId": "professional-monthly"
     }'
   ```

2. **Verify status update:**
   ```sql
   SELECT subscription_status FROM Tenants WHERE marketplace_subscription_id = 'test-sub-123';
   -- Should return: PAST_DUE
   ```

3. **Test plan change webhook:**
   ```bash
   curl -X POST \
     http://localhost:3000/api/webhooks/marketplace/azure \
     -H "Authorization: Bearer test_token" \
     -H "Content-Type: application/json" \
     -d '{
       "action": "ChangePlan",
       "subscriptionId": "test-sub-123",
       "planId": "business-monthly"
     }'
   ```

4. **Verify tier update:**
   ```sql
   SELECT tier FROM Tenants WHERE marketplace_subscription_id = 'test-sub-123';
   -- Should return: Business
   ```

#### Scenario 3: Unsubscribe

1. **Cancel subscription in Azure:**
   - Azure Portal → Subscriptions → Manage
   - Click "Cancel subscription"
   - Confirm cancellation

2. **Verify webhook received:**
   ```sql
   SELECT event_type FROM MarketplaceEvents 
   WHERE subscription_id = 'test-sub-123' 
   ORDER BY created_at DESC LIMIT 1;
   -- Should show: Unsubscribed
   ```

3. **Verify tenant status:**
   ```sql
   SELECT subscription_status FROM Tenants WHERE marketplace_subscription_id = 'test-sub-123';
   -- Should return: CANCELED
   ```

---

## Production Deployment

### Pre-Launch Checklist

- [ ] Credentials stored in secure vault (GitHub Secrets / Azure Key Vault)
- [ ] `.env.production` updated with live credentials
- [ ] JWT signature validation implemented in webhook handler
- [ ] CloudWatch/Application Insights monitoring configured
- [ ] Alert rules set up for webhook failures
- [ ] Database backups enabled
- [ ] SSL/TLS certificate valid for *.cscloudsolutions.com.ar
- [ ] Sandbox testing passed all scenarios
- [ ] Sales/marketing team trained on marketplace process

### Deployment Steps

1. **Update `.env.production`:**
   ```bash
   AZURE_MARKETPLACE_AAD_TENANT_ID=<production-tenant-id>
   AZURE_MARKETPLACE_AAD_APP_ID=<production-app-id>
   AZURE_MARKETPLACE_AAD_APP_SECRET=<production-app-secret>
   AZURE_MARKETPLACE_OFFER_ID=finops-saas-azure-offer
   ```

2. **Deploy application:**
   ```bash
   git push origin main
   # CI/CD pipeline deploys to production
   ```

3. **Publish offer in Partner Center:**
   - Partner Center → Offer → Publish to production
   - Review for 24-48 hours by Microsoft
   - Offer appears on Azure Marketplace

4. **Monitor launch:**
   - Check webhook logs for errors
   - Monitor tenant creation rate
   - Track signup conversion

---

## Troubleshooting

### Landing Page Shows 503 Error

**Cause:** Missing or invalid Azure AD credentials

**Solution:**
1. Check `.env.development` / `.env.production` for AAD credentials
2. Verify credentials in Azure Portal → App registrations
3. Ensure app secret is still valid (hasn't expired)
4. Regenerate if needed

### Webhook Returns 401 Unauthorized

**Cause:** Missing or invalid Authorization header

**Solution:**
1. Verify `Authorization: Bearer <token>` header is present
2. In production, validate JWT signature against Microsoft's public cert
3. Check logs for specific error message

### Tenant Not Created After Activation

**Cause:** Database error or server failure

**Solution:**
1. Check application logs for errors
2. Verify MySQL connection
3. Verify marketplace columns exist in Tenants table
4. Manually create test tenant to verify DB connectivity

### Plan Change Not Reflected

**Cause:** Webhook not received or processed

**Solution:**
1. Check webhook logs in Application Insights
2. Verify webhook URL is correct in Partner Center
3. Check MarketplaceEvents table for event
4. Manually update tier to verify DB works

---

## Support

**Microsoft Partner Center Help:**
- https://docs.microsoft.com/en-us/azure/marketplace/
- https://partner.microsoft.com/support

**Internal Support:**
- engineering@cscloudsolutions.com.ar
- See `/docs/marketplace-overview.md` for architecture overview

---

## Additional Resources

- [Marketplace overview](./marketplace-overview.md)
- [Technical config](../marketplace/azure/technical-config.md)
- [Offer listing](../marketplace/azure/offer-listing.md)
