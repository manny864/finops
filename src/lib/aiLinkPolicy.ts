// AISEC-02: hosts a los que puede apuntar un enlace en texto generado por IA.
// Compartido por el guard server-side (aiOutputGuard) y el render (SafeMarkdown).
const DEFAULT_HOSTS =
  "learn.microsoft.com,docs.microsoft.com,portal.azure.com,azure.microsoft.com,cscloudsolutions.com,cscloudsolutions.com.ar";

const HOSTS = (process.env.NEXT_PUBLIC_AI_LINK_HOSTS || DEFAULT_HOSTS)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Sólo https absoluto a un host permitido (o subdominio). Todo lo demás: false. */
export function isAllowedAiLink(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && HOSTS.some((a) => h === a || h.endsWith("." + a));
  } catch {
    return false;
  }
}
