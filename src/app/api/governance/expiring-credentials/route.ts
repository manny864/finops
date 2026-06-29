import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

type CredItem = {
    appId: string;
    displayName: string;
    credentialType: "password" | "certificate";
    credentialId: string;
    expiresAt: string;
    daysTillExpiry: number;
    severity: "critical" | "high" | "medium" | "low";
};

function severityFor(days: number): CredItem["severity"] {
    if (days <= 7) return "critical";
    if (days <= 30) return "high";
    if (days <= 60) return "medium";
    return "low";
}

function buildMockItems(): CredItem[] {
    // Dates relativas a HOY así el mock siempre se ve "fresco"
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const samples: Array<{ days: number; name: string; type: CredItem["credentialType"] }> = [
        { days: 2,  name: "finops-onboarding-sp",   type: "password" },
        { days: 12, name: "github-actions-cicd",    type: "certificate" },
        { days: 28, name: "data-ingest-job",        type: "password" },
        { days: 65, name: "monitoring-sp",          type: "certificate" },
    ];
    return samples.map((s, i) => ({
        appId: `${"abcd".repeat(8).slice(0, 8)}-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
        displayName: s.name,
        credentialType: s.type,
        credentialId: `kid-${String(i + 1).padStart(3, "0")}`,
        expiresAt: new Date(now + s.days * day).toISOString(),
        daysTillExpiry: s.days,
        severity: severityFor(s.days),
    }));
}

function countBySeverity(items: CredItem[]) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    items.forEach(i => { counts[i.severity]++; });
    return counts;
}

async function getGraphTokenForTenant(tenantId: string): Promise<string | null> {
    const [rows]: any = await pool.query(
        "SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?",
        [tenantId]
    );
    if (!rows?.[0]?.client_id || !rows?.[0]?.client_secret) return null;
    const { client_id, client_secret } = rows[0];
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

async function fetchAllApplications(token: string): Promise<any[]> {
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

function extractExpiringCreds(apps: any[], daysAhead: number): CredItem[] {
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

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    const daysAhead = Math.min(parseInt(searchParams.get("daysAhead") || "90", 10), 365);

    try {
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Auth error" }, { status: 401 });
    }

    if (isMockTenant(tenantId)) {
        const items = buildMockItems().filter(i => i.daysTillExpiry <= daysAhead);
        return NextResponse.json({
            success: true, mock: true,
            items, counts: countBySeverity(items),
        });
    }

    // Real tenant: query Graph en vivo (autoritativo).
    try {
        const token = await getGraphTokenForTenant(tenantId);
        if (!token) {
            return NextResponse.json({
                success: false,
                items: [], counts: { critical: 0, high: 0, medium: 0, low: 0 },
                error: "No hay credenciales del Service Principal para este tenant. Completá el onboarding (client_id/client_secret) para listar credenciales por expirar.",
                code: "NO_SP_CREDS",
            }, { status: 200 });
        }
        const apps = await fetchAllApplications(token);
        const items = extractExpiringCreds(apps, daysAhead);

        // Persistir snapshot (best-effort) para que dashboards offline tengan algo
        try {
            await pool.query("DELETE FROM ExpiringCredentials WHERE tenant_id = ?", [tenantId]);
            if (items.length > 0) {
                const values = items.map(i => [
                    tenantId, i.appId, i.displayName, i.credentialType,
                    i.credentialId, i.expiresAt.slice(0, 19).replace("T", " "),
                    i.daysTillExpiry,
                ]);
                await pool.query(
                    `INSERT INTO ExpiringCredentials
                     (tenant_id, app_id, display_name, credential_type, credential_id, expires_at, days_till_expiry)
                     VALUES ?`,
                    [values]
                );
            }
        } catch (dbErr: any) {
            console.warn("[ExpiringCredentials] snapshot save failed:", dbErr?.message);
        }

        return NextResponse.json({
            success: true, mock: false,
            items, counts: countBySeverity(items),
            source: "graph-live",
        });
    } catch (e: any) {
        console.error("[ExpiringCredentials] Graph live query failed:", e);
        // Fallback al snapshot DB
        try {
            const [rows]: any = await pool.query(
                "SELECT app_id AS appId, display_name AS displayName, credential_type AS credentialType, credential_id AS credentialId, expires_at AS expiresAt, days_till_expiry AS daysTillExpiry FROM ExpiringCredentials WHERE tenant_id = ? AND days_till_expiry <= ? ORDER BY days_till_expiry ASC",
                [tenantId, daysAhead]
            );
            const items: CredItem[] = (rows || []).map((r: any) => ({
                appId: r.appId,
                displayName: r.displayName,
                credentialType: r.credentialType,
                credentialId: r.credentialId,
                expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : r.expiresAt,
                daysTillExpiry: Number(r.daysTillExpiry || 0),
                severity: severityFor(Number(r.daysTillExpiry || 0)),
            }));
            return NextResponse.json({
                success: true, mock: false,
                items, counts: countBySeverity(items),
                source: "db-snapshot",
                warning: `Graph en vivo no disponible (${e?.message || "error"}); mostrando snapshot.`,
            });
        } catch {
            return NextResponse.json({
                success: false,
                items: [], counts: { critical: 0, high: 0, medium: 0, low: 0 },
                error: `Fallo al consultar Microsoft Graph: ${e?.message || "desconocido"}`,
            }, { status: 200 });
        }
    }
}
