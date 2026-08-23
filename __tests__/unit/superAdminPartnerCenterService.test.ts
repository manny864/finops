// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getPartnerCenterStatus,
    relinkPartner,
    configurePartnerMpn,
} from "@/services/superAdminPartnerCenter.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: mocks.mockPoolQuery,
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("superAdminPartnerCenter.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("getPartnerCenterStatus returns correct mock data and metrics when isMock is true", async () => {
        const result = await getPartnerCenterStatus(true);

        expect(result.success).toBe(true);
        expect(result.metrics.linkedPalCount).toBe(0);
        expect(result.metrics.approvedPendingCount).toBe(1);
        expect(result.metrics.linkErrorCount).toBe(2);
        expect(result.items.length).toBe(3);

        const acme = result.items.find((i) => i.tenantId === "tenant-acme-prod");
        expect(acme).toBeDefined();
        expect(acme?.status).toBe("APPROVED_PENDING");
        expect(acme?.planTier).toBe("Enterprise");
    });

    it("getPartnerCenterStatus queries database in real mode", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([
            [
                {
                    tenant_id: "tenant-1",
                    organization_name: "Contoso Ltd",
                    entra_guid: "contoso.onmicrosoft.com",
                    tier: "Enterprise",
                    partner_link_status: "LINKED",
                    partner_link_detail: "Vínculo activo",
                    partner_link_approved_by: "admin@contoso.com",
                    partner_link_approved_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                },
            ],
        ]);

        const result = await getPartnerCenterStatus(false);

        expect(result.success).toBe(true);
        expect(result.items.length).toBe(1);
        expect(result.metrics.linkedPalCount).toBe(1);
        expect(result.items[0].organizationName).toBe("Contoso Ltd");
        expect(result.items[0].status).toBe("LINKED");
        expect(mocks.mockPoolQuery).toHaveBeenCalled();
    });

    it("relinkPartner requests re-association for a given tenant", async () => {
        const result = await relinkPartner({ tenantId: "tenant-acme-prod" }, true);

        expect(result.success).toBe(true);
        expect(result.tenantId).toBe("tenant-acme-prod");
        expect(["APPROVED_PENDING", "LINK_ERROR"]).toContain(result.status);
    });

    it("configurePartnerMpn sets MPN ID in system settings", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([{}]);

        const result = await configurePartnerMpn({ partnerMpnId: "1234567" }, false);

        expect(result.success).toBe(true);
        expect(result.partnerMpnId).toBe("1234567");
        expect(mocks.mockPoolQuery).toHaveBeenCalled();
    });
});
