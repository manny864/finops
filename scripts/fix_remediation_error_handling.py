#!/usr/bin/env python3
"""
Script to apply remediation error handling fix and extend BUSINESS_CUSTOM_ACTIONS.
Follows directivas/remediacion_eliminacion_recursos_sop.md.
"""
import re
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def patch_remediation_service():
    path = os.path.join(BASE_DIR, "src/services/remediationService.ts")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    target = """            if (!res.ok) {
                const bodyText = await res.text().catch(() => "No response body");
                console.error(`[RemediationService] Azure REST API returned ${res.status}: ${bodyText}`);
                throw new Error(`Azure API error ${res.status}: ${bodyText}`);
            }"""

    replacement = """            if (!res.ok) {
                const bodyText = await res.text().catch(() => "No response body");
                console.error(`[RemediationService] Azure REST API returned ${res.status}: ${bodyText}`);
                let parsedError: any = null;
                try {
                    parsedError = JSON.parse(bodyText);
                } catch {}
                const msg = parsedError?.error?.message || `Azure API error ${res.status}: ${bodyText}`;
                const azureError: any = new Error(msg);
                azureError.status = res.status;
                azureError.statusCode = res.status;
                azureError.code = parsedError?.error?.code || (res.status === 403 ? 'AuthorizationFailed' : undefined);
                azureError.details = parsedError || bodyText;
                throw azureError;
            }"""

    if target not in content:
        print("Target not found in remediationService.ts or already patched!")
    else:
        content = content.replace(target, replacement, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Successfully patched src/services/remediationService.ts")

def patch_api_errors():
    path = os.path.join(BASE_DIR, "src/lib/apiErrors.ts")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    target_status = """export function errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const e = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    for (const v of [e.status, e.statusCode, e.code]) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\\d+$/.test(v) ? Number(v) : NaN;
        // Acotado al rango HTTP valido: `code` tambien lleva errnos de driver
        // (p. ej. 1045 de MySQL) y devolverlos haria que NextResponse lance
        // RangeError al construir la respuesta.
        if (n >= 100 && n <= 599) return n;
    }
    return undefined;
}"""

    replacement_status = """export function errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
    for (const v of [e.status, e.statusCode, e.code]) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\\d+$/.test(v) ? Number(v) : NaN;
        // Acotado al rango HTTP valido: `code` tambien lleva errnos de driver
        // (p. ej. 1045 de MySQL) y devolverlos haria que NextResponse lance
        // RangeError al construir la respuesta.
        if (n >= 100 && n <= 599) return n;
    }
    if (typeof e.message === 'string') {
        const match = e.message.match(/Azure API error (\\d{3})/i);
        if (match) {
            const n = Number(match[1]);
            if (n >= 100 && n <= 599) return n;
        }
    }
    return undefined;
}"""

    target_code = """/** Codigo de error no numerico de un SDK (p. ej. 'ETIMEDOUT', 'AuthorizationFailed'). */
export function errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const c = (error as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
}"""

    replacement_code = """/** Codigo de error no numerico de un SDK (p. ej. 'ETIMEDOUT', 'AuthorizationFailed'). */
export function errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const e = error as { code?: unknown; message?: unknown };
    const c = e.code;
    if (typeof c === 'string') return c;
    if (typeof e.message === 'string') {
        if (/AuthorizationFailed/i.test(e.message)) return 'AuthorizationFailed';
        if (/ResourceNotFound/i.test(e.message)) return 'ResourceNotFound';
        if (/Conflict/i.test(e.message)) return 'Conflict';
    }
    return undefined;
}"""

    if target_status in content:
        content = content.replace(target_status, replacement_status, 1)
        print("Patched errorStatus in src/lib/apiErrors.ts")
    if target_code in content:
        content = content.replace(target_code, replacement_code, 1)
        print("Patched errorCode in src/lib/apiErrors.ts")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def patch_onboarding_script():
    path = os.path.join(BASE_DIR, "src/lib/onboardingScriptTemplate.ts")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    target = """    "Microsoft.Network/networkWatchers/delete",
    "Microsoft.Network/networkWatchers/flowLogs/delete",
];"""

    replacement = """    "Microsoft.Network/networkWatchers/delete",
    "Microsoft.Network/networkWatchers/flowLogs/delete",
    // Conexiones de Logic Apps / iPaaS y otros recursos eliminables desde Remediación
    "Microsoft.Web/connections/delete",
    "Microsoft.Web/certificates/delete",
    "Microsoft.Sql/servers/elasticPools/delete",
    "Microsoft.Compute/availabilitySets/delete",
    "Microsoft.Network/routeTables/delete",
    "Microsoft.Network/ipGroups/delete",
];"""

    if target in content:
        content = content.replace(target, replacement, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Successfully updated BUSINESS_CUSTOM_ACTIONS in src/lib/onboardingScriptTemplate.ts")
    else:
        print("Target not found in onboardingScriptTemplate.ts or already updated!")

if __name__ == "__main__":
    patch_remediation_service()
    patch_api_errors()
    patch_onboarding_script()
    print("Patch application complete.")
