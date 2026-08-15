const CORPORATE_DOMAINS = [
    '@cscloudsolutions.com.ar',
    '@cscloudsolutionsoutlook.onmicrosoft.com'
];

export function isSuperAdmin(userEmail: string | null | undefined): boolean {
    if (!userEmail) return false;
    const lower = userEmail.trim().toLowerCase();
    return CORPORATE_DOMAINS.some(d => lower.endsWith(d));
}
