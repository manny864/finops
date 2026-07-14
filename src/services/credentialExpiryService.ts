/**
 * credentialExpiryService — obtención de credenciales de App Registrations
 * (passwords y certificados) con su vencimiento, vía Microsoft Graph
 * (rol: Application.Read.All del Service Principal del tenant, read-only).
 *
 * Consumidores:
 *  - GET /api/governance/expiring-credentials (panel de Credenciales).
 *  - GET /api/cron/credential-expiry-alerts (evaluador de reglas
 *    credential_expiry de AlertRules — notifica por email/Slack/Teams).
 */
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";

export type CredItem = {
    appId: string;
    displayName: string;
    credentialType: "password" | "certificate";
    credentialId: string;
    expiresAt: string;
    daysTillExpiry: number;
    severity: "critical" | "high" | "medium" | "low";
};

export function severityFor(days: number): CredItem["severity"] {
    if (days <= 7) return "critical";
    if (days <= 30) return "high";
    if (days <= 60) return "medium";
    return "low";
}

export async function getGraphTokenForTenant(tenantId: string): Promise<string | null> {
    const creds = await getTenantCredentials(tenantId);
    if (!creds) return null;
    const { clientId: client_id, clientSecret: client_secret } = creds;
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id, client_secret,
            scope: "https://graph.microsoft.com/.default",
            grant_type: "client_credentials",
        }),
    });
    const data = await res.json();
    return res.ok && data.access_token ? data.access_token : null;
}

export async function fetchAllApplications(token: string): Promise<any[]> {
    const apps: any[] = [];
    let url: string | null =
        "https://graph.microsoft.com/v1.0/applications?$select=appId,displayName,passwordCredentials,keyCredentials&$top=200";
    let pageGuard = 0;
    while (url && pageGuard < 20) {
        const res: Response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const txt = await res.text();
            throw Object.assign(new Error(`Graph /applications ${res.status}: ${txt.slice(0, 200)}`), { status: res.status });
        }
        const json: any = await res.json();
        if (Array.isArray(json.value)) apps.push(...json.value);
        url = json["@odata.nextLink"] || null;
        pageGuard++;
    }
    return apps;
}

export function extractExpiringCreds(apps: any[], daysAhead: number): CredItem[] {
    const now = Date.now();
    const horizon = now + daysAhead * 24 * 60 * 60 * 1000;
    const out: CredItem[] = [];
    for (const app of apps) {
        const appId = app.appId;
        const displayName = app.displayName || appId;
        for (const cred of app.passwordCredentials || []) {
            const exp = cred.endDateTime ? new Date(cred.endDateTime).getTime() : 0;
            if (!exp || exp > horizon) continue;
            const days = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
            out.push({
                appId, displayName,
                credentialType: "password",
                credentialId: cred.keyId || "",
                expiresAt: new Date(exp).toISOString(),
                daysTillExpiry: days,
                severity: severityFor(days),
            });
        }
        for (const cred of app.keyCredentials || []) {
            const exp = cred.endDateTime ? new Date(cred.endDateTime).getTime() : 0;
            if (!exp || exp > horizon) continue;
            const days = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
            out.push({
                appId, displayName,
                credentialType: "certificate",
                credentialId: cred.keyId || "",
                expiresAt: new Date(exp).toISOString(),
                daysTillExpiry: days,
                severity: severityFor(days),
            });
        }
    }
    // Más urgentes primero
    out.sort((a, b) => a.daysTillExpiry - b.daysTillExpiry);
    return out;
}

/** Consulta Graph en vivo y devuelve las credenciales que vencen en ≤ daysAhead días. */
export async function getExpiringCredentials(tenantId: string, daysAhead: number): Promise<CredItem[] | null> {
    const token = await getGraphTokenForTenant(tenantId);
    if (!token) return null;
    const apps = await fetchAllApplications(token);
    return extractExpiringCreds(apps, daysAhead);
}

/** Línea de texto plano de una credencial — usada en el body de webhooks (Slack/Teams). */
export function credLine(c: CredItem): string {
    const state = c.daysTillExpiry < 0 ? `VENCIDA hace ${Math.abs(c.daysTillExpiry)} días` : `vence en ${c.daysTillExpiry} días`;
    return `${c.displayName} (${c.credentialType === "password" ? "secreto" : "certificado"}) — ${state} (${c.expiresAt.slice(0, 10)})`;
}

/**
 * HTML del email de alerta de credenciales por vencer. Reusado por el cron
 * (/api/cron/credential-expiry-alerts) y por el botón "Probar" del panel
 * (/api/budgets/alerts/[id]/test) — `isTest` solo cambia el título/aviso
 * para que quien lo reciba sepa que es una prueba manual, no la alerta real.
 */
export function buildCredentialAlertEmailHtml(ruleName: string, thresholdDays: number, creds: CredItem[], isTest = false): string {
    const rows = creds.map(c => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.displayName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.credentialType === "password" ? "Secreto" : "Certificado"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.expiresAt.slice(0, 10)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${c.daysTillExpiry < 0 ? "#c00" : c.daysTillExpiry <= 7 ? "#d60" : "#333"};font-weight:bold;">
            ${c.daysTillExpiry < 0 ? `Vencida (${Math.abs(c.daysTillExpiry)} días)` : `${c.daysTillExpiry} días`}
        </td></tr>`).join("");
    const testBanner = isTest
        ? `<p style="background:#eff6ff;color:#1d4ed8;padding:8px 12px;border-radius:6px;font-size:13px;"><b>Esto es una PRUEBA</b> — la disparaste manualmente desde Gobernanza → Credenciales por Expirar. No afecta la recurrencia configurada de la alerta real.</p>`
        : "";
    const countLine = creds.length > 0
        ? `detectó <b>${creds.length}</b> credencial(es) que vencen dentro de <b>${thresholdDays} días</b> (o ya vencidas)`
        : `no encontró credenciales que venzan dentro de <b>${thresholdDays} días</b> ahora mismo`;
    return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
        <h2 style="color:#0054A6;">🔑 ${isTest ? "Prueba de alerta" : "Alerta"} de credenciales por expirar</h2>
        ${testBanner}
        <p>La regla <b>${ruleName}</b> ${countLine}:</p>
        ${creds.length > 0 ? `<table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr style="background:#f4f7fb;text-align:left;">
                <th style="padding:8px 10px;">Aplicación</th><th style="padding:8px 10px;">Tipo</th>
                <th style="padding:8px 10px;">Vence</th><th style="padding:8px 10px;">Estado</th>
            </tr>
            ${rows}
        </table>` : ""}
        <p style="color:#666;font-size:12px;margin-top:16px;">
            Renová estas credenciales en Entra ID antes del vencimiento para evitar cortes de servicio.
            Detalle completo en Gobernanza → Credenciales por Expirar.
        </p>
    </div>`;
}
