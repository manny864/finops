import {
  MarketplaceMeteringClient,
  ResolveCustomerCommand,
} from '@aws-sdk/client-marketplace-metering';
import {
  MarketplaceEntitlementServiceClient,
  GetEntitlementsCommand,
  type Entitlement,
} from '@aws-sdk/client-marketplace-entitlement-service';
import { createPublicKey, createVerify, X509Certificate } from 'crypto';

const REGION = process.env.AWS_MARKETPLACE_REGION || 'us-east-1';

function platformCreds() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS platform credentials not configured');
  }
  return { accessKeyId, secretAccessKey };
}

export interface AwsResolvedCustomer {
  customerIdentifier: string;
  customerAWSAccountId?: string;
  productCode: string;
}

export async function resolveCustomer(registrationToken: string): Promise<AwsResolvedCustomer> {
  const client = new MarketplaceMeteringClient({
    region: REGION,
    credentials: platformCreds(),
  });
  const resp = await client.send(
    new ResolveCustomerCommand({ RegistrationToken: registrationToken })
  );
  if (!resp.CustomerIdentifier || !resp.ProductCode) {
    throw new Error('ResolveCustomer returned incomplete result');
  }
  return {
    customerIdentifier: resp.CustomerIdentifier,
    customerAWSAccountId: resp.CustomerAWSAccountId,
    productCode: resp.ProductCode,
  };
}

export async function getEntitlements(
  customerIdentifier: string,
  productCode?: string
): Promise<Entitlement[]> {
  const code = productCode || process.env.AWS_MARKETPLACE_PRODUCT_CODE;
  if (!code) {
    throw new Error('Missing AWS_MARKETPLACE_PRODUCT_CODE');
  }
  const client = new MarketplaceEntitlementServiceClient({
    region: REGION,
    credentials: platformCreds(),
  });
  const resp = await client.send(
    new GetEntitlementsCommand({
      ProductCode: code,
      Filter: { CUSTOMER_IDENTIFIER: [customerIdentifier] },
    })
  );
  return resp.Entitlements ?? [];
}

// ===== SNS signature verification =====

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  Token?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
  Token2?: string;
}

const SIGNED_FIELDS_NOTIFICATION = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const;
const SIGNED_FIELDS_SUBSCRIPTION = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const;

function buildStringToSign(msg: SnsMessage): string {
  const fields = msg.Type === 'Notification' ? SIGNED_FIELDS_NOTIFICATION : SIGNED_FIELDS_SUBSCRIPTION;
  const parts: string[] = [];
  for (const f of fields) {
    const v = (msg as unknown as Record<string, string | undefined>)[f];
    if (v !== undefined) {
      parts.push(f);
      parts.push(v);
    }
  }
  return parts.join('\n') + '\n';
}

function isAmazonCertHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();

export async function verifySnsMessage(msg: SnsMessage): Promise<boolean> {
  if (process.env.MARKETPLACE_SKIP_VERIFY === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MARKETPLACE_SKIP_VERIFY is not allowed in production');
    }
    return true;
  }
  if (!isAmazonCertHost(msg.SigningCertURL)) {
    throw new Error(`Invalid SigningCertURL host: ${msg.SigningCertURL}`);
  }
  let pem = certCache.get(msg.SigningCertURL);
  if (!pem) {
    const resp = await fetch(msg.SigningCertURL);
    if (!resp.ok) throw new Error(`Failed to fetch SNS cert: ${resp.status}`);
    pem = await resp.text();
    certCache.set(msg.SigningCertURL, pem);
  }
  const cert = new X509Certificate(pem);
  const publicKey = createPublicKey(cert.publicKey);
  const stringToSign = buildStringToSign(msg);
  const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign, 'utf8');
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(msg.Signature, 'base64'));
}

export async function confirmSubscription(msg: SnsMessage): Promise<void> {
  if (msg.Type !== 'SubscriptionConfirmation' || !msg.SubscribeURL) return;
  if (!isAmazonCertHost(msg.SubscribeURL.replace(/^https:\/\//, 'https://'))) {
    // SubscribeURL hostname matches sns endpoint
    const u = new URL(msg.SubscribeURL);
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) {
      throw new Error(`Invalid SubscribeURL: ${msg.SubscribeURL}`);
    }
  }
  const resp = await fetch(msg.SubscribeURL);
  if (!resp.ok) {
    throw new Error(`Subscription confirmation failed: ${resp.status}`);
  }
}

export function _internal() {
  return { buildStringToSign, isAmazonCertHost };
}
