import { getAzureCredential } from "@/lib/azure";
import { resolveSkuName, resolveSkuPrice } from "@/lib/m365SkuCatalog";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

// ─────────────────────────────────────────────────────────────────────────────
// Microsoft 365 / Entra ID: usuarios, licencias, grupos, MFA y actividad, vía
// Microsoft Graph. Cada bloque va en su propio try/catch y se marca en
// `capabilities` si el permiso/feature no está disponible (p.ej. signInActivity
// requiere Entra ID P1) — así la UI degrada con gracia en vez de romperse.
// ─────────────────────────────────────────────────────────────────────────────

/** Token de Microsoft Graph para el tenant. Exportado para reuso en otros servicios de identidad. */
export async function graphToken(tenantId: string): Promise<string> {
    const credential = await getAzureCredential(tenantId);
    const tok = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tok?.token) throw new Error("No se pudo autenticar con Microsoft Graph");
    return tok.token;
}

/**
 * GET paginado contra Microsoft Graph, siguiendo `@odata.nextLink`.
 * Exportado para reuso: duplicar el manejo de paginacion en cada servicio de
 * identidad era la alternativa peor.
 */
export async function graphGetAll(token: string, url: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = url;
    let guard = 0;
    while (next && guard < 50) {
        guard++;
        const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const err = await res.text().catch(() => "");
            throw Object.assign(new Error(`Graph ${res.status}: ${err.slice(0, 200)}`), { status: res.status });
        }
        const json: any = await res.json();
        out.push(...(json.value || []));
        next = json["@odata.nextLink"] || null;
    }
    return out;
}

interface GraphUser {
    id: string;
    displayName: string;
    userPrincipalName: string;
    accountEnabled: boolean;
    assignedLicenses: Array<{ skuId: string }>;
    signInActivity?: { lastSignInDateTime?: string | null };
}

const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};

/** Detalle de usuarios: enabled, licencias, actividad. Base para dashboard y User Activity. */
export async function getUsersDetail(tenantId: string) {
    const token = await graphToken(tenantId);
    const capabilities = { signInActivity: true };

    // subscribedSkus → mapa skuId→{part, name}. Necesario para traducir las
    // assignedLicenses (que solo traen GUID) a nombres de producto.
    const skus = await graphGetAll(token, "https://graph.microsoft.com/v1.0/subscribedSkus");
    const skuById = new Map<string, { part: string; name: string; price: number }>();
    for (const s of skus) {
        skuById.set(s.skuId, { part: s.skuPartNumber, name: resolveSkuName(s.skuPartNumber), price: resolveSkuPrice(s.skuPartNumber) });
    }

    // Usuarios. signInActivity requiere Entra ID P1 + AuditLog.Read.All: si falla
    // por eso, reintentamos sin ese campo (marcando la capability como ausente).
    const select = "id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity";
    let rawUsers: GraphUser[];
    try {
        rawUsers = await graphGetAll(token, `https://graph.microsoft.com/v1.0/users?$select=${select}&$top=999`) as GraphUser[];
    } catch (e) {
        if (errorStatus(e) === 403 || errorStatus(e) === 400) {
            capabilities.signInActivity = false;
            rawUsers = await graphGetAll(token, `https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999`) as GraphUser[];
        } else {
            throw e;
        }
    }

    const users = rawUsers.map(u => {
        const products = (u.assignedLicenses || []).map(l => skuById.get(l.skuId)?.name).filter(Boolean) as string[];
        const monthlyCost = (u.assignedLicenses || []).reduce((sum, l) => sum + (skuById.get(l.skuId)?.price || 0), 0);
        const lastDays = daysSince(u.signInActivity?.lastSignInDateTime);
        // When signInActivity capability is disabled, mark with -1 to distinguish from null (which means never signed in)
        const displayLastDays = capabilities.signInActivity ? lastDays : (lastDays === null ? -1 : lastDays);
        return {
            id: u.id,
            displayName: u.displayName || u.userPrincipalName,
            userPrincipalName: u.userPrincipalName,
            accountEnabled: !!u.accountEnabled,
            products,
            licenseCount: products.length,
            monthlyCost,
            lastActivityDays: displayLastDays,
            // "Inactive" = sin sign-in en 30+ días o nunca. Con capability off, no se puede saber.
            inactive: capabilities.signInActivity ? (lastDays === null || lastDays >= 30) : false,
        };
    });

    return { users, skus, skuById, capabilities };
}

