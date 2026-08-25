import { describe, it, expect } from "vitest";

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

describe("M365 User Activity Classification", () => {
    it("should classify standard corporate users as Member even if tenant domain contains RPA/SVC", () => {
        expect(classifyUserType("mchavez@RPA365SA.onmicrosoft.com")).toBe("Member");
        expect(classifyUserType("aleverdet@rpa-enterprises.com")).toBe("Member");
        expect(classifyUserType("jdoe@servicecloud.com")).toBe("Member");
        expect(classifyUserType("manuel.chavez@rpa365.onmicrosoft.com")).toBe("Member");
    });

    it("should classify external B2B guests as Guest even if tenant domain contains RPA", () => {
        expect(classifyUserType("mchavez_ctrl365.com#EXT#@RPA365SA.onmicrosoft.com")).toBe("Guest");
        expect(classifyUserType("external_partner.org#ext#@contoso.onmicrosoft.com")).toBe("Guest");
        expect(classifyUserType("user@domain.com", "Guest")).toBe("Guest");
    });

    it("should classify service accounts correctly based on alias prefix/exact name", () => {
        expect(classifyUserType("svc_backup@rpa365sa.onmicrosoft.com")).toBe("ServiceAccount");
        expect(classifyUserType("svc-sql@company.com")).toBe("ServiceAccount");
        expect(classifyUserType("bot_billing@company.com")).toBe("ServiceAccount");
        expect(classifyUserType("digitalworker@company.com")).toBe("ServiceAccount");
        expect(classifyUserType("rpa@company.com")).toBe("ServiceAccount");
        expect(classifyUserType("adminrpa@company.com")).toBe("ServiceAccount");
        expect(classifyUserType("app_bot@company.com")).toBe("ServiceAccount");
    });
});
