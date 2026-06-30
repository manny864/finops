import { WorkOS } from "@workos-inc/node";

let cached: WorkOS | null = null;

export function getWorkOS(): WorkOS {
    if (cached) return cached;
    
    const apiKey = process.env.WORKOS_API_KEY;
    const clientId = process.env.WORKOS_CLIENT_ID;
    
    if (!apiKey || !clientId) {
        throw new Error("WorkOS not configured (WORKOS_API_KEY / WORKOS_CLIENT_ID)");
    }
    
    cached = new WorkOS(apiKey, { clientId });
    return cached;
}

export function isWorkOSConfigured(): boolean {
    return !!(
        process.env.WORKOS_API_KEY &&
        process.env.WORKOS_CLIENT_ID &&
        !process.env.WORKOS_API_KEY.includes("placeholder")
    );
}
