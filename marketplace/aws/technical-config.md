# AWS Marketplace - Technical Configuration

## Overview

This document describes the technical setup required for FinOps SaaS Platform to function as an AWS Marketplace SaaS offer (with optional metering).

---

## Registration Page Configuration

### Registration Page URL (with token resolution)

```
https://finops.cscloudsolutions.com.ar/marketplace/aws/landing?x-amzn-marketplace-token={token}
```

**Flow:**
1. Customer subscribes to product on AWS Marketplace
2. AWS redirects customer to registration page with `?x-amzn-marketplace-token=XXXX` query parameter
3. Our application exchanges token with AWS Marketplace Metering Service API
4. Token resolves to: customer ID, subscription ID, product code, plan
5. Registration page displays welcome screen and activation button
6. Customer clicks "Complete Setup" → redirects to signup with prefilled marketplace data
7. On successful signup, application calls `ResolveCustomer` to finalize entitlement

---

## SNS Topic Configuration

### SNS Topic URL (incoming subscription events)

```
arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events
```

**Protocol:** HTTPS
**Endpoint:** https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/aws

**Events Subscribed:**
- `aws:ce:purchase-entitlement:v1` — Customer purchased subscription
- `aws:ce:entitlement-updated:v1` — Customer modified subscription (plan change, quantity)
- `aws:ce:entitlement-deleted:v1` — Customer canceled subscription

**SNS Message Structure:**
```json
{
  "action": "EntitlementCreated|EntitlementUpdated|EntitlementDeleted",
  "customerId": "customer-123",
  "productCode": "finops-saas-aws-prod-xxx",
  "subscriptionName": "finops-professional-monthly",
  "subscriptionStatus": "Active|Suspended|Canceled",
  "effectiveDate": "2024-01-15T00:00:00Z",
  "expirationDate": "2024-02-15T00:00:00Z"
}
```

---

## Authentication & Authorization

### AWS Marketplace Account Configuration

#### Product Code
```
{AWS_MARKETPLACE_PRODUCT_CODE}
```

#### Role ARN (for calling Metering Service API)
```
{AWS_MARKETPLACE_ROLE_ARN}
```
Permissions required:
- `aws-marketplace:ResolveCustomer`
- `aws-marketplace:GetEntitlements`
- `aws-marketplace:MeterUsage` (if using metering-based pricing)

#### AWS Region
```
{AWS_REGION}
```
Default: us-east-1

### API Credentials

AWS credentials are assumed via IAM role (recommended) or explicit access key/secret.

---

## Environment Variables

Add these to `.env.production` and `.env.development`:

```env
# AWS Marketplace Configuration
AWS_MARKETPLACE_PRODUCT_CODE=finops-saas-aws-prod-xxx
AWS_MARKETPLACE_ROLE_ARN=arn:aws:iam::123456789012:role/FinopsMarketplaceRole
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

---

## AWS Marketplace Metering Service Integration

### Token Resolution API

**Endpoint:** AWS Marketplace Metering Service
**Method:** POST

**Action:** `ResolveCustomer`

**Request:**
```bash
POST https://metering.marketplace.us-east-1.amazonaws.com/
Authorization: AWS4-HMAC-SHA256 ...
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSIEServiceV20150731.ResolveCustomer

{
  "RegistrationToken": "AQoDYXdzEIv..."
}
```

**Response:**
```json
{
  "CustomerIdentifier": "customer-123",
  "ProductCode": "finops-saas-aws-prod-xxx",
  "SubscriptionName": "finops-professional-monthly"
}
```

### Record Metering Usage (optional)

If using metering-based pricing (per-subscription, per-resource):

**Action:** `MeterUsage`

**Request:**
```json
{
  "ProductCode": "finops-saas-aws-prod-xxx",
  "UsageRecords": [
    {
      "Timestamp": "2024-01-15T12:00:00Z",
      "Dimension": "ProvidedResources",
      "Value": 42,
      "CustomerIdentifier": "customer-123"
    }
  ]
}
```

---

## Webhook Configuration

### SQS Forwarder (AWS SNS → SQS → HTTPS Webhook)

**Alternative:** AWS Lambda forwards SNS messages to webhook

1. SNS publishes subscription event
2. Lambda/SQS receives event
3. Lambda invokes HTTPS webhook at `/api/webhooks/marketplace/aws`

**SQS Queue:**
```
arn:aws:sqs:us-east-1:123456789012:marketplace-subscription-queue
```

**SNS Subscription:** forwards to SQS queue
**SQS Consumer:** Lambda function calls webhook endpoint

---

## SNS Message Signature Validation

All SNS messages include a signature that must be validated:

**Headers in webhook request:**
```
x-amz-sns-message-type: Notification
x-amz-sns-message-id: 1234567-1234-1234-1234-123456789012
x-amz-sns-subscription-arn: arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events:12345678-1234-1234-1234-123456789012
x-amz-sns-topic-arn: arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events
```

**Validation:** 
- Use AWS SNS message verification library (aws-sdk)
- Verify `Signature` field against `SigningCertUrl` certificate
- Reject messages older than 15 minutes

---

## Sandbox Testing

### Test Environment

```
Registration Page (Sandbox): https://finops.cscloudsolutions.com.ar/marketplace/aws/landing?x-amzn-marketplace-token=sandbox_token_xxx
Webhook URL (Sandbox): https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/aws
```

### Test Credentials

Provided by AWS during sandbox registration:
```
AWS_MARKETPLACE_PRODUCT_CODE=prod-xxxxxxxxxxxxxx (sandbox)
AWS_MARKETPLACE_ROLE_ARN=arn:aws:iam::123456789012:role/FinopsMarketplaceSandboxRole
```

### Test Cases

1. **Token Resolution**
   - Register with sandbox token → verify customer data returned
   
2. **Activation Flow**
   - Generate token → resolve → complete signup → verify tenant created
   
3. **SNS Webhooks**
   - Send EntitlementCreated → verify tenant status Active
   - Send EntitlementUpdated (plan change) → verify tier updated
   - Send EntitlementDeleted → verify subscription marked Canceled

4. **Metering (if applicable)**
   - Record usage for day 1-30 → verify billed correctly at month end

---

## Deployment Checklist

- [ ] AWS Marketplace account and product created
- [ ] Product code obtained and added to `.env.production`
- [ ] IAM role created with necessary permissions
- [ ] SNS topic created and subscription configured
- [ ] Registration page URL registered with AWS Marketplace
- [ ] Lambda function created for webhook forwarding (if using SQS)
- [ ] Sandbox testing completed with all test cases
- [ ] Production credentials obtained
- [ ] SSL/TLS certificate valid and renewed
- [ ] CloudWatch monitoring and alarms configured
- [ ] Webhook retry logic implemented (exponential backoff)
- [ ] Database backups configured

---

## Monitoring & Logging

### CloudWatch Metrics to Track

- `SubscriptionEntitlementResolved` (custom metric)
- `WebhookDeliveryFailure` (custom metric)
- `AWSMarketplaceAPIErrors` (custom metric)

### CloudWatch Logs

All webhook events logged to:
```
/aws/lambda/finops-marketplace-webhook-handler
```

### Alerting

- Alert if webhook delivery fails > 3 times in 1 hour
- Alert if ResolveCustomer API fails
- Alert if SNS signature validation fails

---

## Support & Contact

**Technical Support:** support@cscloudsolutions.com.ar
**Business/Billing:** sales@cscloudsolutions.com.ar
**Documentation:** https://docs.cscloudsolutions.com.ar/marketplace/aws
**AWS Marketplace Support:** https://aws.amazon.com/marketplace/seller-resources/
