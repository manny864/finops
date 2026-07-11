// Catálogo de SKUs de Microsoft 365 / Entra ID.
//
// Graph (subscribedSkus) devuelve skuPartNumber (ej. "SPB") y GUID, pero NO el
// nombre comercial ni el precio. El precio por licencia lo negocia cada cliente,
// así que estos son PRECIOS DE LISTA PÚBLICOS mensuales (USD) usados solo como
// ESTIMACIÓN para "License Spend" — el cliente puede sobrescribirlos luego.
// Fuente: precios públicos de Microsoft (aprox., pueden variar por región/fecha).

interface SkuInfo {
    name: string;
    monthlyListPrice: number; // USD por licencia/mes (0 = gratis o desconocido)
}

const SKU_CATALOG: Record<string, SkuInfo> = {
    // Microsoft 365 Business
    O365_BUSINESS_ESSENTIALS: { name: "Microsoft 365 Business Basic", monthlyListPrice: 6 },
    SMB_BUSINESS_ESSENTIALS: { name: "Microsoft 365 Business Basic", monthlyListPrice: 6 },
    O365_BUSINESS_PREMIUM: { name: "Microsoft 365 Business Standard", monthlyListPrice: 12.5 },
    SMB_BUSINESS_PREMIUM: { name: "Microsoft 365 Business Standard", monthlyListPrice: 12.5 },
    SPB: { name: "Microsoft 365 Business Premium", monthlyListPrice: 22 },
    O365_BUSINESS: { name: "Microsoft 365 Apps for Business", monthlyListPrice: 8.25 },
    SMB_BUSINESS: { name: "Microsoft 365 Apps for Business", monthlyListPrice: 8.25 },
    // Microsoft 365 Enterprise
    SPE_E3: { name: "Microsoft 365 E3", monthlyListPrice: 36 },
    SPE_E5: { name: "Microsoft 365 E5", monthlyListPrice: 57 },
    SPE_F1: { name: "Microsoft 365 F3", monthlyListPrice: 8 },
    ENTERPRISEPACK: { name: "Office 365 E3", monthlyListPrice: 23 },
    ENTERPRISEPREMIUM: { name: "Office 365 E5", monthlyListPrice: 38 },
    STANDARDPACK: { name: "Office 365 E1", monthlyListPrice: 10 },
    OFFICESUBSCRIPTION: { name: "Microsoft 365 Apps for Enterprise", monthlyListPrice: 12 },
    // Power Platform
    FLOW_FREE: { name: "Microsoft Power Automate Free", monthlyListPrice: 0 },
    POWER_BI_STANDARD: { name: "Power BI (Free)", monthlyListPrice: 0 },
    POWER_BI_PRO: { name: "Power BI Pro", monthlyListPrice: 10 },
    PBI_PREMIUM_PER_USER: { name: "Power BI Premium Per User", monthlyListPrice: 20 },
    POWERAPPS_DEV: { name: "Microsoft Power Apps for Developer", monthlyListPrice: 0 },
    POWERAPPS_VIRAL: { name: "Microsoft Power Apps Plan 2 Trial", monthlyListPrice: 0 },
    POWERAUTOMATE_ATTENDED_RPA: { name: "Power Automate per user with attended RPA", monthlyListPrice: 15 },
    // Dynamics
    DYN365_ENTERPRISE_SALES: { name: "Dynamics 365 Sales Enterprise", monthlyListPrice: 95 },
    DYN365_SALES_PRO: { name: "Dynamics 365 Sales Professional", monthlyListPrice: 65 },
    // Otros
    VISIOCLIENT: { name: "Visio Online Plan 2", monthlyListPrice: 15 },
    PROJECTPROFESSIONAL: { name: "Project Plan 3", monthlyListPrice: 30 },
    EXCHANGESTANDARD: { name: "Exchange Online (Plan 1)", monthlyListPrice: 4 },
    EXCHANGEENTERPRISE: { name: "Exchange Online (Plan 2)", monthlyListPrice: 8 },
    MCOMEETADV: { name: "Microsoft 365 Audio Conferencing", monthlyListPrice: 4 },
    MCOEV: { name: "Microsoft Teams Phone Standard", monthlyListPrice: 8 },
    WIN_DEF_ATP: { name: "Microsoft Defender for Endpoint", monthlyListPrice: 5.2 },
    EMS: { name: "Enterprise Mobility + Security E3", monthlyListPrice: 10.6 },
    EMSPREMIUM: { name: "Enterprise Mobility + Security E5", monthlyListPrice: 16.4 },
    AAD_PREMIUM: { name: "Microsoft Entra ID P1", monthlyListPrice: 6 },
    AAD_PREMIUM_P2: { name: "Microsoft Entra ID P2", monthlyListPrice: 9 },
    WINDOWS_STORE: { name: "Windows Store for Business", monthlyListPrice: 0 },
    FABRIC_FREE: { name: "Microsoft Fabric (Free)", monthlyListPrice: 0 },
    Microsoft_Fabric_Free: { name: "Microsoft Fabric (Free)", monthlyListPrice: 0 },
};

export function resolveSkuName(skuPartNumber: string): string {
    return SKU_CATALOG[skuPartNumber]?.name || skuPartNumber.replace(/_/g, " ");
}

export function resolveSkuPrice(skuPartNumber: string): number {
    return SKU_CATALOG[skuPartNumber]?.monthlyListPrice ?? 0;
}