/** SKUs de licencia: total, consumido, no usado y spend estimado (precio de lista). */
export function summarizeLicenses(skus: any[]) {
    const rows = skus.map(s => {
        const total = s.prepaidUnits?.enabled || 0;
        const consumed = s.consumedUnits || 0;
        const unused = Math.max(0, total - consumed);
        const price = resolveSkuPrice(s.skuPartNumber);
        return {
            skuPartNumber: s.skuPartNumber,
            name: resolveSkuName(s.skuPartNumber),
            total, consumed, unused,
            monthlyPrice: price,
            monthlySpend: Number((consumed * price).toFixed(2)),
            unusedSpend: Number((unused * price).toFixed(2)),
        };
    });
    const totalLicenses = rows.reduce((s, r) => s + r.total, 0);
    const totalUnused = rows.reduce((s, r) => s + r.unused, 0);
    const totalSpend = Number(rows.reduce((s, r) => s + r.monthlySpend, 0).toFixed(2));
    return {
        rows,
        totalLicenses, totalUnused,
        unusedPct: totalLicenses > 0 ? Math.round((totalUnused / totalLicenses) * 100) : 0,
        totalSpend,
        productCount: rows.length,
    };
}

/** Registro de MFA y métodos de autenticación (reports/authenticationMethods). */
export async function getMfaAndAuthMethods(tenantId: string) {
    const token = await graphToken(tenantId);
    try {
        const details = await graphGetAll(token, "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=999");
        const mfaCapable = details.filter((d: any) => d.isMfaCapable || d.isMfaRegistered).length;
        const methodCounts: Record<string, number> = {};
        for (const d of details) {
            for (const m of (d.methodsRegistered || [])) {
                methodCounts[m] = (methodCounts[m] || 0) + 1;
            }
        }
        const authMethods = Object.entries(methodCounts)
            .map(([method, count]) => ({ method: prettyAuthMethod(method), count }))
            .sort((a, b) => b.count - a.count);
        return { mfaEnforcedUsers: mfaCapable, authMethods, available: true };
    } catch (e) {
        console.warn("[m365] MFA/auth methods no disponible:", errorMessage(e));
        return { mfaEnforcedUsers: null as number | null, authMethods: [] as Array<{ method: string; count: number }>, available: false };
    }
}

function prettyAuthMethod(m: string): string {
    const map: Record<string, string> = {
        password: "Password",
        microsoftAuthenticatorPush: "Microsoft Authenticator",
        softwareOneTimePasscode: "Software OTP",
        mobilePhone: "SMS / Phone",
        windowsHelloForBusiness: "Windows Hello",
        fido2SecurityKey: "FIDO2 Security Key",
        email: "Email",
    };
    return map[m] || m;
}

/** Grupos: total, sin dueño, y actividad (best-effort desde el reporte O365). */
export async function getGroups(tenantId: string) {
    const token = await graphToken(tenantId);

    const groups = await graphGetAll(
        token,
        "https://graph.microsoft.com/v1.0/groups?$select=id,displayName,groupTypes,createdDateTime,visibility&$expand=owners($select=id)&$top=999"
    );

    const total = groups.length;
    const noOwner = groups.filter((g: any) => !(g.owners && g.owners.length)).length;

    // Actividad de M365 Groups (últimos 180 días). CSV → mapa por groupDisplayName.
    let inactiveGroups: Array<{ name: string; lastActivityDays: number | null }> = [];
    let activeCount: number | null = null;
    let inactiveCount: number | null = null;
    try {
        const res = await fetch("https://graph.microsoft.com/v1.0/reports/getOffice365GroupsActivityDetail(period='D180')", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const text = await res.text();
            const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
            if (lines.length > 1) {
                const header = lines[0].split(",");
                const nameIdx = header.findIndex(h => /Group Display Name/i.test(h));
                const lastActIdx = header.findIndex(h => /Last Activity Date/i.test(h));
                const parsed = lines.slice(1).map(l => {
                    const cells = l.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)?.map(x => x.replace(/^"|"$/g, "")) || [];
                    return { name: cells[nameIdx] || "", lastActivityDays: daysSince(cells[lastActIdx]) };
                }).filter(r => r.name);
                inactiveGroups = parsed
                    .filter(r => r.lastActivityDays === null || r.lastActivityDays >= 90)
                    .sort((a, b) => (b.lastActivityDays ?? 9999) - (a.lastActivityDays ?? 9999));
                inactiveCount = inactiveGroups.length;
                activeCount = parsed.length - inactiveCount;
            }
        }
    } catch (e) {
        console.warn("[m365] groups activity report no disponible:", errorMessage(e));
    }

    return { total, noOwner, inactiveGroups: inactiveGroups.slice(0, 10), activeCount, inactiveCount };
}

