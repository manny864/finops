/**
 * m365UserActivity.service.ts
 *
 * Enriched Microsoft Graph queries for the "Actividad de Usuarios" sub-tab.
 *
 * Queries:
 *  - /v1.0/users (with signInActivity, assignedLicenses, userType)
 *  - /v1.0/subscribedSkus (SKU catalog with pricing)
 *  - /reports/credentialUserRegistrationDetails (MFA registration status)
 *  - /v1.0/auditLogs/signIns (last 10 sign-ins per user, on-demand)
 *
 * Classification:
 *  - Miembro Cloud: @dominio.onmicrosoft.com without #EXT#
 *  - Invitado B2B: #EXT# in UPN or userType === 'Guest'
 *  - Cuenta de Servicio: UPN contains rpa, svc_, adminrpa, service, digitalworker
 *
 * License waste detection: daysInactive > 90 OR accountEnabled === false AND monthlyCostUSD > 0
 */

import { getAzureCredential } from "@/lib/azure";
import { resolveSkuName, resolveSkuPrice } from "@/lib/m365SkuCatalog";
import type {
    M365UserActivityItem,
    M365UserActivityKpis,
    M365AssignedSku,
    UserRemediationAction,
    M365SignInHistoryEntry,
} from "@/types/m365UserActivity.types";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function graphToken(tenantId: string): Promise<string> {
    const credential = await getAzureCredential(tenantId);
    const tok = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tok?.token) throw new Error("No se pudo autenticar con Microsoft Graph");
    return tok.token;
}

async function graphGetAll(token: string, url: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = url;
    let guard = 0;
    while (next && guard < 50) {
        guard++;
        const res: Response = await fetch(next, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!res.ok) {
            const err = await res.text().catch(() => "");
            throw Object.assign(new Error(`Graph ${res.status}: ${err.slice(0, 200)}`), { status: res.status });
        }
        const json: { value?: any[]; "@odata.nextLink"?: string | null } = await res.json();
        out.push(...(json.value || []));
        next = json["@odata.nextLink"] || null;
    }
    return out;
}

const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};

// ─── User type classification ───────────────────────────────────────────────

const SERVICE_ACCOUNT_PREFIXES = ["svc_", "svc-", "svc.", "service_", "service-", "bot_", "bot-", "digitalworker", "adminrpa", "daemon_"];
const SERVICE_ACCOUNT_EXACT = ["rpa", "svc", "bot", "service", "digitalworker", "adminrpa"];

function classifyUserType(upn: string, graphUserType?: string): "Member" | "Guest" | "ServiceAccount" {
    const lower = (upn || "").toLowerCase().trim();
    
    // Extract local username part (e.g. "admin" from "admin@domain.com", or "mchavez" from "mchavez_ctrl365.com#ext#@tenant.com")
    let localPart = lower;
    if (localPart.includes("#ext#")) {
        localPart = localPart.split("#ext#")[0];
        if (localPart.includes("_")) {
            const lastIdx = localPart.lastIndexOf("_");
            localPart = localPart.substring(0, lastIdx);
        }
    } else if (localPart.includes("@")) {
        localPart = localPart.split("@")[0];
    }

    // Service account detection only on local alias
    const isServiceAccount =
        SERVICE_ACCOUNT_EXACT.includes(localPart) ||
        SERVICE_ACCOUNT_PREFIXES.some(prefix => localPart.startsWith(prefix)) ||
        localPart.endsWith("_svc") ||
        localPart.endsWith("-svc") ||
        localPart.endsWith("_bot") ||
        localPart.endsWith("-bot");

    if (isServiceAccount) return "ServiceAccount";

    // B2B Guest detection
    if (lower.includes("#ext#") || graphUserType === "Guest") return "Guest";

    return "Member";
}

// ─── Main enriched query ────────────────────────────────────────────────────

