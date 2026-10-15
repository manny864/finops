import { isIP } from "node:net";

/**
 * IP del cliente sólo cuando hay un contrato de proxy confiable (PERIM-03/05).
 *
 * `TRUST_CLOUDFLARE_CLIENT_IP` lo inyecta Terraform desde `origin_cloudflare_only`:
 * con el ingress cerrado a Cloudflare, `cf-connecting-ip` lo escribe Cloudflare y
 * el cliente no lo puede elegir. Sin ese contrato devuelve `null`: X-Forwarded-For
 * lo controla quien llama y no sirve como clave de cuota.
 */
export function trustedClientIp(request: Request): string | null {
  if (process.env.TRUST_CLOUDFLARE_CLIENT_IP !== "true") return null;
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  return ip && isIP(ip) !== 0 ? ip : null;
}