/** Overview del dashboard: junta usuarios, licencias, MFA y grupos. */
export async function getM365Overview(tenantId: string) {
    const [{ users, skus, capabilities }, mfa, groups] = await Promise.all([
        getUsersDetail(tenantId),
        getMfaAndAuthMethods(tenantId),
        getGroups(tenantId).catch(e => { console.warn("[m365] groups:", e?.message); return { total: 0, noOwner: 0, inactiveGroups: [], activeCount: null, inactiveCount: null }; }),
    ]);

    const licenses = summarizeLicenses(skus);
    const licensedUsers = users.filter(u => u.licenseCount > 0).length;
    const activeUsers = users.filter(u => !u.inactive).length;
    const inactiveUsers = capabilities.signInActivity ? users.filter(u => u.inactive).length : null;
    const blockedUsers = users.filter(u => !u.accountEnabled).length;

    const topInactiveUsers = capabilities.signInActivity
        ? users.filter(u => u.inactive).sort((a, b) => (b.lastActivityDays ?? 99999) - (a.lastActivityDays ?? 99999)).slice(0, 3)
            .map(u => ({ name: u.displayName, days: u.lastActivityDays }))
        : [];

    const topUnusedLicenses = [...licenses.rows].filter(r => r.unused > 0).sort((a, b) => b.unused - a.unused).slice(0, 3)
        .map(r => ({ name: r.name, unused: r.unused }));

    const topLicenseSpend = [...licenses.rows].filter(r => r.monthlySpend > 0).sort((a, b) => b.monthlySpend - a.monthlySpend).slice(0, 3)
        .map(r => ({ name: r.name, spend: r.monthlySpend }));

    return {
        kpis: {
            totalUsers: users.length,
            licensedUsers,
            mfaEnforcedUsers: mfa.mfaEnforcedUsers,
            totalGroups: groups.total,
        },
        userActivity: { active: activeUsers, inactive: inactiveUsers, blocked: blockedUsers, total: users.length },
        groupsActivity: { active: groups.activeCount, inactive: groups.inactiveCount, noOwner: groups.noOwner, total: groups.total },
        productLicense: {
            productCount: licenses.productCount, totalLicenses: licenses.totalLicenses,
            totalUnused: licenses.totalUnused, unusedPct: licenses.unusedPct, totalSpend: licenses.totalSpend,
        },
        topInactiveUsers,
        topUnusedLicenses,
        topInactiveGroups: groups.inactiveGroups.slice(0, 5).map(g => ({ name: g.name, days: g.lastActivityDays })),
        topLicenseSpend,
        authMethods: mfa.authMethods,
        capabilities: { signInActivity: capabilities.signInActivity, mfa: mfa.available },
    };
}

/** Tabla de detalle "User Activity". */
export async function getUserActivity(tenantId: string) {
    const { users, capabilities } = await getUsersDetail(tenantId);
    const enabled = users.filter(u => u.accountEnabled).length;
    const blocked = users.length - enabled;
    const active = users.filter(u => !u.inactive).length;
    const inactive = capabilities.signInActivity ? users.filter(u => u.inactive).length : null;

    return {
        kpis: { total: users.length, enabled, blocked, active, inactive },
        rows: users
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map(u => ({
                displayName: u.displayName,
                accountEnabled: u.accountEnabled,
                lastActivityDays: u.lastActivityDays,
                products: u.products,
                licenseCount: u.licenseCount,
                userPrincipalName: u.userPrincipalName,
            })),
        capabilities,
    };
}
