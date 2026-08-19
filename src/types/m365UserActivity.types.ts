/**
 * m365UserActivity.types.ts
 * Strict TypeScript types for the M365 "Actividad de Usuarios" sub-tab.
 *
 * Covers: enriched user activity rows, filters, remediation actions,
 * and the full API response shape for the User Activity tab.
 */

// ─── SKU assignment per user ────────────────────────────────────────────────

export interface M365AssignedSku {
    skuId: string;
    skuPartNumber: string;
    displayName: string;
    isPaid: boolean;
    priceUSD: number;
}

// ─── User Activity Row (enriched) ───────────────────────────────────────────

export interface M365UserActivityItem {
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string;
    accountEnabled: boolean;
    /** 'Member' | 'Guest' | 'ServiceAccount' */
    userType: "Member" | "Guest" | "ServiceAccount";
    lastSignInDate: string | null;
    /** Days since last interactive or non-interactive sign-in. null = never signed in. */
    daysInactive: number | null;
    isInactive: boolean;       // daysInactive >= 30 or null
    isZombie: boolean;         // daysInactive > 365 or accountEnabled === false
    mfaRegistered: boolean;
    authMethods: string[];
    assignedSkus: M365AssignedSku[];
    monthlyCostUSD: number;
    /** True when user is inactive (>90d) or disabled AND holds paid licenses costing > $0 */
    isLicenseWaste: boolean;
}

// ─── KPI summary for the User Activity tab ──────────────────────────────────

export interface M365UserActivityKpis {
    totalUsers: number;
    enabledUsers: number;
    disabledUsers: number;
    activeUsers: number;        // daysInactive < 30
    inactiveUsers: number;      // daysInactive >= 30
    zombieUsers: number;        // daysInactive > 365 or disabled
    licensedUsers: number;
    mfaRegisteredUsers: number;
    totalMonthlyCostUSD: number;
    licenseWasteCount: number;
    licenseWasteCostUSD: number;
}

// ─── Filters ────────────────────────────────────────────────────────────────

export interface M365ActivityFilters {
    search: string;
    accountState: "all" | "enabled" | "disabled";
    userType: "all" | "member" | "guest" | "service";
    inactivityRange: "all" | "active" | "inactive_30" | "inactive_90" | "zombie_365";
    licenseFilter: "all" | "paid" | "free" | "none";
}

// ─── Remediation action ─────────────────────────────────────────────────────

export interface UserRemediationAction {
    id: string;
    userId: string;
    userPrincipalName: string;
    actionType: "REVOKE_LICENSE" | "DISABLE_ACCOUNT" | "REMOVE_GUEST" | "FORCE_MFA";
    skuPartNumber?: string;
    potentialSavingsUSD: number;
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

// ─── Sign-in history entry (for user detail drawer) ─────────────────────────

export interface M365SignInHistoryEntry {
    createdDateTime: string;
    ipAddress: string;
    appDisplayName: string;
    location: { city?: string; state?: string; countryOrRegion?: string };
    status: { errorCode: number; failureReason?: string };
    isInteractive: boolean;
}

// ─── API response shape ─────────────────────────────────────────────────────

export interface M365UserActivityResponse {
    success: boolean;
    mock: boolean;
    kpis: M365UserActivityKpis;
    rows: M365UserActivityItem[];
    remediations: UserRemediationAction[];
    capabilities: {
        signInActivity: boolean;
        mfa: boolean;
    };
}

// ─── Inactivity badge color mapping ─────────────────────────────────────────

export const INACTIVITY_BADGE = {
    active: { label: "Active", color: "green", threshold: 30 },
    warm: { label: "30-90d", color: "sky", threshold: 90 },
    critical: { label: "90-180d", color: "amber", threshold: 180 },
    zombie: { label: ">180d", color: "red", threshold: Infinity },
} as const;

export function getInactivityBadge(days: number | null): { label: string; color: string } {
    if (days === null) return { label: "Never", color: "slate" };
    if (days < 30) return { label: `${days}d`, color: "green" };
    if (days < 90) return { label: `${days}d`, color: "sky" };
    if (days < 180) return { label: `${days}d`, color: "amber" };
    return { label: `${days}d`, color: "red" };
}