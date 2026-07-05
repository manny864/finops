# AWS Marketplace Integration Guide

## Quick Start

This guide walks through setting up FinOps SaaS Platform on AWS Marketplace, from development to production launch.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [AWS Seller Central Registration](#aws-seller-central-registration)
3. [Product Registration](#product-registration)
4. [Sandbox Testing](#sandbox-testing)
5. [Production Deployment](#production-deployment)
6. [Troubleshooting](#troubleshooting)

---

## Development Setup

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- AWS account (free tier is sufficient for development)
- AWS Seller Central access

### Environment Configuration

1. **Create IAM role for Marketplace:**
   ```
   AWS Console → IAM → Roles → Create role
   - Service: Lambda (or EC2/App Runner)
   - Policy: AWS Marketplace Fulfillment
   ```

2. **Create policy with permissions:**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "aws-marketplace:ResolveCustomer",
           "aws-marketplace:GetEntitlements",
           "aws-marketplace:MeterUsage"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. **Create SNS topic for webhooks:**
   ```bash
   aws sns create-topic --name marketplace-subscription-events --region us-east-1
   # Copy ARN: arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events
   ```

4. **Subscribe HTTPS endpoint:**
   ```bash
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events \
     --protocol https \
     --notification-endpoint https://finops.cscloudsolutions.com.ar/api/webhooks/marketplace/aws
   ```

5. **Update `.env.development`:**
   ```bash
   AWS_MARKETPLACE_PRODUCT_CODE=prod-xxxxxxxxxxxxx  # Assigned during registration
   AWS_MARKETPLACE_ROLE_ARN=arn:aws:iam::123456789012:role/FinopsMarketplaceRole
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   ```

6. **Test locally:**
   ```bash
   npm run dev
   
   # Visit landing page with mock token:
   # http://localhost:3000/marketplace/aws/landing?x-amzn-marketplace-token=test_token_xyz
   
   # Should display: Welcome from AWS Marketplace
   ```

---

## AWS Seller Central Registration

### Create Seller Account

1. **Go to** https://console.aws.amazon.com/seller/
2. **Sign in** with AWS account
3. **Register as a seller:**
   - Provide company information
   - Verify email address
   - Complete tax information
   - Add bank details for payment

### Set Up Marketplace Profile

1. **Seller Central → Account → Company Profile**
2. **Organization Name:** CSCloudSolutions SRL
3. **Legal Business Name:** CSCloudSolutions Sociedad de Responsabilidad Limitada
4. **Website:** https://cscloudsolutions.com.ar
5. **Contact Email:** sales@cscloudsolutions.com.ar
6. **Support Email:** support@cscloudsolutions.com.ar
7. **Phone:** +54 11 1234-5678

---

## Product Registration

### Register as ISV

1. **AWS Marketplace → Products → Register product**
2. **Product category:** SaaS
3. **Product subtype:** Subscription with usage-based or metering

### Create Product Listing

1. **Product name:** FinOps SaaS Platform
2. **Short description:** (500 chars)
   ```
   Cloud cost management and FinOps automation for AWS. Real-time cost analysis, 
   optimization recommendations, Kubernetes cost tracking, and multi-account 
   governance in one platform.
   ```

3. **Long description:** (2000 chars, from aws/listing.md)
4. **Product URL:** https://finops.cscloudsolutions.com.ar
5. **Support URL:** https://finops.cscloudsolutions.com.ar/support

### Pricing Configuration

1. **Pricing type:** SaaS subscription
2. **Billing frequency:** Monthly

3. **Create plans:**

   **Essential - $99/month**
   - SKU: `finops-essential-monthly`
   - Price: $99 USD
   - Currency: USD
   - Free trial: 14 days (optional)

   **Professional - $299/month**
   - SKU: `finops-professional-monthly`
   - Price: $299 USD

   **Business - $799/month**
   - SKU: `finops-business-monthly`
   - Price: $799 USD

   **Enterprise - Contact Sales**
   - SKU: `finops-enterprise-contact`
   - Price: Custom (configure in Seller Central)

### Metering (Optional)

If implementing usage-based pricing:

1. **Metering dimension:**
   - Name: `ProvidedResources`
   - Description: Number of managed resources
   - Unit: Count

2. **Pricing:**
   - Set per-unit cost (e.g., $0.10/resource/month)
   - Or use flat-rate + overage

### Upload Media

1. **Logo (1024x1024 PNG):** finops-logo-1024x1024.png
2. **Product screenshots (up to 5):**
   - Dashboard overview
   - Multi-account view
   - Cost analysis
   - Kubernetes insights
   - Reports & recommendations
3. **Product video (optional):** 2-3 min demo

### Configure Delivery

1. **Software delivery:**
   - Fulfillment type: SaaS (customer managed)
   - Registration URL: https://finops.cscloudsolutions.com.ar/marketplace/aws/landing
   - Token parameter: `x-amzn-marketplace-token`

2. **Customer notification:**
   - Send email upon purchase (yes)
   - Email template: (create custom template with onboarding info)

### Support Configuration

1. **Support tier:** Professional
   - Hours: Monday - Friday, 09:00 - 18:00 ART (UTC-3)
   - Email: support@cscloudsolutions.com.ar
   - Response time: 24 hours (business days)

2. **Support resources:**
   - Documentation: https://docs.cscloudsolutions.com.ar
   - Knowledge base: https://help.cscloudsolutions.com.ar
   - Video tutorials: (if available)

### Legal & Compliance

1. **Terms and conditions:**
   - URL: https://finops.cscloudsolutions.com.ar/legal/terms
   - Acceptance: Required

2. **Privacy policy:**
   - URL: https://finops.cscloudsolutions.com.ar/legal/privacy

3. **EULA:**
   - URL: https://finops.cscloudsolutions.com.ar/legal/eula

---

## Sandbox Testing

### Enable Sandbox

1. **AWS Marketplace → Account → Sandbox accounts**
2. **Create test AWS account** (free tier eligible)
3. **Configure sandbox product:**
   - Copy product configuration from staging
   - Mark as "Sandbox" (not visible in production)

### Test Scenarios

#### Scenario 1: Successful Purchase → Tenant Creation

1. **Subscribe in sandbox AWS account:**
   ```
   AWS Marketplace → Browse products → FinOps SaaS Platform (Sandbox)
   Click "Continue to Subscribe"
   Select plan and click "Subscribe"
   ```

2. **Verify registration page:**
   - Should display "Welcome from AWS Marketplace"
   - Show plan details and features
   - Display "Complete Setup" button

3. **Click "Complete Setup":**
   - Backend calls ResolveCustomer API
   - Tenant created with `marketplace_source='aws_marketplace'`
   - MarketplaceEvents logged
   - Redirects to signup

4. **Verify in app:**
   - /admin/billing shows "Subscribed via AWS Marketplace"
   - Plan change button disabled
   - Link to AWS Console provided

#### Scenario 2: Webhook Events

1. **Test SNS subscription (first-time setup):**
   ```
   AWS SNS → Topics → marketplace-subscription-events → Subscriptions
   Find HTTPS subscription
   Look for SubscriptionConfirmation email
   Visit confirmation link in email
   ```

2. **Send mock EntitlementCreated webhook:**
   ```bash
   aws sns publish \
     --topic-arn arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events \
     --message '{
       "action": "EntitlementCreated",
       "customerId": "test-cust-123",
       "subscriptionName": "finops-professional-monthly",
       "productCode": "prod-xxxxx",
       "subscriptionStatus": "Active",
       "effectiveDate": "2024-01-15T00:00:00Z"
     }'
   ```

3. **Verify in database:**
   ```sql
   SELECT subscription_status FROM Tenants 
   WHERE marketplace_subscription_id = 'test-cust-123';
   -- Should return: ACTIVE
   ```

#### Scenario 3: Plan Change

1. **Send EntitlementUpdated webhook:**
   ```bash
   aws sns publish \
     --topic-arn arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events \
     --message '{
       "action": "EntitlementUpdated",
       "customerId": "test-cust-123",
       "subscriptionName": "finops-business-monthly",
       "subscriptionStatus": "Active"
     }'
   ```

2. **Verify tier updated:**
   ```sql
   SELECT tier FROM Tenants 
   WHERE marketplace_subscription_id = 'test-cust-123';
   -- Should return: Business
   ```

#### Scenario 4: Cancellation

1. **Send EntitlementDeleted webhook:**
   ```bash
   aws sns publish \
     --topic-arn arn:aws:sns:us-east-1:123456789012:marketplace-subscription-events \
     --message '{
       "action": "EntitlementDeleted",
       "customerId": "test-cust-123",
       "subscriptionStatus": "Canceled"
     }'
   ```

2. **Verify cancellation:**
   ```sql
   SELECT subscription_status FROM Tenants 
   WHERE marketplace_subscription_id = 'test-cust-123';
   -- Should return: CANCELED
   ```

---

## Production Deployment

### Pre-Launch Checklist

- [ ] Credentials stored in secure vault (AWS Secrets Manager)
- [ ] `.env.production` updated with live credentials
- [ ] SNS signature validation implemented
- [ ] CloudWatch alarms configured
- [ ] Alert rules for webhook failures
- [ ] Database backups enabled
- [ ] SSL/TLS certificate valid
- [ ] Sandbox testing passed all scenarios
- [ ] Marketing materials prepared
- [ ] Sales team trained

### Deployment Steps

1. **Create production product in Seller Central:**
   - Seller Central → Products → Register new product
   - Duplicate sandbox configuration
   - Mark as "Production"

2. **Update `.env.production`:**
   ```bash
   AWS_MARKETPLACE_PRODUCT_CODE=prod-xxxxxxxxxxxxx  # Production product code
   AWS_MARKETPLACE_ROLE_ARN=arn:aws:iam::123456789012:role/FinopsMarketplaceRole
   AWS_REGION=us-east-1
   ```

3. **Update SNS topic:**
   - Create production SNS topic
   - Subscribe to production webhook URL
   - Confirm subscription

4. **Deploy application:**
   ```bash
   git push origin main
   # CI/CD pipeline deploys to production
   ```

5. **Submit for review in Seller Central:**
   - Seller Central → Products → Request publication
   - AWS reviews product information (24-48 hours)
   - Product appears on AWS Marketplace

6. **Monitor launch:**
   - Check CloudWatch logs for webhook processing
   - Monitor subscription creation rate
   - Track customer feedback

---

## Troubleshooting

### Landing Page Shows 503 Error

**Cause:** Missing AWS credentials or misconfigured IAM role

**Solution:**
1. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in `.env.production`
2. Verify IAM role has marketplace permissions
3. Check CloudWatch logs for specific error

### Webhook Returns 401 Unauthorized

**Cause:** SNS signature validation failed

**Solution:**
1. Verify SNS is sending SubscriptionConfirmation
2. Implement SNS message verification using AWS SDK
3. Check webhook logs for signature validation errors
4. Verify endpoint is accessible from internet

### Customer Not Redirected After Purchase

**Cause:** Registration page URL not configured correctly in Seller Central

**Solution:**
1. Verify registration URL in Seller Central:
   ```
   https://finops.cscloudsolutions.com.ar/marketplace/aws/landing?x-amzn-marketplace-token={token}
   ```
2. Check that `{token}` placeholder is used (not hardcoded)
3. Test URL manually with mock token

### Metering Usage Not Processed

**Cause:** MeterUsage API not called or failed

**Solution:**
1. Check if metering is configured for product
2. Verify IAM role has `aws-marketplace:MeterUsage` permission
3. Check CloudWatch logs for API errors
4. Verify usage is being recorded for correct dimension

---

## Support

**AWS Marketplace Seller Resources:**
- https://aws.amazon.com/marketplace/features/
- https://docs.aws.amazon.com/marketplace/

**AWS Support:**
- AWS Marketplace support portal
- Email: seller@aws.marketplace.com

**Internal Support:**
- engineering@cscloudsolutions.com.ar
- See `/docs/marketplace-overview.md` for architecture

---

## Additional Resources

- [Marketplace overview](./marketplace-overview.md)
- [Technical config](../marketplace/aws/technical-config.md)
- [Product listing](../marketplace/aws/listing.md)
