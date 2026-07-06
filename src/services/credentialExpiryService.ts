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
