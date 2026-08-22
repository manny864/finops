import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Allow-list of webhook hosts that we permit outbound POSTs to.
 * Anything else is rejected (SSRF guard).
 */
const ALLOWED_WEBHOOK_HOST_PATTERNS: RegExp[] = [
  /^hooks\.slack\.com$/i,
  /^([a-z0-9-]+\.)*webhook\.office\.com$/i,
  /^([a-z0-9-]+\.)*office365\.com$/i,
  /^([a-z0-9-]+\.)*microsoft\.com$/i,
  // Microsoft retiró los conectores clásicos de Teams (webhook.office.com);
  // los webhooks de Teams creados hoy vía Workflows/Power Automate resuelven
  // a estos dominios en lugar de webhook.office.com.
  /^([a-z0-9-]+\.)*logic\.azure\.com$/i,
  /^([a-z0-9-]+\.)*azure-apihub\.net$/i,
  /^([a-z0-9-]+\.)*flow\.microsoft\.com$/i,
  /^([a-z0-9-]+\.)*powerplatform\.com$/i,
  /^discord(app)?\.com$/i,
  /^([a-z0-9-]+\.)*pagerduty\.com$/i,
  /^([a-z0-9-]+\.)*opsgenie\.com$/i,
];

const PRIVATE_IPV4_RANGES: Array<[RegExp]> = [
  [/^10\./],
  [/^127\./],
  [/^169\.254\./],
  [/^192\.168\./],
  [/^172\.(1[6-9]|2[0-9]|3[01])\./],
  [/^0\./],
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some(([re]) => re.test(ip));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

/**
 * Base SSRF guard for any URL the server will call on a tenant's behalf:
 *   - HTTPS scheme
 *   - Named host only (no raw IP literals)
 *   - Resolves to a public, non-loopback IP (defence in depth against DNS rebinding)
 *
 * Does NOT apply the webhook host allow-list — callers that need it use
 * `assertSafeWebhookUrl`. Integrations pointed at customer-owned hosts (Jira,
 * Azure DevOps, ServiceNow) can't use a fixed allow-list, but must still be
 * blocked from reaching link-local metadata (169.254.169.254) and RFC1918.
 *
 * Throws on rejection. `label` only shapes the error message.
 */
export async function assertPublicHttpsUrl(rawUrl: string, label = 'URL'): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is malformed`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  const host = parsed.hostname;
  if (!host) throw new Error(`${label} missing host`);

  // Block raw IP literals — only named hosts allowed
  const hostNoBrackets = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  const literal = isIP(hostNoBrackets);
  if (literal !== 0) {
    throw new Error(`${label} cannot use raw IP literal`);
  }

  await assertResolvesPublic(host, label);
  return parsed;
}

async function assertResolvesPublic(host: string, label = 'URL'): Promise<void> {
  try {
    const resolved = await lookup(host, { all: true, verbatim: true });
    for (const entry of resolved) {
      const ip = entry.address;
      const fam = isIP(ip);
      if (fam === 4 && isPrivateIPv4(ip)) {
        throw new Error(`${label} host resolves to private IP: ${ip}`);
      }
      if (fam === 6 && isPrivateIPv6(ip)) {
        throw new Error(`${label} host resolves to private IP: ${ip}`);
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOTFOUND') {
      throw new Error(`${label} host could not be resolved: ${host}`);
    }
    throw err;
  }
}

/**
 * Validates a webhook URL is safe to call:
 *   - Everything `assertPublicHttpsUrl` enforces
 *   - Host matches one of ALLOWED_WEBHOOK_HOST_PATTERNS (unless tenant-configured allowlist extended)
 *
 * Throws on rejection.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL is malformed');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }
  const host = parsed.hostname;
  if (!host) throw new Error('Webhook URL missing host');

  // Block raw IP literals — only named hosts allowed
  const hostNoBrackets = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  const literal = isIP(hostNoBrackets);
  if (literal !== 0) {
    throw new Error('Webhook URL cannot use raw IP literal');
  }

  const extra = process.env.WEBHOOK_ALLOWED_HOSTS;
  const allowedExtra = extra
    ? extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const hostAllowed =
    ALLOWED_WEBHOOK_HOST_PATTERNS.some((re) => re.test(host)) ||
    allowedExtra.some((suffix) => host.toLowerCase() === suffix || host.toLowerCase().endsWith(`.${suffix}`));

  if (!hostAllowed) {
    throw new Error(`Webhook host not in allow-list: ${host}`);
  }

  // Resolve and reject private/loopback IPs (DNS rebinding mitigation)
  await assertResolvesPublic(host, 'Webhook URL');

  return parsed;
}
