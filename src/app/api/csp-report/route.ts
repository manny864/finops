import { NextRequest } from "next/server";
import rateLimiter from "@/lib/rateLimiter";
import { BodyLimitError, readBodyCapped } from "@/lib/readJsonCapped";
import { extractViolations } from "@/lib/cspReport";
import { trustedClientIp } from "@/lib/trustedClientIp";

/**
 * PERIM-01: colector de violaciones CSP (`report-uri` y `report-to` de src/lib/cspNonce.ts).
 *
 * Es anónimo por naturaleza (lo llama el navegador), así que se acota todo:
 * - body ≤ 16 KB cortado mientras llega; sólo los content-types de reportes CSP;
 * - rate limit por IP confiable (20/min) y global (600/min): el exceso se descarta en silencio;
 * - máx. 10 reportes por envío, campos con allowlist y truncados;
 * - URLs redactadas a origen + path: la query y el fragmento pueden llevar tokens.
 * Sale como una línea `[csp-violation]` en stdout → Log Analytics (ContainerAppConsoleLogs).
 * Siempre responde 204 para no dar señal a quien lo sondee.
 */
const MAX_BODY_BYTES = 16 * 1024;
const ACCEPTED = ["application/csp-report", "application/reports+json", "application/json"];

const noContent = () => new Response(null, { status: 204 });

export async function POST(request: NextRequest) {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED.includes(type)) return noContent();

    // PERIM-05: cf-connecting-ip sólo vale con el ingress cerrado a Cloudflare.
    const ip = trustedClientIp(request) ?? "untrusted";
    const [perIp, global] = await Promise.all([
        rateLimiter.checkByKeyDistributed(`csp-report:${ip}`, 20, 60 * 1000),
        rateLimiter.checkByKeyDistributed("csp-report:global", 600, 60 * 1000),
    ]);
    if (!perIp.allowed || !global.allowed) return noContent();

    let payload: unknown;
    try {
        payload = JSON.parse((await readBodyCapped(request, MAX_BODY_BYTES)).toString("utf8"));
    } catch (e) {
        if (!(e instanceof BodyLimitError) && !(e instanceof SyntaxError)) throw e;
        return noContent();
    }

    for (const v of extractViolations(payload)) {
        console.warn("[csp-violation]", JSON.stringify(v));
    }
    return noContent();
}
