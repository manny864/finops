# Azure Marketplace - Technical Configuration

## Overview

This document describes the technical setup required for FinOps SaaS Platform to function as an Azure Marketplace SaaS offer.

---

## Landing Page Configuration

### Landing Page URL (with token resolution)

```
https://app.cscloudsolutions.com.ar/marketplace/azure/landing?token={token}
```

**Flow:**
1. Customer purchases offer from Azure Marketplace
2. Azure redirects customer to landing page with `?token=XXXX` query parameter
3. Our application exchanges token with Microsoft SaaS Fulfillment API
4. Token resolves to: purchaser email, subscription ID, plan selection
5. Landing page displays welcome screen and activation button
6. Customer clicks "Activate Subscription" → redirects to signup with prefilled marketplace data

---

## Webhook Configuration

### Webhook URL (incoming events)

```
https://app.cscloudsolutions.com.ar/api/webhooks/marketplace/azure
```

**Method:** POST
**Content-Type:** application/json
**Auth:** JWT Bearer Token in Authorization header (signed by Microsoft)

**Events Handled:**
- `Reinstated` — Subscription reinstated after cancellation
- `Suspended` — Subscription suspended for non-payment
- `Unsubscribed` — Customer canceled subscription
- `ChangePlan` — Customer upgraded/downgraded plan
- `ChangeQuantity` — Customer modified quantity (if applicable)
- `Renew` — Subscription auto-renewed

**Webhook Payload Structure:**
```json
{
  "action": "Reinstated|Suspended|Unsubscribed|ChangePlan|ChangeQuantity|Renew",
  "subscriptionId": "sub_abc123...",
  "offerId": "finops-saas-azure-offer",
  "planId": "essential-monthly|professional-monthly|business-monthly|enterprise-contact",
  "customerId": "customer_id",
  "operationId": "op_123..."
}
```

---

## Authentication & Authorization

### Azure AD Application Setup

#### Tenant ID
```
{AZURE_MARKETPLACE_AAD_TENANT_ID}
```

#### Application ID (Client ID)
```
{AZURE_MARKETPLACE_AAD_APP_ID}
```

#### Application Secret (Client Secret)
```
{AZURE_MARKETPLACE_AAD_APP_SECRET}
```

#### Permissions Required
- `https://manage.azure.com/.default` — Access to SaaS Fulfillment API

### API Key for Webhook Signature Validation

**Key ID:** Provided by Microsoft Partner Center
**Secret:** Use to validate JWT signature on incoming webhooks

---

## Environment Variables

Add these to `.env.production` and `.env.development`:

```env
# Azure Marketplace Configuration
AZURE_MARKETPLACE_AAD_TENANT_ID=<tenant-id>
AZURE_MARKETPLACE_AAD_APP_ID=<app-id>
AZURE_MARKETPLACE_AAD_APP_SECRET=<app-secret>
AZURE_MARKETPLACE_OFFER_ID=finops-saas-azure-offer
```

---

## SaaS Fulfillment API Integration

### Token Resolution

**Endpoint:** Microsoft SaaS Fulfillment API
**Method:** POST `/marketplaceapi/saas/subscriptions/resolve`

**Request:**
```bash
POST https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "x-ms-marketplace-token": "{token}"
}
```

**Response:**
```json
{
  "subscriptionId": "sub_abc123...",
  "subscriptionStatus": "PendingFulfillmentStart",
  "offerId": "finops-saas-azure-offer",
  "planId": "professional-monthly",
  "customerId": "customer123",
  "quantity": 1,
  "beneficiary": {
    "emailId": "user@company.com",
    "objectId": "00000000-0000-0000-0000-000000000000",
    "tenantId": "00000000-0000-0000-0000-000000000000"
  },
  "purchaser": {
    "emailId": "purchaser@company.com",
    "objectId": "00000000-0000-0000-0000-000000000000",
    "tenantId": "00000000-0000-0000-0000-000000000000"
  }
}
```

### Activate Subscription

**Endpoint:** Microsoft SaaS Fulfillment API
**Method:** POST `/marketplaceapi/saas/subscriptions/{subscriptionId}/activate`

**Request:**
```bash
POST https://marketplaceapi.microsoft.com/api/saas/subscriptions/{subscriptionId}/activate
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "planId": "professional-monthly"
}
```

**Response:**
```json
{
  "subscriptionId": "sub_abc123...",
  "subscriptionStatus": "Active",
  "...": "..."
}
```

---

## Sandbox Testing

### Test Environment URLs

```
Landing Page (Sandbox): https://app.cscloudsolutions.com.ar/marketplace/azure/landing?token=sandbox_token_xxx
Webhook URL (Sandbox): https://app.cscloudsolutions.com.ar/api/webhooks/marketplace/azure
```

### Test Credentials

```
AZURE_MARKETPLACE_AAD_TENANT_ID=<sandbox-tenant-id>
AZURE_MARKETPLACE_AAD_APP_ID=<sandbox-app-id>
AZURE_MARKETPLACE_AAD_APP_SECRET=<sandbox-app-secret>
```

### Test Cases

1. **Token Resolution**
   - POST token to resolve endpoint → verify subscription details returned
   
2. **Activation Flow**
   - Generate token → resolve → activate → verify tenant created in DB
   
3. **Webhook Events**
   - Send mock `Suspended` webhook → verify tenant status updated
   - Send mock `Unsubscribed` webhook → verify subscription marked as CANCELED
   - Send mock `ChangePlan` webhook → verify tier updated

---

## Deployment Checklist

- [ ] Azure AD app created in Partner Center
- [ ] AAD credentials added to `.env.production`
- [ ] Landing page URL registered in Partner Center
- [ ] Webhook URL registered in Partner Center
- [ ] Webhook IP whitelisted (if required)
- [ ] Sandbox testing completed
- [ ] Production credentials obtained
- [ ] Monitoring/alerting configured for webhook failures
- [ ] Database backups configured
- [ ] SSL/TLS certificate valid and renewed

---

## Support & Contact

**Technical Support:** support@cscloudsolutions.com.ar
**Business/Billing:** sales@cscloudsolutions.com.ar
**Documentation:** https://docs.cscloudsolutions.com.ar/marketplace/azure
