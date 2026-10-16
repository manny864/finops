import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'node:net';

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

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // IPv4-mapped, ULA, link-local, NAT64 and unspecified addresses are not global IPv6.
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
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
function parsePublicHttpsUrl(rawUrl: string, label = 'URL'): URL {
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
  if (parsed.username || parsed.password) throw new Error(`${label} cannot include credentials`);

  // Block raw IP literals — only named hosts allowed
  const hostNoBrackets = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  const literal = isIP(hostNoBrackets);
  if (literal !== 0) {
    throw new Error(`${label} cannot use raw IP literal`);
  }

  return parsed;
}

async function resolvePublicAddresses(host: string, label = 'URL') {
  try {
    const resolved = await lookup(host, { all: true, verbatim: true });
    if (resolved.length === 0) throw new Error(`${label} host has no addresses`);
    for (const entry of resolved) {
      if (!isPublicAddress(entry.address)) {
        throw new Error(`${label} host resolves to private IP`);
      }
    }
    return resolved;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOTFOUND') {
      throw new Error(`${label} host could not be resolved: ${host}`);
    }

    throw err;
  }
}

export async function assertPublicHttpsUrl(rawUrl: string, label = 'URL'): Promise<URL> {
  const { url } = await resolvePublicHttpsTarget(rawUrl, false, label);
  return url;
}

/**
 * Validates a webhook URL is safe to call:
 *   - Everything `assertPublicHttpsUrl` enforces
 *   - Host matches one of ALLOWED_WEBHOOK_HOST_PATTERNS (unless tenant-configured allowlist extended)
 *
 * Throws on rejection.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<URL> {
  const { url } = await resolvePublicHttpsTarget(rawUrl, true, 'Webhook URL');
  return url;
}

export async function resolvePublicHttpsTarget(rawUrl: string, webhook = false, label = 'URL') {
  const parsed = parsePublicHttpsUrl(rawUrl, label);
  const host = parsed.hostname;

  const extra = process.env.WEBHOOK_ALLOWED_HOSTS;
  const allowedExtra = extra
    ? extra.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const hostAllowed =
    ALLOWED_WEBHOOK_HOST_PATTERNS.some((re) => re.test(host)) ||
    allowedExtra.some((suffix) => host.toLowerCase() === suffix || host.toLowerCase().endsWith(`.${suffix}`));

  if (webhook && !hostAllowed) {
    throw new Error(`Webhook host not in allow-list: ${host}`);
  }

  const addresses = await resolvePublicAddresses(host, label);
  return { url: parsed, addresses };
}