export async function getEnrichedUserActivity(tenantId: string) {
    const token = await graphToken(tenantId);
    const capabilities = { signInActivity: true, mfa: true };

    // 1. Fetch subscribed SKUs → price map
    const skus = await graphGetAll(token, "https://graph.microsoft.com/v1.0/subscribedSkus");
    const skuById = new Map<string, { part: string; name: string; price: number; isPaid: boolean }>();
    for (const s of skus) {
        const price = resolveSkuPrice(s.skuPartNumber);
        skuById.set(s.skuId, {
            part: s.skuPartNumber,
            name: resolveSkuName(s.skuPartNumber),
            price,
            isPaid: price > 0,
        });
    }

    // 2. Fetch users with signInActivity
    const select = "id,displayName,userPrincipalName,mail,accountEnabled,userType,assignedLicenses,signInActivity";
    let rawUsers: any[];
    try {
        rawUsers = await graphGetAll(
            token,
            `https://graph.microsoft.com/v1.0/users?$select=${select}&$top=999`
        );
    } catch (e) {
        if (errorStatus(e) === 403 || errorStatus(e) === 400) {
            // signInActivity requires P1 + AuditLog.Read.All — degrade gracefully
            capabilities.signInActivity = false;
            rawUsers = await graphGetAll(
                token,
                `https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,userType,assignedLicenses&$top=999`
            );
        } else {
            throw e;
        }
    }

    // 3. Fetch MFA registration details
    const mfaMap = new Map<string, { isMfaRegistered: boolean; methods: string[] }>();
    try {
        const mfaDetails = await graphGetAll(
            token,
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=999"
        );
        for (const d of mfaDetails) {
            mfaMap.set(d.userPrincipalName?.toLowerCase(), {
                isMfaRegistered: !!(d.isMfaCapable || d.isMfaRegistered),
                methods: (d.methodsRegistered || []).map((m: string) => prettyAuthMethod(m)),
            });
        }
    } catch (e) {
        console.warn("[m365/user-activity] MFA details unavailable:", errorMessage(e));
        capabilities.mfa = false;
    }

    // 4. Enrich each user row
    const rows: M365UserActivityItem[] = rawUsers.map((u: any) => {
        const upn: string = u.userPrincipalName || "";
        const userType = classifyUserType(upn, u.userType);
        const lastSignIn = u.signInActivity?.lastSignInDateTime
            || u.signInActivity?.lastNonInteractiveSignInDateTime
            || null;
        const days = capabilities.signInActivity ? daysSince(lastSignIn) : null;
        const mfa = mfaMap.get(upn.toLowerCase());

        // Build assigned SKU list
        const assignedSkus: M365AssignedSku[] = (u.assignedLicenses || []).map((l: any) => {
            const info = skuById.get(l.skuId);
            return {
                skuId: l.skuId,
                skuPartNumber: info?.part || l.skuId,
                displayName: info?.name || l.skuId,
                isPaid: info?.isPaid ?? false,
                priceUSD: info?.price ?? 0,
            };
        });

        const monthlyCostUSD = assignedSkus.reduce((sum, s) => sum + s.priceUSD, 0);
        const isInactive = days === null || days >= 30;
        const isZombie = (days !== null && days > 365) || !u.accountEnabled;
        const isLicenseWaste = (days !== null && days > 90 && monthlyCostUSD > 0)
            || (!u.accountEnabled && monthlyCostUSD > 0);

        return {
            id: u.id,
            displayName: u.displayName || upn,
            userPrincipalName: upn,
            mail: u.mail || "",
            accountEnabled: !!u.accountEnabled,
            userType,
            lastSignInDate: lastSignIn,
            daysInactive: days,
            isInactive,
            isZombie,
            mfaRegistered: mfa?.isMfaRegistered ?? false,
            authMethods: mfa?.methods || [],
            assignedSkus,
            monthlyCostUSD: Number(monthlyCostUSD.toFixed(2)),
            isLicenseWaste,
        };
    });

    // 5. Compute KPIs
    const kpis: M365UserActivityKpis = {
        totalUsers: rows.length,
        enabledUsers: rows.filter(r => r.accountEnabled).length,
        disabledUsers: rows.filter(r => !r.accountEnabled).length,
        activeUsers: rows.filter(r => r.daysInactive !== null && r.daysInactive < 30).length,
        inactiveUsers: rows.filter(r => r.isInactive).length,
        zombieUsers: rows.filter(r => r.isZombie).length,
        licensedUsers: rows.filter(r => r.assignedSkus.length > 0).length,
        mfaRegisteredUsers: rows.filter(r => r.mfaRegistered).length,
        totalMonthlyCostUSD: Number(rows.reduce((s, r) => s + r.monthlyCostUSD, 0).toFixed(2)),
        licenseWasteCount: rows.filter(r => r.isLicenseWaste).length,
        licenseWasteCostUSD: Number(
            rows.filter(r => r.isLicenseWaste).reduce((s, r) => s + r.monthlyCostUSD, 0).toFixed(2)
        ),
    };

    // 6. Generate remediation actions
    const remediations: UserRemediationAction[] = rows
        .filter(r => r.isLicenseWaste)
        .map(r => {
            const paidSkus = r.assignedSkus.filter(s => s.isPaid);
            const skuPart = paidSkus.length > 0 ? paidSkus[0].skuPartNumber : undefined;
            const actionType: UserRemediationAction["actionType"] =
                r.isZombie && !r.accountEnabled ? "DISABLE_ACCOUNT"
                : r.userType === "Guest" ? "REMOVE_GUEST"
                : "REVOKE_LICENSE";

            return {
                id: `remediation-${r.id}`,
                userId: r.id,
                userPrincipalName: r.userPrincipalName,
                actionType,
                skuPartNumber: skuPart,
                potentialSavingsUSD: r.monthlyCostUSD,
                commandPayload: {
                    cli: `az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/users/${r.id}" --body '{"accountEnabled":false}'`,
                    powershell: `Set-MgUser -UserId "${r.userPrincipalName}" -AccountEnabled $false`,
                    impactSummary: `Revocar licencias de ${r.userPrincipalName} ahorraría $${r.monthlyCostUSD}/mes.`,
                },
            };
        });

    return { kpis, rows, remediations, capabilities };
}

// ─── Sign-in history for a single user (on-demand, drawer) ──────────────────

export async function getUserSignInHistory(
    tenantId: string,
    userId: string
): Promise<M365SignInHistoryEntry[]> {
    const token = await graphToken(tenantId);
    try {
        const entries = await graphGetAll(
            token,
            `https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=userId eq '${userId}'&$top=10&$orderby=createdDateTime desc`
        );
        return entries.map((e: any) => ({
            createdDateTime: e.createdDateTime,
            ipAddress: e.ipAddress || "—",
            appDisplayName: e.appDisplayName || "—",
            location: {
                city: e.location?.city,
                state: e.location?.state,
                countryOrRegion: e.location?.countryOrRegion,
            },
            status: {
                errorCode: e.status?.errorCode ?? 0,
                failureReason: e.status?.failureReason,
            },
            isInteractive: e.isInteractive ?? true,
        }));
    } catch (e) {
        console.warn(`[m365/user-activity] Sign-in history unavailable for ${userId}:`, errorMessage(e));
        return [];
    }
}

// ─── Auth method display names ──────────────────────────────────────────────

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