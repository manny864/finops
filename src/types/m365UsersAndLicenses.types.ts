/**
 * m365UsersAndLicenses.types.ts
 * Strict TypeScript types for the M365 Users & Licenses FinOps module.
 *
 * Covers: users, groups, SKU inventory, MFA/auth methods, license spend,
 * and resolutive remediation actions.
 */

// ─── User Types ─────────────────────────────────────────────────────────────

export interface M365UserItem {
    id: string;
    displayName: string;
    userPrincipalName: string;
    accountEnabled: boolean;
    userType: "Member" | "Guest";
    lastSignInDate: string | null;
    daysInactive: number | null; // null = never signed in, -1 = capability unavailable
    assignedPaidSkus: string[];
    assignedFreeSkus: string[];
    hasPaidLicense: boolean;
    licenseCount: number;
    monthlyCostUSD: number;
    products: string[];
}

export interface M365UserSummary {
    totalUsers: number;
    memberUsers: number;
    guestUsers: number;
    activeUsers: number;
    inactiveUsers: number | null; // null when signInActivity capability unavailable
    disabledUsers: number;
    licensedUsers: number;
    mfaEnabledUsers: number | null;
}

// ─── SKU / License Types ────────────────────────────────────────────────────

export interface M365SkuItem {
    skuId: string;
    skuPartNumber: string;
    displayName: string;
    isPaidSku: boolean;
    isSystemSku: boolean;
    prepaidUnits: number;
    consumedUnits: number;
    availableUnits: number;
    monthlyPricePerUnitUSD: number;
    totalMonthlyCostUSD: number;
    unusedSpendUSD: number;
}

export interface M365LicenseSummary {
    totalLicenses: number;
    totalConsumed: number;
    totalAvailable: number;
    totalUnused: number;
    unusedPercentage: number;
    totalMonthlySpendUSD: number;
    paidSkuCount: number;
    freeSkuCount: number;
}

// ─── Group Types ────────────────────────────────────────────────────────────

export interface M365GroupItem {
    id: string;
    displayName: string;
    mailNickname: string;
    groupType: string;
    visibility: string;
    hasOwners: boolean;
    ownersCount: number;
    isInactive: boolean;
    daysInactive: number | null;
    lastActivityDate: string | null;
}

export interface M365GroupSummary {
    totalGroups: number;
    activeGroups: number | null;
    inactiveGroups: number | null;
    orphanedGroups: number; // groups with no owners
}

// ─── MFA / Auth Method Types ────────────────────────────────────────────────

export interface M365AuthMethodStat {
    method: string;
    count: number;
    category: "modern" | "legacy";
}

export interface M365AuthMethodStats {
    microsoftAuthenticator: number;
    softwareOtp: number;
    smsPhone: number;
    email: number;
    fido2Passwordless: number;
    windowsHello: number;
    totalMfaRegistered: number;
    mfaPercentage: number;
    methods: M365AuthMethodStat[];
}

// ─── Remediation Types ──────────────────────────────────────────────────────

export type M365RemediationCategory =
    | "INACTIVE_USER_LICENSE"
    | "DISABLED_USER_LICENSE"
    | "ORPHAN_GROUP"
    | "UNASSIGNED_POOL";

export interface M365LicenseRemediationAction {
    id: string;
    userId?: string;
    userName?: string;
    groupId?: string;
    groupName?: string;
    skuPartNumber?: string;
    monthlySavingsUSD: number;
    category: M365RemediationCategory;
    title: string;
    description: string;
    actionType: "REVOKE" | "ASSIGN_OWNER" | "REASSIGN" | "AUDIT";
    commandPayload: {
        cli: string;
        powershell: string;
        impactSummary: string;
    };
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface M365UsersLicensesResponse {
    success: boolean;
    mock: boolean;
    kpis: M365UserSummary;
    groups: M365GroupSummary;
    licenses: M365LicenseSummary;
    skus: M365SkuItem[];
    users: M365UserItem[];
    topInactiveUsers: M365UserItem[];
    topUnusedSkus: M365SkuItem[];
    topInactiveGroups: M365GroupItem[];
    topLicenseSpend: M365SkuItem[];
    authMethods: M365AuthMethodStats;
    remediations: M365LicenseRemediationAction[];
    capabilities: {
        signInActivity: boolean;
        mfa: boolean;
    };
}

// ─── Corporate Blue Palette for Charts ──────────────────────────────────────

export const M365_CHART_COLORS = {
    primary: "#0078D4",       // Corporate Deep Blue
    secondary: "#2563EB",     // Cobalt Blue
    tertiary: "#0284C7",      // Cyan Blue
    quaternary: "#38BDF8",    // Light Sky Blue
    quinary: "#93C5FD",       // Ice Blue
    inactive: "#94A3B8",      // Slate for inactive/disabled
    savings: "#10B981",       // Emerald for savings
    warning: "#F59E0B",       // Amber for warnings
    danger: "#EF4444",        // Red for critical
};

export const M365_AUTH_METHOD_CATEGORIES: Record<string, "modern" | "legacy"> = {
    "Microsoft Authenticator": "modern",
    "FIDO2 Security Key": "modern",
    "Windows Hello": "modern",
    "Software OTP": "modern",
    "SMS / Phone": "legacy",
    "Email": "legacy",
    "Password": "legacy",
};