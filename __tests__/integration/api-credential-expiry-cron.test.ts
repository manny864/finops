// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as cronGET } from "@/app/api/cron/credential-expiry-alerts/route";

const mocks = vi.hoisted(() => ({
    mockPoolQuery: vi.fn(),
    mockGetExpiringCredentials: vi.fn(),
    mockSendEmail: vi.fn(),
    mockSendWebhook: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/credentialExpiryService", () => ({
    getExpiringCredentials: mocks.mockGetExpiringCredentials,
}));

vi.mock("@/lib/emailHelper", () => ({
    sendEmailAsync: mocks.mockSendEmail,
}));

vi.mock("@/lib/notifications", () => ({
    sendLegacyWebhookAlert: mocks.mockSendWebhook,
}));

const SECRET = "una-clave-larga-de-cron-123";

function makeReq(auth?: string) {
    return new NextRequest(new URL("http://localhost:3000/api/cron/credential-expiry-alerts"), {
        headers: auth ? { authorization: auth } : {},
    });
}

const cred = (days: number, name = "app-sp") => ({
    appId: "a", displayName: name, credentialType: "password",
    credentialId: "k", expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
    daysTillExpiry: days, severity: "high",
});

describe("GET /api/cron/credential-expiry-alerts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
    });

    it("returns 401 without valid bearer", async () => {
        const res = await cronGET(makeReq("Bearer nope"));
        expect(res.status).toBe(401);
    });

    it("returns 503 when CRON_SECRET is missing", async () => {
        delete process.env.CRON_SECRET;
        const res = await cronGET(makeReq(`Bearer ${SECRET}`));
        expect(res.status).toBe(503);
    });

    it("notifies by email when credentials fall within the threshold and updates the rule", async () => {
        mocks.mockPoolQuery
            .mockResolvedValueOnce([[{ id: 1, tenant_id: "t1", rule_name: "Creds 30d", threshold_value: 30, channel: "email", channel_target: "ops@x.com" }], []])
            .mockResolvedValueOnce([{}, []]); // UPDATE last_triggered_at
        mocks.mockGetExpiringCredentials.mockResolvedValue([cred(5), cred(90, "lejana")]);

        const res = await cronGET(makeReq(`Bearer ${SECRET}`));
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.notified).toBe(1);
        expect(mocks.mockSendEmail).toHaveBeenCalledTimes(1);
        // Solo la credencial dentro del umbral (5 ≤ 30) viaja en el HTML.
        const html = mocks.mockSendEmail.mock.calls[0][1] as string;
        expect(html).toContain("app-sp");
        expect(html).not.toContain("lejana");
        expect(mocks.mockPoolQuery.mock.calls[1][0]).toContain("UPDATE AlertRules");
    });

    it("uses the webhook sender for slack/teams channels", async () => {
        mocks.mockPoolQuery
            .mockResolvedValueOnce([[{ id: 2, tenant_id: "t1", rule_name: "Creds slack", threshold_value: 15, channel: "slack", channel_target: "https://hooks.slack.com/x" }], []])
            .mockResolvedValueOnce([{}, []]);
        mocks.mockGetExpiringCredentials.mockResolvedValue([cred(-3, "vencida")]);

        const res = await cronGET(makeReq(`Bearer ${SECRET}`));
        const json = await res.json();
        expect(json.notified).toBe(1);
        expect(mocks.mockSendWebhook).toHaveBeenCalledWith(
            "https://hooks.slack.com/x",
            expect.objectContaining({ severity: "warning" })
        );
    });

    it("does not notify when no credentials are within the threshold", async () => {
        mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 3, tenant_id: "t1", rule_name: "r", threshold_value: 7, channel: "email", channel_target: "a@b.c" }], []]);
        mocks.mockGetExpiringCredentials.mockResolvedValue([cred(60)]);
        const res = await cronGET(makeReq(`Bearer ${SECRET}`));
        const json = await res.json();
        expect(json.notified).toBe(0);
        expect(mocks.mockSendEmail).not.toHaveBeenCalled();
    });
});
