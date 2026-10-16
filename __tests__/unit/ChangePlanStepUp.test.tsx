import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestChallenge, fetchMock, t, accounts, instance } = vi.hoisted(() => ({
    requestChallenge: vi.fn(),
    fetchMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
    t: (key: string) => key,
    accounts: [{}],
    instance: {},
}));
vi.mock("next-intl", () => ({ useTranslations: () => t }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance, accounts }) }));
vi.mock("@/lib/msalToken", () => ({ getFreshIdToken: async () => "synthetic-id-token" }));
vi.mock("@/hooks/useMfaChallenge", () => ({
    useMfaChallenge: () => ({ requestChallenge, mfaModal: null }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ChangePlanModal from "@/components/admin/ChangePlanModal";

function show() {
    render(<ChangePlanModal open onClose={vi.fn()} onChanged={vi.fn()} tenantId="tenant-a"
        currentTier="Professional" currentBillingCycle="MONTHLY" />);
    return screen.getByRole("button", { name: "changePlanConfirm" });
}
beforeEach(() => {
    requestChallenge.mockReset();
    fetchMock.mockReset().mockImplementation(async (_url, init) =>
        Response.json(init?.method === "PATCH" ? { success: true } : { previewAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("ChangePlanModal exact MFA binding", () => {
    it("uses the same captured plan/cycle/proration after waiting for MFA even if form state changes", async () => {
        let complete!: (result: { challengeId: string; cancelled: boolean }) => void;
        requestChallenge.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
        const button = show();
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        await waitFor(() => expect(requestChallenge).toHaveBeenCalledOnce());
        expect(requestChallenge).toHaveBeenCalledWith("change_plan", {
            action: "change_subscription_plan", tenantId: "tenant-a",
            newTier: "Business", billing: "monthly", prorationBillingMode: "prorated_immediately",
        });
        fireEvent.click(screen.getByRole("button", { name: "changePlanYearly" }));
        await act(async () => { complete({ challengeId: "verified-synthetic-challenge", cancelled: false }); });
        await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
        const [url, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH")!;
        expect(url).toBe("/api/billing/subscription?tenantId=tenant-a");
        expect(JSON.parse(String(init?.body))).toEqual({
            newTier: "Business", billing: "monthly", prorationBillingMode: "prorated_immediately",
        });
        expect(init?.headers).toMatchObject({ "X-MFA-Challenge-Id": "verified-synthetic-challenge" });
    });
    it("does not submit a mutation when MFA is canceled", async () => {
        requestChallenge.mockResolvedValue({ challengeId: null, cancelled: true });
        const button = show();
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        await waitFor(() => expect(requestChallenge).toHaveBeenCalledOnce());
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    });
});
