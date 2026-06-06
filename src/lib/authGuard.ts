export function isSuperAdmin(userEmail: string | null | undefined): boolean {
    if (!userEmail) return false;
    return userEmail.trim().toLowerCase().endsWith('@cscloudsolutions.com.ar');
}
